import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";

// 定义服务器基本信息
const server = new McpServer({
  name: "LocalFileServer",
  version: "1.0.0",
});

// 配置允许访问的本地目录
const BASE_DIR = dirname(fileURLToPath(import.meta.url));
console.log("DEBUG: BASE_DIR:", BASE_DIR);

/**
 * 检查路径是否在允许的目录内
 * @param path 要检查的路径
 * @returns 是否在允许的目录内
 */
function isPathAllowed(path: string): boolean {
  const resolvedPath = resolve(path);
  return resolvedPath.startsWith(BASE_DIR);
}

/**
 * 读取文件内容
 * @param fullPath 文件的完整路径
 * @returns 文件内容
 */
async function readFileContent(fullPath: string): Promise<string> {
  try {
    const content = await fs.readFile(fullPath, "utf-8");
    console.log("DEBUG: File content read successfully");
    return content;
  } catch (error: unknown) {
    console.log("DEBUG: File read error:", (error as Error).message);
    throw new Error(`Failed to read file: ${(error as Error).message}`);
  }
}

// 定义文件资源模板
server.resource(
  "file",
  new ResourceTemplate("file:///{path}", {
    list: undefined,
  }),
  async (uri: URL, variables: { path?: string }) => {
    console.log("DEBUG: Received URI:", uri.href);
    if (!variables.path) {
      console.log("DEBUG: Path parameter is missing");
      throw new Error("Path parameter is required.");
    }

    const safePath = decodeURIComponent(variables.path);
    const fullPath = join(BASE_DIR, safePath);
    console.log("DEBUG: safePath:", safePath);
    console.log("DEBUG: fullPath:", fullPath);

    if (!isPathAllowed(fullPath)) {
      console.log("DEBUG: Path access denied");
      throw new Error("Access to this path is not allowed.");
    }

    const content = await readFileContent(fullPath);
    console.log(content);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: content,
        },
      ],
    };
  }
);

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("LocalFileServer1 is running with stdio transport...");
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});