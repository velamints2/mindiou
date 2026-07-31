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

// ── Multidimensional repayment evaluation ──

const PLACEHOLDER_PATTERN = /TODO|FIXME|PLACEHOLDER|lorem ipsum|\{\{|\}\}|__\w+__|N\/A/i;

function placeholderError(text) {
  const error = new Error(`Evaluation contains placeholder content: ${String(text || "").slice(0, 60)}`);
  error.errorCategory = "placeholder";
  return error;
}

function schemaError(message) {
  const error = new Error(message);
  error.errorCategory = "schema";
  return error;
}

function assertNoPlaceholder(text) {
  if (PLACEHOLDER_PATTERN.test(String(text || ""))) {
    throw placeholderError(text);
  }
}

export function normalizeDimensionEvaluation(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const evidence = clean(entry.evidence || "").slice(0, 400);
  const feedback = clean(entry.feedback || "").slice(0, 400);
  assertNoPlaceholder(evidence);
  assertNoPlaceholder(feedback);
  const numeric = Number(entry.score);
  const score = Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
  const uncertainty = ["low", "medium", "high"].includes(clean(entry.uncertainty || "").toLowerCase())
    ? clean(entry.uncertainty || "").toLowerCase()
    : "medium";
  return { score, evidence, feedback, uncertainty };
}

/**
 * Validates and normalizes the model's five-dimension evaluation. Missing
 * dimensions or non-numeric scores throw a schema error; placeholder text in
 * any learner-facing string throws a placeholder error. Callers convert both
 * into the deterministic fallback.
 */
export function normalizeRepaymentEvaluation(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const container = source.dimensions && typeof source.dimensions === "object" ? source.dimensions : source;
  const dimensions = {};
  for (const dimension of DIMENSIONS) {
    const entry = container[dimension];
    if (!entry || typeof entry !== "object" || typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
      throw schemaError(`Repayment evaluation is missing a valid score for dimension: ${dimension}`);
    }
    dimensions[dimension] = normalizeDimensionEvaluation(entry);
  }
  const overallFeedback = clean(source.overallFeedback || "").slice(0, 400);
  const nextQuestion = clean(source.nextQuestion || "").slice(0, 400);
  assertNoPlaceholder(overallFeedback);
  assertNoPlaceholder(nextQuestion);
  const overallScore = Math.round(
    DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension].score * DIM_WEIGHTS[dimension], 0)
  );
  const minScore = Math.min(...DIMENSIONS.map(dimension => dimensions[dimension].score));
  return {
    dimensions,
    overallScore,
    passed: overallScore >= 70 && minScore >= 40,
    overallFeedback,
    nextQuestion
  };
}

const CAUSAL_WORDS = ["因为", "所以", "导致", "因此", "because", "therefore", "so that"];
const VERIFY_WORDS = ["验证", "测试", "指标", "日志", "监控", "复现", "verify", "test", "measure", "log", "reproduce"];
const BOUNDARY_WORDS = ["但是", "然而", "除非", "风险", "边界", "however", "unless", "risk", "boundary"];
const TRANSFER_WORDS = ["例如", "另一个", "场景", "迁移", "for example", "another", "scenario", "transfer"];

const DIMENSION_LABELS = {
  conceptualUnderstanding: "概念理解",
  causalExplanation: "因果解释",
  practicalReproduction: "实践复现",
  boundariesAndRisks: "边界与风险",
  transferAbility: "迁移能力"
};

function countHits(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.reduce((count, word) => count + (lower.includes(word.toLowerCase()) ? 1 : 0), 0);
}

function fragmentAround(answer, words) {
  const text = String(answer || "");
  if (!text.trim()) return "";
  const lower = text.toLowerCase();
  let best = -1;
  for (const word of words) {
    const at = lower.indexOf(word.toLowerCase());
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  const start = best >= 0 ? Math.max(0, best - 10) : 0;
  return text.slice(start, start + 80).trim();
}

function titleTokens(title) {
  return String(title || "")
    .toLowerCase()
    .split(/[^a-z0-9一-鿿]+/)
    .filter(token => token.length >= 2);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Deterministic rule-based evaluation used whenever the model path fails.
 * Same input always produces the same output; every dimension quotes a real
 * fragment of the learner's answer; uncertainty is always high.
 */
export function createFallbackEvaluation({ gap, answer } = {}) {
  const text = String(answer || "");
  const trimmed = text.trim();
  const lengthScore = Math.min(20, Math.floor(trimmed.length / 25));
  const lower = trimmed.toLowerCase();
  const tokens = titleTokens(gap?.title || "");
  const matchedTokens = tokens.filter(token => lower.includes(token));
  const overlap = tokens.length > 0 ? matchedTokens.length / tokens.length : 0;
  const causalHits = countHits(trimmed, CAUSAL_WORDS);
  const verifyHits = countHits(trimmed, VERIFY_WORDS);
  const boundaryHits = countHits(trimmed, BOUNDARY_WORDS);
  const transferHits = countHits(trimmed, TRANSFER_WORDS);
  const title = clean(gap?.title || "").slice(0, 30) || "该欠条";

  const dimensions = {
    conceptualUnderstanding: {
      score: clampScore(lengthScore + overlap * 40),
      evidence: fragmentAround(trimmed, matchedTokens.length > 0 ? matchedTokens : tokens),
      feedback: matchedTokens.length > 0
        ? "回答覆盖了欠条主题的关键概念，请继续补充机制层面的细节。"
        : `回答与欠条主题的关键词重合度低。请围绕「${title}」直接解释核心机制。`,
      uncertainty: "high"
    },
    causalExplanation: {
      score: clampScore(lengthScore + Math.min(45, causalHits * 15)),
      evidence: fragmentAround(trimmed, CAUSAL_WORDS),
      feedback: causalHits > 0
        ? "已包含因果说明，请检查因果链是否完整闭合。"
        : "回答缺少因果连接（因为/所以/导致/因此）。请说明哪个原因导致哪个结果。",
      uncertainty: "high"
    },
    practicalReproduction: {
      score: clampScore(lengthScore + Math.min(45, verifyHits * 15)),
      evidence: fragmentAround(trimmed, VERIFY_WORDS),
      feedback: verifyHits > 0
        ? "已提到验证手段，请补充具体指标、日志或复现步骤。"
        : "缺少可验证的复现信号（测试/指标/日志/复现步骤）。请给出如何验证修复有效。",
      uncertainty: "high"
    },
    boundariesAndRisks: {
      score: clampScore(lengthScore + Math.min(45, boundaryHits * 15 + verifyHits * 10)),
      evidence: fragmentAround(trimmed, [...BOUNDARY_WORDS, ...VERIFY_WORDS]),
      feedback: boundaryHits > 0
        ? "已提及边界或风险，请说明具体的触发条件。"
        : "未说明边界条件或风险（但是/除非/风险）。请指出方案在什么情况下会失效。",
      uncertainty: "high"
    },
    transferAbility: {
      score: clampScore(lengthScore + Math.min(45, transferHits * 15)),
      evidence: fragmentAround(trimmed, TRANSFER_WORDS),
      feedback: transferHits > 0
        ? "已给出迁移例子，请确认不同场景背后的机制一致。"
        : "缺少迁移场景（例如/另一个场景）。请举一个不同场景说明同一机制。",
      uncertainty: "high"
    }
  };

  const overallScore = Math.round(
    DIMENSIONS.reduce((sum, dimension) => sum + dimensions[dimension].score * DIM_WEIGHTS[dimension], 0)
  );
  const minScore = Math.min(...DIMENSIONS.map(dimension => dimensions[dimension].score));
  const weakest = [...DIMENSIONS]
    .sort((a, b) => dimensions[a].score - dimensions[b].score || a.localeCompare(b))
    .slice(0, 2)
    .map(dimension => DIMENSION_LABELS[dimension]);
  const verification = clean(gap?.verificationMethod || "") || "关键机制";
  return {
    dimensions,
    overallScore,
    passed: overallScore >= 70 && minScore >= 40,
    overallFeedback: `本次使用离线规则评估（模型不可用），结果偏保守，仅供参考。相对薄弱的维度：${weakest.join("、")}。`,
    nextQuestion: `请针对「${verification.slice(0, 60)}」重新解释，并补充缺失的信号。`
  };
}

export function getRepaymentEvaluationPrompt() {
  return [
    "你是 MindIOU 认知清偿评估器。你只评估学习者在本次回答中实际展示出的理解，不评估其潜力或过往表现。",
    "必须使用学习者回答所使用的语言撰写全部 feedback 与追问。",
    "严格返回一个 JSON 对象，结构如下：",
    '{ "dimensions": { "conceptualUnderstanding": { "score": 0-100 整数, "evidence": "引用学习者回答的真实片段", "feedback": "具体反馈", "uncertainty": "low|medium|high" }, "causalExplanation": {同上}, "practicalReproduction": {同上}, "boundariesAndRisks": {同上}, "transferAbility": {同上} }, "overallFeedback": "先指出回答中正确的内容，再指出一个具体的遗漏或误解，最后给出一个有用的下一步", "nextQuestion": "一个简短的追问" }',
    "五个维度一个都不能少；score 必须是数字。",
    "评分锚点：0-39 未展示该能力；40-69 部分展示但有明显遗漏；70-89 基本展示且有证据；90-100 完整展示且可迁移。",
    "evidence 必须引用学习者回答中的真实片段，不得编造或改写。",
    "禁止空泛反馈（如“不错”“继续努力”）；每条反馈必须指出具体的内容或缺失。",
    "禁止宣称学习者已经长期掌握、已认证或已熟练；一次回答只能作为本次会话的证据。",
    "不得输出占位符、模板残留或英文标记词。"
  ].join("\n");
}

// ── Review queue ──

const HOUR_MS = 60 * 60 * 1000;

/**
 * Keeps at most one pending review item per gap: an existing pending item is
 * updated in place, otherwise a new one is appended.
 */
export function upsertReviewItemForGap({ reviewQueue, gap, attempt, now = new Date().toISOString() } = {}) {
  if (!Array.isArray(reviewQueue)) {
    throw new Error("A reviewQueue array is required");
  }
  const passed = Boolean(attempt?.evaluation?.passed);
  const base = new Date(now).getTime();
  let dueAt;
  let priority;
  let nextQuestionType;
  let reason;
  if (!passed) {
    dueAt = new Date(base + 12 * HOUR_MS).toISOString();
    priority = "high";
    nextQuestionType = "boundary_probe";
    reason = "回答未通过，需要针对遗漏点重新解释";
  } else if (gap?.status === "repaid") {
    dueAt = new Date(base + 72 * HOUR_MS).toISOString();
    priority = "low";
    nextQuestionType = "transfer_scenario";
    reason = "已清偿，到期迁移场景验证";
  } else {
    dueAt = new Date(base + 24 * HOUR_MS).toISOString();
    priority = "medium";
    nextQuestionType = "feynman_reexplain";
    reason = "首次通过，需要间隔后再次独立解释";
  }
  const existing = reviewQueue.find(item => item.gapId === gap.gapId && item.status === "pending");
  if (existing) {
    existing.dueAt = dueAt;
    existing.priority = priority;
    existing.reason = reason;
    existing.nextQuestionType = nextQuestionType;
    existing.lastResult = passed ? "passed" : "failed";
    existing.attemptCount = (existing.attemptCount || 0) + 1;
    existing.updatedAt = now;
    return existing;
  }
  const item = {
    reviewItemId: crypto.randomUUID(),
    gapId: gap.gapId,
    userId: gap.userId,
    dueAt,
    priority,
    reason,
    attemptCount: 1,
    lastResult: passed ? "passed" : "failed",
    nextQuestionType,
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
  reviewQueue.push(item);
  return item;
}

/**
 * A repaid gap with an overdue pending review item moves to reviewDue.
 */
export function refreshReviewDue(gap, { now = new Date().toISOString(), reviewQueue = [] } = {}) {
  if (gap?.status !== "repaid") return gap;
  const nowMs = new Date(now).getTime();
  const due = (Array.isArray(reviewQueue) ? reviewQueue : []).some(
    item => item.gapId === gap.gapId && item.status === "pending" && new Date(item.dueAt).getTime() <= nowMs
  );
  if (!due) return gap;
  return transitionGapStatus(gap, "reviewDue", { reason: "复习到期，需要再次验证", now });
}

/**
 * When a new attempt starts, pending review items for the gap are completed.
 */
export function completePendingReviewItems({ reviewQueue, gapId, now = new Date().toISOString() } = {}) {
  if (!Array.isArray(reviewQueue)) return [];
  const completed = [];
  for (const item of reviewQueue) {
    if (item.gapId === gapId && item.status === "pending") {
      item.status = "done";
      item.updatedAt = now;
      completed.push(item);
    }
  }
  return completed;
}

// ── Capability profile ──

function levelForScore(score) {
  if (score < 40) return "L1";
  if (score < 70) return "L2";
  if (score < 90) return "L3";
  return "L4";
}

function emptyProfileDimension() {
  return { score: 0, level: "L1", stability: "one_shot", evidence: [] };
}

/**
 * EMA-updates the per-domain capability profile. The per-dimension delta is
 * clamped to +/-20 so a single answer can never jump multiple levels, and
 * only a non-fallback passed attempt that promoted its gap to repaid counts
 * as user_verified evidence.
 */
export function updateCapabilityProfile({ profiles, userId, domain, attempt, now = new Date().toISOString() } = {}) {
  if (!Array.isArray(profiles)) {
    throw new Error("A profiles array is required");
  }
  const profileDomain = clean(domain || "") || "general";
  let profile = profiles.find(item => item.userId === userId && item.domain === profileDomain);
  if (!profile) {
    profile = {
      userId,
      domain: profileDomain,
      dimensions: {},
      createdAt: now,
      updatedAt: now,
      dataSchemaVersion: DATA_SCHEMA_VERSION
    };
    profiles.push(profile);
  }
  const passed = Boolean(attempt?.evaluation?.passed);
  const source = passed && !attempt?.fallbackUsed && attempt?.repaymentStatus === "repaid"
    ? "user_verified"
    : "model_inferred";
  const evaluationDimensions = attempt?.evaluation?.dimensions || {};
  for (const dimension of DIMENSIONS) {
    const dimEval = evaluationDimensions[dimension];
    if (!dimEval) continue;
    const current = profile.dimensions[dimension] || emptyProfileDimension();
    const oldScore = Number(current.score) || 0;
    const rawNext = Math.round(oldScore * 0.7 + dimEval.score * 0.3);
    const delta = Math.max(-20, Math.min(20, rawNext - oldScore));
    const nextScore = Math.max(0, Math.min(100, oldScore + delta));
    const evidence = [
      ...(Array.isArray(current.evidence) ? current.evidence : []),
      { attemptId: attempt.attemptId, source, at: now }
    ].slice(-20);
    const verifiedCount = evidence.filter(entry => entry.source === "user_verified").length;
    profile.dimensions[dimension] = {
      score: nextScore,
      level: levelForScore(nextScore),
      stability: verifiedCount >= 2 ? "stable" : "one_shot",
      evidence
    };
  }
  profile.updatedAt = now;
  return profiles;
}
