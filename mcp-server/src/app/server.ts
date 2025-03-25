// mcp-server/src/app/server.ts

import { setupRoutes } from "./routes";
import { ServerConnection } from "../infra/serverConnection";
import { loadEnvironment, getServerPort } from "../common/config";
import { logger } from "../infra/logger";
import { shutdownMySQL } from "../infra/mysqlTools";

async function startServer(): Promise<void> {
  loadEnvironment();
  const serverConnection = new ServerConnection();
  await serverConnection.start();
  const app = setupRoutes(serverConnection);

  const PORT = getServerPort();
  app.listen(PORT, () => {
    logger.info(`MySQL MCP Server running on port ${PORT}`);
  });
}

async function shutdown(): Promise<void> {
  logger.info("Shutting down server...");
  await shutdownMySQL();
  logger.info("Server shut down successfully");
}

startServer().catch((error) => {
  logger.error("Server startup failed", { error: error.message });
  process.exit(1);
});

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});