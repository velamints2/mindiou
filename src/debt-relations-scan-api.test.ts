// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8815;
const OPENAI_PORT = 8816;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/relations-scan-api-test-mvp0.json");
const SESSION_STORE = path.resolve("tmp/relations-scan-api-test-mvp1.json");
const AUTH_STORE = path.resolve("tmp/relations-scan-api-test-auth.sqlite");
const TRAINING_STORE = path.resolve("tmp/relations-scan-api-test-training.json");
const INTEL_STORE = path.resolve("tmp/relations-scan-api-test-intelligence.json");
const GRAPH_STORE = path.resolve("tmp/relations-scan-api-test-graph.json");
const USER_EMAIL = "scan-user@example.com";
const USER_PASSWORD = "test-secret-1";

let appProcess;
let fakeOpenAi;
let userId;
let cookie;

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

function startServer() {
  appProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      MVP0_STORE_PATH: STORE,
      MVP1_STORE_PATH: SESSION_STORE,
      AUTH_STORE_PATH: AUTH_STORE,
      TRAINING_STORE_PATH: TRAINING_STORE,
      DEBT_INTELLIGENCE_STORE_PATH: INTEL_STORE,
      CONCEPT_GRAPH_STORE_PATH: GRAPH_STORE,
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
  return waitFor(`${BASE}/health`);
}

async function stopServer() {
  if (!appProcess) return;
  const exited = new Promise(resolve => appProcess.once("exit", resolve));
  appProcess.kill("SIGTERM");
  await exited;
  appProcess = null;
}

async function removeStores() {
  for (const file of [STORE, SESSION_STORE, TRAINING_STORE, INTEL_STORE, GRAPH_STORE, AUTH_STORE, `${AUTH_STORE}-wal`, `${AUTH_STORE}-shm`]) {
    await rm(file, { force: true });
  }
}

function makeSeedDebt(id, createdAt) {
  return {
    id,
    userId,
    reportId: "report-seed-scan",
    gapText: "不理解 CORS 预检请求为什么失败",
    gapEvidence: "用户直接复制了 AI 给出的配置",
    status: "new",
    recurrenceCount: 0,
    sourceReports: ["report-seed-scan"],
    createdAt,
    updatedAt: createdAt
  };
}

beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await removeStores();
  fakeOpenAi = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/v1/chat/completions") {
      const payload = JSON.parse(body || "{}");
      let userInput = {};
      try {
        userInput = JSON.parse(payload.messages?.at(-1)?.content || "{}");
      } catch {
        userInput = {};
      }
      if (userInput.sourceDebt) {
        json(res, 200, { choices: [{ message: { content: JSON.stringify({
          relationType: "same_project",
          isRelated: true,
          confidence: 0.9,
          reason: "两条欠条来自同一项目，都是直接采纳 AI 配置导致的理解缺口"
        }) } }] });
        return;
      }
      json(res, 500, { error: { message: "fake provider failure" } });
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(OPENAI_PORT, "127.0.0.1", resolve));

  // 阶段1：启动并注册用户，拿到 userId 后停机，以便按用户落种子欠条
  await startServer();
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
  });
  const registered = await register.json();
  userId = registered.user.id;
  await stopServer();

  // 落种子：同一项目（reportId 相同）的两条欠条 → 规则召回命中 1 个候选对
  await writeFile(TRAINING_STORE, JSON.stringify({
    version: 1,
    trainingAttempts: [],
    masteryProfiles: [],
    reviewTasks: [],
    cognitiveDebts: [
      makeSeedDebt("debt-scan-a", "2026-08-01T09:00:00.000Z"),
      makeSeedDebt("debt-scan-b", "2026-08-03T09:00:00.000Z")
    ],
    capabilities: []
  }, null, 2));

  // 阶段2：带种子重启，登录拿会话
  await startServer();
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD })
  });
  cookie = extractCookie(login);
}, 30000);

afterAll(async () => {
  await stopServer();
  await new Promise(resolve => fakeOpenAi?.close(resolve));
  await removeStores();
});

describe("POST /api/training/relations/scan", () => {
  it("未认证调用返回 401", async () => {
    const response = await fetch(`${BASE}/api/training/relations/scan`, { method: "POST" });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.ok).toBe(false);
  });

  it("返回 {pairsConsidered, created, pending} 且重复调用幂等不产生重复关系", async () => {
    const first = await fetch(`${BASE}/api/training/relations/scan`, {
      method: "POST",
      headers: { cookie }
    });
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.ok).toBe(true);
    expect(firstData.pairsConsidered).toBe(1);
    expect(firstData.created).toBe(1);
    expect(firstData.pending).toBe(0);

    const second = await fetch(`${BASE}/api/training/relations/scan`, {
      method: "POST",
      headers: { cookie }
    });
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.ok).toBe(true);
    expect(secondData.pairsConsidered).toBe(1);
    expect(secondData.created).toBe(0);
    expect(secondData.pending).toBe(0);

    const relations = await fetch(`${BASE}/api/training/debts/debt-scan-b/relations`, {
      headers: { cookie }
    });
    expect(relations.status).toBe(200);
    const relationsData = await relations.json();
    expect(relationsData.relations).toHaveLength(1);
    expect(relationsData.relations[0].status).toBe("auto_confirmed");
    expect(relationsData.relations[0].relationType).toBe("same_project");
  });
});
