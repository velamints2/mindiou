// @ts-nocheck
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

const TEST_PORT = 8814;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
const TEST_DIR = path.resolve("tmp/ops-health-test");
let serverProcess: ReturnType<typeof spawn> | null = null;

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
      LEARNING_API_TOKEN: ""
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
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("layered health checks", () => {
  it("GET /healthz returns liveness without dependency data", async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("alive");
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(body.providerStatus).toBeUndefined();
  });

  it("GET /readyz returns readiness with per-dependency breakdown", async () => {
    const res = await fetch(`${BASE}/readyz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ready");
    expect(body.checks.authStore.ok).toBe(true);
    expect(body.checks.config.ai).toBe(false);
    expect(body.checks.config.research).toBe(false);
    expect(body.checks.config.stt).toBe(false);
  });

  it("legacy GET /health keeps its original shape", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.ai).toBe(false);
    expect(body.provider).toBe("openai");
    expect(typeof body.model).toBe("string");
    expect(typeof body.sttModel).toBe("string");
  });

  it("health endpoints never expose secrets", async () => {
    for (const route of ["/healthz", "/readyz", "/health"]) {
      const body = await (await fetch(`${BASE}${route}`)).text();
      expect(body).not.toMatch(/api[_-]?key|token|secret|authorization/i);
    }
  });
});
