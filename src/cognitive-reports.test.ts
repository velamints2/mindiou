// @ts-nocheck
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  CALCULATION_VERSION,
  buildInputsSection,
  buildTrainingSection,
  buildPatternsSection,
  buildProgressSection,
  buildNextFocusSection,
  buildMonthlyReport,
  buildWeeklySummaryText,
  buildMonthlySummaryText,
  generateWeeklyReport,
  generateMonthlyReport,
  getLatestWeeklyReport,
  getLatestMonthlyReport
} from "../cognitive-reports.js";
import { createCognitiveReportsStore } from "../cognitive-reports-store.js";
import { createCognitiveProfileStore } from "../cognitive-profile-store.js";
import { createDebtIntelligenceStore } from "../debt-intelligence-store.js";
import { createConceptGraphStore } from "../concept-graph-store.js";
import { createLearningOrchestratorStore } from "../learning-orchestrator-store.js";
import { createTrainingStore } from "../training-store.js";

const tmpDir = path.join(os.tmpdir(), `mindiou-cognitive-reports-test-${process.pid}`);
const reportsPath = path.join(tmpDir, "cognitive-reports-store.json");
const profilePath = path.join(tmpDir, "cognitive-profile-store.json");
const intelPath = path.join(tmpDir, "debt-intelligence-store.json");
const graphPath = path.join(tmpDir, "concept-graph-store.json");
const orchestratorPath = path.join(tmpDir, "learning-orchestrator-store.json");
const trainingPath = path.join(tmpDir, "training-store.json");

const NOW = new Date("2026-08-04T12:00:00.000Z"); // 周二
// NOW 所在周（周一 UTC 起）与月周期，与 resolveSnapshotPeriod 同口径
const WEEK = { periodStart: "2026-08-03T00:00:00.000Z", periodEnd: "2026-08-10T00:00:00.000Z" };
const MONTH = { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" };

async function freshStores() {
  await mkdir(tmpDir, { recursive: true });
  const store = createCognitiveReportsStore(reportsPath);
  const profileStore = createCognitiveProfileStore(profilePath);
  const intelligenceStore = createDebtIntelligenceStore(intelPath);
  const graphStore = createConceptGraphStore(graphPath);
  const orchestratorStore = createLearningOrchestratorStore(orchestratorPath);
  const trainingStore = createTrainingStore(trainingPath);
  await Promise.all([
    store.load(), profileStore.load(), intelligenceStore.load(),
    graphStore.load(), orchestratorStore.load(), trainingStore.load()
  ]);
  return { store, profileStore, intelligenceStore, graphStore, orchestratorStore, trainingStore };
}

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

let debtSeq = 0;
function makeDebt(overrides = {}) {
  debtSeq += 1;
  const id = overrides.id || `debt-${debtSeq}`;
  return {
    id,
    userId: "user-1",
    reportId: `report-${id}`,
    gapText: `缺口 ${id}`,
    gapEvidence: "证据",
    status: "new",
    recurrenceCount: 0,
    sourceReports: [`report-${id}`],
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:00:00.000Z",
    ...overrides
  };
}

function makeAnalysis(debtId, overrides = {}) {
  return {
    id: `analysis-${debtId}`,
    cognitiveDebtId: debtId,
    userId: "user-1",
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
    createdAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T10:00:00.000Z",
    ...overrides
  };
}

function makeProfile(debtId, overrides = {}) {
  return {
    cognitiveDebtId: debtId,
    conceptualUnderstanding: 60,
    independentRecall: 50,
    hintIndependence: 70,
    misconceptionResistance: 40,
    transferAbility: 80,
    retentionStrength: 90,
    overallMastery: 63,
    currentStage: 2,
    successfulAttempts: 1,
    failedAttempts: 0,
    relapseCount: 0,
    ...overrides
  };
}

function makeAttempt(debtId, overrides = {}) {
  return {
    id: `attempt-${debtId}-${Math.random().toString(36).slice(2, 8)}`,
    userId: "user-1",
    cardId: "card-1",
    cognitiveDebtId: debtId,
    trainingStage: "delayed_recall",
    taskType: "short_recall",
    originalPrompt: "解释这个概念",
    finalAnswer: "我的回答",
    hintEvents: [],
    evaluation: { overallScore: 70, passed: true, hintDependency: 30 },
    startedAt: "2026-08-04T09:00:00.000Z",
    completedAt: "2026-08-04T09:05:00.000Z",
    durationSeconds: 300,
    ...overrides
  };
}

function makeTask(id, debtId, overrides = {}) {
  return {
    id,
    userId: "user-1",
    cognitiveDebtId: debtId,
    cardId: "card-1",
    trainingStage: "delayed_recall",
    taskType: "short_recall",
    prompt: "不看之前的材料，用你自己的话解释",
    hintsAllowed: false,
    maxHints: 0,
    createdAt: "2026-08-01T09:00:00.000Z",
    dueAt: "2026-08-03T12:00:00.000Z",
    status: "pending",
    ...overrides
  };
}

function mapFrom(list, keyOf) {
  return new Map(list.map(item => [keyOf(item), item]));
}

// ─── buildInputsSection：本周输入 ───

describe("buildInputsSection — 本周新增欠条、领域分布与来源", () => {
  it("周期内无新增欠条时标记 insufficientData", () => {
    const result = buildInputsSection({
      debts: [makeDebt({ id: "d-old", createdAt: "2026-07-20T09:00:00.000Z" })],
      analysesByDebtId: new Map(),
      period: WEEK
    });
    expect(result.insufficientData).toBe(true);
    expect(result.newDebtCount).toBe(0);
    expect(result.domainDistribution).toEqual([]);
  });

  it("只统计周期内新增欠条，领域分布按独立欠条数排序，来源取 sourceReports 首个", () => {
    const d1 = makeDebt({ id: "d1", reportId: "report-a", sourceReports: ["report-a"], createdAt: "2026-08-03T08:00:00.000Z" });
    const d2 = makeDebt({ id: "d2", reportId: "report-a", sourceReports: ["report-a"], createdAt: "2026-08-04T08:00:00.000Z" });
    const d3 = makeDebt({ id: "d3", reportId: "report-b", sourceReports: ["report-b"], createdAt: "2026-08-05T08:00:00.000Z" });
    const outside = makeDebt({ id: "d-out", createdAt: "2026-07-27T08:00:00.000Z" });
    const analyses = mapFrom([
      makeAnalysis("d1"),
      makeAnalysis("d2"),
      makeAnalysis("d3", { domainPath: ["finance"] })
    ], item => item.cognitiveDebtId);

    const result = buildInputsSection({
      debts: [d1, d2, d3, outside],
      analysesByDebtId: analyses,
      period: WEEK
    });
    expect(result.insufficientData).toBe(false);
    expect(result.newDebtCount).toBe(3);
    expect(result.newDebtIds).toEqual(["d1", "d2", "d3"]);
    expect(result.domainDistribution[0].skillNodeKey).toBe("software_engineering.frontend");
    expect(result.domainDistribution[0].count).toBe(2);
    expect(result.domainDistribution[1].skillNodeKey).toBe("finance");
    expect(result.topSources[0]).toEqual({ source: "report-a", count: 2 });
  });
});

// ─── buildTrainingSection：本周训练 ───

describe("buildTrainingSection — 训练次数、阶段通过率、提示依赖趋势与复发", () => {
  it("周期内无训练时标记 insufficientData", () => {
    const result = buildTrainingSection({ debts: [], attempts: [], period: WEEK });
    expect(result.insufficientData).toBe(true);
    expect(result.totalAttempts).toBe(0);
    expect(result.averageHintsPerAttempt).toBeNull();
    expect(result.hintDependencyTrend).toBe("insufficient_data");
  });

  it("按阶段统计通过率，平均提示次数只计周期内训练", () => {
    const attempts = [
      makeAttempt("d1", { trainingStage: "delayed_recall", evaluation: { passed: true, hintDependency: 30 }, hintEvents: [{}, {}], completedAt: "2026-08-03T10:00:00.000Z" }),
      makeAttempt("d1", { trainingStage: "delayed_recall", evaluation: { passed: false, hintDependency: 70 }, hintEvents: [], completedAt: "2026-08-04T10:00:00.000Z" }),
      makeAttempt("d2", { trainingStage: "scenario_transfer", evaluation: { passed: true, hintDependency: 20 }, hintEvents: [{}], completedAt: "2026-08-05T10:00:00.000Z" }),
      makeAttempt("d3", { trainingStage: "delayed_recall", evaluation: { passed: true, hintDependency: 30 }, completedAt: "2026-07-20T10:00:00.000Z" })
    ];
    const result = buildTrainingSection({ debts: [], attempts, period: WEEK });
    expect(result.insufficientData).toBe(false);
    expect(result.totalAttempts).toBe(3);
    expect(result.passedAttempts).toBe(2);
    expect(result.stagePassRates.delayed_recall).toEqual({ attempts: 2, passed: 1, passRate: 0.5 });
    expect(result.stagePassRates.scenario_transfer).toEqual({ attempts: 1, passed: 1, passRate: 1 });
    expect(result.stagePassRates.initial_compensation).toBeNull();
    expect(result.averageHintsPerAttempt).toBe(1);
  });

  it("提示依赖趋势：后半均值低于前半 5 分以上为 improving，反之为 declining", () => {
    const improvingAttempts = [
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 80 }, completedAt: "2026-08-03T09:00:00.000Z" }),
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 70 }, completedAt: "2026-08-04T09:00:00.000Z" }),
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 30 }, completedAt: "2026-08-05T09:00:00.000Z" }),
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 20 }, completedAt: "2026-08-06T09:00:00.000Z" })
    ];
    expect(buildTrainingSection({ debts: [], attempts: improvingAttempts, period: WEEK }).hintDependencyTrend).toBe("improving");

    const decliningAttempts = [
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 10 }, completedAt: "2026-08-03T09:00:00.000Z" }),
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 20 }, completedAt: "2026-08-04T09:00:00.000Z" }),
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 70 }, completedAt: "2026-08-05T09:00:00.000Z" }),
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 80 }, completedAt: "2026-08-06T09:00:00.000Z" })
    ];
    expect(buildTrainingSection({ debts: [], attempts: decliningAttempts, period: WEEK }).hintDependencyTrend).toBe("declining");
  });

  it("复发欠条按 updatedAt 落在周期内统计", () => {
    const debts = [
      makeDebt({ id: "d-r", status: "relapsed", updatedAt: "2026-08-05T09:00:00.000Z" }),
      makeDebt({ id: "d-r-old", status: "relapsed", updatedAt: "2026-07-01T09:00:00.000Z" })
    ];
    const result = buildTrainingSection({
      debts,
      attempts: [makeAttempt("d-r", { completedAt: "2026-08-04T09:00:00.000Z" })],
      period: WEEK
    });
    expect(result.relapsedDebtCount).toBe(1);
    expect(result.relapsedDebts[0].debtId).toBe("d-r");
  });
});

// ─── buildPatternsSection：本周认知模式 ───

describe("buildPatternsSection — 机制分布、重复问题簇、高风险与最弱维度", () => {
  it("同一报告产生的同机制欠条按 1 条独立证据计", () => {
    const debts = [
      makeDebt({ id: "d1", reportId: "report-x", sourceReports: ["report-x"] }),
      makeDebt({ id: "d2", reportId: "report-x", sourceReports: ["report-x"] }),
      makeDebt({ id: "d3", reportId: "report-y", sourceReports: ["report-y"] })
    ];
    const analyses = mapFrom([
      makeAnalysis("d1", { primaryGapMechanism: "concept_gap" }),
      makeAnalysis("d2", { primaryGapMechanism: "concept_gap" }),
      makeAnalysis("d3", { primaryGapMechanism: "rationale_gap" })
    ], item => item.cognitiveDebtId);
    const result = buildPatternsSection({
      debts, analysesByDebtId: analyses, profilesByDebtId: new Map(),
      graphStore: null, userId: "user-1", period: WEEK
    });
    expect(result.topMechanism.key).toBe("concept_gap");
    expect(result.topMechanism.count).toBe(1); // 同报告去重
    expect(result.mechanismDistribution).toHaveLength(2);
  });

  it("重复问题簇：本周有新欠条加入的簇被列出，高风险欠条排除 no_material_risk", () => {
    const debts = [
      makeDebt({ id: "d1", gapText: "不理解 CORS 预检" }),
      makeDebt({ id: "d2", gapText: "不理解 TLS 握手" })
    ];
    const analyses = mapFrom([
      makeAnalysis("d1", { riskTypes: ["security_risk", "no_material_risk"] }),
      makeAnalysis("d2", { riskTypes: ["no_material_risk"] })
    ], item => item.cognitiveDebtId);
    const fakeGraph = {
      listDebtClusters: () => [
        { id: "cluster-1", title: "网络基础问题", clusterType: "same_concept" },
        { id: "cluster-2", title: "无关簇", clusterType: "similar_gap" }
      ],
      listDebtClusterMembers: ({ clusterId }) => clusterId === "cluster-1"
        ? [{ cognitiveDebtId: "d1" }, { cognitiveDebtId: "d-old" }]
        : [{ cognitiveDebtId: "d-outside" }]
    };
    const result = buildPatternsSection({
      debts, analysesByDebtId: analyses, profilesByDebtId: new Map(),
      graphStore: fakeGraph, userId: "user-1", period: WEEK
    });
    expect(result.recurringClusters).toHaveLength(1);
    expect(result.recurringClusters[0].clusterId).toBe("cluster-1");
    expect(result.recurringClusters[0].memberCount).toBe(2);
    expect(result.recurringClusters[0].newDebtIdsInPeriod).toEqual(["d1"]);
    expect(result.highRiskDebts).toHaveLength(1);
    expect(result.highRiskDebts[0].debtId).toBe("d1");
    expect(result.highRiskDebts[0].riskTypes).toEqual(["security_risk"]);
  });

  it("最弱掌握维度取全部欠条六维聚合最低维", () => {
    const debts = [makeDebt({ id: "d1" })];
    const profiles = mapFrom([
      makeProfile("d1", { misconceptionResistance: 10, transferAbility: 90 })
    ], item => item.cognitiveDebtId);
    const result = buildPatternsSection({
      debts, analysesByDebtId: new Map(), profilesByDebtId: profiles,
      graphStore: null, userId: "user-1", period: WEEK
    });
    expect(result.weakestDimension.dimension).toBe("misconceptionResistance");
    expect(result.weakestDimension.value).toBe(10);
    expect(typeof result.weakestDimension.label).toBe("string");
  });
});

// ─── buildProgressSection：本周进步 ───

describe("buildProgressSection — mastered、提示转独立、迁移通过与六维对比", () => {
  it("进入 mastered 的欠条按周期内 updatedAt 统计", () => {
    const debts = [
      makeDebt({ id: "d1", status: "mastered", updatedAt: "2026-08-05T09:00:00.000Z" }),
      makeDebt({ id: "d2", status: "mastered", updatedAt: "2026-07-05T09:00:00.000Z" })
    ];
    const result = buildProgressSection({
      debts, attempts: [], profilesByDebtId: new Map(), snapshots: [], period: WEEK
    });
    expect(result.masteredDebts).toHaveLength(1);
    expect(result.masteredDebts[0].debtId).toBe("d1");
    expect(result.insufficientData).toBe(false);
  });

  it("提示依赖转独立：周期内独立通过后段训练且历史曾高度依赖提示", () => {
    const debts = [makeDebt({ id: "d1", gapText: "不理解 CORS" }), makeDebt({ id: "d2", gapText: "不理解 TLS" })];
    const attempts = [
      // d1：历史高度依赖 → 本周独立通过 delayed_recall ✓
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 85 }, completedAt: "2026-07-20T09:00:00.000Z" }),
      makeAttempt("d1", { evaluation: { passed: true, hintDependency: 30 }, completedAt: "2026-08-04T09:00:00.000Z" }),
      // d2：本周独立通过，但无历史依赖记录 ✗
      makeAttempt("d2", { evaluation: { passed: true, hintDependency: 20 }, completedAt: "2026-08-05T09:00:00.000Z" })
    ];
    const result = buildProgressSection({
      debts, attempts, profilesByDebtId: new Map(), snapshots: [], period: WEEK
    });
    expect(result.hintToIndependent).toHaveLength(1);
    expect(result.hintToIndependent[0].debtId).toBe("d1");
    expect(result.hintToIndependent[0].gapText).toContain("CORS");
  });

  it("迁移训练通过：scenario_transfer / error_detection 通过后记入", () => {
    const debts = [makeDebt({ id: "d1" }), makeDebt({ id: "d2" })];
    const attempts = [
      makeAttempt("d1", { trainingStage: "scenario_transfer", evaluation: { passed: true, hintDependency: 20 }, completedAt: "2026-08-04T09:00:00.000Z" }),
      makeAttempt("d2", { trainingStage: "scenario_transfer", evaluation: { passed: false, hintDependency: 20 }, completedAt: "2026-08-05T09:00:00.000Z" })
    ];
    const result = buildProgressSection({
      debts, attempts, profilesByDebtId: new Map(), snapshots: [], period: WEEK
    });
    expect(result.transferPassed).toHaveLength(1);
    expect(result.transferPassed[0].debtId).toBe("d1");
    expect(result.transferPassed[0].stage).toBe("scenario_transfer");
  });

  it("六维聚合与上一周快照对比：overallDelta 为当前值减上一周期加权值", () => {
    const debts = [makeDebt({ id: "d1" }), makeDebt({ id: "d2" })];
    const profiles = mapFrom([
      makeProfile("d1", { overallMastery: 60 }),
      makeProfile("d2", { overallMastery: 80 })
    ], item => item.cognitiveDebtId);
    const snapshots = [
      {
        periodStart: "2026-07-27T00:00:00.000Z",
        periodEnd: "2026-08-03T00:00:00.000Z",
        skillSummaryJson: {
          skills: [{ skillNodeKey: "k1", averageOverallMastery: 50, relatedDebtCount: 2 }]
        }
      }
    ];
    const result = buildProgressSection({
      debts, attempts: [], profilesByDebtId: profiles, snapshots, period: WEEK
    });
    expect(result.mastery.current.overallMastery).toBe(70);
    expect(result.mastery.previousOverallMastery).toBe(50);
    expect(result.mastery.overallDelta).toBe(20);
    expect(result.mastery.comparedSnapshotPeriodStart).toBe("2026-07-27T00:00:00.000Z");
  });

  it("无任何数据时 insufficientData", () => {
    const result = buildProgressSection({
      debts: [], attempts: [], profilesByDebtId: new Map(), snapshots: [], period: WEEK
    });
    expect(result.insufficientData).toBe(true);
    expect(result.mastery).toBeNull();
  });
});

// ─── buildNextFocusSection：下周重点（复用学习编排） ───

describe("buildNextFocusSection — 下周重点来自学习编排推荐", () => {
  it("缺少 orchestratorStore / trainingStore 时标记 insufficientData", async () => {
    const result = await buildNextFocusSection("user-1", {}, { now: NOW });
    expect(result.insufficientData).toBe(true);
    expect(result.theme).toBeNull();
    expect(result.tasks).toEqual([]);
  });

  it("有到期复习任务时产出主题、优先任务、预计时间与推荐原因", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt({ id: "debt-1", gapText: "不理解 CORS 预检请求为什么失败" }));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-1"));

    const result = await buildNextFocusSection("user-1", stores, { now: NOW });
    expect(result.insufficientData).toBe(false);
    expect(result.theme.skillNodeId).toBe("software_engineering.frontend");
    expect(result.theme.displayName).toBeTruthy();
    expect(result.tasks.length).toBeGreaterThanOrEqual(1);
    expect(result.tasks[0].debtId).toBe("debt-1");
    expect(result.tasks[0].recommendationId).toBeTruthy();
    expect(result.totalEstimatedMinutes).toBeGreaterThan(0);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ─── buildMonthlyReport：月度快照对比 ───

function makeMonthlySnapshot(periodStart, overrides = {}) {
  return {
    id: `snap-${periodStart}`,
    userId: "user-1",
    snapshotType: "monthly",
    periodStart,
    periodEnd: overrides.periodEnd || "2026-08-01T00:00:00.000Z",
    skillSummaryJson: {
      skills: [
        {
          skillNodeKey: "software_engineering.frontend",
          displayName: "软件工程 / 前端",
          relatedDebtCount: 4,
          masteredRatio: 0.5,
          averageOverallMastery: 60,
          relapsedDebtCount: 1,
          trend: "improving",
          ...(overrides.skill || {})
        }
      ]
    },
    learningBehaviorSummaryJson: {
      totalAttempts: 10,
      transferPassRate: { passRate: 0.4, attempts: 5, passed: 2 },
      hintDependencyTrend: "improving",
      ...(overrides.learning || {})
    },
    gapPatternSummaryJson: {
      distribution: [
        { mechanism: "concept_gap", count: 3, share: 0.6 },
        { mechanism: "rationale_gap", count: 2, share: 0.4 }
      ],
      ...(overrides.patterns || {})
    },
    calculationVersion: "cognitive-profile/v1",
    createdAt: periodStart
  };
}

describe("buildMonthlyReport — 两个月度快照对比", () => {
  it("不足两个月度快照时整体 insufficientData，各节标记数据不足", async () => {
    const stores = await freshStores();
    await stores.profileStore.saveSnapshot(makeMonthlySnapshot("2026-08-01T00:00:00.000Z"));
    const result = await buildMonthlyReport("user-1", MONTH, { ...stores, now: NOW });
    expect(result.insufficientData).toBe(true);
    expect(result.comparedPeriods).toBeNull();
    expect(result.inputs.insufficientData).toBe(true);
    expect(result.training.insufficientData).toBe(true);
    expect(result.patterns.insufficientData).toBe(true);
    expect(result.progress.insufficientData).toBe(true);
    expect(result.nextFocus.insufficientData).toBe(true);
  });

  it("两个月度快照：领域掌握变化、迁移通过率、复发率与机制分布对比", async () => {
    const stores = await freshStores();
    await stores.profileStore.saveSnapshot(makeMonthlySnapshot("2026-07-01T00:00:00.000Z", {
      periodEnd: "2026-08-01T00:00:00.000Z",
      skill: { masteredRatio: 0.25, averageOverallMastery: 40, relapsedDebtCount: 2 },
      learning: { totalAttempts: 6, transferPassRate: { passRate: 0.2, attempts: 5, passed: 1 } }
    }));
    await stores.profileStore.saveSnapshot(makeMonthlySnapshot("2026-08-01T00:00:00.000Z", {
      periodEnd: "2026-09-01T00:00:00.000Z",
      skill: { masteredRatio: 0.5, averageOverallMastery: 60, relapsedDebtCount: 1 },
      learning: { totalAttempts: 10, transferPassRate: { passRate: 0.4, attempts: 5, passed: 2 } }
    }));

    const result = await buildMonthlyReport("user-1", MONTH, { ...stores, now: NOW });
    expect(result.insufficientData).toBe(false);
    expect(result.comparedPeriods.current.periodStart).toBe("2026-08-01T00:00:00.000Z");
    expect(result.comparedPeriods.previous.periodStart).toBe("2026-07-01T00:00:00.000Z");

    const change = result.inputs.skillChanges[0];
    expect(change.skillNodeKey).toBe("software_engineering.frontend");
    expect(change.masteredRatioBefore).toBe(0.25);
    expect(change.masteredRatioAfter).toBe(0.5);
    expect(change.delta).toBe(0.25);

    expect(result.training.attemptsBefore).toBe(6);
    expect(result.training.attemptsAfter).toBe(10);
    expect(result.training.transferPassRateBefore).toBe(0.2);
    expect(result.training.transferPassRateAfter).toBe(0.4);
    expect(result.training.transferDelta).toBe(0.2);

    expect(result.progress.overallMasteryBefore).toBe(40);
    expect(result.progress.overallMasteryAfter).toBe(60);
    expect(result.progress.overallDelta).toBe(20);
    expect(result.progress.relapseRateBefore).toBe(0.5);
    expect(result.progress.relapseRateAfter).toBe(0.25);
    expect(result.progress.relapseDelta).toBe(-0.25);

    expect(result.patterns.mechanismAfter[0].mechanism).toBe("concept_gap");
  });
});

// ─── 确定性 summaryText 模板 ───

describe("buildWeeklySummaryText / buildMonthlySummaryText — 确定性模板", () => {
  it("周报模板包含周期、新增欠条数、通过率、最弱维度与下周重点", () => {
    const text = buildWeeklySummaryText({
      period: WEEK,
      inputs: {
        insufficientData: false,
        newDebtCount: 2,
        domainDistribution: [{ skillNodeKey: "k", displayName: "软件工程 / 前端", count: 2 }],
        topSources: [{ source: "report-a", count: 2 }]
      },
      training: {
        insufficientData: false,
        totalAttempts: 4,
        passedAttempts: 3,
        averageHintsPerAttempt: 1.5,
        relapsedDebtCount: 1
      },
      patterns: {
        insufficientData: false,
        topMechanism: { key: "concept_gap", label: "概念缺口", count: 2 },
        recurringClusters: [{ clusterId: "c1" }],
        highRiskDebts: [{ debtId: "d1" }],
        weakestDimension: { dimension: "transferAbility", label: "迁移能力", value: 20 }
      },
      progress: {
        insufficientData: false,
        mastery: { current: { overallMastery: 70 }, overallDelta: 10 },
        masteredDebts: [{ debtId: "d1" }],
        hintToIndependent: [],
        transferPassed: []
      },
      nextFocus: {
        insufficientData: false,
        theme: { skillNodeId: "k", displayName: "软件工程 / 前端" },
        tasks: [{ debtId: "d1" }],
        totalEstimatedMinutes: 15
      }
    });
    expect(text).toContain("本周（08-03 ~ 08-10）新增 2 张认知欠条");
    expect(text).toContain("「软件工程 / 前端」（2 张）");
    expect(text).toContain("report-a（2 张）");
    expect(text).toContain("完成 4 次训练，通过率 75%");
    expect(text).toContain("平均每次使用 1.5 次提示");
    expect(text).toContain("1 张欠条出现复发");
    expect(text).toContain("最高频机制是「概念缺口」");
    expect(text).toContain("当前最弱维度是「迁移能力」(20)");
    expect(text).toContain("提升 10 分（当前 70）");
    expect(text).toContain("1 张欠条进入已掌握");
    expect(text).toContain("下周重点：「软件工程 / 前端」，1 个优先任务，预计 15 分钟");
  });

  it("周报模板在数据不足时只陈述事实，不编造内容", () => {
    const text = buildWeeklySummaryText({
      period: WEEK,
      inputs: { insufficientData: true },
      training: { insufficientData: true },
      patterns: { insufficientData: true },
      progress: { insufficientData: true },
      nextFocus: { insufficientData: true }
    });
    expect(text).toContain("没有新增认知欠条");
    expect(text).toContain("本周没有完成训练");
    expect(text).not.toContain("下周重点");
  });

  it("月报模板在快照不足时明确说明原因", () => {
    const text = buildMonthlySummaryText({ period: MONTH, insufficientData: true });
    expect(text).toContain("月度报告数据不足");
    expect(text).toContain("至少两个月度画像快照");
  });

  it("月报模板包含领域升降、六维变化、迁移与复发率对比", () => {
    const text = buildMonthlySummaryText({
      period: MONTH,
      insufficientData: false,
      comparedPeriods: {},
      inputs: {
        skillChanges: [
          { skillNodeKey: "k1", displayName: "软件工程 / 前端", masteredRatioBefore: 0.25, masteredRatioAfter: 0.5, delta: 0.25 }
        ]
      },
      training: { transferPassRateBefore: 0.2, transferPassRateAfter: 0.4, transferDelta: 0.2 },
      patterns: { mechanismAfter: [{ mechanism: "concept_gap", label: "概念缺口", count: 3 }] },
      progress: {
        overallMasteryBefore: 40, overallMasteryAfter: 60, overallDelta: 20,
        relapseRateBefore: 0.5, relapseRateAfter: 0.25, relapseDelta: -0.25
      },
      nextFocus: { insufficientData: true }
    });
    expect(text).toContain("「软件工程 / 前端」(25%→50%)");
    expect(text).toContain("六维聚合掌握度 40 → 60（+20）");
    expect(text).toContain("迁移训练通过率 20% → 40%");
    expect(text).toContain("复发率 50% → 25%");
    expect(text).toContain("本月最高频机制是「概念缺口」（3 条独立证据）");
  });
});

// ─── 生成与幂等 ───

describe("generateWeeklyReport / getLatestWeeklyReport — 生成、幂等替换与 AI 回退", () => {
  async function seedWeeklyData(stores) {
    await stores.trainingStore.saveCognitiveDebt(makeDebt({ id: "debt-1", gapText: "不理解 CORS 预检请求" }));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-1"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-1"));
  }

  it("生成并保存当前周期周报：五节结构、计算版本与确定性摘要", async () => {
    const stores = await freshStores();
    await seedWeeklyData(stores);
    const report = await generateWeeklyReport("user-1", stores, { now: NOW });
    expect(report.reportType).toBe("weekly");
    expect(report.periodStart).toBe(WEEK.periodStart);
    expect(report.periodEnd).toBe(WEEK.periodEnd);
    expect(report.calculationVersion).toBe(CALCULATION_VERSION);
    expect(report.inputsJson.newDebtCount).toBe(1);
    expect(report.nextFocusJson.insufficientData).toBe(false);
    expect(report.summaryText).toContain("新增 1 张认知欠条");
    expect(stores.store.findReport("user-1", "weekly", WEEK.periodStart).id).toBe(report.id);
  });

  it("同周期重算整体替换（新 id），历史周期报告不被触碰", async () => {
    const stores = await freshStores();
    await seedWeeklyData(stores);
    // 手工落一份历史周期报告
    const historical = await stores.store.saveReport({
      id: "report-historical",
      userId: "user-1",
      reportType: "weekly",
      periodStart: "2026-07-27T00:00:00.000Z",
      periodEnd: "2026-08-03T00:00:00.000Z",
      summaryText: "历史周报",
      calculationVersion: CALCULATION_VERSION,
      createdAt: "2026-07-28T00:00:00.000Z"
    });

    const first = await generateWeeklyReport("user-1", stores, { now: NOW });
    const second = await generateWeeklyReport("user-1", stores, { now: NOW });
    expect(second.id).not.toBe(first.id);
    expect(second.periodStart).toBe(first.periodStart);

    const weeklyReports = stores.store.listReports("user-1", { reportType: "weekly" });
    expect(weeklyReports).toHaveLength(2); // 当前周期 1 份 + 历史 1 份
    expect(weeklyReports.filter(item => item.periodStart === WEEK.periodStart)).toHaveLength(1);
    const untouched = stores.store.getReport(historical.id, "user-1");
    expect(untouched.summaryText).toBe("历史周报");
    expect(untouched.createdAt).toBe("2026-07-28T00:00:00.000Z");
  });

  it("getLatestWeeklyReport 首次读时生成，之后同周期直接返回已有报告", async () => {
    const stores = await freshStores();
    await seedWeeklyData(stores);
    const first = await getLatestWeeklyReport("user-1", stores, { now: NOW });
    expect(first.generated).toBe(true);
    const second = await getLatestWeeklyReport("user-1", stores, { now: NOW });
    expect(second.generated).toBe(false);
    expect(second.report.id).toBe(first.report.id);
  });

  it("chatFn 润色成功时摘要被改写，失败 / fallback / 过短时回退确定性模板", async () => {
    const storesA = await freshStores();
    await seedWeeklyData(storesA);
    const polished = await generateWeeklyReport("user-1", storesA, {
      now: NOW,
      chatFn: async () => ({ summary: "本周你新增了 1 张认知欠条，主要集中在软件工程前端方向，继续保持训练节奏。" })
    });
    expect(polished.summaryText).toContain("本周你新增了 1 张认知欠条");
    expect(polished.summaryText).not.toContain("本周（08-03");

    const storesB = await freshStores();
    await seedWeeklyData(storesB);
    const throwing = await generateWeeklyReport("user-1", storesB, {
      now: NOW,
      chatFn: async () => { throw new Error("network down"); }
    });
    expect(throwing.summaryText).toContain("本周（08-03 ~ 08-10）新增 1 张认知欠条");

    const storesC = await freshStores();
    await seedWeeklyData(storesC);
    const fallbackMarked = await generateWeeklyReport("user-1", storesC, {
      now: NOW,
      chatFn: async () => ({ __fallback: true })
    });
    expect(fallbackMarked.summaryText).toContain("本周（08-03 ~ 08-10）");

    const storesD = await freshStores();
    await seedWeeklyData(storesD);
    const tooShort = await generateWeeklyReport("user-1", storesD, {
      now: NOW,
      chatFn: async () => ({ summary: "短" })
    });
    expect(tooShort.summaryText).toContain("本周（08-03 ~ 08-10）");
  });
});

describe("generateMonthlyReport / getLatestMonthlyReport — 月报生成与幂等", () => {
  it("月报按当前月周期保存，同周期幂等替换；快照不足时摘要明确数据不足", async () => {
    const stores = await freshStores();
    const first = await generateMonthlyReport("user-1", stores, { now: NOW });
    expect(first.reportType).toBe("monthly");
    expect(first.periodStart).toBe(MONTH.periodStart);
    expect(first.periodEnd).toBe(MONTH.periodEnd);
    expect(first.calculationVersion).toBe(CALCULATION_VERSION);
    expect(first.inputsJson.insufficientData).toBe(true);
    expect(first.summaryText).toContain("月度报告数据不足");

    const second = await getLatestMonthlyReport("user-1", stores, { now: NOW });
    expect(second.generated).toBe(false);
    expect(second.report.id).toBe(first.id);
    expect(stores.store.listReports("user-1", { reportType: "monthly" })).toHaveLength(1);
  });

  it("月报内容来自最近两个月度快照对比", async () => {
    const stores = await freshStores();
    await stores.profileStore.saveSnapshot(makeMonthlySnapshot("2026-07-01T00:00:00.000Z", {
      periodEnd: "2026-08-01T00:00:00.000Z",
      skill: { masteredRatio: 0.25, averageOverallMastery: 40 }
    }));
    await stores.profileStore.saveSnapshot(makeMonthlySnapshot("2026-08-01T00:00:00.000Z", {
      periodEnd: "2026-09-01T00:00:00.000Z",
      skill: { masteredRatio: 0.5, averageOverallMastery: 60 }
    }));
    const report = await generateMonthlyReport("user-1", stores, { now: NOW });
    expect(report.inputsJson.skillChanges[0].delta).toBe(0.25);
    expect(report.progressJson.overallDelta).toBe(20);
    expect(report.summaryText).toContain("六维聚合掌握度 40 → 60");
  });
});

// ─── store 字段校验 ───

describe("cognitive-reports-store — 字段校验与隔离", () => {
  it("reportType 非法 / 缺 userId / 缺 periodStart 时拒绝保存", async () => {
    const stores = await freshStores();
    await expect(stores.store.saveReport({ id: "r1", userId: "user-1", reportType: "daily", periodStart: "x" }))
      .rejects.toThrow("reportType must be weekly or monthly");
    await expect(stores.store.saveReport({ id: "r2", userId: "", reportType: "weekly", periodStart: "x" }))
      .rejects.toThrow("userId is required");
    await expect(stores.store.saveReport({ id: "r3", userId: "user-1", reportType: "weekly", periodStart: "" }))
      .rejects.toThrow("periodStart is required");
  });

  it("listReports 按周期新到旧排序且按用户隔离", async () => {
    const stores = await freshStores();
    await stores.store.saveReport({
      id: "r-a", userId: "user-1", reportType: "weekly",
      periodStart: "2026-07-27T00:00:00.000Z", summaryText: "旧", createdAt: "2026-07-28T00:00:00.000Z"
    });
    await stores.store.saveReport({
      id: "r-b", userId: "user-1", reportType: "weekly",
      periodStart: "2026-08-03T00:00:00.000Z", summaryText: "新", createdAt: "2026-08-04T00:00:00.000Z"
    });
    await stores.store.saveReport({
      id: "r-c", userId: "user-2", reportType: "weekly",
      periodStart: "2026-08-03T00:00:00.000Z", summaryText: "他人", createdAt: "2026-08-04T00:00:00.000Z"
    });
    const list = stores.store.listReports("user-1", { reportType: "weekly" });
    expect(list.map(item => item.id)).toEqual(["r-b", "r-a"]);
    expect(stores.store.getReport("r-c", "user-1")).toBeNull();
    expect(stores.store.getReport("r-c", "user-2").id).toBe("r-c");
  });
});
