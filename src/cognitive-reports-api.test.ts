// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8824;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/cognitive-reports-api-test-mvp0.json");
const SESSION_STORE = path.resolve("tmp/cognitive-reports-api-test-mvp1.json");
const AUTH_STORE = path.resolve("tmp/cognitive-reports-api-test-auth.sqlite");
const TRAINING_STORE = path.resolve("tmp/cognitive-reports-api-test-training.json");
const INTEL_STORE = path.resolve("tmp/cognitive-reports-api-test-intelligence.json");
const GRAPH_STORE = path.resolve("tmp/cognitive-reports-api-test-graph.json");
const PROFILE_STORE = path.resolve("tmp/cognitive-reports-api-test-profile.json");
const ORCHESTRATOR_STORE = path.resolve("tmp/cognitive-reports-api-test-orchestrator.json");
const REPORTS_STORE = path.resolve("tmp/cognitive-reports-api-test-reports.json");
const USER_EMAIL = "reports-user@example.com";
const PASSWORD = "test-secret-1";
const DAY_MS = 24 * 60 * 60 * 1000;

let appProcess;
let userCookie;

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
      LEARNING_ORCHESTRATOR_STORE_PATH: ORCHESTRATOR_STORE,
      COGNITIVE_REPORTS_STORE_PATH: REPORTS_STORE,
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
    ORCHESTRATOR_STORE, REPORTS_STORE, AUTH_STORE, `${AUTH_STORE}-wal`, `${AUTH_STORE}-shm`
  ]) {
    await rm(file, { force: true });
  }
}

function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

/** 当前周周期起点（周一 UTC），与 resolveSnapshotPeriod 同口径。 */
function currentWeekMonday() {
  const d = new Date();
  const day = d.getUTCDay() || 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
}

// 未登录请求回退 demo-user：种子欠条/任务/分类与历史周报都落在 demo-user 上
beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await removeStores();
  const weekStart = currentWeekMonday();
  const inWeek = new Date(weekStart.getTime() + 3600 * 1000).toISOString();
  await writeFile(TRAINING_STORE, JSON.stringify({
    version: 1,
    trainingAttempts: [],
    masteryProfiles: [],
    reviewTasks: [{
      id: "rep-task-1",
      userId: "demo-user",
      cognitiveDebtId: "rep-debt-1",
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
      id: "rep-debt-1",
      userId: "demo-user",
      reportId: "report-rep-1",
      gapText: "不理解 CORS 预检请求为什么失败",
      gapEvidence: "用户直接复制了 AI 给出的配置",
      status: "review_due",
      recurrenceCount: 0,
      sourceReports: ["report-rep-1"],
      createdAt: inWeek,
      updatedAt: inWeek
    }],
    capabilities: []
  }, null, 2));
  await writeFile(INTEL_STORE, JSON.stringify({
    version: 1,
    debtIntelligenceAnalyses: [{
      id: "analysis-rep-debt-1",
      cognitiveDebtId: "rep-debt-1",
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
      createdAt: inWeek,
      updatedAt: inWeek
    }],
    analysisRuns: []
  }, null, 2));
  // 种子一份历史周期周报：任何操作都不应改写它
  await writeFile(REPORTS_STORE, JSON.stringify({
    version: 1,
    cognitiveReports: [{
      id: "seed-historical-weekly",
      userId: "demo-user",
      reportType: "weekly",
      periodStart: "2026-07-06T00:00:00.000Z",
      periodEnd: "2026-07-13T00:00:00.000Z",
      inputsJson: { insufficientData: true },
      trainingJson: { insufficientData: true },
      patternsJson: { insufficientData: true },
      progressJson: { insufficientData: true },
      nextFocusJson: { insufficientData: true },
      summaryText: "历史周报种子",
      calculationVersion: "cognitive-reports/v1",
      createdAt: "2026-07-07T00:00:00.000Z"
    }]
  }, null, 2));
  await startServer();

  const register = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: USER_EMAIL, password: PASSWORD })
  });
  userCookie = extractCookie(register);
}, 30000);

afterAll(async () => {
  await stopServer();
  await removeStores();
});

describe("GET /api/cognitive-reports/weekly/latest", () => {
  it("首次读时生成本周周报，五节齐备且摘要为确定性模板；再次读取返回同一份", async () => {
    const first = await fetch(`${BASE}/api/cognitive-reports/weekly/latest`);
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.ok).toBe(true);
    expect(firstData.generated).toBe(true);
    const report = firstData.report;
    expect(report.reportType).toBe("weekly");
    expect(report.calculationVersion).toBe("cognitive-reports/v1");
    // 五节结构
    expect(report.inputsJson.newDebtCount).toBe(1);
    expect(report.trainingJson.insufficientData).toBe(true); // 本周无训练
    expect(report.patternsJson.topMechanism.key).toBe("concept_gap");
    expect(report.nextFocusJson.insufficientData).toBe(false);
    expect(report.nextFocusJson.theme.skillNodeId).toBe("software_engineering.frontend");
    expect(report.nextFocusJson.tasks.length).toBeGreaterThanOrEqual(1);
    // 确定性摘要（AI 已禁用）：包含真实统计数字
    expect(report.summaryText).toContain("新增 1 张认知欠条");
    expect(report.summaryText).toContain("本周没有完成训练");

    // 幂等：同周期再次读取不重新生成
    const second = await fetch(`${BASE}/api/cognitive-reports/weekly/latest`);
    const secondData = await second.json();
    expect(secondData.generated).toBe(false);
    expect(secondData.report.id).toBe(report.id);
  });
});

describe("GET /api/cognitive-reports/monthly/latest", () => {
  it("月度快照不足两个月时各节标记数据不足，摘要明确说明", async () => {
    const response = await fetch(`${BASE}/api/cognitive-reports/monthly/latest`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.report.reportType).toBe("monthly");
    expect(data.report.inputsJson.insufficientData).toBe(true);
    expect(data.report.trainingJson.insufficientData).toBe(true);
    expect(data.report.patternsJson.insufficientData).toBe(true);
    expect(data.report.progressJson.insufficientData).toBe(true);
    expect(data.report.summaryText).toContain("月度报告数据不足");
  });
});

describe("GET /api/cognitive-reports/history", () => {
  it("type 缺失或非法返回 400", async () => {
    const missing = await fetch(`${BASE}/api/cognitive-reports/history`);
    expect(missing.status).toBe(400);
    const invalid = await fetch(`${BASE}/api/cognitive-reports/history?type=daily`);
    expect(invalid.status).toBe(400);
  });

  it("历史列表按周期新到旧排序，历史种子报告不被生成逻辑改写，支持分页", async () => {
    const response = await fetch(`${BASE}/api/cognitive-reports/history?type=weekly`);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.total).toBe(2); // 历史种子 + 本次生成
    expect(data.reports[0].periodStart > data.reports[1].periodStart).toBe(true);
    const historical = data.reports.find(item => item.id === "seed-historical-weekly");
    expect(historical).toBeDefined();
    expect(historical.summaryText).toBe("历史周报种子");
    expect(historical.createdAt).toBe("2026-07-07T00:00:00.000Z");

    const paged = await fetch(`${BASE}/api/cognitive-reports/history?type=weekly&limit=1&offset=1`);
    const pagedData = await paged.json();
    expect(pagedData.total).toBe(2);
    expect(pagedData.reports).toHaveLength(1);
    expect(pagedData.reports[0].id).toBe("seed-historical-weekly");

    const monthly = await fetch(`${BASE}/api/cognitive-reports/history?type=monthly`);
    const monthlyData = await monthly.json();
    expect(monthlyData.total).toBe(1); // monthly/latest 读时生成的一份
    expect(monthlyData.reports[0].reportType).toBe("monthly");
  });
});

describe("POST /api/cognitive-reports/weekly/generate", () => {
  it("未登录返回 401；登录后可生成，同周期重算替换（新 id）且历史报告不混入", async () => {
    const unauthenticated = await fetch(`${BASE}/api/cognitive-reports/weekly/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    expect(unauthenticated.status).toBe(401);

    const first = await fetch(`${BASE}/api/cognitive-reports/weekly/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: userCookie },
      body: "{}"
    });
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.ok).toBe(true);
    expect(firstData.report.reportType).toBe("weekly");
    expect(firstData.report.inputsJson.newDebtCount).toBe(0); // 新用户无数据
    expect(firstData.report.summaryText).toContain("没有新增认知欠条");

    const second = await fetch(`${BASE}/api/cognitive-reports/weekly/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: userCookie },
      body: "{}"
    });
    const secondData = await second.json();
    expect(secondData.report.id).not.toBe(firstData.report.id);
    expect(secondData.report.periodStart).toBe(firstData.report.periodStart);

    // 该用户只有当前周期一份报告；demo-user 的历史种子不可见
    const history = await fetch(`${BASE}/api/cognitive-reports/history?type=weekly`, {
      headers: { cookie: userCookie }
    });
    const historyData = await history.json();
    expect(historyData.total).toBe(1);
    expect(historyData.reports[0].id).toBe(secondData.report.id);
  });
});
