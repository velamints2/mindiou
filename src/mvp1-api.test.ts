// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8801;
const OPENAI_PORT = 8802;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/mvp1-api-test-store.json");
const SESSION_STORE = path.resolve("tmp/mvp1-api-test-sessions.json");
const AUTH_STORE = path.resolve("tmp/mvp1-api-test-auth.sqlite");
let appProcess;
let fakeOpenAi;
let sessionId = "";
let alice;
let bob;

const seededReport = {
  id: "mvp1-seeded-report",
  createdAt: "2026-07-14T00:00:00.000Z",
  input: { artifactText: "G2 request failed in a phone WebView.", artifactType: "codex", charCount: 42, preprocess: null },
  analysis: { userCapability: { currentDomain: "G2 WebView networking" } },
  sections: {
    aiCompleted: [],
    userContributed: [],
    dangerousGaps: [{ rank: 1, gap: "CORS versus reachability", whyDangerous: "A partial fix can pass desktop tests.", evidence: "The device still failed." }],
    cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
    feynmanCards: [{ id: "mvp1-card", target: "CORS versus reachability", prompt: "Explain why a reachable API may still fail in a WebView.", targetLevel: "L2", difficulty: "intermediate", userAnswer: "", aiFollowUp: "", answeredAt: null }],
    nextActions: []
  },
  corrections: [],
  status: "generated"
};

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

beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await rm(AUTH_STORE, { force: true });
  await rm(`${AUTH_STORE}-wal`, { force: true });
  await rm(`${AUTH_STORE}-shm`, { force: true });
  fakeOpenAi = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/v1/models") {
      json(res, 200, { object: "list", data: [{ id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" }] });
      return;
    }
    if (req.url === "/v1/responses") {
      json(res, 200, { output: [{ type: "message", content: [{ type: "output_text", text: "Reachability comes before CORS. CORS controls whether JavaScript can read a cross-origin response.", annotations: [{ type: "url_citation", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS", title: "Cross-Origin Resource Sharing" }] }] }] });
      return;
    }
    if (req.url === "/v1/chat/completions") {
      const payload = JSON.parse(body || "{}");
      const userInput = JSON.parse(payload.messages?.at(-1)?.content || "{}");
      if (userInput.researchText) {
        json(res, 200, { choices: [{ message: { content: JSON.stringify({
          rewrittenQuestion: "How do reachability and CORS fail at different stages?",
          summary: "They are separate boundaries.",
          scaffold: [{ id: "point-1", point: "Reachability comes before browser response access.", whyItMatters: "A response can arrive but remain unreadable.", sourceIds: ["source-1"] }]
        }) } }] });
        return;
      }
      const good = String(userInput.answer || "").includes("JavaScript");
      const analysis = good ? {
        status: "provisionally_cleared", coverage: 0.9, demonstrated: ["Separates transport from response access"], missing: [], misconceptions: [], evidence: ["The answer describes both stages"], materialSourceIds: ["source-1"], feedback: "Core boundary explained.", teaching: "", nextQuestion: "", recommendation: "end"
      } : {
        status: "needs_practice", coverage: 0.2, demonstrated: ["Mentions network"], missing: ["CORS boundary"], misconceptions: ["Merges all failures"], evidence: ["Only transport is mentioned"], materialSourceIds: ["source-1"], feedback: "Separate transport from browser access.", teaching: "The server may respond before CORS decides whether JavaScript can read it.", nextQuestion: "What does CORS control?", recommendation: "continue"
      };
      json(res, 200, { choices: [{ message: { content: JSON.stringify(analysis) } }] });
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(OPENAI_PORT, "127.0.0.1", resolve));
  await startServer();
  alice = await registerUser("alice@example.com");
  bob = await registerUser("bob@example.com");
  // Seed the report with Alice as owner, then restart so the store reloads it.
  await stopServer();
  seededReport.userId = alice.user.id;
  await writeFile(STORE, JSON.stringify({ version: 1, clearanceReports: [seededReport] }, null, 2));
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
      LEARNING_API_TOKEN: ""
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

describe("MVP-1 HTTP vertical slice", () => {
  it("reports the configured text provider independently from STT", async () => {
    const response = await fetch(`${BASE}/health?live=1`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({
      ai: true,
      provider: "deepseek",
      model: "deepseek-v4-flash",
      stt: false,
      providerStatus: { reachable: true, status: 200 }
    });
  });

  it("exposes a compact latest-report entry for Rokid glasses", async () => {
    // A device token identifies the owning user on the Rokid channel.
    const tokenResponse = await fetch(`${BASE}/api/auth/device-token`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ name: "rokid-test" })
    });
    expect(tokenResponse.status).toBe(201);
    const { deviceToken } = await tokenResponse.json();

    const response = await fetch(`${BASE}/api/rokid/clearance-entry`, {
      headers: { authorization: `Bearer ${deviceToken.token}` }
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.platform).toBe("rokid-aiui");
    expect(data._adminChannel).toBeUndefined();
    expect(data.entry).toMatchObject({
      reportId: seededReport.id,
      cardId: "mvp1-card",
      cardNumber: 1,
      cardCount: 1
    });
    expect(data.entry.prompt).toContain("reachable API");

    // Without a configured LEARNING_API_TOKEN the admin channel stays open
    // (local development) and is labelled as such.
    const legacy = await fetch(`${BASE}/api/rokid/clearance-entry`);
    expect(legacy.status).toBe(200);
    expect((await legacy.json())._adminChannel).toBe(true);
  });

  it("starts from a persisted card without exposing the hidden scaffold", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "mvp1-card" })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    sessionId = data.session.id;
    expect(data.session.clearanceQuestion).toContain("reachability");
    expect(data.session.sources[0].type).toBe("official_doc");
    expect(data.session.scaffold).toBeUndefined();
    expect(data.session.userId).toBe(alice.user.id);
  });

  it("analyzes an answer and reveals the scaffold", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions/${sessionId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: "The request may reach the server, but CORS can stop JavaScript from reading the response." })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.attempt.analysis.status).toBe("provisionally_cleared");
    expect(data.session.scaffold).toHaveLength(1);
  });

  it("ends only when the user calls the end endpoint", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions/${sessionId}/end`, {
      method: "POST",
      headers: { cookie: alice.cookie }
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result.status).toBe("provisionally_cleared");
    expect(data.result.sourceReviewRequired).toBe(false);
    expect(data.session.state).toBe("ended");
  });
});

describe("MVP-1 user ownership and persistence", () => {
  it("assigns a new session to the authenticated user", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "mvp1-card" })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.session.userId).toBe(alice.user.id);
  });

  it("hides a session from other users and rejects anonymous callers with 401", async () => {
    const createResponse = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "mvp1-card" })
    });
    const created = await createResponse.json();
    const ownedId = created.session.id;

    const asOwner = await fetch(`${BASE}/api/mvp1/sessions/${ownedId}`, { headers: { cookie: alice.cookie } });
    expect(asOwner.status).toBe(200);

    const asBob = await fetch(`${BASE}/api/mvp1/sessions/${ownedId}`, { headers: { cookie: bob.cookie } });
    expect(asBob.status).toBe(404);

    const asAnonymous = await fetch(`${BASE}/api/mvp1/sessions/${ownedId}`);
    expect(asAnonymous.status).toBe(401);

    const answerAsBob = await fetch(`${BASE}/api/mvp1/sessions/${ownedId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: JSON.stringify({ answer: "CORS can stop JavaScript from reading the response." })
    });
    expect(answerAsBob.status).toBe(404);
  });

  it("writes the cautious final state back to the MVP-0 card on end", async () => {
    const createResponse = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "mvp1-card" })
    });
    const created = await createResponse.json();
    const writeBackSessionId = created.session.id;

    const answerResponse = await fetch(`${BASE}/api/mvp1/sessions/${writeBackSessionId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: "The request may reach the server, but CORS can stop JavaScript from reading the response." })
    });
    expect(answerResponse.status).toBe(200);

    const endResponse = await fetch(`${BASE}/api/mvp1/sessions/${writeBackSessionId}/end`, {
      method: "POST",
      headers: { cookie: alice.cookie }
    });
    expect(endResponse.status).toBe(200);
    const ended = await endResponse.json();

    const reportResponse = await fetch(`${BASE}/api/mvp0/reports/${seededReport.id}`, { headers: { cookie: alice.cookie } });
    expect(reportResponse.status).toBe(200);
    const reportData = await reportResponse.json();
    const card = reportData.report.sections.feynmanCards.find(item => item.id === "mvp1-card");
    expect(card.clearance).toBeTruthy();
    expect(card.clearance.status).toBe(ended.result.status);
    expect(card.clearance.sessionId).toBe(writeBackSessionId);
    expect(card.clearance.endedAt).toBeTruthy();
  });

  it("recovers a session with its attempts after a server restart", async () => {
    const createResponse = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "mvp1-card" })
    });
    const created = await createResponse.json();
    const restartSessionId = created.session.id;

    const answerResponse = await fetch(`${BASE}/api/mvp1/sessions/${restartSessionId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: "The request may reach the server, but CORS can stop JavaScript from reading the response." })
    });
    expect(answerResponse.status).toBe(200);

    await stopServer();
    await startServer();

    const response = await fetch(`${BASE}/api/mvp1/sessions/${restartSessionId}`, { headers: { cookie: alice.cookie } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.session.userId).toBe(alice.user.id);
    expect(data.session.attempts).toHaveLength(1);
    expect(data.session.attempts[0].answer).toContain("JavaScript");

    const asAnonymous = await fetch(`${BASE}/api/mvp1/sessions/${restartSessionId}`);
    expect(asAnonymous.status).toBe(401);
  });
});
