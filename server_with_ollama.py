from mcp import FastMCP, tool
import requests

# Ollama API 配置
OLLAMA_API_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "llama3"  # 使用 llama3 模型，您可以替换为其他模型

@tool()
def chat(query: str) -> str:
    """调用 Ollama 大模型生成响应"""
    data = {
        "model": MODEL_NAME,
        "prompt": query,
        "stream": False  # 非流式输出，直接返回完整响应
    }
    try:
        response = requests.post(OLLAMA_API_URL, json=data)
        response.raise_for_status()  # 检查 HTTP 请求是否成功
        return response.json()["response"]
    except requests.RequestException as e:
        return f"调用 Ollama 时出错: {e}"

# 初始化并运行 MCP 服务器
app = FastMCP()
app.add_tool(chat)
app.run()