import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

// Experiment-apparatus API tests: auth gating, exp1 label round-trip via the
// audit namespace, and the unsealed-exp2 guard. These routes were added for
// the research program (EXP-1/EXP-2) and had no coverage until now.

const API_PORT = 8871;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE_DIR = path.resolve("tmp/test-exp-routes");
const STORE = path.join(STORE_DIR, "mvp0-store.json");
const SESSION_STORE = path.join(STORE_DIR, "mvp1-store.json");
const AUTH_STORE = path.join(STORE_DIR, "auth-store.json");
const DATA_DB = path.join(STORE_DIR, "data.sqlite");

let appProcess: ChildProcessWithoutNullStreams | undefined;
let sessionCookie: string | undefined;

async function waitFor(url: string, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function api(pathname: string, options: RequestInit & { headers?: Record<string, string> } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(sessionCookie ? { cookie: sessionCookie } : {}), ...(options.headers || {}) }
  });
  return { response, data: await response.json().catch(() => ({})) };
}

beforeAll(async () => {
  await rm(STORE_DIR, { recursive: true, force: true });
  await mkdir(STORE_DIR, { recursive: true });
  appProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      MVP0_STORE_PATH: STORE,
      MVP1_STORE_PATH: SESSION_STORE,
      AUTH_STORE_PATH: AUTH_STORE,
      DATA_DB_PATH: DATA_DB
    },
    stdio: "pipe"
  });
  await waitFor(`${BASE}/health`);
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "exp-tester@example.com", password: "test-secret-1" })
  });
  sessionCookie = (register.headers.get("set-cookie") || "").split(";")[0];
  expect(sessionCookie).toBeTruthy();
});

afterAll(async () => {
  const proc = appProcess;
  if (!proc) return;
  const exited = new Promise(resolve => proc.once("exit", resolve));
  proc.kill("SIGTERM");
  await exited;
  await rm(STORE_DIR, { recursive: true, force: true });
});

describe("experiment route auth", () => {
  it("rejects unauthenticated access to exp1/exp2/research", async () => {
    for (const pathname of ["/api/experiments/exp1/sheet", "/api/experiments/exp2/status", "/api/research/assets"]) {
      const response = await fetch(`${BASE}${pathname}`);  // no cookie on purpose
      expect(response.status, pathname).toBe(401);
    }
  });
});

describe("exp1 label flow", () => {
  it("stores a label and returns it in sheet + audit", async () => {
    const { response, data } = await api("/api/experiments/exp1/label", {
      method: "POST",
      body: JSON.stringify({ rowId: "candidate:test-session:0", label: "real_debt", note: "测试标注" })
    });
    expect(response.status).toBe(200);
    expect(data.labeled).toBe(1);

    const sheet = await api("/api/experiments/exp1/sheet");
    expect(sheet.data.labels["candidate:test-session:0"].label).toBe("real_debt");

    const audit = await api("/api/experiments/audit");
    type AuditEntry = { endpoint?: string };
    const entries: AuditEntry[] = Array.isArray(audit.data?.entries) ? audit.data.entries : [];
    expect(entries.some((entry: AuditEntry) => entry.endpoint === "/api/experiments/exp1/label")).toBe(true);
  });

  it("rejects invalid labels", async () => {
    const { response } = await api("/api/experiments/exp1/label", {
      method: "POST",
      body: JSON.stringify({ rowId: "x", label: "definitely_not_real" })
    });
    expect(response.status).toBe(400);
  });
});

describe("exp2 guards", () => {
  it("reports unsealed status with zero assignments", async () => {
    const { data } = await api("/api/experiments/exp2/status");
    expect(data.sealed).toBe(false);
    expect(data.assigned).toBe(0);
  });

  it("read-log rejects debts not in the experiment", async () => {
    const { response } = await api("/api/experiments/exp2/read-log", {
      method: "POST",
      body: JSON.stringify({ debtId: "unknown", seconds: 10 })
    });
    expect(response.status).toBe(404);
  });
});
