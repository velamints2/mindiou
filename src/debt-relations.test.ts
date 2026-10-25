// @ts-nocheck
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  PROMPT_VERSION,
  findCandidatePairs,
  conceptJaccard,
  textTokenSimilarity,
  cosineSimilarity,
  scorePairSimilarity,
  validateRelationJudgment,
  judgePairRelation,
  syncConceptsFromAnalysis,
  applyRecurrenceRelapse,
  detectRelations,
  confirmRelation,
  rejectRelation,
  rebuildUserClusters,
  deriveClusterMasterySummary
} from "../debt-relations.js";
import { createConceptGraphStore } from "../concept-graph-store.js";
import { createDebtIntelligenceStore } from "../debt-intelligence-store.js";
import { createTrainingStore } from "../training-store.js";

const tmpDir = path.join(os.tmpdir(), `mindiou-debt-relations-test-${process.pid}`);
const graphPath = path.join(tmpDir, "concept-graph-store.json");
const intelPath = path.join(tmpDir, "debt-intelligence-store.json");
const trainingPath = path.join(tmpDir, "training-store.json");

async function freshStores() {
  await mkdir(tmpDir, { recursive: true });
  const graphStore = createConceptGraphStore(graphPath);
  const intelligenceStore = createDebtIntelligenceStore(intelPath);
  const trainingStore = createTrainingStore(trainingPath);
  await Promise.all([graphStore.load(), intelligenceStore.load(), trainingStore.load()]);
  return { graphStore, intelligenceStore, trainingStore };
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
    updatedAt: "2026-08-01T09:00:00.000Z",
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
    prerequisiteConcepts: [{ key: "same-origin policy", displayName: "同源策略" }],
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
    conceptualUnderstanding: 60,
    independentRecall: 50,
    hintIndependence: 70,
    misconceptionResistance: 40,
    transferAbility: 80,
    retentionStrength: 80,
    overallMastery: 62,
    currentStage: 3,
    successfulAttempts: 2,
    failedAttempts: 0,
    relapseCount: 0,
    ...overrides
  };
}

async function seedDebt(trainingStore, intelligenceStore, debt, analysis) {
  await trainingStore.saveCognitiveDebt(debt);
  if (analysis) await intelligenceStore.saveAnalysis({ ...analysis, version: 1, isCurrent: true });
}

describe("findCandidatePairs — 规则召回", () => {
  it("同概念欠条命中候选，信号包含共享概念与同机制", () => {
    const debtA = makeDebt("debt-a", { createdAt: "2026-08-01T09:00:00.000Z" });
    const debtB = makeDebt("debt-b", {
      gapText: "不理解 CORS 预检的 405 报错",
      createdAt: "2026-08-03T09:00:00.000Z",
      sourceReports: ["report-2"],
      reportId: "report-2"
    });
    const analyses = { "debt-a": makeAnalysis("debt-a"), "debt-b": makeAnalysis("debt-b") };
    const pairs = findCandidatePairs({ debts: [debtA, debtB], analysesByDebtId: analyses, now: "2026-08-04T00:00:00.000Z" });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].signals.sharedConcepts).toContain("cors");
    expect(pairs[0].signals.sameGapMechanism).toBe(true);
    // 方向：较新的 debt-b 为 source
    expect(pairs[0].sourceId).toBe("debt-b");
    expect(pairs[0].targetId).toBe("debt-a");
  });

  it("不相关欠条不命中（不同领域、不同机制、无概念交集、不同项目）", () => {
    const debtA = makeDebt("debt-a");
    const debtB = makeDebt("debt-b", {
      gapText: "不理解财务报表中的折旧",
      reportId: "report-9",
      sourceReports: ["report-9"],
      createdAt: "2026-08-02T09:00:00.000Z"
    });
    const analyses = {
      "debt-a": makeAnalysis("debt-a"),
      "debt-b": makeAnalysis("debt-b", {
        domainPath: ["finance", "accounting"],
        primaryGapMechanism: "decision_gap",
        concepts: [{ key: "depreciation", displayName: "折旧" }],
        prerequisiteConcepts: []
      })
    };
    const pairs = findCandidatePairs({ debts: [debtA, debtB], analysesByDebtId: analyses, now: "2026-08-04T00:00:00.000Z" });
    expect(pairs).toHaveLength(0);
  });

  it("超出时间窗口的欠条对不命中", () => {
    const debtA = makeDebt("debt-a", { createdAt: "2026-01-01T09:00:00.000Z" });
    const debtB = makeDebt("debt-b", { createdAt: "2026-08-01T09:00:00.000Z" });
    const analyses = { "debt-a": makeAnalysis("debt-a"), "debt-b": makeAnalysis("debt-b") };
    const pairs = findCandidatePairs({ debts: [debtA, debtB], analysesByDebtId: analyses, now: "2026-08-04T00:00:00.000Z" });
    expect(pairs).toHaveLength(0);
  });

  it("focusDebtId 只返回包含该欠条的对", () => {
    const debts = [
      makeDebt("debt-a", { createdAt: "2026-08-01T09:00:00.000Z" }),
      makeDebt("debt-b", { createdAt: "2026-08-02T09:00:00.000Z" }),
      makeDebt("debt-c", { createdAt: "2026-08-03T09:00:00.000Z" })
    ];
    const analyses = {
      "debt-a": makeAnalysis("debt-a"),
      "debt-b": makeAnalysis("debt-b"),
      "debt-c": makeAnalysis("debt-c")
    };
    const pairs = findCandidatePairs({ debts, analysesByDebtId: analyses, focusDebtId: "debt-a", now: "2026-08-04T00:00:00.000Z" });
    expect(pairs.length).toBe(2);
    expect(pairs.every(pair => pair.sourceId === "debt-a" || pair.targetId === "debt-a")).toBe(true);
  });
});

describe("相似度计算", () => {
  it("conceptJaccard 与 textTokenSimilarity 基本性质", () => {
    expect(conceptJaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(conceptJaccard(new Set(), new Set())).toBe(0);
    expect(textTokenSimilarity("不理解 CORS 预检请求", "不理解 CORS 预检请求")).toBe(1);
    expect(textTokenSimilarity("CORS preflight", "财务 折旧 报表")).toBe(0);
  });

  it("cosineSimilarity 正交为 0，同向为 1", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("embeddingFn 返回向量时 similarityBasis=embedding", async () => {
    const result = await scorePairSimilarity({
      debtA: makeDebt("debt-a"),
      debtB: makeDebt("debt-b"),
      analysisA: makeAnalysis("debt-a"),
      analysisB: makeAnalysis("debt-b"),
      embeddingFn: async () => [[1, 1, 0], [1, 1, 0]]
    });
    expect(result.similarityBasis).toBe("embedding");
    expect(result.similarityScore).toBeCloseTo(1);
  });

  it("embedding 不可用（抛错/无函数/非法返回）时透明降级 lexical_fallback", async () => {
    const debtA = makeDebt("debt-a");
    const debtB = makeDebt("debt-b");
    const analysisA = makeAnalysis("debt-a");
    const analysisB = makeAnalysis("debt-b");

    const withThrow = await scorePairSimilarity({
      debtA, debtB, analysisA, analysisB,
      embeddingFn: async () => { throw new Error("embedding service down"); }
    });
    expect(withThrow.similarityBasis).toBe("lexical_fallback");
    expect(withThrow.similarityScore).toBeGreaterThan(0);

    const withInvalid = await scorePairSimilarity({
      debtA, debtB, analysisA, analysisB,
      embeddingFn: async () => null
    });
    expect(withInvalid.similarityBasis).toBe("lexical_fallback");

    const withoutFn = await scorePairSimilarity({ debtA, debtB, analysisA, analysisB });
    expect(withoutFn.similarityBasis).toBe("lexical_fallback");
    // 概念完全相同 + 文本相同 → 词面得分 1
    expect(withoutFn.similarityScore).toBe(1);
  });
});

describe("validateRelationJudgment / judgePairRelation — 输出校验", () => {
  it("合法输出通过校验", () => {
    const result = validateRelationJudgment({
      relationType: "SAME_CONCEPT", isRelated: true, confidence: 0.9, reason: "同一概念"
    });
    expect(result.ok).toBe(true);
    expect(result.value.relationType).toBe("same_concept");
  });

  it("非法枚举、越界置信度、缺 reason 被拒绝", () => {
    expect(validateRelationJudgment({ relationType: "friendship", isRelated: true, confidence: 0.9, reason: "x" }).ok).toBe(false);
    expect(validateRelationJudgment({ relationType: "same_concept", isRelated: true, confidence: 1.2, reason: "x" }).ok).toBe(false);
    expect(validateRelationJudgment({ relationType: "same_concept", isRelated: "yes", confidence: 0.9, reason: "x" }).ok).toBe(false);
    expect(validateRelationJudgment({ relationType: "same_concept", isRelated: true, confidence: 0.9, reason: "" }).ok).toBe(false);
  });

  it("chatFn 返回 __fallback 时 judgePairRelation 抛错", async () => {
    await expect(judgePairRelation({
      sourceDebt: makeDebt("a"),
      targetDebt: makeDebt("b"),
      signals: {},
      similarity: { similarityScore: 0.5, similarityBasis: "lexical_fallback" },
      chatFn: async () => ({ __fallback: true, __fallbackError: "AI_API_KEY is not set" })
    })).rejects.toThrow(/unavailable/i);
  });
});

describe("detectRelations — 置信度策略与幂等", () => {
  async function seedPair() {
    const stores = await freshStores();
    const debtA = makeDebt("debt-a", { createdAt: "2026-08-01T09:00:00.000Z" });
    const debtB = makeDebt("debt-b", {
      gapText: "不理解 CORS 预检 405 报错",
      reportId: "report-2",
      sourceReports: ["report-2"],
      createdAt: "2026-08-03T09:00:00.000Z"
    });
    await seedDebt(stores.trainingStore, stores.intelligenceStore, debtA, makeAnalysis("debt-a"));
    await seedDebt(stores.trainingStore, stores.intelligenceStore, debtB, makeAnalysis("debt-b"));
    return stores;
  }

  it("置信度 >=0.85 自动建立（auto_confirmed）", async () => {
    const stores = await seedPair();
    const chatFn = async () => ({ relationType: "same_concept", isRelated: true, confidence: 0.92, reason: "同一概念" });
    const result = await detectRelations({
      ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z", trigger: "test"
    });
    expect(result.pairsConsidered).toBe(1);
    expect(result.created).toBe(1);
    expect(result.pending).toBe(0);
    const relations = stores.graphStore.listDebtRelations({ userId: "user-1" });
    expect(relations).toHaveLength(1);
    expect(relations[0].status).toBe("auto_confirmed");
    expect(relations[0].relationType).toBe("same_concept");
    expect(relations[0].similarityBasis).toBe("lexical_fallback");
    expect(relations[0].promptVersion).toBe(PROMPT_VERSION);
  });

  it("置信度 0.60-0.84 进入 pending_confirmation", async () => {
    const stores = await seedPair();
    const chatFn = async () => ({ relationType: "similar_gap", isRelated: true, confidence: 0.7, reason: "结构相似" });
    const result = await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(result.created).toBe(0);
    expect(result.pending).toBe(1);
    const relations = stores.graphStore.listDebtRelations({ userId: "user-1" });
    expect(relations[0].status).toBe("pending_confirmation");
  });

  it("置信度 <0.60 或 isRelated=false 不建立", async () => {
    const stores = await seedPair();
    const lowChat = async () => ({ relationType: "similar_gap", isRelated: true, confidence: 0.4, reason: "证据薄弱" });
    const low = await detectRelations({ ...stores, userId: "user-1", chatFn: lowChat, now: "2026-08-04T00:00:00.000Z" });
    expect(low.created + low.pending).toBe(0);

    const notRelated = async () => ({ relationType: "same_project", isRelated: false, confidence: 0.9, reason: "仅同项目" });
    const none = await detectRelations({ ...stores, userId: "user-1", chatFn: notRelated, now: "2026-08-04T00:00:00.000Z" });
    expect(none.created + none.pending).toBe(0);
    expect(stores.graphStore.listDebtRelations({ userId: "user-1" })).toHaveLength(0);
  });

  it("重复扫描幂等：已有活跃关系的对不再调用模型", async () => {
    const stores = await seedPair();
    let calls = 0;
    const chatFn = async () => {
      calls++;
      return { relationType: "same_concept", isRelated: true, confidence: 0.9, reason: "同一概念" };
    };
    const first = await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(first.created).toBe(1);
    expect(calls).toBe(1);

    const second = await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(second.created).toBe(0);
    expect(second.pending).toBe(0);
    expect(calls).toBe(1);
    expect(stores.graphStore.listDebtRelations({ userId: "user-1" })).toHaveLength(1);
  });

  it("reject 后同一 对+relationType 不再自动重建", async () => {
    const stores = await seedPair();
    const chatFn = async () => ({ relationType: "same_concept", isRelated: true, confidence: 0.7, reason: "可能同概念" });
    const first = await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(first.pending).toBe(1);
    const relation = stores.graphStore.listDebtRelations({ userId: "user-1" })[0];

    await rejectRelation({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      debtId: "debt-a",
      relationId: relation.id
    });
    expect(stores.graphStore.getDebtRelation(relation.id).status).toBe("user_rejected");

    const second = await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(second.created + second.pending).toBe(0);
    const all = stores.graphStore.listDebtRelations({ userId: "user-1" });
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("user_rejected");
  });

  it("chatFn 缺失时谨慎跳过并记录 analysisRun", async () => {
    const stores = await seedPair();
    const result = await detectRelations({ ...stores, userId: "user-1", chatFn: null, now: "2026-08-04T00:00:00.000Z", trigger: "test" });
    expect(result.skipped).toBe("ai_unavailable");
    const runs = stores.intelligenceStore.listAnalysisRuns();
    expect(runs.some(run => run.status === "skipped" && run.trigger === "relation_test")).toBe(true);
  });
});

describe("复发集成 — 复用 handleRelapse 且幂等", () => {
  async function seedRecurrence() {
    const stores = await freshStores();
    const oldDebt = makeDebt("debt-old", {
      status: "mastered",
      createdAt: "2026-08-01T09:00:00.000Z"
    });
    const newDebt = makeDebt("debt-new", {
      gapText: "CORS 预检又失败了",
      reportId: "report-2",
      sourceReports: ["report-2"],
      createdAt: "2026-08-03T09:00:00.000Z"
    });
    await seedDebt(stores.trainingStore, stores.intelligenceStore, oldDebt, makeAnalysis("debt-old"));
    await seedDebt(stores.trainingStore, stores.intelligenceStore, newDebt, makeAnalysis("debt-new"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-old"));
    return stores;
  }

  it("auto_confirmed 的 recurrence 自动触发 handleRelapse：relapseCount+1、retentionStrength 减半、状态置 relapsed", async () => {
    const stores = await seedRecurrence();
    const chatFn = async () => ({ relationType: "recurrence", isRelated: true, confidence: 0.95, reason: "同一问题复发" });
    const result = await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(result.created).toBe(1);

    const profile = stores.trainingStore.getMasteryProfile("debt-old");
    expect(profile.relapseCount).toBe(1);
    expect(profile.retentionStrength).toBe(40); // 80 * 0.5
    expect(profile.transferAbility).toBe(56); // 80 * 0.7
    expect(stores.trainingStore.getCognitiveDebt("debt-old", "user-1").status).toBe("relapsed");

    const relation = stores.graphStore.listDebtRelations({ userId: "user-1" })[0];
    expect(relation.relapseAppliedAt).toBeTruthy();
  });

  it("pending 的 recurrence 由用户 confirm 后触发 handleRelapse，重复 confirm 不重复扣减", async () => {
    const stores = await seedRecurrence();
    const chatFn = async () => ({ relationType: "recurrence", isRelated: true, confidence: 0.7, reason: "疑似复发" });
    await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(stores.trainingStore.getMasteryProfile("debt-old").relapseCount).toBe(0);

    const relation = stores.graphStore.listDebtRelations({ userId: "user-1" })[0];
    const confirmed = await confirmRelation({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      debtId: "debt-new",
      relationId: relation.id
    });
    expect(confirmed.relation.status).toBe("user_confirmed");
    expect(confirmed.relapse.applied).toBe(true);

    const profile = stores.trainingStore.getMasteryProfile("debt-old");
    expect(profile.relapseCount).toBe(1);
    expect(profile.retentionStrength).toBe(40);

    // 重复 confirm：幂等返回，不重复扣减
    const again = await confirmRelation({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      debtId: "debt-new",
      relationId: relation.id
    });
    expect(again.alreadyConfirmed).toBe(true);
    expect(stores.trainingStore.getMasteryProfile("debt-old").relapseCount).toBe(1);
    expect(stores.trainingStore.getMasteryProfile("debt-old").retentionStrength).toBe(40);

    // 直接重复调用 applyRecurrenceRelapse 也不重复扣减
    const repeat = await applyRecurrenceRelapse({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      relation: stores.graphStore.getDebtRelation(relation.id)
    });
    expect(repeat.applied).toBe(false);
    expect(repeat.reason).toBe("already_applied");
    expect(stores.trainingStore.getMasteryProfile("debt-old").relapseCount).toBe(1);
  });

  it("target 已处于 relapsed 时只标记不再扣减；状态机不允许时不改状态", async () => {
    const stores = await seedRecurrence();
    // new 状态不能流转到 relapsed（VALID_TRANSITIONS.new 不含 relapsed）
    await stores.trainingStore.saveCognitiveDebt({
      ...makeDebt("debt-old", { status: "new" }),
      updatedAt: "2026-08-03T00:00:00.000Z"
    });
    const chatFn = async () => ({ relationType: "recurrence", isRelated: true, confidence: 0.95, reason: "复发" });
    await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });

    // profile 仍被扣减（relapseCount+1），但欠条状态保持 new
    expect(stores.trainingStore.getMasteryProfile("debt-old").relapseCount).toBe(1);
    expect(stores.trainingStore.getCognitiveDebt("debt-old", "user-1").status).toBe("new");

    // 再次扫描（已有活跃关系被跳过），直接再调用 apply 也幂等
    const relation = stores.graphStore.listDebtRelations({ userId: "user-1" })[0];
    const repeat = await applyRecurrenceRelapse({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      relation
    });
    expect(repeat.applied).toBe(false);
  });
});

describe("概念节点同步", () => {
  it("自动新建概念为 pending_review，conceptKey 全局复用，链接幂等", async () => {
    const { graphStore } = await freshStores();
    const analysis = makeAnalysis("debt-a");
    const first = await syncConceptsFromAnalysis({ graphStore, analysis });
    expect(first.createdNodes).toBe(2);
    expect(first.linked).toBe(2);
    const nodes = graphStore.listConceptNodes();
    expect(nodes).toHaveLength(2);
    expect(nodes.every(node => node.status === "pending_review")).toBe(true);

    // 第二次同步：复用已有节点，不重复建链接
    const second = await syncConceptsFromAnalysis({ graphStore, analysis: makeAnalysis("debt-b") });
    expect(second.createdNodes).toBe(0);
    expect(second.linked).toBe(2);
    expect(graphStore.listConceptNodes()).toHaveLength(2);
    expect(graphStore.listDebtConceptLinks({ cognitiveDebtId: "debt-b" })).toHaveLength(2);
  });

  it("单次运行新建概念受速率限制", async () => {
    const { graphStore } = await freshStores();
    const manyConcepts = Array.from({ length: 5 }, (_, index) => ({
      key: `concept-${index}`, displayName: `概念${index}`
    }));
    const analysis = makeAnalysis("debt-a", { concepts: manyConcepts, prerequisiteConcepts: [] });
    const result = await syncConceptsFromAnalysis({ graphStore, analysis, maxNewConcepts: 2 });
    expect(result.createdNodes).toBe(2);
    expect(result.linked).toBe(2);
    expect(graphStore.listConceptNodes()).toHaveLength(2);
  });
});

describe("欠条簇聚合与掌握度派生", () => {
  it("same_concept 活跃关系形成簇，重复 rebuild 幂等且保留簇 id", async () => {
    const stores = await freshStores();
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-a"), makeAnalysis("debt-a"));
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-b", {
      gapText: "CORS 预检 405",
      createdAt: "2026-08-02T09:00:00.000Z"
    }), makeAnalysis("debt-b"));

    const chatFn = async () => ({ relationType: "same_concept", isRelated: true, confidence: 0.9, reason: "同概念" });
    await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });

    let clusters = stores.graphStore.listDebtClusters("user-1");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].clusterType).toBe("same_concept");
    const members = stores.graphStore.listDebtClusterMembers({ clusterId: clusters[0].id });
    expect(members).toHaveLength(2);
    const firstId = clusters[0].id;

    // 幂等重算：不产生重复簇，簇 id 稳定
    const rebuild = await rebuildUserClusters({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      userId: "user-1"
    });
    expect(rebuild.clusters).toHaveLength(1);
    clusters = stores.graphStore.listDebtClusters("user-1");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].id).toBe(firstId);
    expect(stores.graphStore.listDebtClusterMembers({ clusterId: firstId })).toHaveLength(2);
  });

  it("共享 primary 概念（无显式关系）也能聚成簇", async () => {
    const stores = await freshStores();
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-a"), makeAnalysis("debt-a"));
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-b", {
      gapText: "另一个 CORS 问题",
      createdAt: "2026-08-02T09:00:00.000Z"
    }), makeAnalysis("debt-b"));
    await syncConceptsFromAnalysis({ graphStore: stores.graphStore, analysis: makeAnalysis("debt-a") });
    await syncConceptsFromAnalysis({ graphStore: stores.graphStore, analysis: makeAnalysis("debt-b") });

    await rebuildUserClusters({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      userId: "user-1"
    });
    const clusters = stores.graphStore.listDebtClusters("user-1");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].title).toContain("CORS");
    expect(clusters[0].primaryConceptNodeId).toBeTruthy();
  });

  it("recurrence 关系的簇类型为 recurring_problem；关系被 reject 后簇消失", async () => {
    const stores = await freshStores();
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-a", { status: "mastered" }), makeAnalysis("debt-a"));
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-b", {
      gapText: "CORS 又失败",
      createdAt: "2026-08-02T09:00:00.000Z"
    }), makeAnalysis("debt-b"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-a"));

    const chatFn = async () => ({ relationType: "recurrence", isRelated: true, confidence: 0.9, reason: "复发" });
    await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    let clusters = stores.graphStore.listDebtClusters("user-1");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].clusterType).toBe("recurring_problem");

    const relation = stores.graphStore.listDebtRelations({ userId: "user-1" })[0];
    await rejectRelation({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      debtId: "debt-a",
      relationId: relation.id
    });
    clusters = stores.graphStore.listDebtClusters("user-1");
    expect(clusters).toHaveLength(0);
  });

  it("clusterMasterySummary 与 trainingStore 的 MasteryProfile 一致（六维平均 + 状态计数）", async () => {
    const stores = await freshStores();
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-a", { status: "mastered" }), makeAnalysis("debt-a"));
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-b", {
      status: "initially_understood",
      gapText: "CORS 预检 405",
      createdAt: "2026-08-02T09:00:00.000Z"
    }), makeAnalysis("debt-b"));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-a", {
      conceptualUnderstanding: 60, independentRecall: 50, hintIndependence: 70,
      misconceptionResistance: 40, transferAbility: 80, retentionStrength: 90, overallMastery: 63
    }));
    await stores.trainingStore.saveMasteryProfile(makeProfile("debt-b", {
      conceptualUnderstanding: 30, independentRecall: 20, hintIndependence: 40,
      misconceptionResistance: 10, transferAbility: 50, retentionStrength: 60, overallMastery: 33
    }));

    const chatFn = async () => ({ relationType: "same_concept", isRelated: true, confidence: 0.9, reason: "同概念" });
    await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    const cluster = stores.graphStore.listDebtClusters("user-1")[0];
    const memberIds = stores.graphStore.listDebtClusterMembers({ clusterId: cluster.id }).map(member => member.cognitiveDebtId);

    const debtsById = new Map(stores.trainingStore.listCognitiveDebts("user-1").map(debt => [debt.id, debt]));
    const profilesByDebtId = new Map(stores.trainingStore.listMasteryProfiles("user-1").map(profile => [profile.cognitiveDebtId, profile]));
    const summary = deriveClusterMasterySummary({ memberDebtIds: memberIds, debtsById, profilesByDebtId });

    expect(summary.memberCount).toBe(2);
    expect(summary.withProfileCount).toBe(2);
    expect(summary.statusCounts).toEqual({ mastered: 1, initially_understood: 1 });
    expect(summary.averageMastery.conceptualUnderstanding).toBe(45); // (60+30)/2
    expect(summary.averageMastery.independentRecall).toBe(35);
    expect(summary.averageMastery.hintIndependence).toBe(55);
    expect(summary.averageMastery.misconceptionResistance).toBe(25);
    expect(summary.averageMastery.transferAbility).toBe(65);
    expect(summary.averageMastery.retentionStrength).toBe(75);
    expect(summary.averageMastery.overallMastery).toBe(48); // (63+33)/2
  });

  it("pending_confirmation 的关系不参与成簇", async () => {
    const stores = await freshStores();
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-a"), makeAnalysis("debt-a"));
    await seedDebt(stores.trainingStore, stores.intelligenceStore, makeDebt("debt-b", {
      gapText: "CORS 预检 405",
      createdAt: "2026-08-02T09:00:00.000Z"
    }), makeAnalysis("debt-b", { concepts: [{ key: "http caching", displayName: "HTTP 缓存" }], prerequisiteConcepts: [] }));

    const chatFn = async () => ({ relationType: "same_concept", isRelated: true, confidence: 0.7, reason: "疑似同概念" });
    await detectRelations({ ...stores, userId: "user-1", chatFn, now: "2026-08-04T00:00:00.000Z" });
    expect(stores.graphStore.listDebtClusters("user-1")).toHaveLength(0);

    // 用户确认后成簇
    const relation = stores.graphStore.listDebtRelations({ userId: "user-1" })[0];
    await confirmRelation({
      graphStore: stores.graphStore,
      trainingStore: stores.trainingStore,
      userId: "user-1",
      debtId: "debt-a",
      relationId: relation.id
    });
    expect(stores.graphStore.listDebtClusters("user-1")).toHaveLength(1);
  });
});

describe("concept-graph-store 持久化", () => {
  it("关系与簇在重载后恢复", async () => {
    const stores = await freshStores();
    await stores.graphStore.saveDebtRelation({
      id: "rel-1",
      userId: "user-1",
      sourceDebtId: "debt-b",
      targetDebtId: "debt-a",
      relationType: "same_concept",
      similarityScore: 0.8,
      confidence: 0.9,
      reason: "同概念",
      status: "auto_confirmed",
      createdAt: "2026-08-04T10:00:00.000Z"
    });

    const reloaded = createConceptGraphStore(graphPath);
    await reloaded.load();
    const relation = reloaded.getDebtRelation("rel-1");
    expect(relation).toBeTruthy();
    expect(relation.status).toBe("auto_confirmed");
    // 无序对查找：反向也能命中
    expect(reloaded.findDebtRelation("debt-a", "debt-b", "same_concept")?.id).toBe("rel-1");
    expect(reloaded.findDebtRelation("debt-a", "debt-b", "recurrence")).toBeNull();
  });
});
