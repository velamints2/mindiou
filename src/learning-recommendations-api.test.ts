// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8823;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/learning-rec-api-test-mvp0.json");
const SESSION_STORE = path.resolve("tmp/learning-rec-api-test-mvp1.json");
const AUTH_STORE = path.resolve("tmp/learning-rec-api-test-auth.sqlite");
const TRAINING_STORE = path.resolve("tmp/learning-rec-api-test-training.json");
const INTEL_STORE = path.resolve("tmp/learning-rec-api-test-intelligence.json");
const GRAPH_STORE = path.resolve("tmp/learning-rec-api-test-graph.json");
const PROFILE_STORE = path.resolve("tmp/learning-rec-api-test-profile.json");
const ORCHESTRATOR_STORE = path.resolve("tmp/learning-rec-api-test-orchestrator.json");
const DAY_MS = 24 * 60 * 60 * 1000;

let appProcess;

async function waitFor(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
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
      LEARNING_ORCHESTRATOR_STORE_PATH: ORCHESTRATOR_STORE,
      COGNITIVE_PROFILE_SNAPSHOT_INTERVAL_MS: "0",
      SPIRAL_DISABLE_AI: "1",
      AI_API_KEY: "",
      OPENAI_API_KEY: "",
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
    ORCHESTRATOR_STORE, AUTH_STORE, `${AUTH_STORE}-wal`, `${AUTH_STORE}-shm`
  ]) {
    await rm(file, { force: true });
  }
}

function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

// 未登录请求回退 demo-user：种子欠条/任务/分类都落在 demo-user 上
beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await removeStores();
  await writeFile(TRAINING_STORE, JSON.stringify({
    version: 1,
    trainingAttempts: [],
    masteryProfiles: [],
    reviewTasks: [{
      id: "rec-task-1",
      userId: "demo-user",
      cognitiveDebtId: "rec-debt-1",
      cardId: "card-1",
      trainingStage: "delayed_recall",
      taskType: "short_recall",
      prompt: "不看之前的材料，用你自己的话解释：CORS",
      hintsAllowed: false,
      maxHints: 0,
      createdAt: daysAgo(2),
      dueAt: daysAgo(1),
      status: "pending"
    }],
    cognitiveDebts: [{
      id: "rec-debt-1",
      userId: "demo-user",
      reportId: "report-rec-1",
      gapText: "不理解 CORS 预检请求为什么失败",
      gapEvidence: "用户直接复制了 AI 给出的配置",
      status: "review_due",
      recurrenceCount: 0,
      sourceReports: ["report-rec-1"],
      createdAt: daysAgo(5),
      updatedAt: daysAgo(1)
    }],
    capabilities: []
  }, null, 2));
  await writeFile(INTEL_STORE, JSON.stringify({
    version: 1,
    debtIntelligenceAnalyses: [{
      id: "analysis-rec-debt-1",
      cognitiveDebtId: "rec-debt-1",
      userId: "demo-user",
      version: 1,
      domainPath: ["software_engineering", "frontend"],
      primaryGapMechanism: "concept_gap",
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
      updatedAt: daysAgo(5)
    }],
    analysisRuns: []
  }, null, 2));
  await startServer();
}, 30000);

afterAll(async () => {
  await stopServer();
  await removeStores();
});

describe("GET /api/learning-recommendations/today", () => {
  it("返回 200 与推荐结构，不再被方法闸门挡成 405", async () => {
    const response = await fetch(`${BASE}/api/learning-recommendations/today`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.recommendations)).toBe(true);
    expect(data.recommendations.length).toBeGreaterThan(0);
    const rec = data.recommendations.find(item => item.recommendationType === "due_review");
    expect(rec).toBeDefined();
    expect(rec.primaryDebtId).toBe("rec-debt-1");
    expect(rec.existingReviewTaskId).toBe("rec-task-1");
    expect(typeof rec.title).toBe("string");
    expect(typeof rec.reason).toBe("string");
    expect(typeof rec.priorityScore).toBe("number");
    expect(rec.debtSummary.id).toBe("rec-debt-1");
    expect(rec.reviewTask.id).toBe("rec-task-1");
  });

  it("POST accept 后推荐保持 accepted 且带 reviewTaskId，重复 accept 返回 409", async () => {
    const today = await (await fetch(`${BASE}/api/learning-recommendations/today`)).json();
    const rec = today.recommendations.find(item => item.recommendationType === "due_review");
    expect(rec).toBeDefined();

    const accept = await fetch(`${BASE}/api/learning-recommendations/${rec.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(accept.status).toBe(200);
    const accepted = await accept.json();
    expect(accepted.ok).toBe(true);
    expect(accepted.reviewTaskId).toBe("rec-task-1");
    expect(accepted.reviewStartEndpoint).toBe("/api/training/reviews/rec-task-1/start");

    // 刷新（未提交训练）：推荐仍在列表中，状态 accepted，且带已创建的 reviewTaskId
    const refreshed = await (await fetch(`${BASE}/api/learning-recommendations/today`)).json();
    const stillThere = refreshed.recommendations.find(item => item.id === rec.id);
    expect(stillThere).toBeDefined();
    expect(stillThere.status).toBe("accepted");
    expect(stillThere.existingReviewTaskId).toBe("rec-task-1");
    expect(stillThere.reviewTask?.id).toBe("rec-task-1");

    // 重复 accept 仍是 409：前端必须走「继续训练」而不是再次 accept
    const reaccept = await fetch(`${BASE}/api/learning-recommendations/${rec.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(reaccept.status).toBe(409);
  });
});

describe("GET /api/learning-recommendations/weekly-focus", () => {
  it("返回 200，不再被方法闸门挡成 405", async () => {
    const response = await fetch(`${BASE}/api/learning-recommendations/weekly-focus`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    // 种子欠条有 domainPath：本周学习重点应聚合到 software_engineering.frontend
    expect(data.weeklyFocus).toBeTruthy();
    expect(data.weeklyFocus.recommendationType).toBe("weekly_focus");
    expect(data.weeklyFocus.skillNodeId).toBe("software_engineering.frontend");
  });
});
