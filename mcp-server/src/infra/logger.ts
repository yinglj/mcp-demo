// mcp-server/src/infra/logger.ts

export const logger = {
  info: (message: string, meta?: any) => {
    console.log(`[INFO] ${message}`, meta || "");
  },
  warn: (message: string, meta?: any) => {
    console.warn(`[WARN] ${message}`, meta || "");
  },
  error: (message: string, meta?: any) => {
    console.error(`[ERROR] ${message}`, meta || "");
  },
};