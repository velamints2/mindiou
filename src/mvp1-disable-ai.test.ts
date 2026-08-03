// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Regression test for the 2026-08-03 demo-mode defect: with
// SPIRAL_DISABLE_AI=1 + MVP1_DEMO_FALLBACK=1 and a configured
// OPENAI_API_KEY, creating a clearance session used to fail with
// HTTP 502 "External research returned no cited sources" because the
// live research call succeeded while the structuring chat fell back to
// an empty scaffold, which filtered every cited source out. The
// research chain must instead degrade transparently to the curated
// demo materials without calling external AI at all.

const API_PORT = 8831;
const OPENAI_PORT = 8832;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/mvp1-disable-ai-test-store.json");
const SESSION_STORE = path.resolve("tmp/mvp1-disable-ai-test-sessions.json");
const AUTH_STORE = path.resolve("tmp/mvp1-disable-ai-test-auth.sqlite");
let appProcess;
let fakeOpenAi;
let externalAiCalls = 0;
let alice;

const seededReport = {
  id: "mvp1-disable-ai-report",
  createdAt: "2026-08-03T00:00:00.000Z",
  input: { artifactText: "AI restarted Nginx and declared the incident resolved.", artifactType: "codex", charCount: 56, preprocess: null },
  analysis: { userCapability: { currentDomain: "Linux 服务器故障排查" } },
  sections: {
    aiCompleted: ["定位高 I/O wait 并重启 Nginx"],
    userContributed: ["提供了故障时间线"],
    dangerousGaps: [{ rank: 1, gap: "区分根因修复与症状缓解", whyDangerous: "重启可能只清除了症状", evidence: "AI 直接宣布修复完成" }],
    cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
    feynmanCards: [{ id: "demo-card-root-cause", target: "区分根因修复与症状缓解", prompt: "如何区分症状暂时缓解和真正的根因修复？", targetLevel: "L2", difficulty: "intermediate", userAnswer: "", aiFollowUp: "", answeredAt: null }],
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

async function startServer() {
  appProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      MVP0_STORE_PATH: STORE,
      MVP1_STORE_PATH: SESSION_STORE,
      AUTH_STORE_PATH: AUTH_STORE,
      // Demo-mode production configuration: AI disabled, curated fallback
      // enabled, and a fully configured OpenAI key/base URL that must stay
      // unused while SPIRAL_DISABLE_AI=1.
      SPIRAL_DISABLE_AI: "1",
      MVP1_DEMO_FALLBACK: "1",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${OPENAI_PORT}/v1`,
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

beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await rm(AUTH_STORE, { force: true });
  await rm(`${AUTH_STORE}-wal`, { force: true });
  await rm(`${AUTH_STORE}-shm`, { force: true });
  // The fake provider answers like a healthy OpenAI endpoint so that any
  // regression re-triggers the original 502 instead of masking it behind
  // a network failure, and it counts every unexpected external call.
  fakeOpenAi = createServer(async (req, res) => {
    externalAiCalls += 1;
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/v1/responses") {
      json(res, 200, { output: [{ type: "message", content: [{ type: "output_text", text: "Live research text that must never be requested.", annotations: [{ type: "url_citation", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS", title: "Cross-Origin Resource Sharing" }] }] }] });
      return;
    }
    if (req.url === "/v1/chat/completions") {
      json(res, 200, { choices: [{ message: { content: JSON.stringify({ rewrittenQuestion: "live", summary: "live", scaffold: [{ id: "point-1", point: "live", whyItMatters: "live", sourceIds: ["source-1"] }] }) } }] });
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(OPENAI_PORT, "127.0.0.1", resolve));
  await startServer();
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "disable-ai@example.com", password: "test-secret-1" })
  });
  const data = await register.json();
  alice = { cookie: (register.headers.get("set-cookie") || "").split(";")[0], user: data.user };
  // Seed the report with Alice as owner, then restart so the store reloads it.
  await stopServer();
  seededReport.userId = alice.user.id;
  await writeFile(STORE, JSON.stringify({ version: 1, clearanceReports: [seededReport] }, null, 2));
  await startServer();
});

afterAll(async () => {
  appProcess?.kill("SIGTERM");
  await new Promise(resolve => fakeOpenAi?.close(resolve));
  await rm(STORE, { force: true });
  await rm(SESSION_STORE, { force: true });
  await rm(AUTH_STORE, { force: true });
  await rm(`${AUTH_STORE}-wal`, { force: true });
  await rm(`${AUTH_STORE}-shm`, { force: true });
});

describe("MVP-1 demo mode with SPIRAL_DISABLE_AI=1 and a configured API key", () => {
  it("creates a clearance session from curated demo research without calling external AI", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "demo-card-root-cause" })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.session.researchMode).toBe("curated_demo_fallback");
    expect(data.session.sources.length).toBeGreaterThanOrEqual(3);
    expect(data.session.clearanceQuestion).toBeTruthy();
    expect(data.session.scaffold).toBeUndefined();
    expect(data.session.userId).toBe(alice.user.id);
    expect(externalAiCalls).toBe(0);
  });

  it("analyzes demo answers locally and never marks them provisionally cleared", async () => {
    const created = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "demo-card-root-cause" })
    });
    const { session } = await created.json();

    const answerResponse = await fetch(`${BASE}/api/mvp1/sessions/${session.id}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: alice.cookie },
      body: JSON.stringify({ answer: "D-state 是不可中断的 I/O 阻塞，高 I/O wait 只是症状。重启 Nginx 不一定解决根因，需要日志、iostat 延迟、/proc 状态和重复负载来验证。" })
    });
    expect(answerResponse.status).toBe(200);
    const data = await answerResponse.json();
    expect(data.attempt.analysis.status).not.toBe("provisionally_cleared");
    expect(["needs_verification", "needs_practice"]).toContain(data.attempt.analysis.status);
    expect(externalAiCalls).toBe(0);
  });
});
