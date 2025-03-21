# mcp-client/template_lister.py

import json
from typing import Optional
from server_connection import ServerConnection

class TemplateLister:
    def __init__(self, server_connection: ServerConnection):
        self.server_connection = server_connection

    async def list_templates(self, server_name: Optional[str] = None) -> str:
        """通过 list_resource_templates 方法列出指定服务器（或所有服务器）的模板"""
        if not self.server_connection.server_info:
            return "No servers available."

        if server_name and server_name not in self.server_connection.server_info:
            return f"Server {server_name} not found."

        target_servers = [server_name] if server_name else self.server_connection.server_info.keys()
        output = []

        for srv in target_servers:
            session = self.server_connection.sessions[srv]
            try:
                response = await session.request("list_resource_templates", {})
                print(f"Raw response from list_resource_templates: {response}")

                if hasattr(response, "resourceTemplates") and response.resourceTemplates:
                    templates = response.resourceTemplates
                    if not templates:
                        output.append(f"No templates found on server {srv}.")
                        continue

                    output.append(f"\nResource Templates on server {srv}:")
                    for template in templates:
                        output.append(f"- URI Template: {template.uriTemplate}")
                        output.append(f"  Name: {template.name}")
                        output.append(f"  MIME Type: {template.mimeType}")
                        output.append(f"  Description: {template.description}")
                        output.append("")
                else:
                    output.append(f"No templates returned from server {srv}.")
            except Exception as e:
                output.append(f"Failed to list templates on server {srv}: {str(e)}")

            prompts = self.server_connection.server_info[srv]["prompts"]
            if prompts:
                output.append(f"Prompt templates on server {srv}:")
                for prompt in prompts:
                    output.append(f"- Name: {prompt['name']}")
                    output.append(f"  Description: {prompt['description']}")
                    output.append(f"  Arguments: {json.dumps(prompt['arguments'], ensure_ascii=False)}")
                    output.append("")

        return "\n".join(output)