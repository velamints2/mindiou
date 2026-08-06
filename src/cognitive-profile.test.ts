// @ts-nocheck
import { describe, expect, it, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  CALCULATION_VERSION,
  confidenceFromEvidenceCount,
  countIndependentEvidence,
  evidenceKeyForDebt,
  skillNodeKeyFromDomainPath,
  aggregateSkillProfile,
  aggregateGapPatterns,
  aggregateLearningBehavior,
  aggregateRiskProfile,
  generateInsights,
  createSnapshot,
  resolveSnapshotPeriod,
  computeProfileAggregates,
  generatePeriodicSnapshots
} from "../cognitive-profile.js";
import { createCognitiveProfileStore } from "../cognitive-profile-store.js";
import { createDebtIntelligenceStore } from "../debt-intelligence-store.js";
import { createTrainingStore } from "../training-store.js";

const tmpDir = path.join(os.tmpdir(), `mindiou-cognitive-profile-test-${process.pid}`);
const profilePath = path.join(tmpDir, "cognitive-profile-store.json");
const intelPath = path.join(tmpDir, "debt-intelligence-store.json");
const trainingPath = path.join(tmpDir, "training-store.json");

const NOW = new Date("2026-08-04T12:00:00.000Z");
const PERIOD = { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" };

async function freshStores() {
  await mkdir(tmpDir, { recursive: true });
  const profileStore = createCognitiveProfileStore(profilePath);
  const intelligenceStore = createDebtIntelligenceStore(intelPath);
  const trainingStore = createTrainingStore(trainingPath);
  await Promise.all([profileStore.load(), intelligenceStore.load(), trainingStore.load()]);
  return { profileStore, intelligenceStore, trainingStore };
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
    trainingStage: "initial_compensation",
    taskType: "feynman_explanation",
    originalPrompt: "解释这个概念",
    finalAnswer: "我的回答",
    hintEvents: [],
    evaluation: { overallScore: 70, passed: true, hintDependency: 30 },
    startedAt: "2026-08-01T09:00:00.000Z",
    completedAt: "2026-08-01T09:05:00.000Z",
    durationSeconds: 300,
    ...overrides
  };
}

function mapFrom(list, keyOf) {
  return new Map(list.map(item => [keyOf(item), item]));
}

describe("最低证据规则与独立证据去重", () => {
  it("1 条证据不生成结论（confidence = 0），2-3 条 ≤0.4，4-7 条 ≤0.7，≥8 条 ≤0.9", () => {
    expect(confidenceFromEvidenceCount(0)).toBe(0);
    expect(confidenceFromEvidenceCount(1)).toBe(0);
    expect(confidenceFromEvidenceCount(2)).toBe(0.4);
    expect(confidenceFromEvidenceCount(3)).toBe(0.4);
    expect(confidenceFromEvidenceCount(4)).toBe(0.7);
    expect(confidenceFromEvidenceCount(7)).toBe(0.7);
    expect(confidenceFromEvidenceCount(8)).toBe(0.9);
    expect(confidenceFromEvidenceCount(20)).toBe(0.9);
  });

  it("同一报告产生的多张相似欠条按 1 条独立证据计", () => {
    const debts = [
      makeDebt({ id: "d1", reportId: "report-x", sourceReports: ["report-x"] }),
      makeDebt({ id: "d2", reportId: "report-x", sourceReports: ["report-x"] }),
      makeDebt({ id: "d3", reportId: "report-x", sourceReports: ["report-x", "report-y"] }),
      makeDebt({ id: "d4", reportId: "report-z", sourceReports: ["report-z"] })
    ];
    expect(evidenceKeyForDebt(debts[0])).toBe("report:report-x");
    expect(evidenceKeyForDebt(debts[2])).toBe("report:report-x");
    expect(countIndependentEvidence(debts)).toBe(2);
    expect(confidenceFromEvidenceCount(countIndependentEvidence(debts))).toBe(0.4);
  });

  it("无报告来源时按欠条自身计独立证据", () => {
    const debts = [
      makeDebt({ id: "d1", reportId: null, sourceReports: [] }),
      makeDebt({ id: "d2", reportId: null, sourceReports: [] })
    ];
    expect(countIndependentEvidence(debts)).toBe(2);
  });
});

describe("aggregateSkillProfile — 领域聚合", () => {
  it("skillNodeKey 取 domainPath 前三段", () => {
    expect(skillNodeKeyFromDomainPath(["software_engineering", "backend", "distributed_systems", "extra"]))
      .toBe("software_engineering.backend.distributed_systems");
    expect(skillNodeKeyFromDomainPath(["finance"])).toBe("finance");
    expect(skillNodeKeyFromDomainPath([])).toBe("");
    expect(skillNodeKeyFromDomainPath(null)).toBe("");
  });

  it("六维均值与 MasteryProfile 精确一致（单欠条逐维相等，双欠条取平均）", () => {
    const debtA = makeDebt({ id: "d-a" });
    const debtB = makeDebt({ id: "d-b" });
    const analyses = mapFrom([makeAnalysis("d-a"), makeAnalysis("d-b")], item => item.cognitiveDebtId);
    const profileA = makeProfile("d-a");
    const profileB = makeProfile("d-b", {
      conceptualUnderstanding: 80, independentRecall: 60, hintIndependence: 50,
      misconceptionResistance: 60, transferAbility: 40, retentionStrength: 70, overallMastery: 61
    });
    const profiles = mapFrom([profileA, profileB], item => item.cognitiveDebtId);

    const single = aggregateSkillProfile("user-1", {
      debts: [debtA], analysesByDebtId: analyses, profilesByDebtId: profiles, now: NOW
    });
    const skillA = single.skills[0];
    expect(skillA.skillNodeKey).toBe("software_engineering.backend.distributed_systems");
    expect(skillA.averageMastery.conceptualUnderstanding).toBe(60);
    expect(skillA.averageMastery.independentRecall).toBe(50);
    expect(skillA.averageMastery.hintIndependence).toBe(70);
    expect(skillA.averageMastery.misconceptionResistance).toBe(40);
    expect(skillA.averageMastery.transferAbility).toBe(80);
    expect(skillA.averageMastery.retentionStrength).toBe(90);
    expect(skillA.averageMastery.overallMastery).toBe(63);

    const both = aggregateSkillProfile("user-1", {
      debts: [debtA, debtB], analysesByDebtId: analyses, profilesByDebtId: profiles, now: NOW
    });
    const skillAB = both.skills[0];
    expect(skillAB.relatedDebtCount).toBe(2);
    expect(skillAB.averageMastery.conceptualUnderstanding).toBe(70);
    expect(skillAB.averageMastery.transferAbility).toBe(60);
    // 最弱两维按均值升序：misconceptionResistance(50)、independentRecall(55)
    expect(skillAB.weakestDimensions.map(item => item.dimension)).toEqual([
      "misconceptionResistance", "independentRecall"
    ]);
  });

  it("欠条数 / 已掌握 / 复发计数与趋势、数据不足标记", () => {
    const debts = [
      makeDebt({ id: "d1", status: "mastered" }),
      makeDebt({ id: "d2", status: "mastered" }),
      makeDebt({ id: "d3", status: "relapsed" }),
      makeDebt({ id: "d4", status: "new" })
    ];
    const analyses = mapFrom(debts.map(d => makeAnalysis(d.id)), item => item.cognitiveDebtId);
    const result = aggregateSkillProfile("user-1", { debts, analysesByDebtId: analyses, now: NOW });
    const skill = result.skills[0];
    expect(skill.relatedDebtCount).toBe(4);
    expect(skill.masteredDebtCount).toBe(2);
    expect(skill.relapsedDebtCount).toBe(1);
    expect(skill.masteredRatio).toBe(0.5);
    expect(skill.independentEvidenceCount).toBe(4);
    expect(skill.confidence).toBe(0.7);
    // 全部欠条同日创建：前后两半无时间先后之分，不产出趋势结论
    expect(skill.trend).toBe("insufficient_data");
    expect(result.insufficientData).toBe(false);
  });

  it("无分类的欠条计入 unclassifiedDebtCount，不进入领域列表", () => {
    const debts = [makeDebt({ id: "d1" }), makeDebt({ id: "d2" })];
    const analyses = mapFrom([makeAnalysis("d1")], item => item.cognitiveDebtId);
    const result = aggregateSkillProfile("user-1", { debts, analysesByDebtId: analyses, now: NOW });
    expect(result.skills).toHaveLength(1);
    expect(result.unclassifiedDebtCount).toBe(1);
  });

  it("趋势：对比最近两个快照的 masteredRatio", () => {
    const debts = [makeDebt({ id: "d1", status: "mastered" }), makeDebt({ id: "d2" })];
    const analyses = mapFrom(debts.map(d => makeAnalysis(d.id)), item => item.cognitiveDebtId);
    const key = "software_engineering.backend.distributed_systems";
    const snapshots = [
      { skillSummaryJson: { skills: [{ skillNodeKey: key, masteredRatio: 0.8 }] } },
      { skillSummaryJson: { skills: [{ skillNodeKey: key, masteredRatio: 0.4 }] } }
    ];
    const result = aggregateSkillProfile("user-1", { debts, analysesByDebtId: analyses, snapshots, now: NOW });
    expect(result.skills[0].trend).toBe("improving");
  });
});

describe("aggregateGapPatterns — 认知模式", () => {
  it("机制分布排序、去重计数与确定性结论", () => {
    const debts = [
      makeDebt({ id: "d1", createdAt: "2026-08-01T09:00:00.000Z" }),
      makeDebt({ id: "d2", createdAt: "2026-08-02T09:00:00.000Z" }),
      makeDebt({ id: "d3", createdAt: "2026-08-03T09:00:00.000Z" })
    ];
    const analyses = mapFrom([
      makeAnalysis("d1", { primaryGapMechanism: "rationale_gap" }),
      makeAnalysis("d2", { primaryGapMechanism: "verification_gap" }),
      makeAnalysis("d3", { primaryGapMechanism: "rationale_gap" })
    ], item => item.cognitiveDebtId);
    const result = aggregateGapPatterns({ debts, analysesByDebtId: analyses, periodDays: 30, now: NOW });
    expect(result.totalIndependentEvidence).toBe(3);
    expect(result.confidence).toBe(0.4);
    expect(result.distribution.map(item => item.key)).toEqual(["rationale_gap", "verification_gap"]);
    expect(result.distribution[0].count).toBe(2);
    expect(result.conclusion).toContain("原理缺口");
    expect(result.conclusion).toContain("验证缺口");
    expect(result.conclusion).toContain("最近30天");
    expect(result.insufficientData).toBe(false);
  });

  it("周期外的欠条不计入分布；证据不足时不产出结论", () => {
    const debts = [
      makeDebt({ id: "d1", createdAt: "2026-06-01T09:00:00.000Z" }),
      makeDebt({ id: "d2", createdAt: "2026-08-02T09:00:00.000Z" })
    ];
    const analyses = mapFrom(debts.map(d => makeAnalysis(d.id)), item => item.cognitiveDebtId);
    const result = aggregateGapPatterns({ debts, analysesByDebtId: analyses, periodDays: 30, now: NOW });
    expect(result.totalIndependentEvidence).toBe(1);
    expect(result.conclusion).toBeNull();
    expect(result.insufficientData).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it("同报告多张欠条在机制计数中去重为 1 条独立证据", () => {
    const debts = [
      makeDebt({ id: "d1", reportId: "r1", sourceReports: ["r1"] }),
      makeDebt({ id: "d2", reportId: "r1", sourceReports: ["r1"] })
    ];
    const analyses = mapFrom(debts.map(d => makeAnalysis(d.id)), item => item.cognitiveDebtId);
    const result = aggregateGapPatterns({ debts, analysesByDebtId: analyses, now: NOW });
    expect(result.distribution[0].count).toBe(1);
    expect(result.distribution[0].debtCount).toBe(2);
    expect(result.insufficientData).toBe(true);
  });
});

describe("aggregateLearningBehavior — 学习模式", () => {
  it("各阶段通过率、平均提示数、迁移通过率、复发率、时长与提示依赖趋势", () => {
    const debts = [
      makeDebt({ id: "d1", status: "relapsed", recurrenceCount: 1 }),
      makeDebt({ id: "d2", status: "mastered" })
    ];
    const attempts = [
      makeAttempt("d1", { trainingStage: "initial_compensation", evaluation: { passed: true, hintDependency: 60 }, completedAt: "2026-07-20T09:05:00.000Z", hintEvents: [{ id: "h1" }] }),
      makeAttempt("d1", { trainingStage: "scenario_transfer", evaluation: { passed: true, hintDependency: 40 }, completedAt: "2026-07-25T09:05:00.000Z" }),
      makeAttempt("d2", { trainingStage: "scenario_transfer", evaluation: { passed: false, hintDependency: 20 }, completedAt: "2026-08-01T09:05:00.000Z", initialAnswer: "初稿", finalAnswer: "修改后的答案" })
    ];
    const profiles = mapFrom([makeProfile("d1"), makeProfile("d2")], item => item.cognitiveDebtId);
    const result = aggregateLearningBehavior({ debts, attempts, profilesByDebtId: profiles });
    expect(result.totalAttempts).toBe(3);
    expect(result.stagePassRates.initial_compensation.passRate).toBe(1);
    expect(result.stagePassRates.scenario_transfer).toMatchObject({ attempts: 2, passed: 1, passRate: 0.5 });
    expect(result.stagePassRates.delayed_recall).toBeNull();
    expect(result.averageHintsPerAttempt).toBe(round2(1 / 3));
    expect(result.transferPassRate.passRate).toBe(0.5);
    expect(result.relapseRate).toMatchObject({ trainedDebtCount: 2, relapsedDebtCount: 1, rate: 0.5 });
    expect(result.averageDurationSeconds).toBe(300);
    expect(result.answerRevisionRate).toMatchObject({ total: 1, revised: 1, rate: 1 });
    // 提示依赖度 60/40 → 20，后半更低：improving
    expect(result.hintDependencyTrend).toBe("improving");
    expect(result.insufficientFields).toEqual([]);
  });

  it("无训练记录时分项标注 insufficient_data", () => {
    const result = aggregateLearningBehavior({ debts: [makeDebt({ id: "d1" })], attempts: [] });
    expect(result.totalAttempts).toBe(0);
    expect(result.averageHintsPerAttempt).toBeNull();
    expect(result.transferPassRate).toBeNull();
    expect(result.relapseRate).toBeNull();
    expect(result.hintDependencyTrend).toBe("insufficient_data");
    expect(result.insufficientData).toBe(true);
    expect(result.insufficientFields).toContain("transferPassRate");
    expect(result.insufficientFields).toContain("hintDependencyTrend");
  });
});

function round2(value) {
  return Math.round(value * 100) / 100;
}

describe("aggregateRiskProfile — 风险画像", () => {
  it("排除 no_material_risk，按类型计数并附证据", () => {
    const debts = [makeDebt({ id: "d1" }), makeDebt({ id: "d2" }), makeDebt({ id: "d3" })];
    const analyses = mapFrom([
      makeAnalysis("d1", { riskTypes: ["no_material_risk"] }),
      makeAnalysis("d2", { riskTypes: ["quality_risk", "security_risk"] }),
      makeAnalysis("d3", { riskTypes: ["quality_risk"] })
    ], item => item.cognitiveDebtId);
    const result = aggregateRiskProfile({ debts, analysesByDebtId: analyses });
    expect(result.totalRiskDebts).toBe(2);
    expect(result.distribution.map(item => item.riskType)).toEqual(["quality_risk", "security_risk"]);
    expect(result.distribution[0].count).toBe(2);
    expect(result.distribution[0].evidenceDebtIds.sort()).toEqual(["d2", "d3"]);
    expect(result.insufficientData).toBe(false);
  });

  it("全部欠条均无实质风险时标记数据不足", () => {
    const debts = [makeDebt({ id: "d1" })];
    const analyses = mapFrom([makeAnalysis("d1", { riskTypes: ["no_material_risk"] })], item => item.cognitiveDebtId);
    const result = aggregateRiskProfile({ debts, analysesByDebtId: analyses });
    expect(result.totalRiskDebts).toBe(0);
    expect(result.distribution).toEqual([]);
    expect(result.insufficientData).toBe(true);
  });
});

describe("generateInsights — 结论生成与最低证据规则", () => {
  function buildAggregates(debts, analyses, profiles = [], attempts = []) {
    const analysesByDebtId = mapFrom(analyses, item => item.cognitiveDebtId);
    const profilesByDebtId = mapFrom(profiles, item => item.cognitiveDebtId);
    return {
      skills: aggregateSkillProfile("user-1", { debts, analysesByDebtId, profilesByDebtId, now: NOW }),
      gapPatterns: aggregateGapPatterns({ debts, analysesByDebtId, now: NOW }),
      learningBehavior: aggregateLearningBehavior({ debts, attempts, profilesByDebtId }),
      risks: aggregateRiskProfile({ debts, analysesByDebtId })
    };
  }

  it("1 条证据不生成任何结论", async () => {
    const debts = [makeDebt({ id: "d1", status: "mastered" })];
    const aggregates = buildAggregates(debts, [makeAnalysis("d1")]);
    const { insights } = await generateInsights({ userId: "user-1", ...aggregates, ...PERIOD, now: NOW });
    expect(insights).toHaveLength(0);
  });

  it("2-3 条证据生成初步观察（confidence ≤ 0.4），≥8 条稳定模式（≤ 0.9）", async () => {
    const few = [0, 1, 2].map(i => makeDebt({ id: `f${i}`, status: "mastered" }));
    const fewAggregates = buildAggregates(few, few.map(d => makeAnalysis(d.id)));
    const fewResult = await generateInsights({ userId: "user-1", ...fewAggregates, ...PERIOD, now: NOW });
    expect(fewResult.insights.length).toBeGreaterThan(0);
    for (const insight of fewResult.insights) {
      expect(insight.confidence).toBeLessThanOrEqual(0.4);
    }

    const many = Array.from({ length: 8 }, (_, i) => makeDebt({ id: `m${i}`, status: "mastered" }));
    const manyAggregates = buildAggregates(many, many.map(d => makeAnalysis(d.id)));
    const manyResult = await generateInsights({ userId: "user-1", ...manyAggregates, ...PERIOD, now: NOW });
    const skillInsight = manyResult.insights.find(item => item.insightType === "skill_strength");
    expect(skillInsight).toBeDefined();
    expect(skillInsight.confidence).toBeLessThanOrEqual(0.9);
    expect(skillInsight.confidence).toBe(0.9);
  });

  it("每条 insight 都带 evidence IDs 字段（数组存在，可为空）", async () => {
    const debts = [0, 1].map(i => makeDebt({ id: `e${i}`, status: "mastered" }));
    const aggregates = buildAggregates(debts, debts.map(d => makeAnalysis(d.id)));
    const { insights } = await generateInsights({ userId: "user-1", ...aggregates, ...PERIOD, now: NOW });
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(Array.isArray(insight.evidenceDebtIds)).toBe(true);
      expect(Array.isArray(insight.evidenceAttemptIds)).toBe(true);
      expect(Array.isArray(insight.evidenceClusterIds)).toBe(true);
      expect(insight.calculationVersion).toBe(CALCULATION_VERSION);
      expect(insight.periodStart).toBe(PERIOD.periodStart);
    }
    const skillInsight = insights.find(item => item.insightType === "skill_strength");
    expect(skillInsight.evidenceDebtIds.sort()).toEqual(["e0", "e1"]);
  });

  it("chatFn 仅润色措辞：合法输出被采纳并标记 aiEnhanced，异常输出回退模板", async () => {
    const debts = [0, 1].map(i => makeDebt({ id: `p${i}`, status: "mastered" }));
    const aggregates = buildAggregates(debts, debts.map(d => makeAnalysis(d.id)));

    const polishingChatFn = async messages => {
      const input = JSON.parse(messages.at(-1).content);
      return {
        insights: input.insights.map(item => ({
          id: item.id,
          title: `润色：${item.title}`,
          description: item.description
        }))
      };
    };
    const polished = await generateInsights({ userId: "user-1", ...aggregates, ...PERIOD, chatFn: polishingChatFn, now: NOW });
    expect(polished.aiEnhanced).toBe(true);
    expect(polished.insights[0].title.startsWith("润色：")).toBe(true);

    const brokenChatFn = async () => ({ unexpected: true });
    const fallback = await generateInsights({ userId: "user-1", ...aggregates, ...PERIOD, chatFn: brokenChatFn, now: NOW });
    expect(fallback.aiEnhanced).toBe(false);
    expect(fallback.insights[0].title.startsWith("润色：")).toBe(false);

    const throwingChatFn = async () => { throw new Error("provider down"); };
    const rescued = await generateInsights({ userId: "user-1", ...aggregates, ...PERIOD, chatFn: throwingChatFn, now: NOW });
    expect(rescued.insights.length).toBeGreaterThan(0);
  });

  it("传入 store 时按周期幂等替换旧记录", async () => {
    const { profileStore } = await freshStores();
    const debts = [0, 1].map(i => makeDebt({ id: `s${i}`, status: "mastered" }));
    const aggregates = buildAggregates(debts, debts.map(d => makeAnalysis(d.id)));
    const first = await generateInsights({ userId: "user-1", ...aggregates, ...PERIOD, store: profileStore, now: NOW });
    const second = await generateInsights({ userId: "user-1", ...aggregates, ...PERIOD, store: profileStore, now: NOW });
    expect(first.insights.length).toBeGreaterThan(0);
    expect(second.insights).toHaveLength(first.insights.length);
    expect(profileStore.listInsights("user-1")).toHaveLength(first.insights.length);
    // 其他用户的记录不受影响
    expect(profileStore.listInsights("user-2")).toHaveLength(0);
  });
});

describe("快照不可变性", () => {
  it("同周期重复生成不覆盖历史，历史快照永不改写", async () => {
    const { profileStore } = await freshStores();
    const aggregates = {
      skills: { skills: [], unclassifiedDebtCount: 0 },
      gapPatterns: { periodDays: 30, totalIndependentEvidence: 0, distribution: [] },
      learningBehavior: { totalAttempts: 0, stagePassRates: {}, hintDependencyTrend: "insufficient_data" },
      risks: { totalRiskDebts: 0, distribution: [] }
    };
    const first = await createSnapshot({
      store: profileStore, userId: "user-1", snapshotType: "weekly",
      periodStart: "2026-08-03T00:00:00.000Z", periodEnd: "2026-08-10T00:00:00.000Z",
      ...aggregates, now: NOW
    });
    expect(first.created).toBe(true);

    const again = await createSnapshot({
      store: profileStore, userId: "user-1", snapshotType: "weekly",
      periodStart: "2026-08-03T00:00:00.000Z", periodEnd: "2026-08-10T00:00:00.000Z",
      ...aggregates,
      gapPatterns: { periodDays: 30, totalIndependentEvidence: 99, distribution: [] },
      now: NOW
    });
    expect(again.created).toBe(false);
    expect(again.snapshot.id).toBe(first.snapshot.id);
    // 旧内容保持不变
    expect(again.snapshot.gapPatternSummaryJson.totalIndependentEvidence).toBe(0);
    expect(profileStore.listSnapshots("user-1")).toHaveLength(1);

    // 新周期生成新快照，历史保留
    const nextWeek = await createSnapshot({
      store: profileStore, userId: "user-1", snapshotType: "weekly",
      periodStart: "2026-08-10T00:00:00.000Z", periodEnd: "2026-08-17T00:00:00.000Z",
      ...aggregates, now: NOW
    });
    expect(nextWeek.created).toBe(true);
    expect(profileStore.listSnapshots("user-1")).toHaveLength(2);
  });

  it("resolveSnapshotPeriod 给出稳定周期边界", () => {
    const weekly = resolveSnapshotPeriod("weekly", new Date("2026-08-04T12:00:00.000Z"));
    expect(weekly.periodStart).toBe("2026-08-03T00:00:00.000Z"); // 周一
    const monthly = resolveSnapshotPeriod("monthly", new Date("2026-08-04T12:00:00.000Z"));
    expect(monthly.periodStart).toBe("2026-08-01T00:00:00.000Z");
    const manual = resolveSnapshotPeriod("manual", new Date("2026-08-04T12:00:00.000Z"));
    expect(manual.periodStart).toBe("2026-08-04T00:00:00.000Z");
  });

  it("generatePeriodicSnapshots 幂等：同一周期不重复生成", async () => {
    const { profileStore, intelligenceStore, trainingStore } = await freshStores();
    const debt = makeDebt({ id: "d1" });
    await trainingStore.saveCognitiveDebt(debt);
    await intelligenceStore.saveAnalysis({ ...makeAnalysis("d1"), version: 1, isCurrent: true });

    const first = await generatePeriodicSnapshots({ profileStore, trainingStore, intelligenceStore, now: NOW });
    expect(first.users).toBe(1);
    expect(first.created).toBe(2); // weekly + monthly
    expect(first.errors).toEqual([]);

    const second = await generatePeriodicSnapshots({ profileStore, trainingStore, intelligenceStore, now: NOW });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(2);
    expect(profileStore.listSnapshots("user-1")).toHaveLength(2);
  });
});

describe("读时重算：删除欠条后聚合不再包含该欠条", () => {
  it("从 trainingStore 移除欠条后重新聚合，领域计数随之下降", async () => {
    const { profileStore, intelligenceStore, trainingStore } = await freshStores();
    const debts = [
      makeDebt({ id: "d1", status: "mastered" }),
      makeDebt({ id: "d2" }),
      makeDebt({ id: "d3" })
    ];
    for (const debt of debts) await trainingStore.saveCognitiveDebt(debt);
    for (const debt of debts) {
      await intelligenceStore.saveAnalysis({ ...makeAnalysis(debt.id), version: 1, isCurrent: true });
    }

    const before = computeProfileAggregates({
      userId: "user-1", trainingStore, intelligenceStore, profileStore, now: NOW
    });
    expect(before.skills.skills[0].relatedDebtCount).toBe(3);

    // 模拟用户删除欠条：从 store 状态中移除后重新聚合
    trainingStore.getState().cognitiveDebts = trainingStore.getState().cognitiveDebts
      .filter(debt => debt.id !== "d2");
    const after = computeProfileAggregates({
      userId: "user-1", trainingStore, intelligenceStore, profileStore, now: NOW
    });
    expect(after.skills.skills[0].relatedDebtCount).toBe(2);
    expect(after.skills.skills[0].evidenceDebtIds.sort()).toEqual(["d1", "d3"]);
  });
});
