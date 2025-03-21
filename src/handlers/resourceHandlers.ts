// src/handlers/resourceHandlers.ts

import { ErrorCode, ListResourcesRequestSchema, McpError, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { mysqlTools } from "../tools/mysql";
import { logger } from "../tools/logger";
import { getPromptHandler } from "../prompts";

// 注册资源相关的请求处理
export const registerResourceHandlers = (server: Server) => {
  // 处理资源列表请求
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    logger.info("Listing resources");
    return {
      resources: [
        {
          uri: "mysql://tables",
          mimeType: "application/json",
          name: "Database Tables",
          description: "A list of all tables in the MySQL database",
        },
      ],
    };
  });

  // 处理资源读取请求
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    logger.info("Reading resource", { uri });

    if (uri === "mysql://tables") {
      const tables = await mysqlTools.getTableSchema.handler({ database: "mysql", table: "tables" });
      return {
        contents: [
          {
            uri: "mysql://tables",
            mimeType: "application/json",
            text: JSON.stringify(tables),
          },
        ],
      };
    }

    // 支持动态资源读取，例如 mysql://prompts/execute-sql-query
    const promptMatch = uri.match(/^mysql:\/\/prompts\/(.+)$/);
    if (promptMatch) {
      const promptName = promptMatch[1];
      try {
        const prompt = await getPromptHandler(promptName);
        return {
          contents: [
            {
              uri: uri,
              mimeType: "application/json",
              text: JSON.stringify({
                name: promptName,
                description: prompt.description,
                messages: prompt.messages,
              }, null, 2),
            },
          ],
        };
      } catch (error: any) {
        logger.error("Failed to read prompt resource", { uri, error: error.message });
        throw error;
      }
    }

    logger.warn("Unknown resource requested", { uri });
    throw new McpError(ErrorCode.MethodNotFound, `Unknown resource: ${uri}`);
  });
};