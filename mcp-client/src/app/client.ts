// mcp-client/src/app/client.ts

import { LLMClient } from "../core/llmClient";
import { ServerConnection } from "../infra/serverConnection";
import { QueryProcessor } from "../core/queryProcessor";
import { TemplateLister } from "../core/templateLister";
import { loadEnvironment, loadServerConfig, getLlmPreference } from "../common/config";
import { chatLoop } from "./chatLoop";

export class MCPClient {
  private serverConnection: ServerConnection;
  private llmClient: LLMClient;
  private queryProcessor: QueryProcessor;
  private templateLister: TemplateLister;

  constructor() {
    loadEnvironment();
    const llmPreference = getLlmPreference();
    this.serverConnection = new ServerConnection();
    this.llmClient = new LLMClient(llmPreference);
    this.queryProcessor = new QueryProcessor(this.llmClient, this.serverConnection);
    this.templateLister = new TemplateLister(this.serverConnection);
  }

  async start(): Promise<void> {
    const servers = loadServerConfig().mcpServers;
    await this.serverConnection.connectToServers(servers);
    await chatLoop(this.queryProcessor, this.templateLister);
  }

  async cleanup(): Promise<void> {
    await this.serverConnection.cleanup();
  }
}

async function main(): Promise<void> {
  const client = new MCPClient();
  try {
    await client.start();
  } finally {
    await client.cleanup();
  }
}

main().catch((error) => {
  console.error(`Error in main: ${error}`);
  process.exit(1);
});