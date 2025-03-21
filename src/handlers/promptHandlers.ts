// src/handlers/promptHandlers.ts

import { GetPromptRequestSchema, ListPromptsRequestSchema, ListResourceTemplatesRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { logger } from "../tools/logger";
import { getPromptHandler, listPromptsHandler } from "../prompts";

// 注册 Prompt 相关的请求处理
export const registerPromptHandlers = (server: Server) => {
  // 处理 prompt 列表请求
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    logger.info("Listing prompts");
    return await listPromptsHandler();
  });

  // 处理获取 prompt 请求
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    logger.info("Getting prompt", { name });
    return await getPromptHandler(name);
  });

  // 新增 list_resource_templates 方法
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    logger.info("Handling list_resource_templates request");
    // 获取所有 prompt 作为资源模板的基础
    const { prompts } = await listPromptsHandler();

    // 明确定义 prompt 的类型
    const resourceTemplates = prompts.map((prompt: { name: string; description?: string }) => ({
      uriTemplate: `mysql://prompts/{prompt_name}`, // 动态 URI 模板
      name: `Prompt: ${prompt.name}`,
      mimeType: "application/json",
      description: prompt.description || "No description available",
    }));

    return {
      resourceTemplates: resourceTemplates,
    };
  });
};