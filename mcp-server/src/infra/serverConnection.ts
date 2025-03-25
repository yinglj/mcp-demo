// mcp-server/src/infra/serverConnection.ts

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerToolHandlers } from "../core/handlers/toolHandler";
import { registerResourceHandlers } from "../core/handlers/resourceHandler";
import { registerPromptHandlers } from "../core/handlers/promptHandler";
import { logger } from "../infra/logger";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export class ServerConnection {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "mysql-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      }
    );

    registerToolHandlers(this.server);
    registerResourceHandlers(this.server);
    registerPromptHandlers(this.server);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("Stdio transport connected");
  }

  async connectTransport(transport: SSEServerTransport): Promise<void> {
    await this.server.connect(transport);
  }
}