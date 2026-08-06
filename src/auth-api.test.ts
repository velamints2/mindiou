// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8803;
const OPENAI_PORT = 8804;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/auth-api-test-mvp0.json");
const SESSION_STORE = path.resolve("tmp/auth-api-test-mvp1.json");
const AUTH_STORE = path.resolve("tmp/auth-api-test-auth.sqlite");
let appProcess;
let fakeOpenAi;

const SAMPLE_ARTIFACT = `
I'm building a React app with Vite. The AI suggested using TypeScript for type safety.
I agreed because I don't know TypeScript well. The AI set up the entire project structure.
It chose useState for state management and useEffect for data fetching.
I wanted to use Firebase, but the AI said Supabase was better for this use case.
The AI wrote all the database queries and API routes. I'm not sure how the auth flow works.
`;

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

function extractCookie(response) {
  const header = response.headers.get("set-cookie") || "";
  return header.split(";")[0];
}

async function registerUser(email, password = "test-secret-1") {
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  return { response, data, cookie: extractCookie(response) };
}

async function removeStores() {
  await rm(STORE, { force: true });
  await rm(SESSION_STORE, { force: true });
  await rm(AUTH_STORE, { force: true });
  await rm(`${AUTH_STORE}-wal`, { force: true });
  await rm(`${AUTH_STORE}-shm`, { force: true });
}

beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await removeStores();
  fakeOpenAi = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/v1/responses") {
      json(res, 200, { output: [{ type: "message", content: [{ type: "output_text", text: "Auth flow has a client boundary and a server boundary.", annotations: [{ type: "url_citation", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies", title: "Using HTTP cookies" }] }] }] });
      return;
    }
    if (req.url === "/v1/chat/completions") {
      const payload = JSON.parse(body || "{}");
      let userInput = {};
      try {
        userInput = JSON.parse(payload.messages?.at(-1)?.content || "{}");
      } catch {
        userInput = {};
      }
      if (userInput.researchText) {
        json(res, 200, { choices: [{ message: { content: JSON.stringify({
          rewrittenQuestion: "How does a session cookie prove identity?",
          summary: "The server maps the session id to a user.",
          scaffold: [{ id: "point-1", point: "Cookies are sent automatically by the browser.", whyItMatters: "The server must still validate them.", sourceIds: ["source-1"] }]
        }) } }] });
        return;
      }
      if (userInput.answer !== undefined) {
        json(res, 200, { choices: [{ message: { content: JSON.stringify({
          status: "needs_practice", coverage: 0.2, demonstrated: ["Mentions sessions"], missing: ["Server-side lookup"], misconceptions: [], evidence: ["Partial answer"], materialSourceIds: ["source-1"], feedback: "Cover the server lookup.", teaching: "The session id is a key into server state.", nextQuestion: "Where is the user id stored?", recommendation: "continue"
        }) } }] });
        return;
      }
      // MVP-0 report generation and anything else: fail so the server falls back.
      json(res, 500, { error: { message: "fake provider failure" } });
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(OPENAI_PORT, "127.0.0.1", resolve));
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
});

afterAll(async () => {
  appProcess?.kill("SIGTERM");
  await new Promise(resolve => fakeOpenAi?.close(resolve));
  await removeStores();
});

describe("auth API", () => {
  it("rejects unsupported imports and text over 30,000 characters with clear errors", async () => {
    const { cookie } = await registerUser("input-limits@example.com");
    const unsupported = await fetch(`${BASE}/api/mvp0/timelines`, {
      method: "POST",
      headers: { cookie, "content-type": "text/plain", "x-mindiou-locale": "zh-CN" },
      body: "plain file-like payload"
    });
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toMatchObject({ code: "UNSUPPORTED_INPUT_FORMAT" });

    const oversized = await fetch(`${BASE}/api/mvp0/timelines`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-mindiou-locale": "en" },
      body: JSON.stringify({ artifactText: "x".repeat(30_001), locale: "en" })
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: "ARTIFACT_TEXT_TOO_LONG" });
  });

  it("allows three new analyses per day and rejects the fourth", async () => {
    const { cookie } = await registerUser("daily-limit@example.com");
    for (let index = 1; index <= 3; index += 1) {
      const response = await fetch(`${BASE}/api/mvp0/timelines`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json", "x-mindiou-locale": "en" },
        body: JSON.stringify({ artifactText: `${SAMPLE_ARTIFACT}\nAttempt ${index}`, locale: "en" })
      });
      expect(response.status).toBe(200);
      expect((await response.json()).usage.analysisCount).toBe(index);
    }
    const rejected = await fetch(`${BASE}/api/mvp0/timelines`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-mindiou-locale": "en" },
      body: JSON.stringify({ artifactText: `${SAMPLE_ARTIFACT}\nAttempt 4`, locale: "en" })
    });
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toMatchObject({ code: "DAILY_ANALYSIS_LIMIT" });
  });

  it("registers a user and sets a session cookie", async () => {
    const { response, data, cookie } = await registerUser("Alice@Example.com");
    expect(response.status).toBe(201);
    expect(data.ok).toBe(true);
    expect(data.user.email).toBe("alice@example.com");
    expect(data.user.id).toBeTruthy();
    expect(cookie).toMatch(/^session=[0-9a-f-]{36}$/);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("Max-Age=604800");
  });

  it("rejects a duplicate registration with 409", async () => {
    await registerUser("dup@example.com");
    const { response, data } = await registerUser("dup@example.com");
    expect(response.status).toBe(409);
    expect(data.error).toContain("Email already registered");
  });

  it("rejects registration without email or password", async () => {
    const response = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "", password: "" })
    });
    expect(response.status).toBe(400);
  });

  it("logs in with correct credentials and sets a session cookie", async () => {
    await registerUser("login@example.com", "test-secret-1");
    const response = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "login@example.com", password: "test-secret-1" })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.user.email).toBe("login@example.com");
    expect(extractCookie(response)).toMatch(/^session=/);
  });

  it("rejects a wrong password and an unknown email with the same 401", async () => {
    await registerUser("uniform@example.com", "test-secret-1");
    const wrongPassword = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "uniform@example.com", password: "wrong" })
    });
    expect(wrongPassword.status).toBe(401);
    expect((await wrongPassword.json()).error).toBe("Invalid email or password");

    const unknownEmail = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "wrong" })
    });
    expect(unknownEmail.status).toBe(401);
    expect((await unknownEmail.json()).error).toBe("Invalid email or password");
  });

  it("returns the current user from GET /api/auth/me with a cookie", async () => {
    const { data, cookie } = await registerUser("me@example.com");
    const response = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect((await response.json()).user).toEqual(data.user);
  });

  it("returns 401 from GET /api/auth/me without a cookie", async () => {
    const response = await fetch(`${BASE}/api/auth/me`);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Authentication required");
  });

  it("separates cohort capacity and estimates from real genesis participation", async () => {
    const response = await fetch(`${BASE}/api/genesis`);
    expect(response.status).toBe(200);
    const { genesis } = await response.json();
    expect(genesis.capacity).toBe(300);
    expect(genesis.estimates).toEqual({ completed: 87 });
    expect(genesis.actual.registered).toBeGreaterThanOrEqual(1);
    expect(genesis.actual.joined).toBe(0);
    expect(genesis.actual.completedFirstClearance).toBe(0);
    expect(genesis.actual.adoptedSuggestions).toBe(7);
    expect(genesis.members).toEqual([]);
  });

  it("keeps the reserved identity private and immutable before activation", async () => {
    const { data, cookie } = await registerUser("reserved@example.com");
    expect(data.user.genesisIdentity).toMatchObject({ activatedAt: null, visibility: "private" });
    const update = await fetch(`${BASE}/api/genesis/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ visibility: "public", displayName: "Too early" })
    });
    expect(update.status).toBe(400);
  });

  it("invalidates the session on logout", async () => {
    const { cookie } = await registerUser("logout@example.com");
    const logout = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(200);
    const me = await fetch(`${BASE}/api/auth/me`, { headers: { cookie } });
    expect(me.status).toBe(401);
  });

  it("issues, lists and revokes a device token for the authenticated user", async () => {
    const { cookie } = await registerUser("device@example.com");

    const created = await fetch(`${BASE}/api/auth/device-token`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "rokid" })
    });
    expect(created.status).toBe(201);
    const { deviceToken } = await created.json();
    expect(deviceToken.token).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceToken.name).toBe("rokid");

    const list = await fetch(`${BASE}/api/auth/device-tokens`, { headers: { cookie } });
    expect(list.status).toBe(200);
    const { deviceTokens } = await list.json();
    expect(deviceTokens).toHaveLength(1);
    expect(deviceTokens[0].id).toBe(deviceToken.id);
    expect(deviceTokens[0].token).toBeUndefined();
    expect(deviceTokens[0].revokedAt).toBeNull();

    const revoked = await fetch(`${BASE}/api/auth/device-token/${deviceToken.id}`, {
      method: "DELETE",
      headers: { cookie }
    });
    expect(revoked.status).toBe(200);
    const afterRevoke = await fetch(`${BASE}/api/auth/device-tokens`, { headers: { cookie } });
    expect((await afterRevoke.json()).deviceTokens[0].revokedAt).toBeTruthy();

    const anonymous = await fetch(`${BASE}/api/auth/device-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "anon" })
    });
    expect(anonymous.status).toBe(401);
  });
});

describe("MVP-0/MVP-1 route protection and isolation", () => {
  it("rejects unauthenticated requests to protected endpoints with 401", async () => {
    const createReport = await fetch(`${BASE}/api/mvp0/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artifactText: SAMPLE_ARTIFACT, artifactType: "chatgpt" })
    });
    expect(createReport.status).toBe(401);

    const listReports = await fetch(`${BASE}/api/mvp0/reports`);
    expect(listReports.status).toBe(401);

    const dashboard = await fetch(`${BASE}/api/dashboard`);
    expect(dashboard.status).toBe(401);

    const getReport = await fetch(`${BASE}/api/mvp0/reports/some-id`);
    expect(getReport.status).toBe(401);

    const createSession = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId: "r", cardId: "c" })
    });
    expect(createSession.status).toBe(401);

    const getSession = await fetch(`${BASE}/api/mvp1/sessions/some-id`);
    expect(getSession.status).toBe(401);

    const answer = await fetch(`${BASE}/api/mvp1/sessions/some-id/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "x" })
    });
    expect(answer.status).toBe(401);

    const end = await fetch(`${BASE}/api/mvp1/sessions/some-id/end`, { method: "POST" });
    expect(end.status).toBe(401);
  });

  it("scopes reports to their owner and hides them from other users", async () => {
    const alice = await registerUser("owner-a@example.com");
    const bob = await registerUser("owner-b@example.com");

    const createResponse = await fetch(`${BASE}/api/mvp0/report`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ artifactText: SAMPLE_ARTIFACT, artifactType: "chatgpt" })
    });
    expect(createResponse.status).toBe(200);
    const created = await createResponse.json();
    expect(created.report.userId).toBe(alice.data.user.id);
    const reportId = created.report.id;
    const cardId = created.report.sections.feynmanCards[0].id;

    const aliceList = await fetch(`${BASE}/api/mvp0/reports`, { headers: { cookie: alice.cookie } });
    const aliceReports = (await aliceList.json()).reports;
    expect(aliceReports.map(item => item.id)).toContain(reportId);

    const bobList = await fetch(`${BASE}/api/mvp0/reports`, { headers: { cookie: bob.cookie } });
    const bobReports = (await bobList.json()).reports;
    expect(bobReports.map(item => item.id)).not.toContain(reportId);

    const aliceDashboardResponse = await fetch(`${BASE}/api/dashboard`, { headers: { cookie: alice.cookie } });
    expect(aliceDashboardResponse.status).toBe(200);
    const aliceDashboard = (await aliceDashboardResponse.json()).dashboard;
    expect(aliceDashboard.reportCount).toBeGreaterThanOrEqual(1);
    expect(aliceDashboard.latestReport.id).toBe(reportId);
    expect(aliceDashboard.outstandingDebts.some(item => item.reportId === reportId && item.cardId === cardId)).toBe(true);

    const bobDashboardResponse = await fetch(`${BASE}/api/dashboard`, { headers: { cookie: bob.cookie } });
    expect(bobDashboardResponse.status).toBe(200);
    const bobDashboard = (await bobDashboardResponse.json()).dashboard;
    expect(bobDashboard.reportCount).toBe(0);
    expect(bobDashboard.outstandingDebts).toEqual([]);

    const aliceGet = await fetch(`${BASE}/api/mvp0/reports/${reportId}`, { headers: { cookie: alice.cookie } });
    expect(aliceGet.status).toBe(200);

    const bobGet = await fetch(`${BASE}/api/mvp0/reports/${reportId}`, { headers: { cookie: bob.cookie } });
    expect(bobGet.status).toBe(404);

    const bobAnswer = await fetch(`${BASE}/api/mvp0/reports/${reportId}/cards/${cardId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: JSON.stringify({ answer: "Bob should not be able to answer." })
    });
    expect(bobAnswer.status).toBe(404);

    const bobCorrection = await fetch(`${BASE}/api/mvp0/reports/${reportId}/corrections`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: JSON.stringify({ target: "gap", correctedValue: "x" })
    });
    expect(bobCorrection.status).toBe(404);
  });

  it("scopes MVP-1 sessions to their owner and hides them from other users", async () => {
    const alice = await registerUser("session-a@example.com");
    const bob = await registerUser("session-b@example.com");

    const createReport = await fetch(`${BASE}/api/mvp0/report`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ artifactText: SAMPLE_ARTIFACT, artifactType: "chatgpt" })
    });
    const report = (await createReport.json()).report;

    const createSession = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: report.id, cardId: report.sections.feynmanCards[0].id })
    });
    expect(createSession.status).toBe(200);
    const session = (await createSession.json()).session;
    expect(session.userId).toBe(alice.data.user.id);

    const dashboardResponse = await fetch(`${BASE}/api/dashboard`, { headers: { cookie: alice.cookie } });
    expect(dashboardResponse.status).toBe(200);
    const dashboard = (await dashboardResponse.json()).dashboard;
    expect(dashboard.latestSession.id).toBe(session.id);
    expect(dashboard.latestSession.reportDisplay.title).toBe(report.display.title);
    expect(dashboard.latestSession.cardTitle).toBeTruthy();
    expect(dashboard.latestSession.lastActivityAt).toBeTruthy();

    const bobCreate = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: JSON.stringify({ reportId: report.id, cardId: report.sections.feynmanCards[0].id })
    });
    expect(bobCreate.status).toBe(404);

    const aliceGet = await fetch(`${BASE}/api/mvp1/sessions/${session.id}`, { headers: { cookie: alice.cookie } });
    expect(aliceGet.status).toBe(200);

    const bobGet = await fetch(`${BASE}/api/mvp1/sessions/${session.id}`, { headers: { cookie: bob.cookie } });
    expect(bobGet.status).toBe(404);

    const bobAnswer = await fetch(`${BASE}/api/mvp1/sessions/${session.id}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bob.cookie },
      body: JSON.stringify({ answer: "cross-user answer" })
    });
    expect(bobAnswer.status).toBe(404);

    const bobEnd = await fetch(`${BASE}/api/mvp1/sessions/${session.id}/end`, {
      method: "POST",
      headers: { cookie: bob.cookie }
    });
    expect(bobEnd.status).toBe(404);

    const aliceAnswer = await fetch(`${BASE}/api/mvp1/sessions/${session.id}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: "The session id is looked up by the server to recover the user id." })
    });
    expect(aliceAnswer.status).toBe(200);
    const aliceEnd = await fetch(`${BASE}/api/mvp1/sessions/${session.id}/end`, {
      method: "POST",
      headers: { cookie: alice.cookie }
    });
    expect(aliceEnd.status).toBe(200);
    const ended = await aliceEnd.json();
    expect(ended.genesisIdentity).toMatchObject({
      number: alice.data.user.genesisIdentity.number,
      visibility: "private"
    });
    expect(ended.genesisIdentity.activatedAt).toBeNull();

    const publish = await fetch(`${BASE}/api/genesis/identity`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ visibility: "anonymous" })
    });
    expect(publish.status).toBe(400);
    const archive = (await (await fetch(`${BASE}/api/genesis`)).json()).genesis;
    expect(archive.actual.joined).toBeGreaterThanOrEqual(1);
    expect(archive.actual.completedFirstClearance).toBeGreaterThanOrEqual(1);
    expect(archive.members).not.toContainEqual(expect.objectContaining({ number: alice.data.user.genesisIdentity.number }));
  });
});
