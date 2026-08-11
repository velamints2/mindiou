// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const TEST_DIR = path.join(os.tmpdir(), `mindiou-hook-token-${Date.now()}`);
const DATA_DB = path.join(TEST_DIR, "data.sqlite");
const AUTH_DB = path.join(TEST_DIR, "auth.sqlite");
const LEARNING_JSON = path.join(TEST_DIR, "learning.json");
const SESSION_SECRET = "mindiou-hook-token-test-secret-32-chars!";
let baseUrl;
let appProcess;
let alice;
let bob;
let project;

async function freePort() {
  const probe = createServer();
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

function cookieOf(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

async function register(email) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "test-secret-1" })
  });
  return { response, data: await response.json(), cookie: cookieOf(response) };
}

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  appProcess = spawn(process.execPath, ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DB_PATH: DATA_DB,
      AUTH_STORE_PATH: AUTH_DB,
      LEARNING_STORE_PATH: LEARNING_JSON,
      MINDIOU_SESSION_SECRET: SESSION_SECRET,
      AI_PROVIDER: "deepseek",
      AI_API_KEY: "test-key",
      AI_BASE_URL: "http://127.0.0.1:18999/v1",
      STT_API_KEY: "",
      LEARNING_API_TOKEN: ""
    },
    stdio: "ignore"
  });
  await waitFor(`${baseUrl}/health`);
  alice = await register("hook-alice@example.com");
  bob = await register("hook-bob@example.com");

  const projectResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: alice.cookie },
    body: JSON.stringify({ name: "Hook Token 测试项目", projectType: "software" })
  });
  project = (await projectResponse.json()).project;
});

afterAll(async () => {
  appProcess?.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 400));
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("project Hook Token management", () => {
  it("requires a web session to create or list project tokens", async () => {
    const create = await fetch(`${baseUrl}/api/projects/${project.id}/hook-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "anonymous" })
    });
    const list = await fetch(`${baseUrl}/api/projects/${project.id}/hook-token`);
    expect(create.status).toBe(401);
    expect(list.status).toBe(401);
  });

  it("creates a project-bound token, hides it from lists, and revokes it", async () => {
    const create = await fetch(`${baseUrl}/api/projects/${project.id}/hook-token`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ name: "评委演示" })
    });
    const created = await create.json();
    expect(create.status).toBe(201);
    expect(created.hook.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.hook.projectId).toBe(project.id);

    const list = await fetch(`${baseUrl}/api/projects/${project.id}/hook-token`, { headers: { cookie: alice.cookie } });
    const listed = await list.json();
    expect(list.status).toBe(200);
    expect(listed.tokens).toHaveLength(1);
    expect(listed.tokens[0].token).toBeUndefined();
    expect(listed.tokens[0].tokenHash).toBeUndefined();

    const context = await fetch(`${baseUrl}/api/projects/${project.id}/agent-context`, {
      headers: { authorization: `Bearer ${created.hook.token}` }
    });
    expect(context.status).toBe(200);

    const revoke = await fetch(`${baseUrl}/api/projects/${project.id}/hook-token/${created.hook.id}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie }
    });
    expect(revoke.status).toBe(200);

    const afterRevoke = await fetch(`${baseUrl}/api/projects/${project.id}/agent-context`, {
      headers: { authorization: `Bearer ${created.hook.token}` }
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("does not let another account manage the project's tokens", async () => {
    const list = await fetch(`${baseUrl}/api/projects/${project.id}/hook-token`, { headers: { cookie: bob.cookie } });
    const create = await fetch(`${baseUrl}/api/projects/${project.id}/hook-token`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: JSON.stringify({ name: "cross-user" })
    });
    expect(list.status).toBe(404);
    expect(create.status).toBe(404);
  });
});
