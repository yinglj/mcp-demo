// mcp-client/src/core/templateLister.ts

import { ServerConnection } from "../infra/serverConnection";

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

interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  mimeType: string;
  description: string;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: any;
}

export class TemplateLister {
  private serverConnection: ServerConnection;

  constructor(serverConnection: ServerConnection) {
    this.serverConnection = serverConnection;
  }

  async listTemplates(serverName?: string, type: "all" | "resources" | "prompts" | "tools" = "all"): Promise<string> {
    if (this.serverConnection.serverInfo.size === 0) {
      return "No servers available.";
    }

    if (serverName && !this.serverConnection.serverInfo.has(serverName)) {
      return `Server ${serverName} not found.`;
    }

    const targetServers = serverName ? [serverName] : Array.from(this.serverConnection.serverInfo.keys());
    const output: string[] = [];

    for (const srv of targetServers) {
      const session = this.serverConnection.getSession(srv);
      if (!session) {
        output.push(`Session for server ${srv} not found.`);
        continue;
      }

      const serverInfo = this.serverConnection.serverInfo.get(srv);
      if (!serverInfo) {
        output.push(`Server info for ${srv} not found.`);
        continue;
      }

      // List Resource Templates
      if (type === "all" || type === "resources") {
        try {
          const response = await session.listResources();
          console.log(`Raw response from listResources: ${JSON.stringify(response)}`);

          if (response.resources && response.resources.length > 0) {
            const resourceTemplates: ResourceTemplate[] = response.resources
              .filter((resource: any) => resource.uriTemplate || resource.uri)
              .map((resource: any) => ({
                uriTemplate: resource.uriTemplate || resource.uri,
                name: resource.name || "",
                mimeType: resource.mimeType || "",
                description: resource.description || "",
              }));

            if (resourceTemplates.length > 0) {
              output.push(`\nResource Templates on server ${srv}:`);
              for (const template of resourceTemplates) {
                output.push(`- URI Template: ${template.uriTemplate}`);
                output.push(`  Name: ${template.name}`);
                output.push(`  MIME Type: ${template.mimeType}`);
                output.push(`  Description: ${template.description}`);
                output.push("");
              }
            } else {
              output.push(`No resource templates found on server ${srv}.`);
            }
          } else {
            output.push(`No resources returned from server ${srv}.`);
          }
        } catch (error) {
          console.error(`Failed to list resource templates on server ${srv}: ${error instanceof Error ? error.message : String(error)}`);
          output.push(`Failed to list resource templates on server ${srv}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // List Prompt Templates
      if (type === "all" || type === "prompts") {
        if (serverInfo.prompts.length > 0) {
          output.push(`\nPrompt Templates on server ${srv}:`);
          for (const prompt of serverInfo.prompts as Prompt[]) {
            output.push(`- Name: ${prompt.name}`);
            output.push(`  Description: ${prompt.description}`);
            output.push(`  Arguments: ${JSON.stringify(prompt.arguments)}`);
            const template = serverInfo.promptTemplates[prompt.name];
            if (template) {
              output.push(`  Template Messages:`);
              template.messages.forEach((msg, index) => {
                output.push(`    ${index + 1}. [${msg.role}] ${msg.content.text}`);
              });
            }
            output.push("");
          }
        } else {
          output.push(`No prompt templates found on server ${srv}.`);
        }
      }

      // List Tools
      if (type === "all" || type === "tools") {
        if (serverInfo.tools.length > 0) {
          output.push(`\nTools on server ${srv}:`);
          for (const tool of serverInfo.tools as Tool[]) {
            output.push(`- Name: ${tool.name}`);
            output.push(`  Description: ${tool.description}`);
            output.push(`  Input Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`);
            output.push("");
          }
        } else {
          output.push(`No tools found on server ${srv}.`);
        }
      }
    }

    return output.join("\n");
  }
}