# mcp-client/llm.py

import os
from typing import List, Optional, Dict, Any
import json
import re
from anthropic import Anthropic
from openai import AsyncOpenAI
from utils import clean_markdown_json

class LLMClient:
    def __init__(self, preference: str):
        self.anthropic = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        self.openai = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.preference = preference

    async def select_server(self, query: str, server_info: Dict[str, Dict]) -> Optional[str]:
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
            for server_name, info in server_info.items():
                server_info_message += (
                    f"Server: {server_name}\n"
                    f"Tools: {[tool['name'] for tool in info['tools']]}\n"
                    f"Resources: {[resource['uri'] for resource in info['resources']]}\n"
                    f"Prompts: {[prompt['name'] for prompt in info['prompts']]}\n"
                    f"Latency: {info['latency']:.2f}ms\n"
                    f"Load: {info['load']:.2f}%\n\n"
                )
            user_message = f"User query: {query}\nWhich server should be used to handle this query?"

            if self.preference == "openai":
                response = await self.openai.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": server_info_message + user_message}
                    ],
                    max_tokens=100
                )
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

            if selected_server == "None":
                return None
            return selected_server

        except Exception as e:
            print(f"Error in server selection: {str(e)}")
            return None

    async def select_prompt(self, server_info: Dict, query: str) -> Optional[str]:
        """使用 LLM 动态选择合适的 prompt 模板"""
        prompts = server_info["prompts"]
        if not prompts:
            print("No prompts available for server.")
            return None

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

        if self.preference == "openai":
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

        if selected_prompt_name == "None":
            return None
        return selected_prompt_name

    async def extract_prompt_arguments(self, prompt_args: List[Dict], query: str) -> Dict[str, Any]:
        """使用 LLM 提取 prompt 参数"""
        system_prompt = (
            "You are an AI assistant that extracts parameters from a user's query based on the required arguments of a prompt template. "
            "I will provide the user's query and the list of arguments that need to be extracted. "
            "Extract the values for each argument from the query and return them as a JSON object. "
            "If an argument cannot be extracted, return an empty string for that argument. "
            "Ensure the response is a pure JSON string and do not wrap it in Markdown code blocks (e.g., ```json ... ```). "
            "Do not include any additional text outside the JSON string."
        )

        args_info = "Arguments to extract:\n"
        for arg in prompt_args:
            args_info += f"Name: {arg['name']}, Description: {arg['description']}, Required: {arg['required']}\n"
        user_message = f"User query: {query}\n{args_info}\nExtract the values for these arguments."

        if self.preference == "openai":
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                max_tokens=100
            )
            raw_response = response.choices[0].message.content
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

        cleaned_response = clean_markdown_json(raw_response)
        try:
            args = json.loads(cleaned_response)
        except json.JSONDecodeError as e:
            print(f"Failed to parse cleaned response as JSON: {cleaned_response}, error: {str(e)}")
            args = {arg["name"]: "" for arg in prompt_args}
        return args

    async def extract_tool_arguments(self, tool: Dict, query: str) -> Dict[str, Any]:
        """使用 LLM 根据工具的 inputSchema 提取参数"""
        input_schema = tool.get("inputSchema", {})
        properties = input_schema.get("properties", {})
        required = input_schema.get("required", [])

        if not properties:
            print(f"No properties defined in inputSchema for tool {tool['name']}")
            return {}

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

        if self.preference == "openai":
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                max_tokens=100
            )
            raw_response = response.choices[0].message.content
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

        cleaned_response = clean_markdown_json(raw_response)
        try:
            args = json.loads(cleaned_response)
        except json.JSONDecodeError as e:
            print(f"Failed to parse cleaned tool response as JSON: {cleaned_response}, error: {str(e)}")
            args = {prop: "" for prop in properties.keys()}

        for req in required:
            if req not in args or args[req] == "":
                print(f"Missing required parameter: {req} for tool {tool['name']}")
                return {}

        return args

    async def select_tool(self, tools: List[Dict], user_message: str) -> Dict[str, Any]:
        """使用 LLM 选择工具并提取参数"""
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

        if self.preference == "openai":
            response = await self.openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                max_tokens=200
            )
            raw_response = response.choices[0].message.content
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

        cleaned_response = clean_markdown_json(raw_response)
        return json.loads(cleaned_response)