import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const client = new Client({ name: "local-support-agent", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(__dirname, "mcp-server.mjs")],
});

let availableTools = [];
let connected = false;

export async function connectMcpClient() {
  if (connected) return availableTools;
  await client.connect(transport);
  const result = await client.listTools();
  availableTools = result.tools;
  connected = true;
  return availableTools;
}

export function getMcpTools() {
  return availableTools;
}

export async function callMcpTool(name, args) {
  await connectMcpClient();
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(
      result.content?.find((item) => item.type === "text")?.text ||
        `MCP tool failed: ${name}`,
    );
  }

  const text = result.content?.find((item) => item.type === "text")?.text;
  return text ? JSON.parse(text) : null;
}
