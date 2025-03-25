// mcp-client/src/core/templateLister.ts

// import { Client, ClientOptions } from "@modelcontextprotocol/sdk/client/index.js";
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

export class TemplateLister {
  private serverConnection: ServerConnection;

  constructor(serverConnection: ServerConnection) {
    this.serverConnection = serverConnection;
  }

  async listTemplates(serverName?: string): Promise<string> {
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

      try {
        // 使用 Client 的 listResources 方法替代 request("list_resource_templates")
        const response = await session.listResources();
        console.log(`Raw response from listResources: ${JSON.stringify(response)}`);

        if (response.resources && response.resources.length > 0) {
          // 假设 resources 中包含模板信息
          const resourceTemplates: ResourceTemplate[] = response.resources
            .filter((resource: any) => resource.uriTemplate) // 过滤出具有 uriTemplate 的资源作为模板
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

      const serverInfo = this.serverConnection.serverInfo.get(srv);
      if (serverInfo && serverInfo.prompts.length > 0) {
        output.push(`Prompt templates on server ${srv}:`);
        for (const prompt of serverInfo.prompts as Prompt[]) {
          output.push(`- Name: ${prompt.name}`);
          output.push(`  Description: ${prompt.description}`);
          output.push(`  Arguments: ${JSON.stringify(prompt.arguments)}`);
          output.push("");
        }
      } else {
        output.push(`No prompt templates found on server ${srv}.`);
      }
    }

    return output.join("\n");
  }
}