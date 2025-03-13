#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { diffLines, createTwoFilesPatch } from "diff";
import { minimatch } from "minimatch";
import { Logger, createLogger, transports, format } from "winston";

// Base directory for configuration files
export const BASE_DIR = path.resolve(process.cwd());

// Logger setup
export const logger = createLogger({
  level: "info",
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
  ),
  transports: [new transports.Console()],
});

// Configuration schema for MCP servers
export const McpConfigSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.object({
      allowedDirectories: z.array(z.string()).min(1),
    })
  ),
});

// Tool input schema
const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// File info interface
interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

// Utility functions
function normalizePath(p: string): string {
  return path.normalize(p);
}

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

async function validatePath(requestedPath: string, allowedDirectories: string[]): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);
  const normalizedRequested = normalizePath(absolute);

  const isAllowed = allowedDirectories.some((dir) => normalizedRequested.startsWith(dir));
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(", ")}`
    );
  }

  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    const isRealPathAllowed = allowedDirectories.some((dir) => normalizedReal.startsWith(dir));
    if (!isRealPathAllowed) {
      throw new Error("Access denied - symlink target outside allowed directories");
    }
    return realPath;
  } catch (error) {
    const parentDir = path.dirname(absolute);
    try {
      const realParentPath = await fs.realpath(parentDir);
      const normalizedParent = normalizePath(realParentPath);
      const isParentAllowed = allowedDirectories.some((dir) => normalizedParent.startsWith(dir));
      if (!isParentAllowed) {
        throw new Error("Access denied - parent directory outside allowed directories");
      }
      return absolute;
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  }
}

// Schema definitions (unchanged from original)
const ReadFileArgsSchema = z.object({ path: z.string() });
const ReadMultipleFilesArgsSchema = z.object({ paths: z.array(z.string()) });
const WriteFileArgsSchema = z.object({ path: z.string(), content: z.string() });
const EditOperation = z.object({
  oldText: z.string().describe("Text to search for - must match exactly"),
  newText: z.string().describe("Text to replace with"),
});
const EditFileArgsSchema = z.object({
  path: z.string(),
  edits: z.array(EditOperation),
  dryRun: z.boolean().default(false).describe("Preview changes using git-style diff format"),
});
const CreateDirectoryArgsSchema = z.object({ path: z.string() });
const ListDirectoryArgsSchema = z.object({ path: z.string() });
const DirectoryTreeArgsSchema = z.object({ path: z.string() });
const MoveFileArgsSchema = z.object({ source: z.string(), destination: z.string() });
const SearchFilesArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  excludePatterns: z.array(z.string()).optional().default([]),
});
const GetFileInfoArgsSchema = z.object({ path: z.string() });

// File system utilities (unchanged from original)
async function getFileStats(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

async function searchFiles(
  rootPath: string,
  pattern: string,
  excludePatterns: string[],
  allowedDirectories: string[]
): Promise<string[]> {
  const results: string[] = [];

  async function search(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      try {
        await validatePath(fullPath, allowedDirectories);

        const relativePath = path.relative(rootPath, fullPath);
        const shouldExclude = excludePatterns.some((pattern) => {
          const globPattern = pattern.includes("*") ? pattern : `**/${pattern}/**`;
          return minimatch(relativePath, globPattern, { dot: true });
        });

        if (shouldExclude) continue;

        if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(fullPath);
        }

        if (entry.isDirectory()) {
          await search(fullPath);
        }
      } catch (error) {
        continue;
      }
    }
  }

  await search(rootPath);
  return results;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function createUnifiedDiff(originalContent: string, newContent: string, filepath: string = "file"): string {
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);
  return createTwoFilesPatch(filepath, filepath, normalizedOriginal, normalizedNew, "original", "modified");
}

async function applyFileEdits(
  filePath: string,
  edits: Array<{ oldText: string; newText: string }>,
  dryRun = false
): Promise<string> {
  const content = normalizeLineEndings(await fs.readFile(filePath, "utf-8"));
  let modifiedContent = content;

  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }

    const oldLines = normalizedOld.split("\n");
    const contentLines = modifiedContent.split("\n");
    let matchFound = false;

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);
      const isMatch = oldLines.every((oldLine, j) => {
        const contentLine = potentialMatch[j];
        return oldLine.trim() === contentLine.trim();
      });

      if (isMatch) {
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || "";
        const newLines = normalizedNew.split("\n").map((line, j) => {
          if (j === 0) return originalIndent + line.trimStart();
          const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || "";
          const newIndent = line.match(/^\s*/)?.[0] || "";
          if (oldIndent && newIndent) {
            const relativeIndent = newIndent.length - oldIndent.length;
            return originalIndent + " ".repeat(Math.max(0, relativeIndent)) + line.trimStart();
          }
          return line;
        });

        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join("\n");
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }

  const diff = createUnifiedDiff(content, modifiedContent, filePath);
  let numBackticks = 3;
  while (diff.includes("`".repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${"`".repeat(numBackticks)}diff\n${diff}${"`".repeat(numBackticks)}\n\n`;

  if (!dryRun) {
    await fs.writeFile(filePath, modifiedContent, "utf-8");
  }

  return formattedDiff;
}

// Server creation function
export function createServer(
  name: string = "secure-filesystem-server",
  config: { allowedDirectories: string[] } = { allowedDirectories: [] }
) {
  const allowedDirectories =
    config.allowedDirectories.length > 0
      ? config.allowedDirectories.map((dir) => normalizePath(path.resolve(expandHome(dir))))
      : process.argv.slice(2).map((dir) => normalizePath(path.resolve(expandHome(dir))));

  if (allowedDirectories.length === 0) {
    logger.error("No allowed directories specified");
    process.exit(1);
  }
  logger.info("Allowed directories specified:", allowedDirectories);
  // Validate directories
  Promise.all(
    allowedDirectories.map(async (dir) => {
      try {
        const stats = await fs.stat(dir);
        if (!stats.isDirectory()) {
          logger.error(`Error: ${dir} is not a directory`);
          process.exit(1);
        }
      } catch (error) {
        logger.error(`Error accessing directory ${dir}: ${error}`);
        process.exit(1);
      }
    })
  ).catch((error) => {
    logger.error(`Directory validation failed: ${error}`);
    process.exit(1);
  });

  const server = new Server(
    { name, version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "read_file",
          description:
            "Read the complete contents of a file from the file system. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput,
        },
        {
          name: "read_multiple_files",
          description:
            "Read the contents of multiple files simultaneously. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput,
        },
        {
          name: "write_file",
          description:
            "Create or overwrite a file with new content. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
        },
        {
          name: "edit_file",
          description:
            "Make line-based edits to a text file. Returns a git-style diff. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
        },
        {
          name: "create_directory",
          description:
            "Create a new directory or ensure it exists. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput,
        },
        {
          name: "list_directory",
          description:
            "Get a detailed listing of files and directories. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
        },
        {
          name: "directory_tree",
          description:
            "Get a recursive tree view of files and directories as JSON. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput,
        },
        {
          name: "move_file",
          description:
            "Move or rename files and directories. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput,
        },
        {
          name: "search_files",
          description:
            "Recursively search for files and directories matching a pattern. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(SearchFilesArgsSchema) as ToolInput,
        },
        {
          name: "get_file_info",
          description:
            "Retrieve detailed metadata about a file or directory. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput,
        },
        {
          name: "list_allowed_directories",
          description: "Returns the list of directories that this server is allowed to access.",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "read_file": {
          const parsed = ReadFileArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validPath = await validatePath(parsed.data.path, allowedDirectories);
          const content = await fs.readFile(validPath, "utf-8");
          return { content: [{ type: "text", text: content }] };
        }
        case "read_multiple_files": {
          const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const results = await Promise.all(
            parsed.data.paths.map(async (filePath) => {
              try {
                const validPath = await validatePath(filePath, allowedDirectories);
                const content = await fs.readFile(validPath, "utf-8");
                return `${filePath}:\n${content}\n`;
              } catch (error) {
                return `${filePath}: Error - ${String(error)}`;
              }
            })
          );
          return { content: [{ type: "text", text: results.join("\n---\n") }] };
        }
        case "write_file": {
          const parsed = WriteFileArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validPath = await validatePath(parsed.data.path, allowedDirectories);
          await fs.writeFile(validPath, parsed.data.content, "utf-8");
          return { content: [{ type: "text", text: `Successfully wrote to ${parsed.data.path}` }] };
        }
        case "edit_file": {
          const parsed = EditFileArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validPath = await validatePath(parsed.data.path, allowedDirectories);
          const result = await applyFileEdits(validPath, parsed.data.edits, parsed.data.dryRun);
          return { content: [{ type: "text", text: result }] };
        }
        case "create_directory": {
          const parsed = CreateDirectoryArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validPath = await validatePath(parsed.data.path, allowedDirectories);
          await fs.mkdir(validPath, { recursive: true });
          return { content: [{ type: "text", text: `Successfully created directory ${parsed.data.path}` }] };
        }
        case "list_directory": {
          const parsed = ListDirectoryArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validPath = await validatePath(parsed.data.path, allowedDirectories);
          logger.info(`list_directory: ${validPath}`);
          const entries = await fs.readdir(validPath, { withFileTypes: true });
          const formatted = entries
            .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
            .join("\n");
          return { content: [{ type: "text", text: formatted }] };
        }
        case "directory_tree": {
          const parsed = DirectoryTreeArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);

          interface TreeEntry {
            name: string;
            type: "file" | "directory";
            children?: TreeEntry[];
          }

          async function buildTree(currentPath: string): Promise<TreeEntry[]> {
            const validPath = await validatePath(currentPath, allowedDirectories);
            const entries = await fs.readdir(validPath, { withFileTypes: true });
            const result: TreeEntry[] = [];

            for (const entry of entries) {
              const entryData: TreeEntry = {
                name: entry.name,
                type: entry.isDirectory() ? "directory" : "file",
              };
              if (entry.isDirectory()) {
                const subPath = path.join(currentPath, entry.name);
                entryData.children = await buildTree(subPath);
              }
              result.push(entryData);
            }
            return result;
          }

          const treeData = await buildTree(parsed.data.path);
          return { content: [{ type: "text", text: JSON.stringify(treeData, null, 2) }] };
        }
        case "move_file": {
          const parsed = MoveFileArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validSourcePath = await validatePath(parsed.data.source, allowedDirectories);
          const validDestPath = await validatePath(parsed.data.destination, allowedDirectories);
          await fs.rename(validSourcePath, validDestPath);
          return {
            content: [
              { type: "text", text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` },
            ],
          };
        }
        case "search_files": {
          const parsed = SearchFilesArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validPath = await validatePath(parsed.data.path, allowedDirectories);
          const results = await searchFiles(
            validPath,
            parsed.data.pattern,
            parsed.data.excludePatterns,
            allowedDirectories
          );
          return { content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "No matches found" }] };
        }
        case "get_file_info": {
          const parsed = GetFileInfoArgsSchema.safeParse(args);
          if (!parsed.success) throw new Error(`Invalid arguments: ${parsed.error}`);
          const validPath = await validatePath(parsed.data.path, allowedDirectories);
          const info = await getFileStats(validPath);
          return {
            content: [
              {
                type: "text",
                text: Object.entries(info)
                  .map(([key, value]) => `${key}: ${value}`)
                  .join("\n"),
              },
            ],
          };
        }
        case "list_allowed_directories": {
          return { content: [{ type: "text", text: `Allowed directories:\n${allowedDirectories.join("\n")}` }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text", text: `Error: ${errorMessage}` }], isError: true };
    }
  });

  const cleanup = async () => {
    logger.info(`Cleaning up server: ${name}`);
  };

  return { server, cleanup };
}

// If run directly (for testing purposes)
// if (require.main === module) {
//   const { server, cleanup } = createServer();
//   const transport = new (await import("@modelcontextprotocol/sdk/server/stdio.js")).StdioServerTransport();
//   server.connect(transport).then(() => {
//     logger.info("Server running on stdio");
//     process.on("SIGINT", async () => {
//       await cleanup();
//       await server.close();
//       process.exit(0);
//     });
//   }).catch((error) => {
//     logger.error(`Server startup error: ${error}`);
//     process.exit(1);
//   });
// }