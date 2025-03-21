# mcp-client/config.py

import os
import json
from typing import Dict, Any
from dotenv import load_dotenv

def load_environment() -> None:
    """加载环境变量"""
    load_dotenv()

def load_server_config() -> Dict[str, Dict[str, Any]]:
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

def get_llm_preference() -> str:
    """获取 LLM 偏好设置"""
    return os.getenv("LLM_PREFERENCE", "openai")  # 默认使用 OpenAI