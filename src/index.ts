import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ToolSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesResultSchema,
  Resource,
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
      resources: {},
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

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "file:///images",
        mimeType: "image/png",
        name: "Generated Images",
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "file:///images") {
    return {
      contents: [
        {
          uri: "everart://images",
          mimeType: "image/png",
          blob: "", // Empty since this is just for listing
        },
      ],
    };
  }

  const uri = request.params.uri;

  if (uri.startsWith("test://static/resource/")) {
    const index = parseInt(uri.split("/").pop() ?? "", 10) - 1;
    if (index >= 0 && index < ALL_RESOURCES.length) {
      const resource = ALL_RESOURCES[index];
      return {
        contents: [resource],
      };
    }
  }

  throw new Error(`Unknown resource: ${uri}`);
});

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  return {
    resourceTemplates: [
      {
        uriTemplate: "test://static/resource/{id}",
        name: "Static Resource",
        description: "A static resource with a numeric ID",
      },
    ],
  };
});

const ALL_RESOURCES: Resource[] = Array.from({ length: 100 }, (_, i) => {
  const uri = `test://static/resource/${i + 1}`;
  if (i % 2 === 0) {
    return {
      uri,
      name: `Resource ${i + 1}`,
      mimeType: "text/plain",
      text: `Resource ${i + 1}: This is a plaintext resource`,
    };
  } else {
    const buffer = Buffer.from(`Resource ${i + 1}: This is a base64 blob`);
    return {
      uri,
      name: `Resource ${i + 1}`,
      mimeType: "application/octet-stream",
      blob: buffer.toString("base64"),
    };
  }
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