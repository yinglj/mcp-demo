// mcp-server/src/core/handlers/promptHandler.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { GetPromptRequestSchema, ListPromptsRequestSchema, ListResourceTemplatesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "../../infra/logger";
import { getPromptHandler, listPromptsHandler } from "../promptData";

export function registerPromptHandlers(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    logger.info("Listing prompts");
    return await listPromptsHandler();
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    logger.info("Getting prompt", { name });
    return await getPromptHandler(name);
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    logger.info("Handling list_resource_templates request");
    const { prompts } = await listPromptsHandler();

    const resourceTemplates = prompts.map((prompt: { name: string; description?: string }) => ({
      uriTemplate: `mysql://prompts/{prompt_name}`,
      name: `Prompt: ${prompt.name}`,
      mimeType: "application/json",
      description: prompt.description || "No description available",
    }));

    return {
      resourceTemplates: resourceTemplates,
    };
  });
}