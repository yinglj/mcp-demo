import asyncio
from mcp.client import ClientSession, stdio_client
from mcp.client.server_parameters import StdioServerParameters

async def main():
    server_params = StdioServerParameters(command="python", args=["server_with_ollama.py"])
    
    # Use stdio_client as a context manager to get the client
    async with stdio_client(server_params) as client:
        # Pass the client to ClientSession
        async with ClientSession(client) as session:
            await session.initialize()

            # List available tools
            tools = await session.list_tools()
            print("Available tools:", [tool.name for tool in tools])

            print("Welcome to the MCP Chat Client (with Ollama)!")
            print("Type 'exit' to quit.")

            while True:
                user_input = input("You: ")
                if user_input.lower() == "exit":
                    break
                try:
                    # Call the "chat" tool
                    result = await session.call_tool("chat", {"query": user_input})
                    print(f"{result}")
                except Exception as e:
                    print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())