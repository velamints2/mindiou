import crypto from "node:crypto";

// ── Cognitive Repayment V1: pure domain logic (no I/O) ──

export const EVALUATOR_VERSION = "repayment-eval-v1";
export const PROMPT_SCHEMA_VERSION = "repayment-eval-schema-1";
export const DATA_SCHEMA_VERSION = "repayment-data-1";

export const GAP_STATUSES = [
  "identified",
  "queued",
  "attempting",
  "partiallyRepaid",
  "repaid",
  "reviewDue",
  "archived"
];

export const DIMENSIONS = [
  "conceptualUnderstanding",
  "causalExplanation",
  "practicalReproduction",
  "boundariesAndRisks",
  "transferAbility"
];

export const DIM_WEIGHTS = {
  conceptualUnderstanding: 0.25,
  causalExplanation: 0.25,
  practicalReproduction: 0.2,
  boundariesAndRisks: 0.15,
  transferAbility: 0.15
};

export const VALID_TRANSITIONS = {
  identified: ["queued", "attempting", "archived"],
  queued: ["attempting", "identified", "archived"],
  attempting: ["attempting", "partiallyRepaid", "queued", "archived"],
  partiallyRepaid: ["attempting", "repaid", "reviewDue", "archived"],
  repaid: ["reviewDue", "attempting", "archived"],
  reviewDue: ["attempting", "archived"],
  archived: ["identified"]
};

export function canTransition(from, to) {
  return Array.isArray(VALID_TRANSITIONS[from]) && VALID_TRANSITIONS[from].includes(to);
}

export function transitionGapStatus(gap, to, { reason = "", now = new Date().toISOString() } = {}) {
  if (!gap || !canTransition(gap.status, to)) {
    throw new Error(`Invalid gap status transition: ${gap?.status} -> ${to}`);
  }
  const from = gap.status;
  gap.status = to;
  if (!Array.isArray(gap.statusHistory)) gap.statusHistory = [];
  gap.statusHistory.push({ from, to, at: now, reason: String(reason || "") });
  gap.updatedAt = now;
  return gap;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

// Lowercases and collapses whitespace while keeping a map from each
// normalized character index back to its offset in the original string, so
// located excerpts always report true offsets into the source artifact.
function normalizeWithMap(text) {
  const original = String(text || "");
  let normalized = "";
  const indexMap = [];
  let pendingSpace = -1;
  for (let index = 0; index < original.length; index += 1) {
    const char = original[index];
    if (/\s/.test(char)) {
      if (normalized.length > 0 && pendingSpace < 0) pendingSpace = index;
    } else {
      if (pendingSpace >= 0) {
        normalized += " ";
        indexMap.push(pendingSpace);
        pendingSpace = -1;
      }
      normalized += char.toLowerCase();
      indexMap.push(index);
    }
  }
  return { original, normalized, indexMap };
}

function locateInArtifact(artifact, needle) {
  if (!needle) return null;
  const at = artifact.normalized.indexOf(needle);
  if (at < 0) return null;
  return {
    start: artifact.indexMap[at],
    end: artifact.indexMap[at + needle.length - 1] + 1
  };
}

function resolveGapFromReport(report, gapRef) {
  const gaps = Array.isArray(report?.sections?.dangerousGaps) ? report.sections.dangerousGaps : [];
  if (gaps.length === 0) {
    throw new Error("Report has no dangerous gaps to import");
  }
  if (gapRef?.cardId) {
    const cards = Array.isArray(report?.sections?.feynmanCards) ? report.sections.feynmanCards : [];
    const card = cards.find(item => item && item.id === gapRef.cardId) || null;
    if (!card) {
      throw new Error(`Card not found in report: ${gapRef.cardId}`);
    }
    const target = clean(card.target || "");
    const matched = gaps.find(item => clean(item?.gap || "") === target || clean(item?.title || "") === target);
    return { gap: matched || gaps[0], card };
  }
  const rank = Number(gapRef?.gapRank);
  if (!Number.isFinite(rank)) {
    throw new Error("Missing gapRank or cardId");
  }
  const matched = gaps.find(item => Number(item?.rank) === rank);
  if (!matched) {
    throw new Error(`Gap not found in report: rank ${rank}`);
  }
  return { gap: matched, card: null };
}

function buildEvidence(gap, artifactText) {
  const candidates = [];
  if (clean(gap?.evidence || "")) candidates.push(gap.evidence);
  const signals = Array.isArray(gap?.surfaceSignals) ? gap.surfaceSignals : [];
  for (const signal of signals) {
    if (clean(signal || "")) candidates.push(signal);
  }
  const artifact = normalizeWithMap(artifactText);
  const evidence = [];
  for (const candidate of candidates) {
    const excerpt = clean(candidate).slice(0, 300);
    const needle = normalizeWithMap(candidate).normalized;
    const located = locateInArtifact(artifact, needle);
    if (located) {
      evidence.push({
        excerpt,
        evidenceType: "direct_quote",
        sourceLocation: { kind: "artifact", start: located.start, end: located.end }
      });
    } else {
      evidence.push({
        excerpt,
        evidenceType: "inferred",
        sourceLocation: { kind: "unlocated" }
      });
    }
  }
  if (evidence.length === 0) {
    evidence.push({
      excerpt: clean(gap?.gap || "").slice(0, 300),
      evidenceType: "inferred",
      sourceLocation: { kind: "unlocated" }
    });
  }
  return evidence;
}

function deriveConfidence(gap, evidence) {
  const base = typeof gap?.confidence === "number" && Number.isFinite(gap.confidence)
    ? Math.max(0, Math.min(1, gap.confidence))
    : 0.5;
  const unlocated = evidence.filter(item => item.sourceLocation.kind === "unlocated").length;
  let confidence = base * Math.pow(0.7, unlocated);
  confidence = Math.max(0.1, confidence);
  if (evidence.length > 0 && unlocated === evidence.length) {
    confidence = Math.min(confidence, 0.35);
  }
  return Math.round(confidence * 1000) / 1000;
}

/**
 * Imports one dangerous gap from an MVP-0 report into a repayment gap with
 * evidence bound back to the original artifact. Legacy reports missing
 * fields always degrade to explicit defaults instead of throwing.
 */
export function createGapFromReport({ report, gapRef, userId, now = new Date().toISOString() } = {}) {
  if (!report || !report.id) {
    throw new Error("A report is required to import a repayment gap");
  }
  const { gap, card } = resolveGapFromReport(report, gapRef || {});
  const artifactText = String(report?.input?.artifactText || "");
  const evidence = buildEvidence(gap, artifactText);
  const surfaceCount = (Array.isArray(gap?.surfaceSignals) ? gap.surfaceSignals : [])
    .filter(signal => clean(signal || "")).length;
  const locatedCount = evidence.filter(item => item.sourceLocation.kind === "artifact").length;
  let systemReasoningSummary = `该缺口解释 ${surfaceCount} 个表面信号，${locatedCount} 条证据可直接定位到输入材料`;
  if (evidence.length > 0 && locatedCount === 0) {
    systemReasoningSummary += "；证据无法定位，已标记为推断型缺口";
  }
  const masteryCriteria = Array.isArray(gap?.masteryCriteria) ? gap.masteryCriteria : [];
  const verificationMethod = clean(gap?.diagnosticQuestion || "")
    || clean(masteryCriteria[0] || "")
    || "用自己的话解释关键机制，并给出可验证的证据";
  return {
    gapId: crypto.randomUUID(),
    userId: clean(userId || ""),
    reportId: report.id,
    cardId: card ? card.id : null,
    gapRank: Number.isFinite(Number(gap?.rank)) ? Number(gap.rank) : (Number(gapRef?.gapRank) || null),
    title: clean(gap?.title || gap?.gap || "").slice(0, 200),
    whyItMatters: clean(gap?.whyDangerous || ""),
    evidence,
    systemReasoningSummary,
    confidence: deriveConfidence(gap, evidence),
    userCapabilityLevel: clean(report?.analysis?.userCapability?.overall || "") || "unknown",
    verificationMethod,
    status: "identified",
    statusHistory: [],
    createdAt: now,
    updatedAt: now,
    dataSchemaVersion: DATA_SCHEMA_VERSION
  };
}

// ── Attempts and repayment outcome ──

/**
 * Resolves the resulting gap status for one evaluated attempt. A single
 * passed attempt can never reach "repaid" directly; a second independent
 * pass is required.
 */
export function resolveAttemptOutcome(attempt, previousAttempts = []) {
  const passed = Boolean(attempt?.evaluation?.passed);
  if (!passed) return "attempting";
  const priorPass = (Array.isArray(previousAttempts) ? previousAttempts : []).some(
    item => item && item.attemptId !== attempt.attemptId && Boolean(item?.evaluation?.passed)
  );
  return priorPass ? "repaid" : "partiallyRepaid";
}

export function buildAttemptRecord({
  gap,
  answer,
  selfConfidence,
  evaluation,
  feedback,
  nextQuestion,
  repaymentStatus,
  fallbackUsed,
  errorCategory,
  modelProvider,
  modelName,
  clientAttemptId,
  now = new Date().toISOString()
} = {}) {
  const confidence = Number(selfConfidence);
  return {
    attemptId: crypto.randomUUID(),
    gapId: gap.gapId,
    userId: gap.userId,
    answer: String(answer || "").slice(0, 6000),
    submittedAt: now,
    selfConfidence: Number.isInteger(confidence) && confidence >= 1 && confidence <= 5 ? confidence : null,
    evaluation,
    feedback: String(feedback || ""),
    nextQuestion: String(nextQuestion || ""),
    repaymentStatus: String(repaymentStatus || "attempting"),
    evaluatorVersion: EVALUATOR_VERSION,
    promptSchemaVersion: PROMPT_SCHEMA_VERSION,
    dataSchemaVersion: DATA_SCHEMA_VERSION,
    modelProvider: String(modelProvider || ""),
    modelName: String(modelName || ""),
    fallbackUsed: Boolean(fallbackUsed),
    errorCategory: errorCategory || null,
    clientAttemptId: clientAttemptId ? String(clientAttemptId).slice(0, 100) : null
  };
}

/**
 * Advances the gap status after an attempt. The gap must already be in
 * "attempting" (self-transition is legal and used to record the outcome).
 */
export function applyAttemptOutcome(gap, attempt, { now = new Date().toISOString(), previousAttempts = [] } = {}) {
  if (gap?.status !== "attempting") {
    throw new Error(`Cannot apply attempt outcome unless the gap is attempting (current: ${gap?.status})`);
  }
  const outcome = resolveAttemptOutcome(attempt, previousAttempts);
  if (outcome === "repaid") {
    // attempting -> repaid is not a legal direct transition; the pass is
    // recorded first, then the second independent pass promotes the gap.
    transitionGapStatus(gap, "partiallyRepaid", { reason: "本次回答通过", now });
    return transitionGapStatus(gap, "repaid", { reason: "再次独立通过，标记为已清偿", now });
  }
  const reasons = {
    attempting: "回答未通过，保持清偿中",
    partiallyRepaid: "首次通过，需要间隔后再次独立验证"
  };
  return transitionGapStatus(gap, outcome, { reason: reasons[outcome], now });
}
