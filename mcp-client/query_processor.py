# mcp-client/query_processor.py

import json
from typing import Any, Dict, List, Optional
from mcp import ClientSession
from llm import LLMClient
from server_connection import ServerConnection

class QueryProcessor:
    def __init__(self, llm_client: LLMClient, server_connection: ServerConnection):
        self.llm_client = llm_client
        self.server_connection = server_connection

    async def select_prompt_and_fill(self, server_name: str, query: str) -> Optional[Dict[str, Any]]:
        """选择并填充 prompt 模板"""
        server_info = self.server_connection.server_info[server_name]
        selected_prompt_name = await self.llm_client.select_prompt(server_info, query)
        if not selected_prompt_name:
            print("No suitable prompt selected.")
            return None

        selected_prompt = next((p for p in server_info["prompts"] if p["name"] == selected_prompt_name), None)
        if not selected_prompt:
            print("Selected prompt not found in prompts list.")
            return None

        prompt_name = selected_prompt["name"]
        prompt_template = server_info["prompt_templates"][prompt_name]
        prompt_args = selected_prompt["arguments"]

        args = {}
        if prompt_args:
            args = await self.llm_client.extract_prompt_arguments(prompt_args, query)

        filled_messages = []
        for msg in prompt_template["messages"]:
            content = msg["content"]
            for arg_name, arg_value in args.items():
                placeholder = "{{" + arg_name + "}}"
                if arg_value == "":
                    arg_value = "N/A"
                content = content.replace(placeholder, str(arg_value))
            filled_messages.append({"role": msg["role"], "content": content})

        return {
            "prompt_name": prompt_name,
            "messages": filled_messages,
            "args": args,
        }

    async def process_query(self, query: str) -> str:
        """处理用户查询，调用工具并返回结果"""
        try:
            selected_server = await self.llm_client.select_server(query, self.server_connection.server_info)
            if not selected_server:
                return "No suitable MCP server found to handle this query."

            session = self.server_connection.sessions[selected_server]
            print(f"Selected server: {selected_server}")

            tools = self.server_connection.server_info[selected_server]["tools"]
            print(f"Available tools: {tools}")

            corrected_query = query.replace("excute", "execute")
            print(f"Corrected query: {corrected_query}")

            prompt_info = await self.select_prompt_and_fill(selected_server, corrected_query)
            if prompt_info:
                print(f"Selected prompt: {prompt_info['prompt_name']}, filled messages: {prompt_info['messages']}")
                user_message = "\n".join(msg["content"] for msg in prompt_info["messages"])
            else:
                user_message = corrected_query
            print(f"User message: {user_message}")

            tool_call = await self.llm_client.select_tool(tools, user_message)
            tool_name = tool_call.get("tool_name")
            arguments = tool_call.get("arguments", {})

            if not tool_name:
                return "LLM could not determine which tool to use."

            if not arguments:
                tool = next((t for t in tools if t["name"] == tool_name), None)
                if tool:
                    arguments = await self.llm_client.extract_tool_arguments(tool, corrected_query)
                    print(f"Extracted arguments: {arguments}")

            print(f"Using tool: {tool_name} with arguments: {arguments}")
            result = await session.call_tool(tool_name, arguments)
            print(f"Raw tool result: {result}")

            if hasattr(result, "content") and result.content:
                content = result.content
                if isinstance(content, list) and len(content) > 0:
                    first_item = content[0]
                    if hasattr(first_item, "type") and first_item.type == "json":
                        result_text = json.dumps(first_item.data, ensure_ascii=False, indent=2)
                    elif hasattr(first_item, "type") and first_item.type == "text":
                        result_text = first_item.text
                    else:
                        result_text = f"Unsupported content type: {first_item.type}"
                else:
                    result_text = "Empty content returned from tool."
            else:
                result_text = "No content returned from tool."

            self.server_connection.server_info[selected_server]["load"] = min(
                self.server_connection.server_info[selected_server]["load"] + 1.0, 100.0
            )
            return f"Result from {selected_server}:\n{result_text}"

        except json.JSONDecodeError as e:
            print(f"Error parsing LLM response as JSON: {str(e)}")
            return "Failed to process query: LLM response is not valid JSON."
        except Exception as e:
            print(f"Error processing query: {str(e)}")
            return f"Failed to process query: {str(e)}"