// @ts-nocheck
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  DATA_SCHEMA_VERSION,
  GAP_STATUSES,
  createGapFromReport
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
