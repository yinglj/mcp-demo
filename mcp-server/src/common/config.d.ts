interface ServerConfig {
    command: string;
    args: string[];
}
interface Config {
    mcpServers: Record<string, ServerConfig>;
}
export declare function loadEnvironment(): void;
export declare function loadServerConfig(): Config;
export declare function getLlmPreference(): string;
export declare function getServerPort(): number;
export {};
