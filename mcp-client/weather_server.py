from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import threading
import time

class MCPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/sse":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

            # 模拟 SSE 事件流
            self.wfile.write(b"data: {\"tools\": [{\"name\": \"get_weather\", \"description\": \"Get weather for a city\"}]}\n\n")
            self.wfile.flush()

    def do_POST(self):
        if self.path == "/call_tool":
            content_length = int(self.headers["Content-Length"])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode("utf-8"))

            tool_name = data.get("tool_name")
            arguments = data.get("arguments", {})

            if tool_name == "get_weather":
                city = arguments.get("city", "San Francisco")
                result = f"The weather in {city} is 18°C with light rain."
            else:
                result = "Unknown tool"

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"result": result}).encode("utf-8"))

def run_server():
    server = HTTPServer(("localhost", 3001), MCPHandler)
    print("MCP Weather Server running on http://localhost:3001")
    server.serve_forever()

# 模拟 mDNS 广播
from zeroconf import Zeroconf, ServiceInfo
import socket

def broadcast_service():
    zeroconf = Zeroconf()
    service_info = ServiceInfo(
        type_="_mcp._tcp.local.",
        name="weather._mcp._tcp.local.",
        port=3001,
        properties={"transport": "sse"},
        addresses=[socket.inet_aton("127.0.0.1")],
    )
    zeroconf.register_service(service_info)
    print("Broadcasting MCP Weather Server via mDNS...")
    try:
        while True:
            time.sleep(1)
    finally:
        zeroconf.unregister_service(service_info)
        zeroconf.close()

if __name__ == "__main__":
    # 启动 HTTP 服务器和 mDNS 广播
    server_thread = threading.Thread(target=run_server)
    mdns_thread = threading.Thread(target=broadcast_service)
    server_thread.start()
    mdns_thread.start()
    server_thread.join()
    mdns_thread.join()