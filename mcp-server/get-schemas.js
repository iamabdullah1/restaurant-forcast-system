import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from "zod";

const server = new McpServer({ name: "test", version: "1" });
server.tool("hello", "Say hello", { name: z.string() }, async () => ({ content: [{type: "text", text: "world"}]}));

console.log(JSON.stringify(server._registeredTools || server.tools || server));
