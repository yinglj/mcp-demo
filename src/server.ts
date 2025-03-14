import { config } from "./tools/config"; // 确保路径正确
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { mysqlTools, shutdownMySQL } from "./tools/mysql";
import { z } from "zod";
import { QueryArgsSchema, TableInfoArgsSchema, InsertArgsSchema, UpdateArgsSchema, DeleteArgsSchema, CreateTableArgsSchema } from "./types/schemas";
import { zodToJsonSchema } from "zod-to-json-schema";
import { logger } from "./tools/logger";

// 定义增强的上下文类型
interface ToolContext {
  role?: string;
}

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
    },
  }
);

// 处理工具列表请求
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

// 处理工具调用请求
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
      content: [{ type: "json", data: result }],
    };
  } catch (error: any) {
    logger.error("Tool execution failed", { tool: name, error });
    throw new McpError(
      ErrorCode.InternalError,
      `Error: ${error.message || String(error)}`
    );
  }
});

// 处理资源列表请求
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  logger.info("Listing resources");
  return {
    resources: [
      {
        uri: "mysql://tables",
        mimeType: "application/json",
        name: "Database Tables",
      },
    ],
  };
});

// 处理资源读取请求
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  logger.info("Reading resource", { uri });

  if (uri === "mysql://tables") {
    return {
      contents: [
        {
          uri: "mysql://tables",
          mimeType: "application/json",
          blob: JSON.stringify({ message: "List of tables (placeholder)" }),
        },
      ],
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, `Unknown resource: ${uri}`);
});

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
  const PORT = Number(config.port) || 3001; // 使用 config 中的端口，确保一致
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
  logger.error("Server startup failed", { error });
  process.exit(1);
});

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});