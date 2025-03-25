// mcp-server/src/app/routes.ts

import express, { Express } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ServerConnection } from "../infra/serverConnection";
import { logger } from "../infra/logger";

export function setupRoutes(serverConnection: ServerConnection): Express {
  const app = express();
  let transport_sse: SSEServerTransport;

  app.get("/sse", async (req, res) => {
    logger.info("Received SSE connection");
    transport_sse = new SSEServerTransport("/message", res);
    await serverConnection.connectTransport(transport_sse);
  });

  app.post("/message", async (req, res) => {
    logger.info("Received SSE message");
    await transport_sse.handlePostMessage(req, res);
  });

  return app;
}