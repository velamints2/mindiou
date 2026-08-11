/**
 * MindIOU Remote MCP server（Streamable HTTP）。
 *
 * The public endpoint accepts a project-scoped Hook Token per MCP session.
 * The token is validated by the existing MindIOU API and is never stored in
 * a process-wide environment variable or written to logs. Each MCP session
 * gets its own backend client and MCP Server instance.
 */

import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createBackendClient } from "./backend-client.mjs";
import { createMindiouMcpServer } from "./server-factory.mjs";

const host = process.env.MINDIOU_MCP_HOST || "127.0.0.1";
const port = Number(process.env.MINDIOU_MCP_PORT || 8795);
const endpointPath = normalizePath(process.env.MINDIOU_MCP_PATH || "/mcp");
const healthPath = "/healthz";
const backendUrl = String(
  process.env.MINDIOU_BACKEND_URL || process.env.MINDIOU_BASE_URL || "http://127.0.0.1:8794"
).replace(/\/+$/, "");
const maxBodyBytes = Number(process.env.MINDIOU_MCP_MAX_BODY_BYTES || 512 * 1024);
const maxSessions = Number(process.env.MINDIOU_MCP_MAX_SESSIONS || 100);
const sessionTtlMs = Number(process.env.MINDIOU_MCP_SESSION_TTL_MS || 30 * 60 * 1000);

const sessions = new Map();
const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - sessionTtlMs;
  for (const [sessionId, entry] of sessions) {
    if (entry.lastSeenAt < cutoff) closeSession(sessionId, "ttl");
  }
}, Math.min(sessionTtlMs, 60_000));
cleanupTimer.unref();

function normalizePath(value) {
  const path = `/${String(value || "").replace(/^\/+|\/+$/g, "")}`;
  return path === "/" ? "/mcp" : path;
}

function tokenFromRequest(req) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function tokenFingerprint(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("access-control-expose-headers", "Mcp-Session-Id, Last-Event-ID, WWW-Authenticate");
}

function json(res, status, body, headers = {}) {
  setCors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function text(res, status, value, headers = {}) {
  setCors(res);
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(value);
}

function rejectUnauthorized(res) {
  json(res, 401, { ok: false, error: "Bearer Hook Token required" }, { "www-authenticate": "Bearer" });
}

function requestPath(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname;
}

async function readJsonBody(req) {
  const declaredLength = Number(req.headers["content-length"] || 0);
  if (declaredLength > maxBodyBytes) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!total) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 });
  }
}

async function validateToken(token) {
  if (!token) throw Object.assign(new Error("Bearer Hook Token required"), { statusCode: 401 });
  const client = createBackendClient({
    baseUrl: backendUrl,
    hookToken: token,
    // `_` asks the existing API to use the project bound to this token. The
    // remote request never trusts a project ID supplied by a caller.
    projectId: "_"
  });
  const context = await client.getAgentContext("_");
  if (!context?.project?.id) throw Object.assign(new Error("Hook Token is not bound to a project"), { statusCode: 401 });
  return { client, context };
}

function getSession(req, res, token) {
  const sessionId = String(req.headers["mcp-session-id"] || "");
  const entry = sessionId ? sessions.get(sessionId) : null;
  if (!entry) {
    json(res, 404, { ok: false, error: "MCP session not found" });
    return null;
  }
  if (entry.tokenHash !== tokenFingerprint(token)) {
    json(res, 403, { ok: false, error: "MCP session belongs to another Hook Token" });
    return null;
  }
  entry.lastSeenAt = Date.now();
  return entry;
}

function closeSession(sessionId, reason = "closed") {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  sessions.delete(sessionId);
  void entry.transport.close().catch(() => {});
  console.error(`[mindiou-remote-mcp] session closed reason=${reason} session=${sessionId}`);
}

async function handleMcp(req, res) {
  const token = tokenFromRequest(req);
  if (!token) {
    rejectUnauthorized(res);
    return;
  }

  const sessionId = String(req.headers["mcp-session-id"] || "");
  if (sessionId) {
    const entry = getSession(req, res, token);
    if (!entry) return;
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      await entry.transport.handleRequest(req, res, body);
    } else {
      await entry.transport.handleRequest(req, res);
    }
    return;
  }

  if (req.method === "GET") {
    text(res, 405, "MCP session required");
    return;
  }
  if (req.method === "DELETE") {
    json(res, 400, { ok: false, error: "MCP session required" });
    return;
  }
  if (req.method !== "POST") {
    text(res, 405, "Method Not Allowed", { allow: "GET, POST, DELETE, OPTIONS" });
    return;
  }

  const body = await readJsonBody(req);
  if (!isInitializeRequest(body)) {
    json(res, 400, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "MCP initialization request required" },
      id: null
    });
    return;
  }
  if (sessions.size >= maxSessions) {
    json(res, 503, { ok: false, error: "Too many active MCP sessions" });
    return;
  }

  const { client } = await validateToken(token);
  let transport;
  let entry;
  const { server } = createMindiouMcpServer(client, {
    captureState: { getStatus: () => ({ enabled: false, mode: "remote", note: "Remote MCP requires explicit capture_project_session" }) }
  });
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: initializedSessionId => {
      entry.sessionId = initializedSessionId;
      entry.lastSeenAt = Date.now();
      sessions.set(initializedSessionId, entry);
      console.error(`[mindiou-remote-mcp] session initialized session=${initializedSessionId} token=${tokenFingerprint(token)}`);
    }
  });
  entry = {
    sessionId: "",
    tokenHash: tokenFingerprint(token),
    transport,
    server,
    lastSeenAt: Date.now()
  };
  transport.onclose = () => {
    if (entry.sessionId) closeSession(entry.sessionId, "transport");
  };
  transport.onerror = error => {
    console.error(`[mindiou-remote-mcp] transport error session=${entry.sessionId || "initializing"} error=${error?.message || error}`);
  };
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

const httpServer = createServer(async (req, res) => {
  setCors(res);
  try {
    const path = requestPath(req);
    if (req.method === "OPTIONS" && (path === endpointPath || path === healthPath)) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (path === healthPath && req.method === "GET") {
      json(res, 200, { ok: true, service: "mindiou-remote-mcp", sessions: sessions.size, backendConfigured: Boolean(backendUrl) });
      return;
    }
    if (path !== endpointPath) {
      text(res, 404, "Not found");
      return;
    }
    await handleMcp(req, res);
  } catch (error) {
    const status = Number(error?.statusCode) || (/401|Unauthorized|Invalid Project Memory hook token/i.test(String(error?.message)) ? 401 : 500);
    if (!res.headersSent) {
      if (status === 401) rejectUnauthorized(res);
      else json(res, status, { ok: false, error: status >= 500 ? "Remote MCP internal error" : error.message });
    } else {
      res.destroy(error);
    }
    console.error(`[mindiou-remote-mcp] request error status=${status} message=${error?.message || error}`);
  }
});

httpServer.listen(port, host, () => {
  console.error(`[mindiou-remote-mcp] listening http://${host}:${port}${endpointPath} backend=${backendUrl}`);
});

async function shutdown(signal) {
  console.error(`[mindiou-remote-mcp] shutting down signal=${signal}`);
  clearInterval(cleanupTimer);
  for (const sessionId of [...sessions.keys()]) closeSession(sessionId, signal);
  await new Promise(resolve => httpServer.close(resolve));
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
