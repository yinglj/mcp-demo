from mcp.server.fastmcp import FastMCP 
from mcp.server.sse import SseServerTransport
from starlette.applications import Starlette
from starlette.routing import Route, Mount
import uvicorn
from mcp.server.fastmcp.utilities.types import Image
from starlette.requests import Request

# Ollama API config and chat tool (as above)
OLLAMA_API_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "deepseek-r1:1.5b"
# Initialize FastMCP and add tool
mcp = FastMCP("Weather")


@mcp.tool()
async def get_weather(location: str) -> int:
    """Get weather for location."""
    return "It's always sunny in New York"



sse = SseServerTransport("/messages/")

async def handle_sse(request: Request) -> None:
    async with sse.connect_sse(
        request.scope,
        request.receive,
        request._send,  # noqa: SLF001
    ) as (read_stream, write_stream):
        await mcp._mcp_server.run(
            read_stream,
            write_stream,
            mcp._mcp_server.create_initialization_options(),
        )

routes=[
    Route("/sse", endpoint=handle_sse),
    Mount("/messages/", app=sse.handle_post_message),
]
# Create and run Starlette app
starlette_app = Starlette(routes=routes, debug=False)
uvicorn.run(starlette_app, host="0.0.0.0", port=8000)
