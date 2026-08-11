// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProjectMemoryStore } from "../project-memory-store.js";
import { createTrainingStore } from "../training-store.js";

const TEST_DIR = path.join(os.tmpdir(), `mindiou-agent-context-${Date.now()}`);
const DATA_DB = path.join(TEST_DIR, "data.sqlite");
const AUTH_DB = path.join(TEST_DIR, "auth.sqlite");
const LEARNING_JSON = path.join(TEST_DIR, "learning.json");
const USER_ID = "mcp-demo-user";
let baseUrl;
let appProcess;
let hookToken;
let project;
let otherProject;
let memoryStore;
let trainingStore;

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
  for (let i = 0; i < 50; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function call(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bearer ${hookToken}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
}

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  memoryStore = createProjectMemoryStore(DATA_DB);
  project = memoryStore.createProject({ name: "演示项目" }, USER_ID);
  otherProject = memoryStore.createProject({ name: "另一个项目" }, USER_ID);
  const artifact = memoryStore.upsertArtifact({
    projectId: project.id,
    type: "file",
    name: "redeem.ts",
    repositoryRelativePath: "src/redeem.ts"
  }, USER_ID);
  memoryStore.linkDebtArtifact({ debtId: "debt-project", artifactId: artifact.id, relation: "implemented_in" }, USER_ID);
  hookToken = memoryStore.createHookToken(project.id, USER_ID, "test hook").token;

  trainingStore = createTrainingStore(DATA_DB, { legacyJsonPath: LEARNING_JSON });
  await trainingStore.load();
  await trainingStore.saveCognitiveDebt({ id: "debt-project", userId: USER_ID, gapText: "项目内并发控制", status: "open" });
  await trainingStore.saveCognitiveDebt({ id: "debt-other", userId: USER_ID, gapText: "另一个项目的数据库迁移", status: "open" });
  await trainingStore.saveReviewTask({ id: "review-project", userId: USER_ID, cognitiveDebtId: "debt-project", status: "pending", dueAt: "2020-01-01T00:00:00.000Z" });
  await trainingStore.saveReviewTask({ id: "review-other", userId: USER_ID, cognitiveDebtId: "debt-other", status: "pending", dueAt: "2020-01-01T00:00:00.000Z" });

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
      MINDIOU_SESSION_SECRET: "mcp-agent-context-test-secret-32-chars!",
      AI_PROVIDER: "deepseek",
      AI_API_KEY: "test-key",
      AI_BASE_URL: "http://127.0.0.1:18999/v1",
      STT_API_KEY: "",
      LEARNING_API_TOKEN: ""
    },
    stdio: "ignore"
  });
  await waitFor(`${baseUrl}/health`);
}, 30000);

afterAll(async () => {
  appProcess?.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 400));
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("agent context project isolation and demo capture", () => {
  it("returns only debts and reviews linked to the token-bound project", async () => {
    const response = await call(`/api/projects/${project.id}/agent-context`);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.counts.debts).toBe(1);
    expect(data.debts.map(item => item.id)).toEqual(["debt-project"]);
    expect(data.dueReviews.tasks.map(item => item.id)).toEqual(["review-project"]);
  });

  it("rejects a token-bound context request for another project", async () => {
    const response = await call(`/api/projects/${otherProject.id}/agent-context`);
    expect(response.status).toBe(403);
  });

  it("captures a structured session and accepts its debt candidate", async () => {
    const events = [
      { id: "demo-user", type: "user_prompted", payload: { content: "修改激活码兑换，避免并发重复兑换" } },
      { id: "demo-agent", type: "agent_message", payload: { content: "Agent 使用事务、条件更新和唯一约束完成修复，测试通过。" } },
      { id: "demo-file", type: "file_changed", payload: { path: "src/redeem.ts", repositoryRelativePath: "src/redeem.ts" } },
      { id: "demo-candidate", type: "debt_candidate", payload: { gapText: "尚未证明能够解释并发窗口", reason: "关键方案由 Agent 完成", risk: "可能重复处理" } }
    ];
    const capture = await call("/api/agent-sessions/events", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id, sessionId: "demo-session", sourceFingerprint: "demo-session-v1", events })
    });
    const captured = await capture.json();
    expect(capture.status).toBe(200);
    expect(captured.analysis.cognitiveDebtCandidates).toHaveLength(1);
    const sessionId = captured.session.session.id;

    const accepted = await call(`/api/agent-sessions/${encodeURIComponent(sessionId)}/debt-candidates/0/accept`, {
      method: "POST",
      body: "{}"
    });
    const acceptedData = await accepted.json();
    expect(accepted.status).toBe(201);
    expect(acceptedData.debt.userId).toBe(USER_ID);
    expect(acceptedData.links.some(link => link.artifact.projectId === project.id)).toBe(true);
  });

  it("merges a late debt candidate when a hook reuses an existing source fingerprint", async () => {
    const initial = await call("/api/agent-sessions/events", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        sessionId: "reused-capture-session",
        sourceFingerprint: "reused-capture-fingerprint",
        events: [
          { id: "reused-start", type: "session_started", payload: { title: "并发兑换修复" } },
          { id: "reused-file", type: "file_changed", payload: { path: "src/redeem.ts" } }
        ]
      })
    });
    expect(initial.status).toBe(200);
    expect((await initial.json()).analysis.cognitiveDebtCandidates || []).toHaveLength(0);

    const appended = await call("/api/agent-sessions/events", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        sessionId: "reused-capture-session",
        sourceFingerprint: "reused-capture-fingerprint",
        events: [
          {
            id: "reused-candidate",
            type: "debt_candidate",
            payload: {
              gapText: "尚未证明能够解释并发窗口",
              reason: "关键方案由 Agent 完成",
              risk: "可能重复处理"
            }
          }
        ]
      })
    });
    const appendedData = await appended.json();
    expect(appended.status).toBe(200);
    expect(appendedData.idempotent).toBe(true);
    expect(appendedData.analysis.cognitiveDebtCandidates).toHaveLength(1);
    expect(appendedData.analysis.cognitiveDebtCandidates[0].description).toBe("尚未证明能够解释并发窗口");
  });
});
