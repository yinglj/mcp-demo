// mcp-client/src/core/queryProcessor.ts

import { LLMClient } from "./llmClient";
import { ServerConnection } from "../infra/serverConnection";
import { PromptMessage } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

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
  content: ToolResultContent[] | undefined;
}

// Utility function to convert JSON schema to zod schema
function jsonSchemaToZod(jsonSchema: any): z.ZodType<any> {
  if (!jsonSchema || typeof jsonSchema !== "object") {
    return z.any();
  }

  if (jsonSchema.type === "object" && jsonSchema.properties) {
    const shape: Record<string, z.ZodType<any>> = {};
    for (const [key, prop] of Object.entries(jsonSchema.properties)) {
      const propSchema = prop as any;
      let zodField: z.ZodType<any>;

      switch (propSchema.type) {
        case "string":
          zodField = z.string();
          if (propSchema.minLength && zodField instanceof z.ZodString) {
            zodField = zodField.min(propSchema.minLength);
          }
          break;
        case "number":
          zodField = z.number();
          break;
        default:
          zodField = z.any();
      }

      shape[key] = jsonSchema.required?.includes(key) ? zodField : zodField.optional();
    }
    return jsonSchema.additionalProperties === false ? z.object(shape).strict() : z.object(shape);
  }

  return z.any();
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
              content: msg.content.text,
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
    console.log(`processQuery: ${query}`);
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
                    content: msg.content.text,
                  })),
                },
              ])
            ),
          },
        ])
      );
      console.log(`begin this.llmClient.selectServer: ${query}`);
      const selectedServer = await this.llmClient.selectServer(query, transformedServerInfo);
      if (!selectedServer) {
        console.log(`No suitable MCP server found to handle this query.`);
        return "No suitable MCP server found to handle this query.";
      }
      console.log(`end this.llmClient.selectServer: ${query}`);

      const session = this.serverConnection.getSession(selectedServer);
      if (!session) {
        return `Session for server ${selectedServer} not found.`;
      }

      const serverInfo = this.serverConnection.serverInfo.get(selectedServer);
      if (!serverInfo) {
        return `Server info for ${selectedServer} not found.`;
      }

      console.log(`Selected server: ${selectedServer}`);
      const tools = serverInfo.tools;
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
      const validatedArguments = toolArguments;
      if (!validatedArguments || Object.keys(validatedArguments).length === 0) {
        throw new Error(`Invalid or missing arguments for tool: ${toolName}`);
      }

      const schema = tools.find((t: { name: string }) => t.name === toolName)?.inputSchema;
      if (!schema) {
        throw new Error(`Schema for tool ${toolName} not found.`);
      }

      const zodSchema = jsonSchemaToZod(schema);
      console.info(`Using schema: ${JSON.stringify(schema)}, validatedArguments: ${JSON.stringify(validatedArguments)}`);
      const parsedArguments = zodSchema.parse(validatedArguments);
      console.log(`Parsed arguments after zod validation: ${JSON.stringify(parsedArguments)}`);

      // Construct MCP-compliant params object
      const toolCallParams = {
        name: toolName,
        arguments: parsedArguments,
        _meta: { progressToken: 0 }, // Included as per MCP Inspector format
      };
      console.log(`Calling tool with params: ${JSON.stringify(toolCallParams)}`);
      const rawResult = await session.callTool(toolCallParams);
      console.log(`Raw tool result: ${JSON.stringify(rawResult)}`);

      let resultText: string;
      if (Array.isArray(rawResult.content) && rawResult.content.length > 0) {
        const firstItem = rawResult.content[0];
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
      if (error instanceof SyntaxError && error.message.includes("JSON")) {
        console.log(`Error parsing LLM response as JSON: ${error.message}`);
        return "Failed to process query: LLM response is not valid JSON.";
      } else if (error instanceof z.ZodError) {
        console.error(`Schema validation error: ${error.message}`);
        return `Failed to process query: Invalid arguments - ${error.message}`;
      } else {
        console.error(`Error processing query: ${error instanceof Error ? error.message : String(error)}`);
        return `Failed to process query: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
}