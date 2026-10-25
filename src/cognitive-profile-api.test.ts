// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8817;
const OPENAI_PORT = 8818;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/cognitive-profile-api-test-mvp0.json");
const SESSION_STORE = path.resolve("tmp/cognitive-profile-api-test-mvp1.json");
const AUTH_STORE = path.resolve("tmp/cognitive-profile-api-test-auth.sqlite");
const TRAINING_STORE = path.resolve("tmp/cognitive-profile-api-test-training.json");
const INTEL_STORE = path.resolve("tmp/cognitive-profile-api-test-intelligence.json");
const GRAPH_STORE = path.resolve("tmp/cognitive-profile-api-test-graph.json");
const PROFILE_STORE = path.resolve("tmp/cognitive-profile-api-test-profile.json");
const USER_A_EMAIL = "profile-a@example.com";
const USER_C_EMAIL = "profile-c@example.com";
const PASSWORD = "test-secret-1";
const OTHER_USER_ID = "profile-other-user";
const DAY_MS = 24 * 60 * 60 * 1000;

let appProcess;
let fakeOpenAi;
let userAId;
let cookieA;
let cookieC;

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
      COGNITIVE_PROFILE_STORE_PATH: PROFILE_STORE,
      COGNITIVE_PROFILE_SNAPSHOT_INTERVAL_MS: "0",
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
  for (const file of [
    STORE, SESSION_STORE, TRAINING_STORE, INTEL_STORE, GRAPH_STORE, PROFILE_STORE,
    AUTH_STORE, `${AUTH_STORE}-wal`, `${AUTH_STORE}-shm`
  ]) {
    await rm(file, { force: true });
  }
}

function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

function makeSeedDebt(id, userId, overrides = {}) {
  return {
    id,
    userId,
    reportId: `report-${id}`,
    gapText: `缺口 ${id}`,
    gapEvidence: "证据",
    status: "new",
    recurrenceCount: 0,
    sourceReports: [`report-${id}`],
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    ...overrides
  };
}

function makeSeedAnalysis(debtId, userId, overrides = {}) {
  return {
    id: `analysis-${debtId}`,
    cognitiveDebtId: debtId,
    userId,
    version: 1,
    domainPath: ["software_engineering", "backend", "distributed_systems"],
    primaryGapMechanism: "rationale_gap",
    secondaryGapMechanisms: [],
    taskStage: "execution",
    rootCauses: ["accepted_ai_output_directly"],
    riskTypes: ["no_material_risk"],
    transferValue: 3,
    concepts: [],
    prerequisiteConcepts: [],
    classificationConfidence: 0.8,
    evidence: [{ note: "证据", source: "gap_evidence" }],
    taxonomyVersion: "debt-intelligence-taxonomy/v1",
    promptVersion: "debt-intelligence/v1",
    modelName: "test-model",
    isUserCorrected: false,
    isCurrent: true,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    ...overrides
  };
}

beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await removeStores();
  // 假模型服务：所有调用返回 500 → 措辞润色必须回退确定性文案
  fakeOpenAi = createServer((req, res) => {
    json(res, 500, { error: { message: "fake provider failure" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(OPENAI_PORT, "127.0.0.1", resolve));

  // 阶段1：注册 A 拿 userId 后停机，按用户落种子欠条与分类
  await startServer();
  const register = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USER_A_EMAIL, password: PASSWORD })
  });
  const registered = await register.json();
  userAId = registered.user.id;
  await stopServer();

  const aDebts = [
    makeSeedDebt("profile-a1", userAId, { status: "mastered", createdAt: daysAgo(9), updatedAt: daysAgo(9) }),
    makeSeedDebt("profile-a2", userAId, { status: "mastered", createdAt: daysAgo(7), updatedAt: daysAgo(7) }),
    makeSeedDebt("profile-a3", userAId, { status: "training", createdAt: daysAgo(3), updatedAt: daysAgo(3) }),
    makeSeedDebt("profile-a4", userAId, { createdAt: daysAgo(1), updatedAt: daysAgo(1) })
  ];
  const bDebts = [
    makeSeedDebt("profile-b1", OTHER_USER_ID),
    makeSeedDebt("profile-b2", OTHER_USER_ID)
  ];
  await writeFile(TRAINING_STORE, JSON.stringify({
    version: 1,
    trainingAttempts: [],
    masteryProfiles: [],
    reviewTasks: [],
    cognitiveDebts: [...aDebts, ...bDebts],
    capabilities: []
  }, null, 2));

  const analyses = [
    ...aDebts.map(debt => makeSeedAnalysis(debt.id, userAId, {
      riskTypes: debt.id === "profile-a1" || debt.id === "profile-a2" ? ["quality_risk"] : ["no_material_risk"]
    })),
    ...bDebts.map(debt => makeSeedAnalysis(debt.id, OTHER_USER_ID, {
      domainPath: ["finance", "accounting"],
      primaryGapMechanism: "concept_gap"
    }))
  ];
  await writeFile(INTEL_STORE, JSON.stringify({
    version: 1,
    debtIntelligenceAnalyses: analyses,
    analysisRuns: []
  }, null, 2));

  // 阶段2：带种子重启，A 登录；再注册 C（无欠条用户）
  await startServer();
  const loginA = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USER_A_EMAIL, password: PASSWORD })
  });
  cookieA = extractCookie(loginA);
  const registerC = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USER_C_EMAIL, password: PASSWORD })
  });
  cookieC = extractCookie(registerC);
}, 30000);

afterAll(async () => {
  await stopServer();
  await new Promise(resolve => fakeOpenAi?.close(resolve));
  await removeStores();
});

describe("GET /api/cognitive-profile/summary", () => {
  it("只聚合当前用户的欠条，不混入其他用户数据", async () => {
    const response = await fetch(`${BASE}/api/cognitive-profile/summary`, { headers: { cookie: cookieA } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.skills.skills).toHaveLength(1);
    const skill = data.skills.skills[0];
    expect(skill.skillNodeKey).toBe("software_engineering.backend.distributed_systems");
    expect(skill.relatedDebtCount).toBe(4);
    expect(skill.masteredDebtCount).toBe(2);
    for (const debtId of skill.evidenceDebtIds) {
      expect(debtId.startsWith("profile-a")).toBe(true);
    }
    // 结论已生成且证据只指向 A 的欠条
    expect(data.insights.length).toBeGreaterThan(0);
    expect(data.aiEnhanced).toBe(false);
    for (const insight of data.insights) {
      expect(insight.userId).toBe(userAId);
      for (const debtId of insight.evidenceDebtIds) {
        expect(debtId.startsWith("profile-a")).toBe(true);
      }
      expect(Array.isArray(insight.evidenceAttemptIds)).toBe(true);
      expect(Array.isArray(insight.evidenceClusterIds)).toBe(true);
    }
    // 风险画像只统计 A 的两张 quality_risk 欠条
    expect(data.risks.totalRiskDebts).toBe(2);
    expect(data.risks.distribution[0].riskType).toBe("quality_risk");
  });

  it("无欠条用户得到空画像与数据不足标记", async () => {
    const response = await fetch(`${BASE}/api/cognitive-profile/summary`, { headers: { cookie: cookieC } });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.skills.skills).toHaveLength(0);
    expect(data.skills.insufficientData).toBe(true);
    expect(data.patterns.insufficientData).toBe(true);
    expect(data.insights).toHaveLength(0);
  });

  it("未登录请求回退 demo-user，看不到任何已注册用户的画像", async () => {
    const response = await fetch(`${BASE}/api/cognitive-profile/summary`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.skills.skills).toHaveLength(0);
    expect(data.insights).toHaveLength(0);
  });
});

describe("GET /api/cognitive-profile/insights/:id/evidence", () => {
  it("本人可展开证据；其他用户访问同一结论返回 404", async () => {
    const summary = await (await fetch(`${BASE}/api/cognitive-profile/summary`, { headers: { cookie: cookieA } })).json();
    const insight = summary.insights.find(item => item.evidenceDebtIds.length > 0);
    expect(insight).toBeDefined();

    const own = await fetch(`${BASE}/api/cognitive-profile/insights/${insight.id}/evidence`, { headers: { cookie: cookieA } });
    expect(own.status).toBe(200);
    const ownData = await own.json();
    expect(ownData.ok).toBe(true);
    expect(ownData.insight.id).toBe(insight.id);
    expect(ownData.evidence.debts.length).toBe(insight.evidenceDebtIds.length);
    for (const debt of ownData.evidence.debts) {
      expect(debt.id.startsWith("profile-a")).toBe(true);
      expect(typeof debt.gapText).toBe("string");
    }

    const cross = await fetch(`${BASE}/api/cognitive-profile/insights/${insight.id}/evidence`, { headers: { cookie: cookieC } });
    expect(cross.status).toBe(404);
  });
});

describe("POST /api/cognitive-profile/snapshots", () => {
  it("手动快照同日幂等；模型不可用时回退确定性文案；快照按用户隔离", async () => {
    const first = await fetch(`${BASE}/api/cognitive-profile/snapshots`, {
      method: "POST",
      headers: { cookie: cookieA }
    });
    expect(first.status).toBe(201);
    const firstData = await first.json();
    expect(firstData.ok).toBe(true);
    expect(firstData.created).toBe(true);
    expect(firstData.snapshot.snapshotType).toBe("manual");
    expect(firstData.snapshot.userId).toBe(userAId);
    expect(firstData.insightCount).toBeGreaterThan(0);
    // 假模型服务返回 500：润色失败必须回退确定性模板文案
    expect(firstData.aiEnhanced).toBe(false);

    const second = await fetch(`${BASE}/api/cognitive-profile/snapshots`, {
      method: "POST",
      headers: { cookie: cookieA }
    });
    expect(second.status).toBe(200);
    const secondData = await second.json();
    expect(secondData.created).toBe(false);
    expect(secondData.snapshot.id).toBe(firstData.snapshot.id);

    const listA = await (await fetch(`${BASE}/api/cognitive-profile/snapshots`, { headers: { cookie: cookieA } })).json();
    expect(listA.snapshots).toHaveLength(1);
    const listC = await (await fetch(`${BASE}/api/cognitive-profile/snapshots`, { headers: { cookie: cookieC } })).json();
    expect(listC.snapshots).toHaveLength(0);
  });
});
