import asyncio
import json
import os
import time
from typing import Optional, List, Dict, Any
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.sse import sse_client
import aiohttp
from anthropic import Anthropic
from openai import AsyncOpenAI
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

class MCPClient:
    def __init__(self):
        # 初始化多个LLM客户端
        self.anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.llm_preference = os.getenv("LLM_PREFERENCE", "claude")
        self.sessions: Dict[str, ClientSession] = {}
        self.exit_stack = AsyncExitStack()
        self.server_info: Dict[str, Dict] = {}

    def load_server_config(self) -> Dict[str, Dict[str, Any]]:
        """从配置文件加载 MCP 服务器信息"""
        config_path = os.getenv("MCP_CONFIG_PATH", "mcp_config.json")
        if not os.path.exists(config_path):
            print(f"Configuration file {config_path} not found.")
            return {}

        try:
            with open(config_path, "r") as f:
                config = json.load(f)
            return config.get("mcpServers", {})
        except Exception as e:
            print(f"Error reading configuration file {config_path}: {str(e)}")
            return {}

    async def connect_to_servers(self) -> None:
        """根据配置文件连接到所有 MCP 服务器"""
        servers = self.load_server_config()
        if not servers:
            print("No servers found in configuration.")
            return

        for server_name, server_config in servers.items():
            command = server_config.get("command")
            args = server_config.get("args", [])

            if not command or not isinstance(args, list):
                print(f"Invalid configuration for server {server_name}: {server_config}")
                continue

            # 推断传输类型
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
                # 确保 sse_client 返回的对象具有 write 方法
                # 如果 sse_client 返回的是 (read, write) 元组，需要调整
                if isinstance(sse_transport, tuple):
                    read, write = sse_transport
                    # 创建一个临时对象来适配 ClientSession 的接口
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

            self.sessions[server_name] = session
            self.server_info[server_name] = {
                "tools": [tool.name for tool in tools_response.tools],
                "resources": [resource.uri for resource in resources_response.resources],
                "prompts": [prompt.name for prompt in prompts_response.prompts],
                "latency": latency,
                "load": 0.0
            }

            print(f"\nConnected to {server_name} with tools: {self.server_info[server_name]['tools']}, latency: {latency:.2f}ms")

        except Exception as e:
            print(f"Failed to connect to {server_name}: {str(e)}")
            if server_name in self.sessions:
                del self.sessions[server_name]
            if server_name in self.server_info:
                del self.server_info[server_name]

    async def select_server(self, query: str) -> Optional[str]:
        try:
            system_prompt = (
                "You are an AI assistant that helps select the appropriate MCP server based on the user's query. "
                "I will provide a list of available MCP servers with their capabilities (tools, resources, prompts), "
                "latency (in milliseconds), and current load (as a percentage). "
                "Based on the user's query, determine which server is best suited to handle the task. "
                "Prioritize servers with lower latency and lower load, but ensure the server has the required tools or resources. "
                "Return the name of the server or None if no server is suitable."
            )

            server_info_message = "Available MCP servers and their details:\n"
            for server_name, info in self.server_info.items():
                server_info_message += (
                    f"Server: {server_name}\n"
                    f"Tools: {info['tools']}\n"
                    f"Resources: {info['resources']}\n"
                    f"Prompts: {info['prompts']}\n"
                    f"Latency: {info['latency']:.2f}ms\n"
                    f"Load: {info['load']:.2f}%\n\n"
                )
            print(f"server_info_message: {server_info_message}, llm_preference: {self.llm_preference}, openai: {self.openai.api_key}, anthropic: {self.anthropic}")
            user_message = f"User query: {query}\nWhich server should be used to handle this query?"

            if self.llm_preference == "openai":
                response = await self.openai.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": server_info_message + user_message}
                    ],
                    max_tokens=100
                )
                print(f"response: {response.to_json()}")
                selected_server = response.choices[0].message.content.strip()
            else:
                response = self.anthropic.messages.create(
                    model="claude-3-7-sonnet-20250219",
                    system=system_prompt,
                    messages=[
                        {"role": "user", "content": server_info_message + user_message}
                    ],
                    max_tokens=100
                )
                selected_server = response.content[0].text.strip()

            if selected_server == "None" or selected_server not in self.sessions:
                return None
            return selected_server

        except Exception as e:
            print(f"Error in server selection: {str(e)}")
            return None

    async def process_query(self, query: str) -> str:
        try:
            selected_server = await self.select_server(query)
            if not selected_server:
                return "No suitable MCP server found to handle this query."

            session = self.sessions[selected_server]
            print(f"Selected server: {selected_server}")

            response = await session.list_tools()
            available_tools = [{"name": tool.name, "description": tool.description} for tool in response.tools]
            print(f"Available tools: {available_tools}")

            # 修正拼写错误：将 "excute" 替换为 "execute"
            corrected_query = query.replace("excute", "execute")
            print(f"Corrected query: {corrected_query}")

            system_prompt = (
                "You are an AI assistant that can use tools to complete tasks. "
                "Based on the user's query and the available tools, decide which tool to use and what arguments to provide. "
                "Return your response in JSON format with the following structure:\n"
                "{\n"
                "  \"tool_name\": \"<tool_name>\",\n"
                "  \"arguments\": {<key>: <value>, ...}\n"
                "}\n"
                "For example, if the user wants to execute a SQL query, you might return:\n"
                "{\n"
                "  \"tool_name\": \"execute_query\",\n"
                "  \"arguments\": {\"query\": \"SELECT * FROM table_name\"}\n"
                "}\n"
                "Ensure the response is valid JSON."
            )

            user_message = f"User query: {corrected_query}\nAvailable tools: {json.dumps(available_tools)}"
            print(f"user_message: {user_message}")

            if self.llm_preference == "openai":
                response = await self.openai.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message}
                    ],
                    max_tokens=200
                )
                raw_response = response.choices[0].message.content
                print(f"OpenAI raw response: {raw_response}")
                tool_call = json.loads(raw_response)
            else:
                response = self.anthropic.messages.create(
                    model="claude-3-7-sonnet-20250219",
                    system=system_prompt,
                    messages=[
                        {"role": "user", "content": user_message}
                    ],
                    max_tokens=200
                )
                raw_response = response.content[0].text
                print(f"Claude raw response: {raw_response}")
                tool_call = json.loads(raw_response)

            tool_name = tool_call.get("tool_name")
            arguments = tool_call.get("arguments", {})
            print(f"tool_name: {tool_name}, arguments: {arguments}")

            if not tool_name:
                return "LLM could not determine which tool to use."

            print(f"Using tool: {tool_name} with arguments: {arguments}")
            result = await session.call_tool(tool_name, arguments)
            self.server_info[selected_server]["load"] = min(self.server_info[selected_server]["load"] + 1.0, 100.0)
            return f"Result from {selected_server}: {result.result}"

        except json.JSONDecodeError as e:
            print(f"Error parsing LLM response as JSON: {str(e)}")
            return "Failed to process query: LLM response is not valid JSON."
        except Exception as e:
            print(f"Error processing query: {str(e)}")
            return f"Failed to process query: {str(e)}"

    async def chat_loop(self):
        print("Enter your query (or type 'exit' to quit):")
        while True:
            query = input("> ")
            if query.lower() == "exit":
                break
            result = await self.process_query(query)
            print(result)

    async def cleanup(self):
        await self.exit_stack.aclose()

async def main():
    client = MCPClient()

    try:
        await client.connect_to_servers()
        await client.chat_loop()

    finally:
        await client.cleanup()

if __name__ == "__main__":
    asyncio.run(main())