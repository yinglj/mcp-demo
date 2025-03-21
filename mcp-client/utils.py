# mcp-client/utils.py

import re

def clean_markdown_json(raw_response: str) -> str:
    """清理 Markdown 代码块标记"""
    return re.sub(r'```json\s*|\s*```|```', '', raw_response).strip()