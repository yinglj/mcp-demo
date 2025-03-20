import asyncio
import json
import os
import time
import re
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
        self.llm_preference = os.getenv("LLM_PREFERENCE", "openai")  # 默认使用 OpenAI
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
                # 将 arguments 转换为可序列化的字典列表
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

    async def select_server(self, query: str) -> Optional[str]:
        """使用 LLM 选择合适的 MCP 服务器"""
        try:
            system_prompt = (
                "You are an AI assistant that helps select the appropriate MCP server based on the user's query. "
                "I will provide a list of available MCP servers with their capabilities (tools, resources, prompts), "
                "latency (in milliseconds), and current load (as a percentage). "
                "Based on the user's query, determine which server is best suited to handle the task. "
                "Prioritize servers with lower latency and lower load, but ensure the server has the required tools, resources, or prompts. "
                "Return the name of the server or 'None' if no server is suitable."
            )

            server_info_message = "Available MCP servers and their details:\n"
            for server_name, info in self.server_info.items():
                server_info_message += (
                    f"Server: {server_name}\n"
                    f"Tools: {[tool['name'] for tool in info['tools']]}\n"
                    f"Resources: {[resource['uri'] for resource in info['resources']]}\n"
                    f"Prompts: {[prompt['name'] for prompt in info['prompts']]}\n"
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

    async def select_prompt_and_fill(self, server_name: str, query: str) -> Optional[Dict[str, Any]]:
        """使用 LLM 动态选择合适的 prompt 模板并填充参数"""
        prompts = self.server_info[server_name]["prompts"]
        prompt_templates = self.server_info[server_name]["prompt_templates"]

        if not prompts:
            print("No prompts available for server:", server_name)
            return None

        # 使用 LLM 选择最合适的 prompt
        system_prompt = (
            "You are an AI assistant that helps select the most appropriate prompt template based on the user's query. "
            "I will provide a list of available prompt templates with their descriptions and arguments. "
            "Based on the user's query, select the prompt that best matches the intent of the query. "
            "Return the name of the selected prompt or 'None' if no prompt is suitable."
        )

        prompt_info_message = "Available prompt templates:\n"
        for prompt in prompts:
            prompt_info_message += (
                f"Prompt: {prompt['name']}\n"
                f"Description: {prompt['description']}\n"
                f"Arguments: {json.dumps(prompt['arguments'], ensure_ascii=False)}\n\n"
            )
        user_message = f"User query: {query}\nWhich prompt template should be used to handle this query?"
        print(f"Prompt selection input: {prompt_info_message}{user_message}")

        if self.llm_preference == "openai":
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt_info_message + user_message}
                ],
                max_tokens=50
            )
            selected_prompt_name = response.choices[0].message.content.strip()
        else:
            response = self.anthropic.messages.create(
                model="claude-3-7-sonnet-20250219",
                system=system_prompt,
                messages=[
                    {"role": "user", "content": prompt_info_message + user_message}
                ],
                max_tokens=50
            )
            selected_prompt_name = response.content[0].text.strip()

        print(f"Selected prompt name: {selected_prompt_name}")
        if selected_prompt_name == "None" or selected_prompt_name not in prompt_templates:
            print("No suitable prompt selected.")
            return None

        selected_prompt = next((p for p in prompts if p["name"] == selected_prompt_name), None)
        if not selected_prompt:
            print("Selected prompt not found in prompts list.")
            return None

        prompt_name = selected_prompt["name"]
        prompt_template = prompt_templates[prompt_name]
        prompt_args = selected_prompt["arguments"]

        # 使用 LLM 提取参数值
        args = {}
        if prompt_args:
            system_prompt = (
                "You are an AI assistant that extracts parameters from a user's query based on the required arguments of a prompt template. "
                "I will provide the user's query and the list of arguments that need to be extracted. "
                "Extract the values for each argument from the query and return them as a JSON object. "
                "If an argument cannot be extracted, return an empty string for that argument. "
                "Ensure the response is a pure JSON string and do not wrap it in Markdown code blocks (e.g., ```json ... ```). "
                "Do not include any additional text outside the JSON string. "
                "For example, if the query is '获取mysql.user的表结构' and the arguments are 'database' and 'table', "
                "you should return: {\"database\": \"mysql\", \"table\": \"user\"}."
            )

            args_info = "Arguments to extract:\n"
            for arg in prompt_args:
                args_info += f"Name: {arg['name']}, Description: {arg['description']}, Required: {arg['required']}\n"
            user_message = f"User query: {query}\n{args_info}\nExtract the values for these arguments."

            if self.llm_preference == "openai":
                response = await self.openai.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message}
                    ],
                    max_tokens=100
                )
                raw_response = response.choices[0].message.content
                print(f"Parameter extraction response: {raw_response}")
                # 清理 Markdown 代码块标记
                cleaned_response = re.sub(r'```json\s*|\s*```|```', '', raw_response).strip()
                print(f"Cleaned parameter extraction response: {cleaned_response}")
                try:
                    args = json.loads(cleaned_response)
                except json.JSONDecodeError as e:
                    print(f"Failed to parse cleaned response as JSON: {cleaned_response}, error: {str(e)}")
                    # 返回默认值
                    args = {arg["name"]: "" for arg in prompt_args}
            else:
                response = self.anthropic.messages.create(
                    model="claude-3-7-sonnet-20250219",
                    system=system_prompt,
                    messages=[
                        {"role": "user", "content": user_message}
                    ],
                    max_tokens=100
                )
                raw_response = response.content[0].text
                print(f"Parameter extraction response: {raw_response}")
                # 清理 Markdown 代码块标记
                cleaned_response = re.sub(r'```json\s*|\s*```|```', '', raw_response).strip()
                print(f"Cleaned parameter extraction response: {cleaned_response}")
                try:
                    args = json.loads(cleaned_response)
                except json.JSONDecodeError as e:
                    print(f"Failed to parse cleaned response as JSON: {cleaned_response}, error: {str(e)}")
                    # 返回默认值
                    args = {arg["name"]: "" for arg in prompt_args}

        # 填充 prompt 模板
        filled_messages = []
        for msg in prompt_template["messages"]:
            content = msg["content"]
            for arg_name, arg_value in args.items():
                placeholder = "{{" + arg_name + "}}"
                # 如果参数值是空字符串，替换为 "N/A" 或其他默认值
                if arg_value == "":
                    arg_value = "N/A"
                content = content.replace(placeholder, str(arg_value))
            filled_messages.append({"role": msg["role"], "content": content})

        return {
            "prompt_name": prompt_name,
            "messages": filled_messages,
            "args": args,
        }

    async def extract_tool_arguments(self, server_name: str, tool_name: str, query: str) -> Dict[str, Any]:
        """使用 LLM 根据工具的 inputSchema 提取参数"""
        tools = self.server_info[server_name]["tools"]
        tool = next((t for t in tools if t["name"] == tool_name), None)
        if not tool:
            print(f"Tool {tool_name} not found in server {server_name}")
            return {}

        input_schema = tool.get("inputSchema", {})
        properties = input_schema.get("properties", {})
        required = input_schema.get("required", [])

        if not properties:
            print(f"No properties defined in inputSchema for tool {tool_name}")
            return {}

        # 使用 LLM 提取参数值
        system_prompt = (
            "You are an AI assistant that extracts parameters from a user's query based on the input schema of a tool. "
            "I will provide the user's query and the tool's input schema, including the properties and required fields. "
            "Extract the values for each property from the query and return them as a JSON object. "
            "If a property cannot be extracted, return an empty string for that property. "
            "Ensure the response is a pure JSON string and do not wrap it in Markdown code blocks (e.g., ```json ... ```). "
            "Do not include any additional text outside the JSON string."
        )

        schema_info = "Tool input schema:\n"
        for prop_name, prop_info in properties.items():
            schema_info += f"Property: {prop_name}, Description: {prop_info.get('description', 'N/A')}, Type: {prop_info.get('type', 'N/A')}\n"
        schema_info += f"Required properties: {required}\n"
        user_message = f"User query: {query}\n{schema_info}\nExtract the values for these properties."

        if self.llm_preference == "openai":
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                max_tokens=100
            )
            raw_response = response.choices[0].message.content
            print(f"Tool parameter extraction response: {raw_response}")
            # 清理 Markdown 代码块标记
            cleaned_response = re.sub(r'```json\s*|\s*```|```', '', raw_response).strip()
            print(f"Cleaned tool parameter extraction response: {cleaned_response}")
            try:
                args = json.loads(cleaned_response)
            except json.JSONDecodeError as e:
                print(f"Failed to parse cleaned tool response as JSON: {cleaned_response}, error: {str(e)}")
                args = {prop: "" for prop in properties.keys()}
        else:
            response = self.anthropic.messages.create(
                model="claude-3-7-sonnet-20250219",
                system=system_prompt,
                messages=[
                    {"role": "user", "content": user_message}
                ],
                max_tokens=100
            )
            raw_response = response.content[0].text
            print(f"Tool parameter extraction response: {raw_response}")
            # 清理 Markdown 代码块标记
            cleaned_response = re.sub(r'```json\s*|\s*```|```', '', raw_response).strip()
            print(f"Cleaned tool parameter extraction response: {cleaned_response}")
            try:
                args = json.loads(cleaned_response)
            except json.JSONDecodeError as e:
                print(f"Failed to parse cleaned tool response as JSON: {cleaned_response}, error: {str(e)}")
                args = {prop: "" for prop in properties.keys()}

        # 确保所有必需参数都已提供
        for req in required:
            if req not in args or args[req] == "":
                print(f"Missing required parameter: {req} for tool {tool_name}")
                return {}

        return args

    async def process_query(self, query: str) -> str:
        """处理用户查询，调用工具并返回结果"""
        try:
            selected_server = await self.select_server(query)
            if not selected_server:
                return "No suitable MCP server found to handle this query."

            session = self.sessions[selected_server]
            print(f"Selected server: {selected_server}")

            tools = self.server_info[selected_server]["tools"]
            print(f"Available tools: {tools}")

            # 修正拼写错误：将 "excute" 替换为 "execute"
            corrected_query = query.replace("excute", "execute")
            print(f"Corrected query: {corrected_query}")

            # 选择并填充 prompt
            prompt_info = await self.select_prompt_and_fill(selected_server, corrected_query)
            if prompt_info:
                print(f"Selected prompt: {prompt_info['prompt_name']}, filled messages: {prompt_info['messages']}")
                user_message = "\n".join(msg["content"] for msg in prompt_info["messages"])
            else:
                user_message = corrected_query
            print(f"User message: {user_message}")

            system_prompt = (
                "You are an AI assistant that can use tools to complete tasks. "
                "Based on the user's query and the available tools, decide which tool to use and what arguments to provide. "
                "The available tools are:\n"
                f"{json.dumps(tools, ensure_ascii=False, indent=2)}\n"
                "Return your response as a pure JSON string with the following structure:\n"
                "{\"tool_name\": \"<tool_name>\", \"arguments\": {<key>: <value>, ...}}\n"
                "Ensure the response is a pure JSON string and do not wrap it in Markdown code blocks (e.g., ```json ... ```). "
                "Do not include any additional text outside the JSON string."
            )

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
                cleaned_response = re.sub(r'```json\s*|\s*```|```', '', raw_response).strip()
                print(f"Cleaned response: {cleaned_response}")
                tool_call = json.loads(cleaned_response)
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
                cleaned_response = re.sub(r'```json\s*|\s*```|```', '', raw_response).strip()
                print(f"Cleaned response: {cleaned_response}")
                tool_call = json.loads(cleaned_response)

            tool_name = tool_call.get("tool_name")
            arguments = tool_call.get("arguments", {})

            if not tool_name:
                return "LLM could not determine which tool to use."

            # 自动提取参数（如果 LLM 未提供完整参数）
            if not arguments:
                arguments = await self.extract_tool_arguments(selected_server, tool_name, corrected_query)
                print(f"Extracted arguments: {arguments}")

            print(f"Using tool: {tool_name} with arguments: {arguments}")
            result = await session.call_tool(tool_name, arguments)
            print(f"Raw tool result: {result}")

            # 处理工具返回的结果
            if hasattr(result, "content") and result.content:
                content = result.content
                if isinstance(content, list) and len(content) > 0:
                    first_item = content[0]
                    # 检查是否是 type: "json"（如果 mcp-server 未修改）
                    if hasattr(first_item, "type") and first_item.type == "json":
                        # 将 data 转换为字符串
                        result_text = json.dumps(first_item.data, ensure_ascii=False, indent=2)
                    elif hasattr(first_item, "type") and first_item.type == "text":
                        result_text = first_item.text
                    else:
                        result_text = f"Unsupported content type: {first_item.type}"
                else:
                    result_text = "Empty content returned from tool."
            else:
                result_text = "No content returned from tool."

            self.server_info[selected_server]["load"] = min(self.server_info[selected_server]["load"] + 1.0, 100.0)
            return f"Result from {selected_server}:\n{result_text}"

        except json.JSONDecodeError as e:
            print(f"Error parsing LLM response as JSON: {str(e)}")
            return "Failed to process query: LLM response is not valid JSON."
        except Exception as e:
            print(f"Error processing query: {str(e)}")
            return f"Failed to process query: {str(e)}"

    async def chat_loop(self):
        """交互式聊天循环"""
        print("Enter your query (or type 'exit' to quit):")
        while True:
            query = input("> ")
            if query.lower() == "exit":
                break
            result = await self.process_query(query)
            print(result)

    async def cleanup(self):
        """清理资源"""
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