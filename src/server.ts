// src/server.ts

import { config } from "./tools/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { shutdownMySQL } from "./tools/mysql";
import { logger } from "./tools/logger";
import { registerToolHandlers } from "./handlers/toolHandlers";
import { registerResourceHandlers } from "./handlers/resourceHandlers";
import { registerPromptHandlers } from "./handlers/promptHandlers";

// 创建 MCP Server
const server = new Server(
  {
    name: "mysql-mcp-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// 注册所有请求处理
registerToolHandlers(server);
registerResourceHandlers(server);
registerPromptHandlers(server);

// 初始化 Express 应用
const app = express();

let transport_sse: SSEServerTransport;

app.get("/sse", async (req, res) => {
  logger.info("Received SSE connection");
  transport_sse = new SSEServerTransport("/message", res);
  await server.connect(transport_sse);
});

app.post("/message", async (req, res) => {
  logger.info("Received SSE message");
  await transport_sse.handlePostMessage(req, res);
});

// 启动 Stdio 传输
async function startStdioTransport() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Stdio transport connected");
}

// 启动服务器
async function startServer() {
  await startStdioTransport();
  const PORT = Number(config.port) || 3001;
  app.listen(PORT, () => {
    logger.info(`MySQL MCP Server running on port ${PORT}`);
  });
}

// 优雅关闭
async function shutdown() {
  logger.info("Shutting down server...");
  await shutdownMySQL();
  logger.info("Server shut down successfully");
}

// 运行服务器
startServer().catch((error) => {
  logger.error("Server startup failed", { error: error.message });
  process.exit(1);
});

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});