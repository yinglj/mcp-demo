import { ResourceContent } from "@modelcontextprotocol/sdk/client";

declare module "@modelcontextprotocol/sdk/client" {
  interface ResourceContent {
    text123?: string; // 明确指定 text 为可选字符串
  }
}