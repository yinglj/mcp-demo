import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import * as fs from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import express from "express";
import { z } from "zod";
import winston from "winston";
import { ServiceDefinition, ServerConfig } from "./types.js"; // 添加 .d.ts 扩展名

// Configure winston logger
const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "server.log" }),
    ],
});

// Base directory for file access
const BASE_DIR = dirname(fileURLToPath(import.meta.url));
logger.info(`BASE_DIR: ${BASE_DIR}`);

// --- Server Configuration Schema ---
const ServerConfigSchema = z.object({
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string()).optional(),
});

const McpConfigSchema = z.object({
    mcpServers: z.record(ServerConfigSchema),
});

/**
 * Check if a path is within the allowed directory
 * @param path Path to check
 * @returns Whether the path is allowed
 */
function isPathAllowed(path: string): boolean {
    const resolvedPath = resolve(path);
    return resolvedPath.startsWith(BASE_DIR);
}

/**
 * Read file content
 * @param fullPath Full file path
 * @returns File content
 */
async function readFileContent(fullPath: string): Promise<string> {
    try {
        const content = await fs.readFile(fullPath, "utf-8");
        logger.info("File content read successfully");
        return content;
    } catch (error: unknown) {
        logger.error(`File read error: ${(error as Error).message}`);
        throw new Error(`Failed to read file: ${(error as Error).message}`);
    }
}

/**
 * Zod schema for validating ServiceDefinition
 */
const ServiceDefinitionSchema = z.object({
    type: z.enum(["tool", "resource"]),
    name: z.string().min(1),
    schema: z.any().optional(),
    template: z.string().optional(),
    handler: z.union([
        z.function().args(z.any()).returns(z.promise(z.any())), // Tool handler
        z.function().args(z.instanceof(URL), z.any()).returns(z.promise(z.any())), // Resource handler
        z.string(), // String handler
    ]),
});

/**
 * Parse a string handler into a function safely
 * @param handlerStr String representation of the handler
 * @returns Parsed function
 */
function parseHandlerFromString(handlerStr: string): (args: any) => Promise<any> {
    try {
        return new Function("args", `return (async (${handlerStr.includes("{") ? "args" : handlerStr.split("=>")[0]}) => ${handlerStr.includes("{") ? handlerStr : `{ return ${handlerStr} }`})(args)`) as (args: any) => Promise<any>;
    } catch (error) {
        throw new Error(`Failed to parse handler: ${handlerStr} - ${error}`);
    }
}

/**
 * Register a service dynamically
 * @param server McpServer instance
 * @param definition Service definition object
 */
function registerService(server: McpServer, definition: ServiceDefinition) {
    try {
        const validated = ServiceDefinitionSchema.parse(definition);
        const handler = typeof validated.handler === "string"
            ? parseHandlerFromString(validated.handler)
            : validated.handler;

        if (validated.type === "tool") {
            server.tool(validated.name, validated.schema, handler as (args: any) => Promise<any>);
            logger.info(`Registered tool: ${validated.name}`);
        } else if (validated.type === "resource") {
            server.resource(
                validated.name,
                new ResourceTemplate(validated.template!, { list: undefined }),
                handler as (uri: URL, variables: any) => Promise<any>
            );
            logger.info(`Registered resource: ${validated.name}`);
        }
    } catch (error) {
        logger.error(`Failed to register service ${definition.name}: ${error}`);
    }
}

/**
 * Setup a LocalFileServer instance
 * @param name Server name
 * @param args Arguments from config
 * @returns Configured McpServer
 */
function setupLocalFileServer(name: string, args: string[]): McpServer {
    const server = new McpServer({ name, version: "1.0.0" });

    server.tool(
        "query bill",
        { message: z.string() },
        async ({ message }: { message: string }) => ({ // 显式声明 message 类型
            content: [{ type: "text", text: `Tool echo: ${message}` }],
        })
    );

    server.tool(
        "modify bill",
        { message: z.string() },
        async ({ message }: { message: string }) => ({ // 显式声明 message 类型
            content: [{ type: "text", text: `Tool echo: ${message}` }],
        })
    );

    server.resource(
        "file",
        new ResourceTemplate("file:///{path}", { list: undefined }),
        async (uri: URL, variables: { path?: string }) => {
            logger.info(`Received URI: ${uri.href}`);
            if (!variables.path) {
                logger.error("Path parameter is missing");
                throw new Error("Path parameter is required.");
            }

            const safePath = decodeURIComponent(variables.path);
            const fullPath = join(BASE_DIR, safePath);
            logger.info(`safePath: ${safePath}`);
            logger.info(`fullPath: ${fullPath}`);

            if (!isPathAllowed(fullPath)) {
                logger.error("Path access denied");
                throw new Error("Access to this path is not allowed.");
            }

            const content = await readFileContent(fullPath);
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

    return server;
}

/**
 * Load and register example services
 * @param server McpServer instance
 */
async function loadExampleServices(server: McpServer) {
    try {
        registerService(server, {
            type: "tool",
            name: "echo_message",
            schema: { message: z.string() },
            handler: async ({ message }: { message: string }) => ({ // 显式声明 message 类型
                content: [{ type: "text", text: `Echo: ${message}` }],
            }),
        });

        registerService(server, {
            type: "resource",
            name: "system_info",
            template: "system:///info",
            handler: async () => ({
                contents: [
                    {
                        uri: "system:///info",
                        mimeType: "text/plain",
                        text: `System time: ${new Date().toISOString()}`,
                    },
                ],
            }),
        });

        registerService(server, {
            type: "resource",
            name: "file_list",
            template: "file:///list/{dir}",
            handler: async (uri: URL, variables: { dir?: string }) => {
                const dirPath = join(BASE_DIR, variables.dir || "");
                if (!isPathAllowed(dirPath)) throw new Error("Directory access denied");
                const files = await fs.readdir(dirPath);
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: "text/plain",
                            text: files.join("\n"),
                        },
                    ],
                };
            },
        });
    } catch (error) {
        logger.error(`Error loading example services: ${error}`);
    }
}

/**
 * Load services from a JSON config file
 * @param server McpServer instance
 * @param configPath Path to the config file
 */
async function loadServicesFromConfig(server: McpServer, configPath: string) {
    try {
        const config = JSON.parse(await fs.readFile(configPath, "utf-8"));
        if (!Array.isArray(config)) throw new Error("Config file must contain an array of services");
        config.forEach((service: ServiceDefinition) => registerService(server, service));
        logger.info(`Loaded services from config: ${configPath}`);
    } catch (error) {
        logger.error(`Error loading services from config ${configPath}: ${error}`);
    }
}

/**
 * Load services from a directory of .js files
 * @param server McpServer instance
 * @param dir Directory containing service definition files
 */
async function loadServicesFromDirectory(server: McpServer, dir: string) {
    try {
        const files = await fs.readdir(dir);
        for (const file of files) {
            if (file.endsWith(".js")) {
                const fullPath = join(dir, file);
                const service = (await import(fullPath)).default;
                registerService(server, service);
            }
        }
        logger.info(`Loaded services from directory: ${dir}`);
    } catch (error) {
        logger.error(`Error loading services from directory ${dir}: ${error}`);
    }
}

/**
 * Load services from a remote URL
 * @param server McpServer instance
 * @param url Remote URL providing service definitions
 */
async function loadServicesFromRemote(server: McpServer, url: string) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const services = await response.json();
        if (!Array.isArray(services)) throw new Error("Remote response must be an array");
        services.forEach((service: ServiceDefinition) => registerService(server, service));
        logger.info(`Loaded services from remote: ${url}`);
    } catch (error) {
        logger.error(`Error loading services from remote ${url}: ${error}`);
    }
}

/**
 * Start an MCP server based on config
 * @param name Server name
 * @param config Server configuration
 */
async function startServer(name: string, config: ServerConfig) {
    try {
        if (config.env) {
            Object.assign(process.env, config.env);
            logger.info(`Applied environment variables for ${name}: ${JSON.stringify(config.env)}`);
        }

        if (config.args.some((arg: string) => arg.includes("server-filesystem"))) { // 显式声明 arg 类型
            const server = setupLocalFileServer(name, config.args);

            await loadExampleServices(server);
            await loadServicesFromConfig(server, join(BASE_DIR, "services.json"));
            await loadServicesFromDirectory(server, join(BASE_DIR, "services"));
            await loadServicesFromRemote(server, "https://example.com/api/services");

            const app = express();
            let transport: SSEServerTransport;
            app.get("/sse", async (req, res) => {
                transport = new SSEServerTransport("/messages", res);
                await server.connect(transport);
            });

            app.post("/messages", async (req, res) => {
                // Note: to support multiple simultaneous connections, these messages will
                // need to be routed to a specific matching transport. (This logic isn't
                // implemented here, for simplicity.)
                await transport.handlePostMessage(req, res);
            });

            app.listen(3001);
            const stdioTransport = new StdioServerTransport();
            await server.connect(stdioTransport);
            logger.info(`${name} is running with stdio transport...`);
        } else {
            logger.warn(`Server type ${name} not implemented in this script`);
        }
    } catch (error) {
        logger.error(`Failed to start server ${name}: ${error}`);
    }
}

// Start all servers from config
async function main() {
    try {
        const configData = JSON.parse(await fs.readFile(join(BASE_DIR, "mcp-config.json"), "utf-8"));
        const validatedConfig = McpConfigSchema.parse(configData);

        for (const [name, config] of Object.entries(validatedConfig.mcpServers)) {
            await startServer(name, config);
        }
    } catch (error) {
        logger.error(`Error loading mcp-config.json: ${error}`);
        process.exit(1);
    }
}

main();