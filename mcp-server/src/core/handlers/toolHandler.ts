// mcp-server/src/core/handlers/toolHandler.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { mysqlTools } from "../../infra/mysqlTools";
import { z } from "zod";
import { QueryArgsSchema, TableInfoArgsSchema, InsertArgsSchema, UpdateArgsSchema, DeleteArgsSchema, CreateTableArgsSchema } from "../../types/schemas";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logger } from "../../infra/logger";
import { ToolContext } from "../../common/toolContext";

export function registerToolHandlers(server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.info("Listing available tools");
    return {
      tools: Object.values(mysqlTools).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args, context } = request.params;
    const tool = Object.values(mysqlTools).find((t) => t.name === name);

    logger.info("Tool called", { tool: name, args, context });

    if (!tool) {
      logger.warn("Unknown tool requested", { name });
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }

    const userRole = (context as ToolContext | undefined)?.role || "admin";
    if (name === "execute_query" && userRole !== "admin") {
      logger.warn("Permission denied", { tool: name, role: userRole });
      throw new McpError(ErrorCode.InvalidRequest, "Permission denied: Admin role required");
    }

    try {
      const validatedArgs = tool.inputSchema.parse(args);
      let result;
      switch (name) {
        case "execute_query":
          result = await mysqlTools.executeQuery.handler(validatedArgs as z.infer<typeof QueryArgsSchema>);
          break;
        case "get_table_schema":
          result = await mysqlTools.getTableSchema.handler(validatedArgs as z.infer<typeof TableInfoArgsSchema>);
          break;
        case "insert_data":
          result = await mysqlTools.insertData.handler(validatedArgs as z.infer<typeof InsertArgsSchema>);
          break;
        case "update_data":
          result = await mysqlTools.updateData.handler(validatedArgs as z.infer<typeof UpdateArgsSchema>);
          break;
        case "delete_data":
          result = await mysqlTools.deleteData.handler(validatedArgs as z.infer<typeof DeleteArgsSchema>);
          break;
        case "create_table":
          result = await mysqlTools.createTable.handler(validatedArgs as z.infer<typeof CreateTableArgsSchema>);
          break;
        default:
          throw new Error("Unexpected tool name");
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error: any) {
      logger.error("Tool execution failed", { tool: name, error: error.message });
      throw new McpError(
        ErrorCode.InternalError,
        `Error executing tool ${name}: ${error.message || String(error)}`
      );
    }
  });
}