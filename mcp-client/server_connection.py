# mcp-client/server_connection.py

import time
from typing import Dict, List, Optional, Any
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.sse import sse_client

class ServerConnection:
    def __init__(self):
        self.sessions: Dict[str, ClientSession] = {}
        self.exit_stack = AsyncExitStack()
        self.server_info: Dict[str, Dict] = {}

    async def connect_to_servers(self, servers: Dict[str, Dict[str, Any]]) -> None:
        """根据配置文件连接到所有 MCP 服务器"""
        if not servers:
            print("No servers found in configuration.")
            return

        for server_name, server_config in servers.items():
            command = server_config.get("command")
            args = server_config.get("args", [])

            if not command or not isinstance(args, list):
                print(f"Invalid configuration for server {server_name}: {server_config}")
                continue

            if command.lower() == "sse":
                transport_type = "sse"
                if not args or not args[0].startswith("http"):
                    print(f"Invalid SSE URL for server {server_name}: {args}")
                    continue
                url = args[0]
                address = url.split("://")[1].split(":")[0]
                port = int(url.split(":")[-1].split("/")[0])
            else:
                transport_type = "stdio"
                address = args[0] if args else ""
                port = 0

            print(f"Connecting to server: {server_name} at {address}:{port} (Transport: {transport_type})")
            await self.connect_to_server(server_name, address, port, transport_type, command, args)

    async def connect_to_server(self, server_name: str, address: str, port: int, transport_type: str, command: str, args: List[str]) -> None:
        """连接到 MCP 服务器（支持 stdio 和 sse 模式）"""
        try:
            if transport_type == "stdio":
                server_params = StdioServerParameters(
                    command=command,
                    args=args,
                    env=None
                )
                stdio_transport = await self.exit_stack.enter_async_context(stdio_client(server_params))
                stdio, write = stdio_transport
                session = await self.exit_stack.enter_async_context(ClientSession(stdio, write))

            elif transport_type == "sse":
                url = args[0]
                sse_transport = await self.exit_stack.enter_async_context(sse_client(url))
                if isinstance(sse_transport, tuple):
                    read, write = sse_transport
                    class SSETransportAdapter:
                        def __init__(self, read, write):
                            self.read = read
                            self.write = write
                    transport = SSETransportAdapter(read, write)
                else:
                    transport = sse_transport
                session = await self.exit_stack.enter_async_context(ClientSession(transport.read, transport.write))

            else:
                raise ValueError(f"Unsupported transport type: {transport_type}")

            await session.initialize()
            start_time = time.time()
            tools_response = await session.list_tools()
            resources_response = await session.list_resources()
            prompts_response = await session.list_prompts()
            latency = (time.time() - start_time) * 1000

            # 存储工具的详细信息，包括 inputSchema
            tools = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": getattr(tool, "inputSchema", {}),
                }
                for tool in tools_response.tools
            ]

            # 存储资源的详细信息
            resources = [
                {
                    "uri": resource.uri,
                    "mimeType": resource.mimeType,
                    "name": getattr(resource, "name", ""),
                    "description": getattr(resource, "description", ""),
                }
                for resource in resources_response.resources
            ]

            # 存储 prompt 的详细信息，将 PromptArgument 转换为字典
            prompts = []
            for prompt in prompts_response.prompts:
                arguments = [
                    {
                        "name": arg.name,
                        "description": arg.description,
                        "required": arg.required,
                    }
                    for arg in getattr(prompt, "arguments", [])
                ]
                prompts.append({
                    "name": prompt.name,
                    "description": prompt.description,
                    "arguments": arguments,
                })

            # 获取每个 prompt 的模板
            prompt_templates = {}
            for prompt in prompts:
                prompt_name = prompt["name"]
                prompt_response = await session.get_prompt(prompt_name)
                prompt_templates[prompt_name] = {
                    "description": prompt_response.description,
                    "messages": [
                        {
                            "role": msg.role,
                            "content": msg.content.text if msg.content.type == "text" else "",
                        }
                        for msg in prompt_response.messages
                    ],
                }

            self.sessions[server_name] = session
            self.server_info[server_name] = {
                "tools": tools,
                "resources": resources,
                "prompts": prompts,
                "prompt_templates": prompt_templates,
                "latency": latency,
                "load": 0.0,
            }

            print(f"\nConnected to {server_name} with tools: {[tool['name'] for tool in tools]}, latency: {latency:.2f}ms")

        except Exception as e:
            print(f"Failed to connect to {server_name}: {str(e)}")
            if server_name in self.sessions:
                del self.sessions[server_name]
            if server_name in self.server_info:
                del self.server_info[server_name]

    async def cleanup(self):
        """清理资源"""
        await self.exit_stack.aclose()