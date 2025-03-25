// mcp-client/src/core/llmClient.ts

import { OpenAI } from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import { cleanMarkdownJson } from "../common/markdownUtils";

interface ServerInfo {
  tools: Array<{ name: string; description: string; inputSchema: any }>;
  resources: Array<{ uri: string; mimeType: string; name: string; description: string }>;
  prompts: Array<{ name: string; description: string; arguments: Array<{ name: string; description: string; required: boolean }> }>;
  promptTemplates: Record<string, { description: string; messages: Array<{ role: string; content: string }> }>;
  latency: number;
  load: number;
}

export class LLMClient {
  private openai: OpenAI;
  private anthropic: Anthropic;
  private preference: string;

  constructor(preference: string) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.preference = preference;
  }

  async selectServer(query: string, serverInfo: Map<string, ServerInfo>): Promise<string | null> {
    try {
      const systemPrompt = `
        You are an AI assistant that helps select the appropriate MCP server based on the user's query.
        I will provide a list of available MCP servers with their capabilities (tools, resources, prompts),
        latency (in milliseconds), and current load (as a percentage).
        Based on the user's query, determine which server is best suited to handle the task.
        Prioritize servers with lower latency and lower load, but ensure the server has the required tools, resources, or prompts.
        Return the name of the server or 'None' if no server is suitable.
      `;

      let serverInfoMessage = "Available MCP servers and their details:\n";
      for (const [serverName, info] of serverInfo.entries()) {
        serverInfoMessage += `
          Server: ${serverName}
          Tools: ${JSON.stringify(info.tools.map((tool) => tool.name))}
          Resources: ${JSON.stringify(info.resources.map((resource) => resource.uri))}
          Prompts: ${JSON.stringify(info.prompts.map((prompt) => prompt.name))}
          Latency: ${info.latency.toFixed(2)}ms
          Load: ${info.load.toFixed(2)}%
        \n`;
      }
      const userMessage = `User query: ${query}\nWhich server should be used to handle this query?`;

      let selectedServer: string;
      if (this.preference === "openai") {
        const response = await this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: serverInfoMessage + userMessage },
          ],
          max_tokens: 100,
        });
        selectedServer = response.choices[0].message.content?.trim()||"None"; 
      } else {
        const response = await this.anthropic.messages.create({
          model: "claude-3-5-sonnet-20240620",
          system: systemPrompt,
          messages: [{ role: "user", content: serverInfoMessage + userMessage }],
          max_tokens: 100,
        });
        selectedServer = response.content[0].type.trim();
      }

      if (selectedServer === "None" || !serverInfo.has(selectedServer)) {
        return null;
      }
      return selectedServer;
    } catch (error) {
      console.log(`Error in server selection: ${error}`);
      return null;
    }
  }

  async selectPrompt(serverInfo: ServerInfo, query: string): Promise<string | null> {
    const prompts = serverInfo.prompts;
    if (!prompts.length) {
      console.log("No prompts available for server.");
      return null;
    }

    const systemPrompt = `
      You are an AI assistant that helps select the most appropriate prompt template based on the user's query.
      I will provide a list of available prompt templates with their descriptions and arguments.
      Based on the user's query, select the prompt that best matches the intent of the query.
      Return the name of the selected prompt or 'None' if no prompt is suitable.
    `;

    let promptInfoMessage = "Available prompt templates:\n";
    for (const prompt of prompts) {
      promptInfoMessage += `
        Prompt: ${prompt.name}
        Description: ${prompt.description}
        Arguments: ${JSON.stringify(prompt.arguments)}
      \n`;
    }
    const userMessage = `User query: ${query}\nWhich prompt template should be used to handle this query?`;

    let selectedPromptName: string;
    if (this.preference === "openai") {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: promptInfoMessage + userMessage },
        ],
        max_tokens: 50,
      });
      selectedPromptName = response.choices[0].message?.content?.trim() || "None";
    } else {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        system: systemPrompt,
        messages: [{ role: "user", content: promptInfoMessage + userMessage }],
        max_tokens: 50,
      });
      selectedPromptName = response.content[0].type.trim();
    }

    if (selectedPromptName === "None") {
      return null;
    }
    return selectedPromptName;
  }

  async extractPromptArguments(promptArgs: Array<{ name: string; description: string; required: boolean }>, query: string): Promise<Record<string, any>> {
    const systemPrompt = `
      You are an AI assistant that extracts parameters from a user's query based on the required arguments of a prompt template.
      I will provide the user's query and the list of arguments that need to be extracted.
      Extract the values for each argument from the query and return them as a JSON object.
      If an argument cannot be extracted, return an empty string for that argument.
      Ensure the response is a pure JSON string and do not wrap it in Markdown code blocks (e.g., \`\`\`json ... \`\`\`).
      Do not include any additional text outside the JSON string.
    `;

    let argsInfo = "Arguments to extract:\n";
    for (const arg of promptArgs) {
      argsInfo += `Name: ${arg.name}, Description: ${arg.description}, Required: ${arg.required}\n`;
    }
    const userMessage = `User query: ${query}\n${argsInfo}\nExtract the values for these arguments.`;

    let rawResponse: string;
    if (this.preference === "openai") {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 100,
      });
      rawResponse = response.choices[0].message.content||"None";
    } else {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        max_tokens: 100,
      });
      rawResponse = response.content[0].type;
    }

    const cleanedResponse = cleanMarkdownJson(rawResponse);
    try {
      return JSON.parse(cleanedResponse);
    } catch (error) {
      console.log(`Failed to parse cleaned response as JSON: ${cleanedResponse}, error: ${error}`);
      return Object.fromEntries(promptArgs.map((arg) => [arg.name, ""]));
    }
  }

  async extractToolArguments(tool: { name: string; description: string; inputSchema: any }, query: string): Promise<Record<string, any>> {
    const inputSchema = tool.inputSchema || {};
    const properties = inputSchema.properties || {};
    const required = inputSchema.required || [];

    if (!Object.keys(properties).length) {
      console.log(`No properties defined in inputSchema for tool ${tool.name}`);
      return {};
    }

    const systemPrompt = `
      You are an AI assistant that extracts parameters from a user's query based on the input schema of a tool.
      I will provide the user's query and the tool's input schema, including the properties and required fields.
      Extract the values for each property from the query and return them as a JSON object.
      If a property cannot be extracted, return an empty string for that property.
      Ensure the response is a pure JSON string and do not wrap it in Markdown code blocks (e.g., \`\`\`json ... \`\`\`).
      Do not include any additional text outside the JSON string.
    `;

    let schemaInfo = "Tool input schema:\n";
    for (const [propName, propInfo] of Object.entries(properties)) {
      schemaInfo += `Property: ${propName}, Description: ${(propInfo as any).description || "N/A"}, Type: ${(propInfo as any).type || "N/A"}\n`;
    }
    schemaInfo += `Required properties: ${JSON.stringify(required)}\n`;
    const userMessage = `User query: ${query}\n${schemaInfo}\nExtract the values for these properties.`;

    let rawResponse: string;
    if (this.preference === "openai") {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 100,
      });
      rawResponse = response.choices[0].message.content||"None";
    } else {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        max_tokens: 100,
      });
      rawResponse = response.content[0].type;
    }

    const cleanedResponse = cleanMarkdownJson(rawResponse);
    try {
      const args = JSON.parse(cleanedResponse);
      for (const req of required) {
        if (!(req in args) || args[req] === "") {
          console.log(`Missing required parameter: ${req} for tool ${tool.name}`);
          return {};
        }
      }
      return args;
    } catch (error) {
      console.log(`Failed to parse cleaned tool response as JSON: ${cleanedResponse}, error: ${error}`);
      return Object.fromEntries(Object.keys(properties).map((prop) => [prop, ""]));
    }
  }

  async selectTool(tools: Array<{ name: string; description: string; inputSchema: any }>, userMessage: string): Promise<{ tool_name: string; arguments: Record<string, any> }> {
    const systemPrompt = `
      You are an AI assistant that can use tools to complete tasks.
      Based on the user's query and the available tools, decide which tool to use and what arguments to provide.
      The available tools are:
      ${JSON.stringify(tools, null, 2)}
      Return your response as a pure JSON string with the following structure:
      {"tool_name": "<tool_name>", "arguments": {<key>: <value>, ...}}
      Ensure the response is a pure JSON string and do not wrap it in Markdown code blocks (e.g., \`\`\`json ... \`\`\`).
      Do not include any additional text outside the JSON string.
    `;

    let rawResponse: string;
    if (this.preference === "openai") {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: 200,
      });
      rawResponse = response.choices[0].message.content||"None";
    } else {
      const response = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20240620",
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        max_tokens: 200,
      });
      rawResponse = response.content[0].type;
    }

    const cleanedResponse = cleanMarkdownJson(rawResponse);
    return JSON.parse(cleanedResponse);
  }
}