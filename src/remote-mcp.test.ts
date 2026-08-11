// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let backend;
let remote;
let backendUrl;
let remoteUrl;

async function freePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  const backendPort = await freePort();
  backend = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer judge-token-a") {
      json(res, 401, { ok: false, error: "Invalid Project Memory hook token" });
      return;
    }
    if (req.method === "GET" && req.url === "/api/projects/_/agent-context") {
      json(res, 200, {
        ok: true,
        project: { id: "judge-project", name: "评委体验" },
        counts: { sessions: 0, workItems: 0, artifacts: 0, decisions: 0, debts: 0, owned: 0 },
        debts: [],
        repaymentGaps: [],
        capabilityProfiles: [],
        dueReviews: { tasks: [] },
        recentDecisions: [],
        ownership: { summary: {} }
      });
      return;
    }
    if (req.method === "POST" && req.url === "/api/agent-sessions/events") {
      json(res, 200, {
        ok: true,
        project: { id: "judge-project", name: "评委体验" },
        session: { session: { id: "judge-session" }, artifacts: [], decisions: [] },
        analysis: { cognitiveDebtCandidates: [] }
      });
      return;
    }
    json(res, 404, { ok: false, error: "not found" });
  });
  await new Promise(resolve => backend.listen(backendPort, "127.0.0.1", resolve));
  backendUrl = `http://127.0.0.1:${backendPort}`;

  const remotePort = await freePort();
  remoteUrl = `http://127.0.0.1:${remotePort}`;
  remote = spawn(process.execPath, ["mcp/remote-server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MINDIOU_MCP_HOST: "127.0.0.1",
      MINDIOU_MCP_PORT: String(remotePort),
      MINDIOU_MCP_PATH: "/mcp",
      MINDIOU_BACKEND_URL: backendUrl,
      MINDIOU_MCP_SESSION_TTL_MS: "60000"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });
  await waitFor(`${remoteUrl}/healthz`);
}, 30000);

afterAll(async () => {
  remote?.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 300));
  await new Promise(resolve => backend?.close(resolve));
});

describe("remote Streamable HTTP MCP", () => {
  it("rejects an initialization without a Hook Token", async () => {
    const response = await fetch(`${remoteUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    });
    expect(response.status).toBe(401);
  });

  it("creates an isolated MCP session and serves the real tool surface", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${remoteUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer judge-token-a" } }
    });
    const client = new Client({ name: "judge-test", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const contextResult = await client.callTool({ name: "get_learning_context", arguments: {} });
      const context = JSON.parse(contextResult.content[0].text);
      expect(listed.tools).toHaveLength(9);
      expect(listed.tools.map(tool => tool.name)).toContain("capture_project_session");
      expect(context.project.name).toBe("评委体验");
    } finally {
      await transport.close();
    }
  });

  it("does not allow another token to reuse an existing MCP session", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${remoteUrl}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer judge-token-a" } }
    });
    const client = new Client({ name: "judge-test", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      const response = await fetch(`${remoteUrl}/mcp`, {
        method: "GET",
        headers: {
          Authorization: "Bearer another-token",
          "mcp-session-id": transport.sessionId
        }
      });
      expect(response.status).toBe(403);
    } finally {
      await transport.close();
    }
  });
});
