// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8805;
const OPENAI_PORT = 8806;
const ADMIN_TOKEN = "test-admin-token";
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/device-token-api-test-store.json");
const SESSION_STORE = path.resolve("tmp/device-token-api-test-sessions.json");
const AUTH_STORE = path.resolve("tmp/device-token-api-test-auth.sqlite");
let appProcess;
let fakeOpenAi;
let alice;
let bob;

function seededReport(id, createdAt, cardId, domain) {
  return {
    id,
    createdAt,
    userId: "",
    input: { artifactText: `${domain} artifact.`, artifactType: "codex", charCount: 20, preprocess: null },
    analysis: { userCapability: { currentDomain: domain } },
    sections: {
      aiCompleted: [],
      userContributed: [],
      dangerousGaps: [{ rank: 1, gap: `${domain} gap`, whyDangerous: "A partial fix can pass tests.", evidence: "It still failed." }],
      cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
      feynmanCards: [{ id: cardId, target: `${domain} target`, prompt: `Explain the ${domain} gap.`, targetLevel: "L2", difficulty: "intermediate", userAnswer: "", aiFollowUp: "", answeredAt: null }],
      nextActions: []
    },
    corrections: [],
    status: "generated"
  };
}

// Alice owns the older report, Bob owns the newest one, so the unfiltered
// (admin) view and the per-user views resolve to different reports.
const aliceReport = seededReport("device-test-report-alice", "2026-07-20T00:00:00.000Z", "device-card-alice", "Alice networking");
const bobReport = seededReport("device-test-report-bob", "2026-07-21T00:00:00.000Z", "device-card-bob", "Bob storage");

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function waitFor(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function registerUser(email, password = "test-secret-1") {
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  const cookie = (response.headers.get("set-cookie") || "").split(";")[0];
  return { data, cookie, user: data.user };
}

async function issueDeviceToken(cookie, name = "rokid") {
  const response = await fetch(`${BASE}/api/auth/device-token`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name })
  });
  return { response, data: await response.json() };
}

function rokidEntry(token, query = "") {
  return fetch(`${BASE}/api/rokid/clearance-entry${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });
}

beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await rm(AUTH_STORE, { force: true });
  await rm(`${AUTH_STORE}-wal`, { force: true });
  await rm(`${AUTH_STORE}-shm`, { force: true });
  fakeOpenAi = createServer(async (req, res) => {
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(OPENAI_PORT, "127.0.0.1", resolve));
  await startServer();
  alice = await registerUser("alice@example.com");
  bob = await registerUser("bob@example.com");
  // Seed one report per user, then restart so the store reloads them.
  await stopServer();
  aliceReport.userId = alice.user.id;
  bobReport.userId = bob.user.id;
  await writeFile(STORE, JSON.stringify({ version: 1, clearanceReports: [aliceReport, bobReport] }, null, 2));
  await startServer();
});

async function startServer() {
  appProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      MVP0_STORE_PATH: STORE,
      MVP1_STORE_PATH: SESSION_STORE,
      AUTH_STORE_PATH: AUTH_STORE,
      AI_PROVIDER: "deepseek",
      AI_API_KEY: "test-key",
      AI_BASE_URL: `http://127.0.0.1:${OPENAI_PORT}/v1`,
      AI_MODEL: "deepseek-v4-flash",
      RESEARCH_PROVIDER: "openai",
      RESEARCH_API_KEY: "test-key",
      RESEARCH_BASE_URL: `http://127.0.0.1:${OPENAI_PORT}/v1`,
      RESEARCH_MODEL: "gpt-5.5",
      STT_API_KEY: "",
      LEARNING_API_TOKEN: ADMIN_TOKEN
    },
    stdio: "pipe"
  });
  await waitFor(`${BASE}/health`);
}

async function stopServer() {
  if (!appProcess) return;
  const exited = new Promise(resolve => appProcess.once("exit", resolve));
  appProcess.kill("SIGTERM");
  await exited;
}

afterAll(async () => {
  appProcess?.kill("SIGTERM");
  await new Promise(resolve => fakeOpenAi?.close(resolve));
  await rm(STORE, { force: true });
  await rm(SESSION_STORE, { force: true });
  await rm(AUTH_STORE, { force: true });
  await rm(`${AUTH_STORE}-wal`, { force: true });
  await rm(`${AUTH_STORE}-shm`, { force: true });
});

describe("device token management", () => {
  it("issues a device token after login and lists it without the hash", async () => {
    const { response, data } = await issueDeviceToken(alice.cookie, "alice-rokid");
    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.deviceToken.token).toMatch(/^[0-9a-f]{64}$/);
    expect(data.deviceToken.name).toBe("alice-rokid");
    expect(data.deviceToken.id).toBeTruthy();
    expect(data.deviceToken.createdAt).toBeTruthy();

    const list = await fetch(`${BASE}/api/auth/device-tokens`, { headers: { cookie: alice.cookie } });
    expect(list.status).toBe(200);
    const listData = await list.json();
    const entry = listData.deviceTokens.find(item => item.id === data.deviceToken.id);
    expect(entry).toBeTruthy();
    expect(entry.name).toBe("alice-rokid");
    expect(entry.token).toBeUndefined();
    expect(entry.tokenHash).toBeUndefined();
    expect(entry.token_hash).toBeUndefined();
  });

  it("rejects device token management without a session", async () => {
    const create = await fetch(`${BASE}/api/auth/device-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "anon" })
    });
    expect(create.status).toBe(401);

    const list = await fetch(`${BASE}/api/auth/device-tokens`);
    expect(list.status).toBe(401);

    const remove = await fetch(`${BASE}/api/auth/device-token/some-id`, { method: "DELETE" });
    expect(remove.status).toBe(401);
  });

  it("revokes a device token and rejects it on the device channel afterwards", async () => {
    const { data } = await issueDeviceToken(alice.cookie, "alice-revoked");
    const tokenId = data.deviceToken.id;

    const before = await rokidEntry(data.deviceToken.token);
    expect(before.status).toBe(200);

    const revoke = await fetch(`${BASE}/api/auth/device-token/${tokenId}`, {
      method: "DELETE",
      headers: { cookie: alice.cookie }
    });
    expect(revoke.status).toBe(200);

    const after = await rokidEntry(data.deviceToken.token);
    expect(after.status).toBe(401);
  });

  it("prevents a user from revoking another user's device token", async () => {
    const { data } = await issueDeviceToken(alice.cookie, "alice-protected");
    const revoke = await fetch(`${BASE}/api/auth/device-token/${data.deviceToken.id}`, {
      method: "DELETE",
      headers: { cookie: bob.cookie }
    });
    expect(revoke.status).toBe(404);

    const stillValid = await rokidEntry(data.deviceToken.token);
    expect(stillValid.status).toBe(200);
  });
});

describe("Rokid clearance-entry user isolation", () => {
  it("serves only the token owner's latest report", async () => {
    const { data: aliceToken } = await issueDeviceToken(alice.cookie, "alice-glasses");
    const response = await rokidEntry(aliceToken.deviceToken.token);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.platform).toBe("rokid-aiui");
    expect(data._adminChannel).toBeUndefined();
    expect(data.entry).toMatchObject({
      reportId: aliceReport.id,
      cardId: "device-card-alice",
      cardNumber: 1,
      cardCount: 1
    });
  });

  it("serves Bob's report to Bob's device token", async () => {
    const { data: bobToken } = await issueDeviceToken(bob.cookie, "bob-glasses");
    const response = await rokidEntry(bobToken.deviceToken.token);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.entry.reportId).toBe(bobReport.id);
    expect(data.entry.cardId).toBe("device-card-bob");
  });

  it("treats another user's report as not found for the device channel", async () => {
    const { data: aliceToken } = await issueDeviceToken(alice.cookie, "alice-scoped");
    const response = await rokidEntry(aliceToken.deviceToken.token, `?reportId=${bobReport.id}`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.entry).toBeNull();
  });

  it("rejects an invalid device token with 401", async () => {
    const response = await rokidEntry("f".repeat(64));
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.ok).toBe(false);
  });

  it("rejects a missing token with 401 when the admin token is configured", async () => {
    const response = await rokidEntry("");
    expect(response.status).toBe(401);
  });

  it("keeps LEARNING_API_TOKEN as a labelled admin channel", async () => {
    const response = await rokidEntry(ADMIN_TOKEN);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data._adminChannel).toBe(true);
    // The admin channel is unfiltered: the newest report overall is Bob's.
    expect(data.entry.reportId).toBe(bobReport.id);

    const scoped = await rokidEntry(ADMIN_TOKEN, `?reportId=${aliceReport.id}`);
    const scopedData = await scoped.json();
    expect(scopedData._adminChannel).toBe(true);
    expect(scopedData.entry.reportId).toBe(aliceReport.id);
  });
});

describe("G2 session device channel", () => {
  it("accepts a valid device token and rejects an invalid one", async () => {
    const { data: aliceToken } = await issueDeviceToken(alice.cookie, "alice-g2");
    const ok = await fetch(`${BASE}/api/g2/session?duration=15`, {
      headers: { authorization: `Bearer ${aliceToken.deviceToken.token}` }
    });
    expect(ok.status).toBe(200);
    const okData = await ok.json();
    expect(okData.ok).toBe(true);
    expect(okData._adminChannel).toBeUndefined();

    const invalid = await fetch(`${BASE}/api/g2/session?duration=15`, {
      headers: { authorization: `Bearer ${"e".repeat(64)}` }
    });
    expect(invalid.status).toBe(401);

    const admin = await fetch(`${BASE}/api/g2/session?duration=15`, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    expect(admin.status).toBe(200);
    expect((await admin.json())._adminChannel).toBe(true);
  });
});
