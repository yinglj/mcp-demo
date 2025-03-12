import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import axios from "axios";
import * as fs from "fs/promises";
import { join } from "path";

// 读取配置文件
interface McpServerConfig {
  command: string;
  args: string[];
}

interface Config {
  mcpServers: Record<string, McpServerConfig>;
  defaultServer: string;
}

async function loadConfig(): Promise<Config> {
  const configPath = join(process.cwd(), "mcp_server_config.json");
  try {
    const configData = await fs.readFile(configPath, "utf-8");
    return JSON.parse(configData) as Config;
  } catch (error) {
    console.error("DEBUG: Failed to load mcp_server_config.json:", error);
    throw new Error("Configuration file not found or invalid");
  }
}

// Ollama API 配置
const OLLAMA_API_URL = "http://localhost:11434/api/chat";
const OLLAMA_MODEL = "deepseek-r1:1.5b";

async function main() {
  const config = await loadConfig();
  const serverName = process.env.MCP_SERVER || config.defaultServer;

  if (!config.mcpServers[serverName]) {
    throw new Error(`Server "${serverName}" not found in config`);
  }

  const serverConfig = config.mcpServers[serverName];
  console.log(`DEBUG: Connecting to server: ${serverName}`);

  const fileTransport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
  });

  const client = new Client(
    {
      name: "FileClient",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    }
  );

  try {
    console.log("DEBUG: Connecting to file server...");
    await client.connect(fileTransport);
    console.log("DEBUG: File server connection established");

    console.log("DEBUG: Requesting resource...");
    const resource = await client.readResource({ uri: "file:///test.txt" });

    const fileContent = resource.contents[0]?.text; 
    if (typeof fileContent !== "string") {
        throw new Error("File content is not a string");
    }

    console.log("File content from server:", fileContent);

    console.log("DEBUG: Initiating intelligent conversation with Ollama...");
    const userInput = "Hello! Can you summarize the file content for me?";
    const ollamaResponse = await chatWithOllama(userInput, fileContent);
    console.log("Ollama response:", ollamaResponse);

  } catch (error) {
    console.error("DEBUG: Error occurred:", error);
  } finally {
    console.log("DEBUG: Closing client...");
    await client.close();
  }
}

async function chatWithOllama(message: string, context?: string) {
  try {
    const payload = {
      model: OLLAMA_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant. Summarize or answer based on the provided context if available.",
        },
        ...(context ? [{ role: "user", content: `Context: ${context}` }] : []),
        { role: "user", content: message },
      ],
      stream: false,
    };

    const response = await axios.post(OLLAMA_API_URL, payload, {
      headers: { "Content-Type": "application/json" },
    });

    return response.data.message.content;
  } catch (error) {
    console.error("DEBUG: Ollama API error:", error);
    throw new Error("Failed to communicate with Ollama");
  }
}

main().catch(console.error);