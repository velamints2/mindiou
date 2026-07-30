// @ts-nocheck
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

const TEST_PORT = 8812;
const STT_MOCK_PORT = 8813;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const TEST_DIR = path.resolve("tmp/ops-api-test");
let serverProcess: ReturnType<typeof spawn> | null = null;
let sttMock: ReturnType<typeof createServer> | null = null;

async function waitForServer(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server at ${url} did not start`);
}

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  // STT mock：故意永不响应，验证 STT_TIMEOUT_MS 生效。
  sttMock = createServer(() => {
    // never respond
  });
  await new Promise<void>(resolve => sttMock.listen(STT_MOCK_PORT, "127.0.0.1", resolve));
  serverProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      MVP0_STORE_PATH: path.join(TEST_DIR, "mvp0.json"),
      MVP1_STORE_PATH: path.join(TEST_DIR, "mvp1.json"),
      LEARNING_STORE_PATH: path.join(TEST_DIR, "spiral.json"),
      TRAINING_STORE_PATH: path.join(TEST_DIR, "training.json"),
      AUTH_STORE_PATH: path.join(TEST_DIR, "auth.sqlite"),
      SPIRAL_DISABLE_AI: "1",
      LEARNING_API_TOKEN: "",
      STT_API_KEY: "ops-test-key",
      STT_BASE_URL: `http://127.0.0.1:${STT_MOCK_PORT}/v1`,
      STT_TIMEOUT_MS: "300"
    },
    stdio: "pipe"
  });
  await waitForServer(`${BASE}/health`);
});

afterAll(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 200));
    if (!serverProcess.killed) serverProcess.kill("SIGKILL");
  }
  if (sttMock) await new Promise(resolve => sttMock.close(resolve));
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("request id", () => {
  it("generates an x-request-id header when absent", async () => {
    const res = await fetch(`${BASE}/healthz`);
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  });

  it("echoes a valid incoming x-request-id", async () => {
    const res = await fetch(`${BASE}/healthz`, { headers: { "x-request-id": "ops-test-123" } });
    expect(res.headers.get("x-request-id")).toBe("ops-test-123");
  });

  it("replaces a malformed incoming x-request-id", async () => {
    const res = await fetch(`${BASE}/healthz`, { headers: { "x-request-id": "bad id with spaces" } });
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    expect(id).not.toBe("bad id with spaces");
  });

  it("includes requestId in error payloads", async () => {
    // 注意：对未知路径发 GET 会命中既有的 405 分支；用 POST 才能到达 404 兜底。
    const res = await fetch(`${BASE}/no-such-route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(res.status).toBe(404);
    const id = res.headers.get("x-request-id");
    expect(id).toBeTruthy();
    const body = await res.json();
    expect(body.requestId).toBe(id);
  });
});

describe("error status semantics", () => {
  it("returns 400 instead of 500 for malformed JSON bodies", async () => {
    const res = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json"
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("valid JSON");
    expect(body.requestId).toBeTruthy();
  });

  it("returns 413 instead of dropping the connection for oversized bodies", async () => {
    const bigText = "x".repeat(9 * 1024 * 1024);
    const res = await fetch(`${BASE}/api/learn/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: bigText })
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ok).toBe(false);
  }, 20000);
});

describe("STT timeout", () => {
  it("fails fast with a timeout error instead of hanging", async () => {
    const started = Date.now();
    const res = await fetch(`${BASE}/api/learn/transcribe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: Buffer.from("hello").toString("base64"), sampleRate: 16000 })
    });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("timed out");
    expect(elapsed).toBeLessThan(5000);
  }, 10000);
});

describe("admin endpoints", () => {
  it("returns aggregated stats from /api/admin/stats", async () => {
    const res = await fetch(`${BASE}/api/admin/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.stats).toBeTruthy();
    expect(body.stats.funnel).toBeTruthy();
    expect(body.stats.reportQuality).toBeTruthy();
    expect(body.stats.generatedAt).toBeTruthy();
  });

  it("returns event list from /api/admin/events", async () => {
    const res = await fetch(`${BASE}/api/admin/events?limit=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
  });

  it("returns 404 for unknown admin sub-paths", async () => {
    const res = await fetch(`${BASE}/api/admin/no-such-thing`);
    expect(res.status).toBe(404);
  });
});
