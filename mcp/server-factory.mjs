import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMindiouTools } from "./tools.mjs";

/**
 * Build one isolated MCP server instance for one stdio process or one remote
 * HTTP session. The backend client is injected so a remote session can bind
 * every tool call to the bearer token that initialized that session.
 */
export function createMindiouMcpServer(client, options = {}) {
  const captureState = options.captureState || { getStatus: () => ({ enabled: false, mode: "remote" }) };
  const tools = createMindiouTools(client, { captureState });
  const server = new Server(
    { name: "mindiou", version: "0.3.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.definitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return tools.callTool(name, args || {});
  });

  return { server, tools };
}
