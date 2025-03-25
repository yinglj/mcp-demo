// mcp-client/src/infra/serverConnection.ts

import { Client, ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";


interface ClientInfo {
  name: string;
  version: string;
  [key: string]: unknown; // Add index signature
}

interface ServerConfig {
  command: string;
  args: string[];
}

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
}

interface Resource {
  uri: string;
  mimeType: string;
  name: string;
  description: string;
}

interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

interface Prompt {
  name: string;
  description: string;
  arguments: PromptArgument[];
}

interface PromptMessage {
  role: string;
  content: { type: string; text: string };
}

interface ServerInfo {
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  promptTemplates: Record<string, { description: string; messages: PromptMessage[] }>;
  latency: number;
  load: number;
}

export class ServerConnection {
  private clients: Map<string, Client> = new Map();
  public serverInfo: Map<string, ServerInfo> = new Map();

  async connectToServers(servers: Record<string, ServerConfig>): Promise<void> {
    if (!Object.keys(servers).length) {
      console.log("No servers found in configuration.");
      return;
    }

    for (const [serverName, serverConfig] of Object.entries(servers)) {
      const { command, args } = serverConfig;

      if (!command || !Array.isArray(args)) {
        console.log(`Invalid configuration for server ${serverName}: ${JSON.stringify(serverConfig)}`);
        continue;
      }

      let transportType: "stdio" | "sse";
      let address: string;
      let port: number;

      if (command.toLowerCase() === "sse") {
        transportType = "sse";
        if (!args.length || !args[0].startsWith("http")) {
          console.log(`Invalid SSE URL for server ${serverName}: ${args}`);
          continue;
        }
        const url = args[0];
        address = url.split("://")[1].split(":")[0];
        const portPart = url.split(":").slice(-1)[0]?.split("/")[0];
        port = portPart ? parseInt(portPart) : 0;
      } else {
        transportType = "stdio";
        address = args[0] || "";
        port = 0;
      }

      console.log(`Connecting to server: ${serverName} at ${address}:${port} (Transport: ${transportType})`);
      await this.connectToServer(serverName, transportType, command, args);
    }
  }

  async connectToServer(serverName: string, transportType: "stdio" | "sse", command: string, args: string[]): Promise<void> {
    try {
      const clientInfo: ClientInfo = {
        name: `mcp-client-${serverName}`,
        version: "1.0.0",
      };
      const clientOptions: ClientOptions = {
        capabilities: {
          prompts: {},
          resources: {},
          tools: {},
        },
      };
      const client = new Client(clientInfo, clientOptions);

      if (transportType === "stdio") {
        const transport = new StdioClientTransport({ command, args });
        await client.connect(transport);
      } else {
        const url = args[0];
        const transport = new SSEClientTransport(new URL(url));
        await client.connect(transport);
      }

      const startTime = Date.now();

      const toolsResponse = await client.listTools();
      const resourcesResponse = await client.listResources();
      const promptsResponse = await client.listPrompts();
      const latency = Date.now() - startTime;

      const tools = toolsResponse.tools.map((tool: { name: string; description?: string; inputSchema: any }) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || {},
      }));

      const resources = resourcesResponse.resources.map(
        (resource: { uri: string; mimeType?: string; name: string; description?: string }) => ({
          uri: resource.uri,
          mimeType: resource.mimeType || "application/octet-stream",
          name: resource.name,
          description: resource.description || "",
        })
      );

      const prompts = promptsResponse.prompts.map(
        (prompt: { name: string; description?: string; arguments?: Array<{ name: string; description?: string; required?: boolean }> }) => ({
          name: prompt.name,
          description: prompt.description || "",
          arguments: (prompt.arguments || []).map((arg: { name: string; description?: string; required?: boolean }) => ({
            name: arg.name,
            description: arg.description || "",
            required: arg.required || false,
          })),
        })
      );

      const promptTemplates: Record<string, { description: string; messages: PromptMessage[] }> = {};
      for (const prompt of prompts) {
        const promptName = prompt.name;
        const promptResponse = await client.getPrompt({ name: promptName });
        promptTemplates[promptName] = {
          description: promptResponse.description||"",
          messages: (promptResponse.messages || []).map((msg: { role: "user" | "assistant"; content: { type: string; text?: string; data?: string; mimeType?: string } }) => ({
            role: msg.role,
            content: msg.content.type === "text" && msg.content.text
              ? { type: "text", text: msg.content.text }
              : { type: "text", text: `[Unsupported content type: ${msg.content.type}]` },
          })),
        };
      }

      this.clients.set(serverName, client);
      this.serverInfo.set(serverName, {
        tools,
        resources,
        prompts,
        promptTemplates,
        latency,
        load: 0.0,
      });

      console.log(`\nConnected to ${serverName} with tools: ${tools.map((tool: { name: string }) => tool.name)}, latency: ${latency}ms`);
    } catch (error) {
      console.log(`Failed to connect to ${serverName}: ${error}`);
      this.clients.delete(serverName);
      this.serverInfo.delete(serverName);
    }
  }

  getSession(serverName: string): Client | undefined {
    return this.clients.get(serverName);
  }

  async cleanup(): Promise<void> {
    for (const [serverName, client] of this.clients.entries()) {
      await client.close();
      this.clients.delete(serverName);
    }
  }
}