import { ResourceContent } from "@modelcontextprotocol/sdk/client";

declare module "@modelcontextprotocol/sdk/client" {
  interface ResourceContent {
    text123?: string; // 明确指定 text 为可选字符串
  }
}

/**
 * Interface for dynamic service definitions
 */
export interface ServiceDefinition {
    type: "tool" | "resource";
    name: string;
    schema?: any; // Zod schema for tools
    template?: string; // Resource template URI
    handler:
      | ((args: any) => Promise<any>) // For tools
      | ((uri: URL, variables: any) => Promise<any>) // For resources
      | string; // For string-based handlers
  }
  
  /**
   * Interface for server configuration
   */
  export interface ServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }