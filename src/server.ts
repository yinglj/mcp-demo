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
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ToolSchema,
  ListPromptsResult,
  GetPromptResult,
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

// 定义 Prompt 数据
const PROMPTS: Record<string, { description: string; messages: Array<{ role: "user" | "assistant"; content: { type: "text"; text: string } }>; arguments: Array<{ name: string; description: string; required: boolean }> }> = {
  "execute-sql-query": {
    description: "A prompt for executing a SQL query on the database",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text",
          text: "Execute the following SQL query: {{query}} with parameters {{params}}",
        },
      },
    ],
    arguments: [
      {
        name: "query",
        description: "The SQL query to execute (e.g., 'SELECT * FROM users')",
        required: true,
      },
      {
        name: "params",
        description: "Optional parameters for the SQL query to prevent SQL injection",
        required: false,
      },
    ],
  },
  "get-table-schema": {
    description: "A prompt for retrieving the schema of a specific table in a database",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text",
          text: "Retrieve the schema of table {{table}} in database {{database}}",
        },
      },
    ],
    arguments: [
      {
        name: "database",
        description: "The name of the database (e.g., 'mysql')",
        required: true,
      },
      {
        name: "table",
        description: "The name of the table (e.g., 'user')",
        required: true,
      },
    ],
  },
  "insert-data": {
    description: "A prompt for inserting data into a specific table",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text",
          text: "Insert the following data into table {{table}}: {{data}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to insert data into (e.g., 'users')",
        required: true,
      },
      {
        name: "data",
        description: "The data to insert as a JSON object (e.g., '{\"name\": \"John\", \"age\": 30}')",
        required: true,
      },
    ],
  },
  "update-data": {
    description: "A prompt for updating data in a specific table",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text",
          text: "Update table {{table}} with data {{data}} where {{condition}} with parameters {{params}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to update (e.g., 'users')",
        required: true,
      },
      {
        name: "data",
        description: "The data to update as a JSON object (e.g., '{\"age\": 31}')",
        required: true,
      },
      {
        name: "condition",
        description: "The WHERE condition for the update (e.g., 'id = ?')",
        required: true,
      },
      {
        name: "params",
        description: "Optional parameters for the condition to prevent SQL injection",
        required: false,
      },
    ],
  },
  "delete-data": {
    description: "A prompt for deleting data from a specific table",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text",
          text: "Delete data from table {{table}} where {{condition}} with parameters {{params}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to delete data from (e.g., 'users')",
        required: true,
      },
      {
        name: "condition",
        description: "The WHERE condition for the deletion (e.g., 'id = ?')",
        required: true,
      },
      {
        name: "params",
        description: "Optional parameters for the condition to prevent SQL injection",
        required: false,
      },
    ],
  },
  "create-table": {
    description: "A prompt for creating a new table in the database",
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text",
          text: "Create a new table named {{table}} with columns {{columns}}",
        },
      },
    ],
    arguments: [
      {
        name: "table",
        description: "The name of the table to create (e.g., 'employees')",
        required: true,
      },
      {
        name: "columns",
        description: "The columns definition as a JSON array (e.g., '[{\"name\": \"id\", \"type\": \"INT\", \"constraints\": \"PRIMARY KEY\"}]')",
        required: true,
      },
    ],
  },
};

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
    // 将 result 序列化为字符串，并使用 type: "text"
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2), // 格式化 JSON 字符串
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

// 定义 getPromptHandler 函数，以便复用
const getPromptHandler = async (name: string): Promise<GetPromptResult> => {
  logger.info("Getting prompt", { name });

  const prompt = PROMPTS[name];
  if (!prompt) {
    logger.warn("Prompt not found", { name });
    throw new McpError(ErrorCode.MethodNotFound, `Unknown prompt: ${name}`);
  }

  return {
    description: prompt.description,
    messages: prompt.messages,
  };
};

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

// 定义 listPromptsHandler 函数，以便复用
const listPromptsHandler = async (): Promise<ListPromptsResult> => {
  logger.info("Listing prompts");
  return {
    prompts: Object.entries(PROMPTS).map(([name, prompt]) => ({
      name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  };
};

// 处理 prompt 列表请求
server.setRequestHandler(ListPromptsRequestSchema, listPromptsHandler);

// 处理获取 prompt 请求
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name } = request.params;
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