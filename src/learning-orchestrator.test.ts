// @ts-nocheck
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  SCORING_WEIGHTS,
  MAX_CORE_RECOMMENDATIONS,
  gatherCandidates,
  scoreCandidate,
  selectRecommendedStage,
  generateRecommendations,
  getTodayRecommendations,
  syncRecommendationStatuses,
  acceptRecommendation,
  skipRecommendation
} from "../learning-orchestrator.js";
import { createLearningOrchestratorStore } from "../learning-orchestrator-store.js";
import { createTrainingStore } from "../training-store.js";
import { createDebtIntelligenceStore } from "../debt-intelligence-store.js";
import { createConceptGraphStore } from "../concept-graph-store.js";

const tmpDir = path.join(os.tmpdir(), `mindiou-learning-orchestrator-test-${process.pid}`);
const orchestratorPath = path.join(tmpDir, "learning-orchestrator-store.json");
const trainingPath = path.join(tmpDir, "training-store.json");
const intelPath = path.join(tmpDir, "debt-intelligence-store.json");
const graphPath = path.join(tmpDir, "concept-graph-store.json");

const NOW = "2026-08-04T12:00:00.000Z";

async function freshStores() {
  await mkdir(tmpDir, { recursive: true });
  const orchestratorStore = createLearningOrchestratorStore(orchestratorPath);
  const trainingStore = createTrainingStore(trainingPath);
  const intelligenceStore = createDebtIntelligenceStore(intelPath);
  const graphStore = createConceptGraphStore(graphPath);
  await Promise.all([
    orchestratorStore.load(),
    trainingStore.load(),
    intelligenceStore.load(),
    graphStore.load()
  ]);
  return { orchestratorStore, trainingStore, intelligenceStore, graphStore };
}

function makeDeps(stores) {
  return {
    store: stores.orchestratorStore,
    trainingStore: stores.trainingStore,
    intelligenceStore: stores.intelligenceStore,
    graphStore: stores.graphStore
  };
}

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function makeDebt(id, overrides = {}) {
  return {
    id,
    userId: "user-1",
    reportId: "report-1",
    gapText: "不理解 CORS 预检请求为什么失败",
    gapEvidence: "用户直接复制了 AI 给出的配置",
    status: "new",
    recurrenceCount: 0,
    sourceReports: ["report-1"],
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-03T09:00:00.000Z",
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
    riskTypes: ["quality_risk"],
    transferValue: 3,
    concepts: [{ key: "cors", displayName: "CORS 跨域资源共享" }],
    prerequisiteConcepts: [],
    classificationConfidence: 0.8,
    evidence: [{ note: "证据", source: "gap_evidence" }],
    taxonomyVersion: "debt-intelligence-taxonomy/v1",
    promptVersion: "debt-intelligence/v1",
    modelName: "test-model",
    isUserCorrected: false,
    isCurrent: true,
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides
  };
}

function makeProfile(debtId, overrides = {}) {
  return {
    cognitiveDebtId: debtId,
    conceptualUnderstanding: 40,
    independentRecall: 30,
    hintIndependence: 50,
    misconceptionResistance: 20,
    transferAbility: 10,
    retentionStrength: 10,
    overallMastery: 27,
    currentStage: 1,
    successfulAttempts: 0,
    failedAttempts: 1,
    relapseCount: 0,
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
    prompt: "不看之前的材料，用你自己的话解释：CORS",
    hintsAllowed: false,
    maxHints: 0,
    createdAt: "2026-08-01T09:00:00.000Z",
    dueAt: "2026-08-03T12:00:00.000Z",
    status: "pending",
    ...overrides
  };
}

// ─── scoreCandidate：优先级基础分全部由代码计算 ───

describe("scoreCandidate — 七因子加权打分", () => {
  it("全部因子满分时 priorityScore = 1，且各因子记录在 scoreFactorsJson", () => {
    const candidate = {
      recommendationType: "due_review",
      primaryDebtId: "debt-1",
      reviewTask: { dueAt: "2026-08-01T12:00:00.000Z" } // 逾期满 3 天
    };
    const context = {
      debtById: new Map([["debt-1", {
        id: "debt-1", status: "relapsed", recurrenceCount: 3,
        updatedAt: "2026-08-03T12:00:00.000Z"
      }]]),
      profiles: new Map([["debt-1", { relapseCount: 2 }]]),
      analyses: new Map([["debt-1", { riskTypes: ["security_risk"], transferValue: 5 }]]),
      blockingCountByDebtId: new Map([["debt-1", 2]]),
      nowMs: Date.parse(NOW)
    };
    const { priorityScore, scoreFactorsJson } = scoreCandidate(candidate, context);
    expect(scoreFactorsJson).toEqual({
      reviewUrgency: 1,
      riskScore: 1,
      relapseScore: 1,
      currentProjectRelevance: 1,
      recurrenceFrequency: 1,
      prerequisiteBlocking: 1,
      transferValue: 1
    });
    expect(priorityScore).toBe(1);
  });

  it("无任务/无画像/无分类时全部因子为 0", () => {
    const candidate = { recommendationType: "transfer_training", primaryDebtId: "debt-x" };
    const context = {
      debtById: new Map(),
      profiles: new Map(),
      analyses: new Map(),
      blockingCountByDebtId: new Map(),
      nowMs: Date.parse(NOW)
    };
    const { priorityScore, scoreFactorsJson } = scoreCandidate(candidate, context);
    expect(priorityScore).toBe(0);
    for (const key of Object.keys(SCORING_WEIGHTS)) {
      expect(scoreFactorsJson[key]).toBe(0);
    }
  });

  it("部分因子按权重加权求和", () => {
    const candidate = {
      recommendationType: "due_review",
      primaryDebtId: "debt-1",
      reviewTask: { dueAt: "2026-08-02T12:00:00.000Z" } // 逾期 2 天 → 2/3
    };
    const context = {
      debtById: new Map([["debt-1", {
        id: "debt-1", status: "review_due", recurrenceCount: 0,
        updatedAt: "2026-07-20T12:00:00.000Z" // 15 天前 → 0.5
      }]]),
      profiles: new Map(),
      analyses: new Map([["debt-1", { riskTypes: ["quality_risk"], transferValue: 2 }]]),
      blockingCountByDebtId: new Map(),
      nowMs: Date.parse(NOW)
    };
    const { priorityScore, scoreFactorsJson } = scoreCandidate(candidate, context);
    expect(scoreFactorsJson.reviewUrgency).toBeCloseTo(0.667, 3);
    expect(scoreFactorsJson.riskScore).toBe(0.5);
    expect(scoreFactorsJson.relapseScore).toBe(0);
    expect(scoreFactorsJson.currentProjectRelevance).toBe(0.5);
    expect(scoreFactorsJson.transferValue).toBe(0.4);
    const expected =
      SCORING_WEIGHTS.reviewUrgency * (2 / 3)
      + SCORING_WEIGHTS.riskScore * 0.5
      + SCORING_WEIGHTS.currentProjectRelevance * 0.5
      + SCORING_WEIGHTS.transferValue * 0.4;
    expect(priorityScore).toBeCloseTo(expected, 2);
  });
});

// ─── selectRecommendedStage：最弱维度映射 ───

describe("selectRecommendedStage — 按最弱维度推荐训练阶段", () => {
  it("无画像默认首次补偿训练", () => {
    expect(selectRecommendedStage(null)).toBe("initial_compensation");
  });

  it("最弱维度为迁移能力时推荐场景迁移", () => {
    expect(selectRecommendedStage(makeProfile("d", {
      conceptualUnderstanding: 60,
      independentRecall: 60,
      hintIndependence: 60,
      misconceptionResistance: 60,
      transferAbility: 30,
      retentionStrength: 60
    }))).toBe("scenario_transfer");
  });

  it("六维均 ≥70 推荐真实工作验证", () => {
    expect(selectRecommendedStage(makeProfile("d", {
      conceptualUnderstanding: 70,
      independentRecall: 80,
      hintIndependence: 75,
      misconceptionResistance: 90,
      transferAbility: 72,
      retentionStrength: 85
    }))).toBe("real_work_validation");
  });
});

// ─── gatherCandidates：五类候选来源 ───

describe("gatherCandidates — 五类候选来源", () => {
  it("A：到期复训任务生成 due_review 候选并携带现有任务 id", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    const { candidates } = gatherCandidates("user-1", makeDeps(stores), NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].recommendationType).toBe("due_review");
    expect(candidates[0].existingReviewTaskId).toBe("task-1");
  });

  it("A：未到期的任务不产生候选（不重算复训日期）", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1", {
      dueAt: "2026-08-10T12:00:00.000Z"
    }));
    const { candidates } = gatherCandidates("user-1", makeDeps(stores), NOW);
    expect(candidates).toHaveLength(0);
  });

  it("B：高风险未稳定欠条生成 real_work_validation 候选；已掌握的除外", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-risk"));
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-mastered", { status: "mastered" }));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-risk", { riskTypes: ["security_risk"] }));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-mastered", { riskTypes: ["privacy_risk"] }));
    const { candidates } = gatherCandidates("user-1", makeDeps(stores), NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].recommendationType).toBe("real_work_validation");
    expect(candidates[0].primaryDebtId).toBe("debt-risk");
  });

  it("C：≥2 张欠条的簇生成 cluster_consolidation 候选", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-a"));
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-b"));
    await stores.graphStore.saveDebtCluster({
      id: "cluster-1", userId: "user-1", title: "CORS 问题簇", clusterType: "same_concept"
    });
    await stores.graphStore.saveDebtClusterMember({ clusterId: "cluster-1", cognitiveDebtId: "debt-a" });
    await stores.graphStore.saveDebtClusterMember({ clusterId: "cluster-1", cognitiveDebtId: "debt-b" });
    const { candidates } = gatherCandidates("user-1", makeDeps(stores), NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].recommendationType).toBe("cluster_consolidation");
    expect(candidates[0].clusterId).toBe("cluster-1");
    expect(candidates[0].relatedDebtIds).toHaveLength(1);
  });

  it("D：前置关系阻塞方掌握度 <60 生成 prerequisite_training 候选", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-blocker"));
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-blocked"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-blocker", { overallMastery: 40 }));
    await stores.graphStore.saveDebtRelation({
      id: "rel-1", userId: "user-1",
      sourceDebtId: "debt-blocker", targetDebtId: "debt-blocked",
      relationType: "prerequisite_of", status: "auto_confirmed"
    });
    const { candidates } = gatherCandidates("user-1", makeDeps(stores), NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].recommendationType).toBe("prerequisite_training");
    expect(candidates[0].primaryDebtId).toBe("debt-blocker");
    expect(candidates[0].blockedCount).toBe(1);
  });

  it("D：阻塞方掌握度 ≥60 不推荐", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-blocker"));
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-blocked"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-blocker", { overallMastery: 75 }));
    await stores.graphStore.saveDebtRelation({
      id: "rel-1", userId: "user-1",
      sourceDebtId: "debt-blocker", targetDebtId: "debt-blocked",
      relationType: "prerequisite_of", status: "user_confirmed"
    });
    const { candidates } = gatherCandidates("user-1", makeDeps(stores), NOW);
    expect(candidates).toHaveLength(0);
  });

  it("E：理解与回忆达标但迁移不足生成 transfer_training 候选", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-1", {
      conceptualUnderstanding: 65,
      independentRecall: 70,
      transferAbility: 30
    }));
    const { candidates } = gatherCandidates("user-1", makeDeps(stores), NOW);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].recommendationType).toBe("transfer_training");
  });
});

// ─── generateRecommendations：幂等、上限、每周重点、AI 润色回退 ───

describe("generateRecommendations — 生成与幂等", () => {
  it("到期任务生成推荐，重复调用不重复生成", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    const deps = makeDeps(stores);

    const first = await generateRecommendations("user-1", deps, { now: NOW });
    expect(first.created).toBe(1);
    const second = await generateRecommendations("user-1", deps, { now: NOW });
    expect(second.created).toBe(0);

    const recs = stores.orchestratorStore.listRecommendations("user-1");
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendationType).toBe("due_review");
    expect(recs[0].existingReviewTaskId).toBe("task-1");
    expect(recs[0].reason).toContain("逾期 1 天");
    expect(recs[0].scoreFactorsJson.reviewUrgency).toBeGreaterThan(0);
  });

  it("核心推荐上限为 3 条", async () => {
    const stores = await freshStores();
    for (let i = 1; i <= 5; i++) {
      await stores.trainingStore.saveCognitiveDebt(makeDebt(`debt-${i}`));
      await stores.trainingStore.saveReviewTask(makeTask(`task-${i}`, `debt-${i}`));
    }
    const result = await generateRecommendations("user-1", makeDeps(stores), { now: NOW });
    expect(result.created).toBe(MAX_CORE_RECOMMENDATIONS);
    expect(stores.orchestratorStore.listRecommendations("user-1")).toHaveLength(3);
  });

  it("每周学习重点聚合最高优先能力主题，同周幂等", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-1"));
    const deps = makeDeps(stores);

    await generateRecommendations("user-1", deps, { now: NOW });
    const focuses = stores.orchestratorStore.listRecommendations("user-1", { recommendationType: "weekly_focus" });
    expect(focuses).toHaveLength(1);
    expect(focuses[0].skillNodeId).toBe("software_engineering.frontend");
    expect(focuses[0].title).toContain("本周学习重点");
    expect(focuses[0].relatedDebtIds).toContain("debt-1");

    await generateRecommendations("user-1", deps, { now: NOW });
    expect(
      stores.orchestratorStore.listRecommendations("user-1", { recommendationType: "weekly_focus" })
    ).toHaveLength(1);
  });

  it("chatFn 抛异常时回退到确定性 reason 模板", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    const failingChat = async () => { throw new Error("model unavailable"); };
    const result = await generateRecommendations("user-1", makeDeps(stores), {
      now: NOW,
      chatFn: failingChat
    });
    expect(result.created).toBe(1);
    const rec = stores.orchestratorStore.listRecommendations("user-1")[0];
    expect(rec.reason).toContain("逾期 1 天");
  });
});

// ─── getTodayRecommendations：读时生成 + generated→viewed ───

describe("getTodayRecommendations — 查询载荷与已读标记", () => {
  it("返回推荐与每周重点，首次读取将 generated 标记为 viewed", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-1"));

    const result = await getTodayRecommendations("user-1", makeDeps(stores), { now: NOW });
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].status).toBe("viewed");
    expect(result.recommendations[0].debtSummary.id).toBe("debt-1");
    expect(result.recommendations[0].reviewTask.id).toBe("task-1");
    expect(result.recommendations[0].isWeeklyFocusRelated).toBe(true);
    expect(result.weeklyFocus).toBeTruthy();
  });

  it("accepted 推荐仍在列表中且带已创建的 reviewTaskId（前端据此走继续训练）", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-1"));
    const deps = makeDeps(stores);
    const first = await getTodayRecommendations("user-1", deps, { now: NOW });
    const rec = first.recommendations[0];

    await acceptRecommendation({
      store: stores.orchestratorStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      recommendationId: rec.id,
      now: NOW
    });

    // accept 后未提交训练再次读取：推荐保留，状态 accepted，reviewTaskId 可用
    const refreshed = await getTodayRecommendations("user-1", deps, { now: NOW });
    const stillThere = refreshed.recommendations.find(item => item.id === rec.id);
    expect(stillThere).toBeDefined();
    expect(stillThere.status).toBe("accepted");
    expect(stillThere.existingReviewTaskId).toBe("task-1");
    expect(stillThere.reviewTask?.id).toBe("task-1");
  });
});

// ─── syncRecommendationStatuses：状态懒更新 ───

describe("syncRecommendationStatuses — 读时联动", () => {
  it("关联任务完成后推荐标记 completed，超期推荐标记 expired", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    const deps = makeDeps(stores);
    await generateRecommendations("user-1", deps, { now: NOW });

    // 任务完成 → completed
    const task = stores.trainingStore.getReviewTask("task-1", "user-1");
    task.status = "completed";
    await stores.trainingStore.saveReviewTask(task);

    // 手工插入一条已过期的非到期推荐 → expired
    await stores.orchestratorStore.saveRecommendation({
      id: "rec-expired",
      userId: "user-1",
      recommendationType: "transfer_training",
      primaryDebtId: "debt-1",
      title: "过期推荐",
      reason: "测试",
      priorityScore: 0.5,
      scoreFactorsJson: {},
      estimatedMinutes: 3,
      status: "generated",
      scoringVersion: "learning-orchestrator/v1",
      generatedAt: "2026-07-20T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z"
    });

    const changed = await syncRecommendationStatuses("user-1", deps, NOW);
    expect(changed).toBe(2);
    const recs = stores.orchestratorStore.listRecommendations("user-1");
    const dueRec = recs.find(item => item.recommendationType === "due_review");
    expect(dueRec.status).toBe("completed");
    expect(dueRec.completedAt).toBeTruthy();
    expect(recs.find(item => item.id === "rec-expired").status).toBe("expired");
  });
});

// ─── acceptRecommendation：复用现有 review start/submit 链路 ───

describe("acceptRecommendation — 接受推荐进入现有训练流程", () => {
  it("due_review 直接返回现有任务，绝不新建", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    const deps = makeDeps(stores);
    await generateRecommendations("user-1", deps, { now: NOW });
    const rec = stores.orchestratorStore.listRecommendations("user-1")[0];

    const result = await acceptRecommendation({
      store: stores.orchestratorStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      recommendationId: rec.id,
      now: NOW
    });
    expect(result.reviewTaskId).toBe("task-1");
    expect(result.reviewStartEndpoint).toBe("/api/training/reviews/task-1/start");
    expect(stores.trainingStore.listReviewTasks("user-1")).toHaveLength(1);
    expect(stores.orchestratorStore.getRecommendation(rec.id, "user-1").status).toBe("accepted");
  });

  it("非到期推荐按推荐阶段创建 dueAt=now 的复训任务", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-1"));
    await stores.intelligenceStore.saveAnalysis(makeAnalysis("debt-1", { riskTypes: ["security_risk"] }));
    const deps = makeDeps(stores);
    await generateRecommendations("user-1", deps, { now: NOW });
    const rec = stores.orchestratorStore
      .listRecommendations("user-1")
      .find(item => item.recommendationType === "real_work_validation");
    expect(rec).toBeTruthy();

    const result = await acceptRecommendation({
      store: stores.orchestratorStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      recommendationId: rec.id,
      now: NOW
    });
    expect(result.reviewTask).toBeTruthy();
    expect(result.reviewTask.cognitiveDebtId).toBe("debt-1");
    expect(result.reviewTask.status).toBe("pending");
    expect(Date.parse(result.reviewTask.dueAt) <= Date.parse(NOW)).toBe(true);
    // 新任务立即到期，出现在今日复训中
    expect(
      stores.trainingStore.listDueReviews("user-1", NOW).some(task => task.id === result.reviewTaskId)
    ).toBe(true);
  });

  it("已接受的推荐不能重复接受（409）", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    const deps = makeDeps(stores);
    await generateRecommendations("user-1", deps, { now: NOW });
    const rec = stores.orchestratorStore.listRecommendations("user-1")[0];
    const args = {
      store: stores.orchestratorStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      recommendationId: rec.id,
      now: NOW
    };
    await acceptRecommendation(args);
    await expect(acceptRecommendation(args)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("未知推荐 id 返回 404", async () => {
    const stores = await freshStores();
    await expect(acceptRecommendation({
      store: stores.orchestratorStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      recommendationId: "missing",
      now: NOW
    })).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ─── skipRecommendation：可跳过且幂等 ───

describe("skipRecommendation — 跳过推荐", () => {
  it("跳过记录 skipReason，重复跳过幂等返回", async () => {
    const stores = await freshStores();
    await stores.trainingStore.saveCognitiveDebt(makeDebt("debt-1"));
    await stores.trainingStore.saveReviewTask(makeTask("task-1", "debt-1"));
    const deps = makeDeps(stores);
    await generateRecommendations("user-1", deps, { now: NOW });
    const rec = stores.orchestratorStore.listRecommendations("user-1")[0];

    const first = await skipRecommendation({
      store: stores.orchestratorStore,
      userId: "user-1",
      recommendationId: rec.id,
      skipReason: "今天没时间",
      now: NOW
    });
    expect(first.alreadyResolved).toBe(false);
    expect(first.recommendation.status).toBe("skipped");
    expect(first.recommendation.skipReason).toBe("今天没时间");

    const second = await skipRecommendation({
      store: stores.orchestratorStore,
      userId: "user-1",
      recommendationId: rec.id,
      now: NOW
    });
    expect(second.alreadyResolved).toBe(true);

    // 跳过后可重新生成（不再占用活跃名额）
    const regenerated = await generateRecommendations("user-1", deps, { now: NOW });
    expect(regenerated.created).toBe(1);
  });
});

// ─── store：持久化与查重 ───

describe("learning-orchestrator-store — 持久化", () => {
  it("推荐记录落盘后可恢复，findActiveRecommendation 只在活跃期命中", async () => {
    const stores = await freshStores();
    await stores.orchestratorStore.saveRecommendation({
      id: "rec-1",
      userId: "user-1",
      recommendationType: "due_review",
      primaryDebtId: "debt-1",
      title: "到期复训：CORS",
      reason: "测试",
      priorityScore: 0.8,
      scoreFactorsJson: { reviewUrgency: 1 },
      estimatedMinutes: 3,
      status: "generated",
      scoringVersion: "learning-orchestrator/v1"
    });

    const reloaded = createLearningOrchestratorStore(orchestratorPath);
    await reloaded.load();
    const recovered = reloaded.getRecommendation("rec-1", "user-1");
    expect(recovered.title).toBe("到期复训：CORS");
    expect(reloaded.findActiveRecommendation("user-1", {
      primaryDebtId: "debt-1", recommendationType: "due_review"
    })?.id).toBe("rec-1");

    await reloaded.saveRecommendation({ ...recovered, status: "completed" });
    expect(reloaded.findActiveRecommendation("user-1", {
      primaryDebtId: "debt-1", recommendationType: "due_review"
    })).toBeNull();
    // 用户隔离
    expect(reloaded.getRecommendation("rec-1", "user-2")).toBeNull();
  });
});
