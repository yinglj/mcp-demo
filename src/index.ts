import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { number, z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const server = new Server(
  {
    name: "mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

const AddSchema = z.object({
  a: z.number().describe("First number"),
  b: z.number().describe("Second number"),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "calculate_sum",
        description: "Add two numbers together",
        inputSchema: zodToJsonSchema(AddSchema) as ToolInput,
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  if (request.params.name === "calculate_sum") {
    const validatedArgs = AddSchema.parse(args);
    const sum = validatedArgs.a + validatedArgs.b;
    return {
      content: [
        {
          type: "text",
          text: `The sum of ${validatedArgs.a} and ${validatedArgs.b} is ${sum}.`,
        },
      ],
    };
  }
  throw new McpError(ErrorCode.MethodNotFound, "Tool not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);

const app = express();

let transport_sse: SSEServerTransport;

app.get("/sse", async (req, res) => {
  console.log("Received connection");
  transport_sse = new SSEServerTransport("/message", res);
  await server.connect(transport_sse);
});

app.post("/message", async (req, res) => {
  console.log("Received message");

  await transport_sse.handlePostMessage(req, res);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});