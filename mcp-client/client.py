# mcp-client/client.py

import asyncio
from config import load_environment, load_server_config, get_llm_preference
from server_connection import ServerConnection
from llm import LLMClient
from query_processor import QueryProcessor
from template_lister import TemplateLister

class MCPClient:
    def __init__(self):
        load_environment()
        self.llm_preference = get_llm_preference()
        self.server_connection = ServerConnection()
        self.llm_client = LLMClient(self.llm_preference)
        self.query_processor = QueryProcessor(self.llm_client, self.server_connection)
        self.template_lister = TemplateLister(self.server_connection)

    async def start(self):
        """启动客户端"""
        servers = load_server_config()
        await self.server_connection.connect_to_servers(servers)
        await self.chat_loop()

    async def chat_loop(self):
        """交互式聊天循环"""
        print("Enter your query (or type 'exit' to quit):")
        print("Special commands:")
        print("- 'list templates': List available templates on all servers")
        print("- 'list templates <server_name>': List templates on a specific server")
        while True:
            query = input("> ").strip()
            if query.lower() == "exit":
                break

            if query.lower().startswith("list templates"):
                parts = query.split()
                server_name = parts[2] if len(parts) > 2 else None
                result = await self.template_lister.list_templates(server_name)
                print(result)
                continue

            result = await self.query_processor.process_query(query)
            print(result)

    async def cleanup(self):
        """清理资源"""
        await self.server_connection.cleanup()

async def main():
    client = MCPClient()
    try:
        await client.start()
    finally:
        await client.cleanup()

if __name__ == "__main__":
    asyncio.run(main())