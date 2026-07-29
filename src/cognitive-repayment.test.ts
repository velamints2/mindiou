// @ts-nocheck
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  DATA_SCHEMA_VERSION,
  EVALUATOR_VERSION,
  PROMPT_SCHEMA_VERSION,
  GAP_STATUSES,
  VALID_TRANSITIONS,
  canTransition,
  transitionGapStatus,
  createGapFromReport,
  buildAttemptRecord,
  applyAttemptOutcome,
  resolveAttemptOutcome,
  normalizeDimensionEvaluation,
  normalizeRepaymentEvaluation,
  createFallbackEvaluation,
  getRepaymentEvaluationPrompt,
  DIMENSIONS
} from "../cognitive-repayment.js";
import { createCognitiveRepaymentStore } from "../cognitive-repayment-store.js";

const ARTIFACT = "Deploy failed twice last night. nginx restart did not fix the root cause because the upstream port was wrong. We fixed the port mapping and the service recovered.";
const EVIDENCE_SENTENCE = "nginx restart did not fix the root cause";

function makeReport(overrides: any = {}) {
  return {
    id: "report-1",
    userId: "user-1",
    createdAt: "2026-07-29T00:00:00.000Z",
    input: { artifactText: ARTIFACT, artifactType: "codex", charCount: ARTIFACT.length, preprocess: null, confusions: [] },
    analysis: { userCapability: { overall: "L2", currentDomain: "deploy debugging", dimensions: [] } },
    sections: {
      aiCompleted: [],
      userContributed: [],
      cognitiveProcessesOutsourced: [],
      dangerousGaps: [{
        rank: 1,
        title: "Root-cause verification gap",
        gap: "Treated restarts as fixes without verifying the root cause",
        underlyingCapability: "Hypothesis verification",
        surfaceSignals: [EVIDENCE_SENTENCE],
        whyDangerous: "Repeated restarts mask the real fault.",
        transferScenarios: ["database failover"],
        confidence: 0.8,
        alternativeExplanations: [],
        diagnosticQuestion: "How do you confirm a restart actually fixed the root cause?",
        masteryCriteria: ["Verifies the root cause before restarting"],
        evidence: EVIDENCE_SENTENCE
      }],
      cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
      feynmanCards: [{ id: "card-1", target: "Treated restarts as fixes without verifying the root cause", prompt: "Explain verification" }],
      nextActions: []
    },
    status: "generated",
    ...overrides
  };
}

describe("createGapFromReport", () => {
  it("imports a legacy report gap with missing fields into explicit defaults", () => {
    const legacyReport = makeReport({
      analysis: undefined,
      sections: {
        dangerousGaps: [{ rank: 2, gap: "No rollback plan was ever written", whyDangerous: "Failures become unrecoverable.", evidence: "some sentence not present in the artifact" }]
      }
    });
    const gap = createGapFromReport({
      report: legacyReport,
      gapRef: { gapRank: 2 },
      userId: "user-1",
      now: "2026-07-30T00:00:00.000Z"
    });
    expect(gap.gapId).toBeTruthy();
    expect(gap.userId).toBe("user-1");
    expect(gap.reportId).toBe("report-1");
    expect(gap.cardId).toBeNull();
    expect(gap.gapRank).toBe(2);
    expect(gap.title).toBe("No rollback plan was ever written");
    expect(gap.whyItMatters).toBe("Failures become unrecoverable.");
    expect(gap.userCapabilityLevel).toBe("unknown");
    expect(gap.verificationMethod).toBe("用自己的话解释关键机制，并给出可验证的证据");
    expect(gap.status).toBe("identified");
    expect(gap.statusHistory).toEqual([]);
    expect(gap.dataSchemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(gap.evidence.length).toBeGreaterThan(0);
    expect(gap.systemReasoningSummary).toContain("证据无法定位，已标记为推断型缺口");
  });

  it("locates evidence present in the artifact as direct quotes with true offsets", () => {
    const gap = createGapFromReport({
      report: makeReport(),
      gapRef: { gapRank: 1 },
      userId: "user-1",
      now: "2026-07-30T00:00:00.000Z"
    });
    const direct = gap.evidence.filter((item: any) => item.evidenceType === "direct_quote");
    expect(direct.length).toBeGreaterThan(0);
    const first = direct[0];
    const expectedStart = ARTIFACT.indexOf(EVIDENCE_SENTENCE);
    expect(first.sourceLocation).toEqual({
      kind: "artifact",
      start: expectedStart,
      end: expectedStart + EVIDENCE_SENTENCE.length
    });
    expect(ARTIFACT.slice(first.sourceLocation.start, first.sourceLocation.end)).toBe(EVIDENCE_SENTENCE);
    expect(gap.confidence).toBe(0.8);
    expect(gap.systemReasoningSummary).toBe("该缺口解释 1 个表面信号，2 条证据可直接定位到输入材料");
  });

  it("marks missing evidence as inferred and lowers confidence", () => {
    const report = makeReport();
    report.sections.dangerousGaps[0].confidence = 0.5;
    report.sections.dangerousGaps[0].evidence = "a claim that never appears in the source material";
    report.sections.dangerousGaps[0].surfaceSignals = ["another absent signal"];
    const gap = createGapFromReport({
      report,
      gapRef: { gapRank: 1 },
      userId: "user-1",
      now: "2026-07-30T00:00:00.000Z"
    });
    expect(gap.evidence.every((item: any) => item.evidenceType === "inferred")).toBe(true);
    // 0.5 * 0.7 * 0.7 = 0.245, and the all-unlocated cap of 0.35 does not bind.
    expect(gap.confidence).toBeCloseTo(0.245, 3);
    expect(gap.confidence).toBeLessThanOrEqual(0.35);
  });

  it("caps confidence at 0.35 when every evidence candidate is unlocated", () => {
    const report = makeReport();
    report.sections.dangerousGaps[0].confidence = 0.5;
    report.sections.dangerousGaps[0].evidence = "absent from the artifact";
    report.sections.dangerousGaps[0].surfaceSignals = [];
    const gap = createGapFromReport({ report, gapRef: { gapRank: 1 }, userId: "user-1" });
    expect(gap.confidence).toBeLessThanOrEqual(0.35);
    expect(gap.confidence).toBeCloseTo(0.35, 3);
  });

  it("never fabricates locations: unlocated evidence stays unlocated", () => {
    const report = makeReport();
    report.sections.dangerousGaps[0].evidence = "definitely not in the artifact text";
    const gap = createGapFromReport({ report, gapRef: { gapRank: 1 }, userId: "user-1" });
    const inferred = gap.evidence.find((item: any) => item.excerpt.includes("definitely not"));
    expect(inferred.sourceLocation.kind).toBe("unlocated");
    expect(inferred.sourceLocation.start).toBeUndefined();
  });

  it("resolves a gap through a feynman card reference", () => {
    const gap = createGapFromReport({
      report: makeReport(),
      gapRef: { cardId: "card-1" },
      userId: "user-1"
    });
    expect(gap.cardId).toBe("card-1");
    expect(gap.gapRank).toBe(1);
    expect(gap.title).toBe("Root-cause verification gap");
  });

  it("throws when the requested gap rank does not exist", () => {
    expect(() => createGapFromReport({
      report: makeReport(),
      gapRef: { gapRank: 9 },
      userId: "user-1"
    })).toThrow(/not found/i);
  });
});

describe("cognitive repayment store", () => {
  const storePath = path.resolve("tmp/cognitive-repayment-store-test.json");
  afterEach(async () => {
    await rm(storePath, { force: true });
  });

  it("round-trips gaps and enforces ownership on reads", async () => {
    const store = createCognitiveRepaymentStore(storePath);
    await store.load();
    const gap = createGapFromReport({ report: makeReport(), gapRef: { gapRank: 1 }, userId: "user-1" });
    await store.saveGap(gap);
    expect(store.getGap(gap.gapId, "user-1").gapId).toBe(gap.gapId);
    expect(() => store.getGap(gap.gapId, "user-2")).toThrow("Repayment gap not found");
    expect(() => store.getGap("missing", "user-1")).toThrow("Repayment gap not found");
    expect(store.listGaps("user-1")).toHaveLength(1);
    expect(store.listGaps("user-1", { status: "identified" })).toHaveLength(1);
    expect(store.listGaps("user-1", { status: "repaid" })).toHaveLength(0);

    const reloaded = createCognitiveRepaymentStore(storePath);
    await reloaded.load();
    expect(reloaded.getGap(gap.gapId, "user-1").title).toBe(gap.title);
  });

  it("deduplicates attempts by clientAttemptId within the same gap", async () => {
    const store = createCognitiveRepaymentStore(storePath);
    await store.load();
    const attempt = {
      attemptId: "attempt-1",
      gapId: "gap-1",
      userId: "user-1",
      answer: "because the port was wrong",
      submittedAt: "2026-07-30T00:00:00.000Z",
      evaluation: { passed: false },
      clientAttemptId: "client-1"
    };
    const first = await store.saveAttempt(attempt);
    expect(first.deduplicated).toBe(false);
    const second = await store.saveAttempt({ ...attempt, attemptId: "attempt-2" });
    expect(second.deduplicated).toBe(true);
    expect(second.record.attemptId).toBe("attempt-1");
    expect(store.listAttemptsForGap("gap-1")).toHaveLength(1);
    expect(store.findAttemptByClientId("gap-1", "client-1")?.attemptId).toBe("attempt-1");
    expect(store.findAttemptByClientId("gap-1", "nope")).toBeNull();
  });

  it("loads legacy files with missing arrays as empty collections", async () => {
    const store = createCognitiveRepaymentStore(storePath);
    await store.load();
    expect(store.getState()).toMatchObject({ version: 1, gaps: [], attempts: [], reviewQueue: [], capabilityProfiles: [] });
  });
});

describe("gap status state machine", () => {
  it("accepts every documented legal transition", () => {
    for (const from of GAP_STATUSES) {
      for (const to of VALID_TRANSITIONS[from]) {
        expect(canTransition(from, to)).toBe(true);
        const gap = { status: from, statusHistory: [], updatedAt: "2026-07-30T00:00:00.000Z" };
        transitionGapStatus(gap, to, { reason: "test", now: "2026-07-30T01:00:00.000Z" });
        expect(gap.status).toBe(to);
        expect(gap.statusHistory).toEqual([{ from, to, at: "2026-07-30T01:00:00.000Z", reason: "test" }]);
        expect(gap.updatedAt).toBe("2026-07-30T01:00:00.000Z");
      }
    }
  });

  it("rejects illegal transitions", () => {
    const illegal: Array<[string, string]> = [
      ["identified", "repaid"],
      ["identified", "partiallyRepaid"],
      ["repaid", "partiallyRepaid"],
      ["reviewDue", "repaid"],
      ["archived", "attempting"],
      ["queued", "repaid"]
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to)).toBe(false);
      const gap = { status: from, statusHistory: [] };
      expect(() => transitionGapStatus(gap, to, { reason: "test" })).toThrow(/Invalid gap status transition/);
      expect(gap.status).toBe(from);
    }
  });
});

describe("attempt records and outcome", () => {
  function makeGap(status = "attempting") {
    return {
      gapId: "gap-1",
      userId: "user-1",
      reportId: "report-1",
      title: "Root-cause verification",
      status,
      statusHistory: [],
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z"
    };
  }

  it("builds an attempt record with versions and sanitized fields", () => {
    const attempt = buildAttemptRecord({
      gap: makeGap(),
      answer: "x".repeat(7000),
      selfConfidence: 9,
      evaluation: { passed: false },
      feedback: "keep going",
      nextQuestion: "why?",
      repaymentStatus: "attempting",
      fallbackUsed: false,
      modelProvider: "deepseek",
      modelName: "deepseek-v4-flash",
      now: "2026-07-30T01:00:00.000Z"
    });
    expect(attempt.answer).toHaveLength(6000);
    expect(attempt.selfConfidence).toBeNull();
    expect(attempt.evaluatorVersion).toBe(EVALUATOR_VERSION);
    expect(attempt.promptSchemaVersion).toBe(PROMPT_SCHEMA_VERSION);
    expect(attempt.dataSchemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(attempt.errorCategory).toBeNull();
    expect(attempt.clientAttemptId).toBeNull();
    expect(attempt.fallbackUsed).toBe(false);
    expect(attempt.submittedAt).toBe("2026-07-30T01:00:00.000Z");
    const withConfidence = buildAttemptRecord({ gap: makeGap(), answer: "a", selfConfidence: 4, evaluation: { passed: false } });
    expect(withConfidence.selfConfidence).toBe(4);
  });

  it("never marks a gap repaid after a single passed attempt", () => {
    const gap = makeGap();
    const first = buildAttemptRecord({ gap, answer: "solid", evaluation: { passed: true }, repaymentStatus: "partiallyRepaid" });
    applyAttemptOutcome(gap, first, { now: "2026-07-30T01:00:00.000Z", previousAttempts: [] });
    expect(gap.status).toBe("partiallyRepaid");

    // Back to attempting for the second independent explanation.
    transitionGapStatus(gap, "attempting", { reason: "再次作答", now: "2026-07-30T02:00:00.000Z" });
    const second = buildAttemptRecord({ gap, answer: "solid again", evaluation: { passed: true }, repaymentStatus: "repaid" });
    applyAttemptOutcome(gap, second, { now: "2026-07-30T02:30:00.000Z", previousAttempts: [first] });
    expect(gap.status).toBe("repaid");
    expect(gap.statusHistory.map((entry: any) => entry.to)).toEqual(["partiallyRepaid", "attempting", "partiallyRepaid", "repaid"]);
  });

  it("keeps the gap attempting when the answer fails", () => {
    const gap = makeGap();
    const failed = buildAttemptRecord({ gap, answer: "unclear", evaluation: { passed: false }, repaymentStatus: "attempting" });
    applyAttemptOutcome(gap, failed, { previousAttempts: [] });
    expect(gap.status).toBe("attempting");
    expect(gap.statusHistory).toHaveLength(1);
  });

  it("ignores the current attempt when checking for a prior pass", () => {
    const attempt = buildAttemptRecord({ gap: makeGap(), answer: "a", evaluation: { passed: true } });
    expect(resolveAttemptOutcome(attempt, [attempt])).toBe("partiallyRepaid");
    expect(resolveAttemptOutcome(attempt, [{ attemptId: "other", evaluation: { passed: true } }])).toBe("repaid");
  });

  it("refuses to apply an outcome outside the attempting state", () => {
    const gap = makeGap("identified");
    const attempt = buildAttemptRecord({ gap, answer: "a", evaluation: { passed: true } });
    expect(() => applyAttemptOutcome(gap, attempt, { previousAttempts: [] })).toThrow(/attempting/);
  });
});

describe("multidimensional evaluation normalization", () => {
  function validModelOutput() {
    return {
      dimensions: {
        conceptualUnderstanding: { score: 85, evidence: "端口配置错误", feedback: "概念准确", uncertainty: "low" },
        causalExplanation: { score: 80, evidence: "因为端口错所以重启无效", feedback: "因果链完整", uncertainty: "medium" },
        practicalReproduction: { score: 75, evidence: "用日志验证", feedback: "补充指标", uncertainty: "medium" },
        boundariesAndRisks: { score: 60, evidence: "但是负载高时", feedback: "边界不完整", uncertainty: "high" },
        transferAbility: { score: 50, evidence: "例如数据库场景", feedback: "迁移偏少", uncertainty: "medium" }
      },
      overallFeedback: "因果解释正确，但边界分析不足，下次补充失效条件。",
      nextQuestion: "什么情况下修复会再次失效？"
    };
  }

  it("normalizes a valid model evaluation with weighted overall and pass rule", () => {
    const result = normalizeRepaymentEvaluation(validModelOutput());
    expect(result.overallScore).toBe(Math.round(85 * 0.25 + 80 * 0.25 + 75 * 0.2 + 60 * 0.15 + 50 * 0.15));
    expect(result.passed).toBe(true);
    expect(result.dimensions.causalExplanation.uncertainty).toBe("medium");
    expect(result.overallFeedback).toContain("边界分析不足");
    expect(result.nextQuestion).toContain("失效");
  });

  it("fails the pass rule when any dimension is below 40 even with high overall", () => {
    const output = validModelOutput();
    output.dimensions.transferAbility.score = 30;
    output.dimensions.boundariesAndRisks.score = 95;
    output.dimensions.conceptualUnderstanding.score = 95;
    output.dimensions.causalExplanation.score = 95;
    output.dimensions.practicalReproduction.score = 95;
    const result = normalizeRepaymentEvaluation(output);
    expect(result.overallScore).toBeGreaterThanOrEqual(70);
    expect(result.passed).toBe(false);
  });

  it("throws a schema error when a dimension or its score is missing", () => {
    const output = validModelOutput();
    delete output.dimensions.transferAbility;
    expect(() => normalizeRepaymentEvaluation(output)).toThrowError(/transferAbility/);
    try {
      normalizeRepaymentEvaluation(output);
      expect.unreachable();
    } catch (error: any) {
      expect(error.errorCategory).toBe("schema");
    }
    const badScore = validModelOutput();
    badScore.dimensions.causalExplanation.score = "high";
    expect(() => normalizeRepaymentEvaluation(badScore)).toThrowError(/causalExplanation/);
  });

  it("rejects placeholder content in any learner-facing string", () => {
    for (const bad of ["TODO", "{{dimension}}", "N/A", "lorem ipsum", "__blank__"]) {
      const output = validModelOutput();
      output.dimensions.causalExplanation.feedback = `这里 ${bad} 有问题`;
      try {
        normalizeRepaymentEvaluation(output);
        expect.unreachable();
      } catch (error: any) {
        expect(error.errorCategory).toBe("placeholder");
      }
    }
    const inOverall = validModelOutput();
    inOverall.overallFeedback = "FIXME later";
    expect(() => normalizeRepaymentEvaluation(inOverall)).toThrowError(/placeholder/i);
  });

  it("clamps scores, truncates text and defaults uncertainty per dimension", () => {
    const dim = normalizeDimensionEvaluation({ score: 140, evidence: "e".repeat(500), feedback: "f".repeat(500) });
    expect(dim.score).toBe(100);
    expect(dim.evidence).toHaveLength(400);
    expect(dim.feedback).toHaveLength(400);
    expect(dim.uncertainty).toBe("medium");
    expect(normalizeDimensionEvaluation({ score: -5 }).score).toBe(0);
    expect(normalizeDimensionEvaluation({ score: 55, uncertainty: "LOW" }).uncertainty).toBe("low");
  });
});

describe("deterministic fallback evaluation", () => {
  const gap = { title: "Root-cause verification gap", verificationMethod: "How do you verify the fix?" };
  const answer = "因为 upstream 端口配置错误，所以 nginx 重启没有解决根因。我通过查看日志验证了这个假设，但是高并发场景下仍可能失败。例如数据库连接池也是同样的机制。";

  it("produces identical output for identical input", () => {
    const first = createFallbackEvaluation({ gap, answer });
    const second = createFallbackEvaluation({ gap, answer });
    expect(first).toEqual(second);
  });

  it("covers all five dimensions with quoted evidence and high uncertainty", () => {
    const result = createFallbackEvaluation({ gap, answer });
    for (const dimension of DIMENSIONS) {
      const entry = result.dimensions[dimension];
      expect(entry).toBeDefined();
      expect(typeof entry.score).toBe("number");
      expect(entry.score).toBeGreaterThan(0);
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(entry.evidence.length).toBeLessThanOrEqual(80);
      expect(answer).toContain(entry.evidence.slice(0, 20));
      expect(entry.feedback.length).toBeGreaterThan(0);
      expect(entry.uncertainty).toBe("high");
    }
    expect(result.overallScore).toBeGreaterThan(0);
    expect(typeof result.passed).toBe("boolean");
    expect(result.overallFeedback).toContain("离线规则评估");
  });

  it("never lets a fallback evaluation pass the repayment threshold", () => {
    const rich = "因为所以导致因此 verify test measure log reproduce 验证测试指标日志监控复现 但是然而除非风险边界 however unless risk boundary 例如另一个场景迁移 for example another scenario transfer ".repeat(6);
    const result = createFallbackEvaluation({ gap, answer: rich });
    expect(result.passed).toBe(false);
  });

  it("degrades to zero scores with concrete guidance on an empty answer", () => {
    const result = createFallbackEvaluation({ gap, answer: "" });
    for (const dimension of DIMENSIONS) {
      expect(result.dimensions[dimension].score).toBe(0);
      expect(result.dimensions[dimension].feedback.length).toBeGreaterThan(0);
    }
    expect(result.passed).toBe(false);
  });
});

describe("repayment evaluation prompt", () => {
  it("requires five dimensions, learner language and forbids mastery claims", () => {
    const prompt = getRepaymentEvaluationPrompt();
    for (const dimension of DIMENSIONS) {
      expect(prompt).toContain(dimension);
    }
    expect(prompt).toContain("overallFeedback");
    expect(prompt).toContain("nextQuestion");
    expect(prompt).toContain("禁止宣称学习者已经长期掌握");
    expect(prompt).toContain("真实片段");
  });
});
