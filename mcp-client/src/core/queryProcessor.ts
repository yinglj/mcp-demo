import { LLMClient } from "./llmClient";
import { ServerConnection } from "../infra/serverConnection";
import { PromptMessage } from "@modelcontextprotocol/sdk/types.js";

interface ServerInfo {
  tools: Array<{ name: string; description: string; inputSchema: any }>;
  resources: Array<{ uri: string; mimeType: string; name: string; description: string }>;
  prompts: Array<{ name: string; description: string; arguments: Array<{ name: string; description: string; required: boolean }> }>;
  promptTemplates: Record<string, { description: string; messages: PromptMessage[] }>;
  latency: number;
  load: number;
}

interface ToolResultContent {
  type: "json" | "text" | string;
  data?: any;
  text?: string;
}

interface ToolResult {
  content: ToolResultContent[];
}

export class QueryProcessor {
  private llmClient: LLMClient;
  private serverConnection: ServerConnection;

  constructor(llmClient: LLMClient, serverConnection: ServerConnection) {
    this.llmClient = llmClient;
    this.serverConnection = serverConnection;
  }

  async selectPromptAndFill(
    serverName: string,
    query: string
  ): Promise<{ promptName: string; messages: Array<{ role: string; content: string }>; args: Record<string, any> } | null> {
    const serverInfo = this.serverConnection.serverInfo.get(serverName);
    if (!serverInfo) {
      console.log(`Server info for ${serverName} not found.`);
      return null;
    }

    const mappedServerInfo = {
      ...serverInfo,
      promptTemplates: Object.fromEntries(
        Object.entries(serverInfo.promptTemplates).map(([key, value]) => [
          key,
          {
            ...value,
            messages: value.messages.map((msg) => ({
              role: msg.role,
              content: msg.content.text, // Map content to string
            })),
          },
        ])
      ),
    };
    const selectedPromptName = await this.llmClient.selectPrompt(mappedServerInfo, query);
    if (!selectedPromptName) {
      console.log("No suitable prompt selected.");
      return null;
    }

    const selectedPrompt = serverInfo.prompts.find((p: { name: string }) => p.name === selectedPromptName);
    if (!selectedPrompt) {
      console.log(`Selected prompt '${selectedPromptName}' not found in prompts list.`);
      return null;
    }

    const promptName = selectedPrompt.name;
    const promptTemplate = serverInfo.promptTemplates[promptName];
    if (!promptTemplate) {
      console.log(`Prompt template for '${promptName}' not found.`);
      return null;
    }

    const promptArgs = selectedPrompt.arguments;
    let args: Record<string, any> = {};
    if (promptArgs.length > 0) {
      args = await this.llmClient.extractPromptArguments(promptArgs, query);
      if (!args) {
        console.log("Failed to extract prompt arguments.");
        return null;
      }
    }

    const filledMessages = promptTemplate.messages.map((msg: { role: string; content: { type: string; text: string } }) => {
      let content = msg.content.text;
      for (const [argName, argValue] of Object.entries(args)) {
        const placeholder = `{{${argName}}}`;
        const value = argValue === "" ? "N/A" : argValue;
        content = content.replace(placeholder, String(value));
      }
      return { role: msg.role, content };
    });

    return {
      promptName,
      messages: filledMessages,
      args,
    };
  }

  async processQuery(query: string): Promise<string> {
    try {
      const transformedServerInfo = new Map(
        Array.from(this.serverConnection.serverInfo.entries()).map(([key, value]) => [
          key,
          {
            ...value,
            promptTemplates: Object.fromEntries(
              Object.entries(value.promptTemplates).map(([templateKey, templateValue]) => [
                templateKey,
                {
                  ...templateValue,
                  messages: templateValue.messages.map((msg) => ({
                    role: msg.role,
                    content: msg.content.text, // Transform content to string
                  })),
                },
              ])
            ),
          },
        ])
      );
      const selectedServer = await this.llmClient.selectServer(query, transformedServerInfo);
      if (!selectedServer) {
        return "No suitable MCP server found to handle this query.";
      }

      const session = this.serverConnection.getSession(selectedServer);
      if (!session) {
        return `Session for server ${selectedServer} not found.`;
      }

      const serverInfo = this.serverConnection.serverInfo.get(selectedServer);
      if (!serverInfo) {
        return `Server info for ${selectedServer} not found.`;
      }

      const tools = serverInfo.tools;
      console.log(`Selected server: ${selectedServer}`);
      console.log(`Available tools: ${JSON.stringify(tools.map((tool: { name: string }) => tool.name))}`);

      const correctedQuery = query.replace("excute", "execute");
      console.log(`Corrected query: ${correctedQuery}`);

      const promptInfo = await this.selectPromptAndFill(selectedServer, correctedQuery);
      let userMessage: string;
      if (promptInfo) {
        console.log(`Selected prompt: ${promptInfo.promptName}, filled messages: ${JSON.stringify(promptInfo.messages)}`);
        userMessage = promptInfo.messages.map((msg: { role: string; content: string }) => msg.content).join("\n");
      } else {
        userMessage = correctedQuery;
      }
      console.log(`User message: ${userMessage}`);

      const toolCall = await this.llmClient.selectTool(tools, userMessage);
      const toolName = toolCall.tool_name;
      let toolArguments = toolCall.arguments || {};

      if (!toolName) {
        return "LLM could not determine which tool to use.";
      }

      if (Object.keys(toolArguments).length === 0) {
        const tool = tools.find((t: { name: string }) => t.name === toolName);
        if (tool) {
          toolArguments = await this.llmClient.extractToolArguments(tool, correctedQuery);
          console.log(`Extracted arguments: ${JSON.stringify(toolArguments)}`);
        }
      }

      console.log(`Using tool: ${toolName} with arguments: ${JSON.stringify(toolArguments)}`);
      const validatedArguments = toolArguments; // Assuming toolArguments are already valid
      if (!validatedArguments || Object.keys(validatedArguments).length === 0) {
        throw new Error(`Invalid or missing arguments for tool: ${toolName}`);
      }
      const schema = tools.find((t: { name: string }) => t.name === toolName)?.inputSchema;
      if (!schema) {
        throw new Error(`Schema for tool ${toolName} not found.`);
      }
      const parsedArguments = schema.parse(validatedArguments);
      const rawResult = await session.callTool({ name: toolName }, parsedArguments);
      const result: ToolResult = {
        content: (rawResult.content as ToolResultContent[]) || [], // Ensure content is mapped correctly
      };
      console.log(`Raw tool result: ${JSON.stringify(result)}`);

      let resultText: string;
      if (result.content && result.content.length > 0) {
        const firstItem = result.content[0];
        if (firstItem.type === "json" && firstItem.data) {
          resultText = JSON.stringify(firstItem.data, null, 2);
        } else if (firstItem.type === "text" && firstItem.text) {
          resultText = firstItem.text;
        } else {
          resultText = `Unsupported content type: ${firstItem.type}`;
        }
      } else {
        resultText = "No content returned from tool.";
      }

      serverInfo.load = Math.min(serverInfo.load + 1.0, 100.0);
      return `Result from ${selectedServer}:\n${resultText}`;
    } catch (error) {
      console.error(`Error processing query: ${error instanceof Error ? error.message : String(error)}`);
      return `Failed to process query: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}