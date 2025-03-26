// packages/common/src/config.ts

import * as dotenv from "dotenv";
import * as fs from "fs";

interface ServerConfig {
  command: string;
  args: string[];
}

interface Config {
  mcpServers: Record<string, ServerConfig>;
  mysql?: {
    host: string;
    user?: string;
    password?: string;
    database: string;
  };
}

export function loadEnvironment(): void {
  dotenv.config();
  
}

export function loadServerConfig(): Config {
  const configPath = process.env.MCP_CONFIG_PATH || "mcp_config.json";
  if (!fs.existsSync(configPath)) {
    console.log(`Configuration file ${configPath} not found.`);
    return { mcpServers: {}, mysql: {
      host: process.env.MYSQL_HOST || "localhost",
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || "test_db",
    }};
  }

  try {
    const configData = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(configData) as Config;
    return config;
  } catch (error) {
    console.log(`Error reading configuration file ${configPath}: ${error}`);
    return { mcpServers: {} };
  }
}

export function getLlmPreference(): string {
  return process.env.LLM_PREFERENCE || "openai";
}

export function getServerPort(): number {
  return Number(process.env.PORT) || 3001;
}