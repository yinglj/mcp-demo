// mcp-server/src/core/handlers/resourceHandler.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, ListResourcesRequestSchema, McpError, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mysqlTools } from "../../infra/mysqlTools";
import { logger } from "../../infra/logger";
import { getPromptHandler } from "../promptData";

export function registerResourceHandlers(server: Server): void {
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
              text: JSON.stringify(
                {
                  name: promptName,
                  description: prompt.description,
                  messages: prompt.messages,
                },
                null,
                2
              ),
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
}