import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { handleRelapse, canTransition, calculateOverallMastery } from "./mastery.js";
import { normalizeConceptKey } from "./debt-intelligence.js";

/**
 * 欠条关系识别与欠条簇（Phase 2）
 *
 * 三阶段流水线：
 *   阶段1 规则召回（纯函数 findCandidatePairs）
 *   阶段2 语义相似度（embedding 优先，透明降级 lexical_fallback）
 *   阶段3 模型判断（chatFn 注入，输出结构化校验）
 *
 * 置信度策略：>=0.85 自动建立（auto_confirmed）；0.60-0.84 待确认
 * （pending_confirmation）；<0.60 不建立。识别失败只记录，不影响现有功能。
 */

export const PROMPT_VERSION = "debt-relation/v1";

export const RELATION_TYPES = Object.freeze([
  "same_concept", "similar_gap", "recurrence", "prerequisite_of", "caused_by",
  "blocks", "transfer_variant", "same_project", "same_cognitive_pattern"
]);

export const RELATION_STATUSES = Object.freeze([
  "auto_confirmed", "pending_confirmation", "user_confirmed", "user_rejected"
]);

export const CONCEPT_LINK_TYPES = Object.freeze(["primary", "secondary", "prerequisite"]);

export const CLUSTER_TYPES = Object.freeze([
  "same_concept", "recurring_problem", "cognitive_pattern", "learning_path"
]);

export const CONFIDENCE_AUTO_CONFIRM = 0.85;
export const CONFIDENCE_PENDING_MIN = 0.6;
export const MAX_NEW_CONCEPTS_PER_RUN = 20;
export const DEFAULT_TIME_WINDOW_DAYS = 90;
export const MAX_CANDIDATE_PAIRS_PER_SCAN = 200;

// 参与欠条簇连通分量的关系类型
const CLUSTER_EDGE_RELATION_TYPES = ["same_concept", "recurrence", "same_cognitive_pattern"];
// 只有这些状态的关系才视为"活跃"（参与簇聚合与去重）
const ACTIVE_RELATION_STATUSES = ["auto_confirmed", "pending_confirmation", "user_confirmed"];

const RELATION_TYPE_SET = new Set(RELATION_TYPES);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function conceptKeysOf(analysis) {
  if (!analysis) return new Set();
  const keys = new Set();
  for (const item of analysis.concepts || []) {
    const key = normalizeConceptKey(item?.key);
    if (key) keys.add(key);
  }
  for (const item of analysis.prerequisiteConcepts || []) {
    const key = normalizeConceptKey(item?.key);
    if (key) keys.add(key);
  }
  return keys;
}

function setIntersection(a, b) {
  const result = [];
  for (const item of a) {
    if (b.has(item)) result.push(item);
  }
  return result;
}

// ─── 阶段1：规则召回 ───

/**
 * 对同一用户的欠条做规则召回，输出候选对。
 * 命中任一信号即成为候选：domainPath 重叠 / primaryGapMechanism 相同 /
 * 概念 key 交集 / 同项目（reportId 或 sourceReports 相交）。
 * 另要求两欠条创建时间差不超过 windowDays（默认 90 天）。
 * 方向约定：createdAt 较晚的为 source（新欠条），较早的为 target（历史欠条）。
 */
export function findCandidatePairs({
  debts,
  analysesByDebtId = {},
  now,
  windowDays = DEFAULT_TIME_WINDOW_DAYS,
  focusDebtId,
  maxPairs = MAX_CANDIDATE_PAIRS_PER_SCAN
}) {
  const list = (Array.isArray(debts) ? debts : []).filter(debt => debt?.id);
  const windowMs = Math.max(1, Number(windowDays) || DEFAULT_TIME_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  const referenceTime = now ? Date.parse(now) : Date.now();
  const pairs = [];

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (focusDebtId && a.id !== focusDebtId && b.id !== focusDebtId) continue;

      const timeA = Date.parse(a.createdAt || "") || referenceTime;
      const timeB = Date.parse(b.createdAt || "") || referenceTime;
      if (Math.abs(timeA - timeB) > windowMs) continue;

      const analysisA = analysesByDebtId[a.id] || null;
      const analysisB = analysesByDebtId[b.id] || null;
      const signals = {
        domainOverlap: [],
        sameGapMechanism: false,
        sharedConcepts: [],
        sameProject: false
      };

      if (analysisA && analysisB) {
        signals.domainOverlap = setIntersection(new Set(analysisA.domainPath || []), new Set(analysisB.domainPath || []));
        signals.sameGapMechanism = Boolean(
          analysisA.primaryGapMechanism && analysisA.primaryGapMechanism === analysisB.primaryGapMechanism
        );
        signals.sharedConcepts = setIntersection(conceptKeysOf(analysisA), conceptKeysOf(analysisB));
      }

      const reportsA = new Set([a.reportId, ...(a.sourceReports || [])].filter(Boolean));
      const reportsB = new Set([b.reportId, ...(b.sourceReports || [])].filter(Boolean));
      signals.sameProject = setIntersection(reportsA, reportsB).length > 0;

      const signalCount =
        (signals.domainOverlap.length > 0 ? 1 : 0)
        + (signals.sameGapMechanism ? 1 : 0)
        + (signals.sharedConcepts.length > 0 ? 1 : 0)
        + (signals.sameProject ? 1 : 0);
      if (signalCount === 0) continue;

      // source = 较新欠条，target = 较早欠条（recurrence 的方向语义）
      const newerFirst = timeA >= timeB;
      pairs.push({
        sourceId: newerFirst ? a.id : b.id,
        targetId: newerFirst ? b.id : a.id,
        signals,
        signalCount
      });
    }
  }

  pairs.sort((x, y) => y.signalCount - x.signalCount);
  return pairs.slice(0, Math.max(1, Number(maxPairs) || MAX_CANDIDATE_PAIRS_PER_SCAN));
}

// ─── 阶段2：语义相似度 ───

export function conceptJaccard(keysA, keysB) {
  const setA = keysA instanceof Set ? keysA : new Set(keysA || []);
  const setB = keysB instanceof Set ? keysB : new Set(keysB || []);
  if (setA.size === 0 && setB.size === 0) return 0;
  const intersection = setIntersection(setA, setB).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * gapText 词面相似度：英文按词、中文按字符 bigram 的 Jaccard。
 * 仅在 embedding 不可用时作为透明降级依据。
 */
export function textTokenSimilarity(textA, textB) {
  const tokensOf = text => {
    const normalized = clean(text).toLowerCase();
    if (!normalized) return new Set();
    const tokens = new Set();
    const words = normalized.match(/[a-z0-9]+/g) || [];
    for (const word of words) tokens.add(word);
    const cjk = normalized.replace(/[a-z0-9\s\p{P}]/gu, "");
    for (let i = 0; i < cjk.length - 1; i++) tokens.add(cjk.slice(i, i + 2));
    if (cjk.length === 1) tokens.add(cjk);
    return tokens;
  };
  return conceptJaccard(tokensOf(textA), tokensOf(textB));
}

export function cosineSimilarity(vectorA, vectorB) {
  if (!Array.isArray(vectorA) || !Array.isArray(vectorB) || vectorA.length === 0 || vectorA.length !== vectorB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vectorA.length; i++) {
    const x = Number(vectorA[i]) || 0;
    const y = Number(vectorB[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function pairText(debt, analysis) {
  const conceptNames = (analysis?.concepts || []).map(item => clean(item?.displayName)).filter(Boolean).join(" ");
  return `${clean(debt?.gapText)} ${conceptNames}`.trim().slice(0, 1000);
}

/**
 * 计算候选对相似度。优先 embedding（embeddingFn(texts) → vectors）；
 * 无 embeddingFn、调用失败或返回非法时透明降级为概念 Jaccard + 词面相似度，
 * 并以 similarityBasis 标记 embedding | lexical_fallback。绝不编造 embedding 分数。
 */
export async function scorePairSimilarity({ debtA, debtB, analysisA, analysisB, embeddingFn }) {
  if (typeof embeddingFn === "function") {
    try {
      const vectors = await embeddingFn([pairText(debtA, analysisA), pairText(debtB, analysisB)]);
      if (Array.isArray(vectors) && vectors.length === 2
          && Array.isArray(vectors[0]) && Array.isArray(vectors[1])) {
        const score = cosineSimilarity(vectors[0], vectors[1]);
        if (Number.isFinite(score)) {
          return { similarityScore: Math.max(0, Math.min(1, score)), similarityBasis: "embedding" };
        }
      }
    } catch {
      // 透明降级到词面相似度
    }
  }
  const conceptScore = conceptJaccard(conceptKeysOf(analysisA), conceptKeysOf(analysisB));
  const textScore = textTokenSimilarity(debtA?.gapText, debtB?.gapText);
  return {
    similarityScore: Math.round((conceptScore * 0.5 + textScore * 0.5) * 1000) / 1000,
    similarityBasis: "lexical_fallback"
  };
}

// ─── 阶段3：模型判断 ───

let cachedPrompt = null;

export function getDebtRelationPrompt() {
  if (!cachedPrompt) {
    cachedPrompt = readFileSync(new URL("./prompts/debt-relation/v1.md", import.meta.url), "utf8");
  }
  return cachedPrompt;
}

/**
 * 校验模型输出的关系判断。
 * 返回 { ok: true, value: { relationType, isRelated, confidence, reason } } 或 { ok: false, errors }。
 */
export function validateRelationJudgment(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["judgment must be an object"] };
  }
  const relationType = clean(raw.relationType).toLowerCase();
  if (!RELATION_TYPE_SET.has(relationType)) {
    errors.push(`relationType must be one of the known types, got: ${String(raw.relationType).slice(0, 60)}`);
  }
  if (typeof raw.isRelated !== "boolean") {
    errors.push("isRelated must be a boolean");
  }
  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    errors.push(`confidence must be a number between 0 and 1, got: ${String(raw.confidence).slice(0, 20)}`);
  }
  const reason = clean(raw.reason).slice(0, 300);
  if (!reason) errors.push("reason is required");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { relationType, isRelated: raw.isRelated, confidence, reason } };
}

function buildJudgmentInput({ sourceDebt, targetDebt, analysisA, analysisB, signals, similarity }) {
  const summarize = (debt, analysis) => ({
    gapText: clean(debt?.gapText).slice(0, 300),
    gapEvidence: clean(debt?.gapEvidence).slice(0, 500),
    status: clean(debt?.status || ""),
    recurrenceCount: Number(debt?.recurrenceCount) || 0,
    createdAt: clean(debt?.createdAt || ""),
    domainPath: analysis?.domainPath || [],
    primaryGapMechanism: clean(analysis?.primaryGapMechanism || ""),
    rootCauses: analysis?.rootCauses || [],
    concepts: (analysis?.concepts || []).map(item => clean(item?.displayName)).filter(Boolean).slice(0, 6),
    prerequisiteConcepts: (analysis?.prerequisiteConcepts || []).map(item => clean(item?.displayName)).filter(Boolean).slice(0, 6)
  });
  return {
    sourceDebt: summarize(sourceDebt, analysisA),
    targetDebt: summarize(targetDebt, analysisB),
    ruleSignals: signals,
    similarity: {
      score: similarity.similarityScore,
      basis: similarity.similarityBasis
    }
  };
}

/**
 * 调用 chatFn 判断一对欠条的关系。模型输出非法或 __fallback 时抛错，
 * 由编排层记录并跳过该对（不影响其他对）。
 */
export async function judgePairRelation({ sourceDebt, targetDebt, analysisA, analysisB, signals, similarity, chatFn }) {
  if (typeof chatFn !== "function") throw new Error("chatFn is required for relation judgment");
  const raw = await chatFn(
    [
      { role: "system", content: getDebtRelationPrompt() },
      { role: "user", content: JSON.stringify(buildJudgmentInput({ sourceDebt, targetDebt, analysisA, analysisB, signals, similarity })) }
    ],
    () => ({}),
    1024
  );
  if (raw?.__fallback) {
    throw new Error(`relation judgment unavailable: ${clean(raw.__fallbackError) || "AI fallback"}`);
  }
  const result = validateRelationJudgment(raw);
  if (!result.ok) {
    throw new Error(`relation judgment failed validation: ${result.errors.join("; ")}`.slice(0, 500));
  }
  return result.value;
}

// ─── 概念节点同步（速率限制 + 幂等） ───

/**
 * 把一条分类记录中的概念同步进概念图：
 * concepts → primary 链接，prerequisiteConcepts → prerequisite 链接。
 * 自动新建的概念一律 pending_review，单次运行最多新建 maxNewConcepts 个。
 */
export async function syncConceptsFromAnalysis({ graphStore, analysis, maxNewConcepts = MAX_NEW_CONCEPTS_PER_RUN }) {
  if (!analysis?.cognitiveDebtId) return { linked: 0, createdNodes: 0 };
  const budget = Math.max(0, Number(maxNewConcepts) || 0);
  let createdNodes = 0;
  let linked = 0;

  const entries = [
    ...(analysis.concepts || []).map(item => ({ ...item, linkType: "primary" })),
    ...(analysis.prerequisiteConcepts || []).map(item => ({ ...item, linkType: "prerequisite" }))
  ];

  for (const entry of entries) {
    const conceptKey = normalizeConceptKey(entry.key);
    if (!conceptKey) continue;
    let node = graphStore.findConceptNodeByKey(conceptKey);
    if (!node) {
      if (createdNodes >= budget) continue;
      const now = new Date().toISOString();
      node = await graphStore.saveConceptNode({
        id: crypto.randomUUID(),
        conceptKey,
        displayName: clean(entry.displayName).slice(0, 120) || conceptKey,
        description: "",
        parentId: null,
        domainPath: Array.isArray(analysis.domainPath) ? analysis.domainPath : [],
        status: "pending_review",
        createdAt: now,
        updatedAt: now
      });
      createdNodes++;
    }
    await graphStore.saveDebtConceptLink({
      id: crypto.randomUUID(),
      cognitiveDebtId: analysis.cognitiveDebtId,
      conceptNodeId: node.id,
      relationType: entry.linkType,
      confidence: Number(analysis.classificationConfidence) || 0,
      createdAt: new Date().toISOString()
    });
    linked++;
  }
  return { linked, createdNodes };
}

// ─── 复发集成（复用 mastery.js handleRelapse，幂等） ───

/**
 * recurrence 关系生效（auto_confirmed 或 user_confirmed）时调用。
 * 若 target（历史已训练欠条）尚未处于 relapsed：
 *   - 有 MasteryProfile 时调用 handleRelapse 并重算 overallMastery；
 *   - 状态机允许时把欠条状态置为 relapsed，否则只记录关系不改状态。
 * 同一关系通过 relapseAppliedAt 保证不重复触发 handleRelapse。
 */
export async function applyRecurrenceRelapse({ graphStore, trainingStore, relation }) {
  if (!relation || relation.relationType !== "recurrence") {
    return { applied: false, reason: "not_a_recurrence_relation" };
  }
  if (relation.relapseAppliedAt) {
    return { applied: false, reason: "already_applied" };
  }
  const now = new Date().toISOString();
  const markApplied = async () => {
    await graphStore.saveDebtRelation({ ...relation, relapseAppliedAt: now });
  };

  let target;
  try {
    target = trainingStore.getCognitiveDebt(relation.targetDebtId, relation.userId);
  } catch {
    await markApplied();
    return { applied: false, reason: "target_debt_not_found" };
  }
  if (target.status === "relapsed") {
    await markApplied();
    return { applied: false, reason: "already_relapsed" };
  }

  const profile = trainingStore.getMasteryProfile(target.id);
  let profileUpdated = false;
  if (profile) {
    const relapsed = handleRelapse(profile);
    relapsed.overallMastery = calculateOverallMastery(relapsed);
    await trainingStore.saveMasteryProfile(relapsed);
    profileUpdated = true;
  }

  let statusChanged = false;
  if (canTransition(target.status, "relapsed")) {
    target.status = "relapsed";
    target.updatedAt = now;
    await trainingStore.saveCognitiveDebt(target);
    statusChanged = true;
  }

  await markApplied();
  return { applied: true, profileUpdated, statusChanged };
}

// ─── 关系识别编排 ───

/**
 * 对 userId 的欠条执行候选扫描与关系识别（幂等）。
 * - 已有活跃关系的对不再调用模型（重复扫描不产生重复关系）；
 * - 被用户拒绝的 对+relationType 不再自动重建；
 * - auto_confirmed 的 recurrence 立即触发复发集成；
 * - 有新建关系时自动 rebuildUserClusters。
 * chatFn 缺失时谨慎跳过（记录 analysisRun，status=skipped）。
 */
export async function detectRelations({
  graphStore,
  intelligenceStore,
  trainingStore,
  userId,
  focusDebtId,
  chatFn,
  embeddingFn,
  now,
  windowDays = DEFAULT_TIME_WINDOW_DAYS,
  trigger = "auto"
}) {
  const startedAt = new Date().toISOString();
  const run = {
    id: crypto.randomUUID(),
    cognitiveDebtId: focusDebtId || "",
    userId: userId || "demo-user",
    trigger: `relation_${trigger}`,
    status: "failed",
    attemptCount: 1,
    errorMessage: "",
    startedAt,
    finishedAt: startedAt
  };
  const finishRun = async (status, errorMessage = "") => {
    run.status = status;
    run.errorMessage = clean(errorMessage).slice(0, 500);
    run.finishedAt = new Date().toISOString();
    if (intelligenceStore) await intelligenceStore.saveAnalysisRun(run);
  };

  const debts = trainingStore.listCognitiveDebts(userId);
  if (debts.length < 2) {
    await finishRun("skipped", "fewer_than_two_debts");
    return { pairsConsidered: 0, created: 0, pending: 0, skipped: "fewer_than_two_debts" };
  }
  if (typeof chatFn !== "function") {
    await finishRun("skipped", "relation judgment requires an active AI configuration");
    return { pairsConsidered: 0, created: 0, pending: 0, skipped: "ai_unavailable" };
  }

  const analysesByDebtId = {};
  for (const debt of debts) {
    analysesByDebtId[debt.id] = intelligenceStore ? intelligenceStore.getCurrentAnalysis(debt.id) : null;
  }

  const candidates = findCandidatePairs({ debts, analysesByDebtId, now, windowDays, focusDebtId });
  const debtById = new Map(debts.map(debt => [debt.id, debt]));

  let created = 0;
  let pending = 0;
  const failures = [];

  for (const pair of candidates) {
    // 幂等：该对已有活跃关系 → 不再调用模型
    const existing = graphStore.listRelationsForPair(pair.sourceId, pair.targetId);
    if (existing.some(item => ACTIVE_RELATION_STATUSES.includes(item.status))) continue;

    const sourceDebt = debtById.get(pair.sourceId);
    const targetDebt = debtById.get(pair.targetId);
    if (!sourceDebt || !targetDebt) continue;

    let judgment;
    let similarity;
    try {
      similarity = await scorePairSimilarity({
        debtA: sourceDebt,
        debtB: targetDebt,
        analysisA: analysesByDebtId[pair.sourceId],
        analysisB: analysesByDebtId[pair.targetId],
        embeddingFn
      });
      judgment = await judgePairRelation({
        sourceDebt,
        targetDebt,
        analysisA: analysesByDebtId[pair.sourceId],
        analysisB: analysesByDebtId[pair.targetId],
        signals: pair.signals,
        similarity,
        chatFn
      });
    } catch (error) {
      failures.push({
        pair: [pair.sourceId, pair.targetId],
        error: String(error?.message || error || "unknown error").slice(0, 300)
      });
      continue;
    }

    if (!judgment.isRelated || judgment.confidence < CONFIDENCE_PENDING_MIN) continue;
    // 被用户拒绝的 对+relationType 不再自动重建
    if (existing.some(item => item.relationType === judgment.relationType && item.status === "user_rejected")) {
      continue;
    }

    const status = judgment.confidence >= CONFIDENCE_AUTO_CONFIRM ? "auto_confirmed" : "pending_confirmation";
    const relation = await graphStore.saveDebtRelation({
      id: crypto.randomUUID(),
      userId: userId || "demo-user",
      sourceDebtId: pair.sourceId,
      targetDebtId: pair.targetId,
      relationType: judgment.relationType,
      similarityScore: similarity.similarityScore,
      similarityBasis: similarity.similarityBasis,
      confidence: judgment.confidence,
      reason: judgment.reason,
      status,
      promptVersion: PROMPT_VERSION,
      createdAt: new Date().toISOString()
    });
    if (status === "auto_confirmed") created++;
    else pending++;

    if (status === "auto_confirmed" && judgment.relationType === "recurrence") {
      try {
        await applyRecurrenceRelapse({ graphStore, trainingStore, relation });
      } catch (error) {
        failures.push({ pair: [pair.sourceId, pair.targetId], error: `relapse failed: ${String(error?.message || error).slice(0, 200)}` });
      }
    }
  }

  if (created + pending > 0) {
    await rebuildUserClusters({ graphStore, trainingStore, userId });
  }

  await finishRun(
    failures.length > 0 ? "failed" : "succeeded",
    failures.map(item => item.error).join("; ")
  );
  return {
    pairsConsidered: candidates.length,
    created,
    pending,
    ...(failures.length > 0 ? { failures } : {})
  };
}

// ─── 用户确认 / 拒绝 ───

function loadOwnedRelation(graphStore, userId, debtId, relationId) {
  const relation = graphStore.getDebtRelation(relationId);
  if (!relation || relation.userId !== userId) {
    throw new Error(`Debt relation not found: ${relationId}`);
  }
  if (relation.sourceDebtId !== debtId && relation.targetDebtId !== debtId) {
    throw new Error(`Debt relation ${relationId} does not involve debt ${debtId}`);
  }
  return relation;
}

/**
 * 确认 pending_confirmation 关系 → user_confirmed。
 * recurrence 关系确认时触发复发集成（幂等）。确认后重建簇。
 */
export async function confirmRelation({ graphStore, trainingStore, userId, debtId, relationId }) {
  const relation = loadOwnedRelation(graphStore, userId, debtId, relationId);
  if (relation.status === "user_confirmed") {
    return { relation, relapse: null, alreadyConfirmed: true };
  }
  if (relation.status !== "pending_confirmation") {
    const error = new Error(`Only pending relations can be confirmed (current: ${relation.status})`);
    error.statusCode = 409;
    throw error;
  }
  const saved = await graphStore.saveDebtRelation({ ...relation, status: "user_confirmed" });
  let relapse = null;
  if (saved.relationType === "recurrence") {
    relapse = await applyRecurrenceRelapse({ graphStore, trainingStore, relation: saved });
  }
  await rebuildUserClusters({ graphStore, trainingStore, userId });
  return { relation: graphStore.getDebtRelation(saved.id), relapse };
}

/**
 * 拒绝关系 → user_rejected；之后同一 对+relationType 不再自动重建。
 * 已拒绝的关系幂等返回。拒绝活跃关系后重建簇。
 */
export async function rejectRelation({ graphStore, trainingStore, userId, debtId, relationId }) {
  const relation = loadOwnedRelation(graphStore, userId, debtId, relationId);
  if (relation.status === "user_rejected") {
    return { relation, alreadyRejected: true };
  }
  const wasActive = ACTIVE_RELATION_STATUSES.includes(relation.status);
  const saved = await graphStore.saveDebtRelation({ ...relation, status: "user_rejected" });
  if (wasActive) {
    await rebuildUserClusters({ graphStore, trainingStore, userId });
  }
  return { relation: saved };
}

// ─── 欠条簇聚合 ───

/**
 * 幂等重算用户欠条簇：
 * 以 same_concept / recurrence / same_cognitive_pattern 活跃关系与
 * 共享 primary 概念为边求连通分量（>=2 成员成簇）。
 * 成员集合相同的已有簇保留原 id；不再成立的簇删除。
 */
export async function rebuildUserClusters({ graphStore, trainingStore, userId }) {
  const debts = trainingStore.listCognitiveDebts(userId);
  const debtIds = new Set(debts.map(debt => debt.id));

  // 1. 收集边
  const adjacency = new Map();
  const edgeTypes = new Map(); // pairKey -> Set(relationType)
  const addEdge = (a, b, type) => {
    if (!debtIds.has(a) || !debtIds.has(b) || a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
    const key = [a, b].sort().join("::");
    if (!edgeTypes.has(key)) edgeTypes.set(key, new Set());
    edgeTypes.get(key).add(type);
  };

  const activeRelations = graphStore.listDebtRelations({
    userId,
    status: ["auto_confirmed", "user_confirmed"],
    relationType: CLUSTER_EDGE_RELATION_TYPES
  });
  for (const relation of activeRelations) {
    addEdge(relation.sourceDebtId, relation.targetDebtId, relation.relationType);
  }

  // 共享 primary 概念 → same_concept 边
  const links = graphStore.listDebtConceptLinks({ cognitiveDebtIds: [...debtIds] })
    .filter(link => link.relationType === "primary");
  const debtsByConcept = new Map();
  for (const link of links) {
    if (!debtsByConcept.has(link.conceptNodeId)) debtsByConcept.set(link.conceptNodeId, []);
    debtsByConcept.get(link.conceptNodeId).push(link.cognitiveDebtId);
  }
  for (const [conceptNodeId, memberIds] of debtsByConcept) {
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        addEdge(memberIds[i], memberIds[j], `concept:${conceptNodeId}`);
      }
    }
  }

  // 2. 连通分量
  const visited = new Set();
  const components = [];
  for (const debtId of debtIds) {
    if (visited.has(debtId) || !adjacency.has(debtId)) continue;
    const component = [];
    const queue = [debtId];
    visited.add(debtId);
    while (queue.length > 0) {
      const current = queue.shift();
      component.push(current);
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    if (component.length >= 2) components.push(component.sort());
  }
  components.sort((a, b) => a[0].localeCompare(b[0]));

  // 3. 与现有簇按成员集合匹配，保留原 id
  const existingClusters = graphStore.listDebtClusters(userId);
  const existingByMemberKey = new Map();
  for (const cluster of existingClusters) {
    const memberKey = graphStore.listDebtClusterMembers({ clusterId: cluster.id })
      .map(member => member.cognitiveDebtId)
      .sort()
      .join("::");
    existingByMemberKey.set(memberKey, cluster);
  }

  const debtById = new Map(debts.map(debt => [debt.id, debt]));
  const keptClusterIds = new Set();
  const resultClusters = [];

  for (const memberIds of components) {
    const memberKey = memberIds.join("::");

    // 簇类型与主概念
    let clusterType = "same_concept";
    let hasRecurrence = false;
    let hasPattern = false;
    const conceptCounts = new Map();
    for (let i = 0; i < memberIds.length; i++) {
      for (let j = i + 1; j < memberIds.length; j++) {
        const types = edgeTypes.get([memberIds[i], memberIds[j]].sort().join("::"));
        if (!types) continue;
        if ([...types].some(type => type === "recurrence")) hasRecurrence = true;
        if ([...types].some(type => type === "same_cognitive_pattern")) hasPattern = true;
        for (const type of types) {
          if (type.startsWith("concept:")) {
            const nodeId = type.slice("concept:".length);
            conceptCounts.set(nodeId, (conceptCounts.get(nodeId) || 0) + 1);
          }
        }
      }
    }
    if (hasRecurrence) clusterType = "recurring_problem";
    else if (conceptCounts.size === 0 && hasPattern) clusterType = "cognitive_pattern";

    let primaryConceptNodeId = null;
    let bestCount = 0;
    for (const [nodeId, count] of conceptCounts) {
      if (count > bestCount) {
        bestCount = count;
        primaryConceptNodeId = nodeId;
      }
    }
    const primaryNode = primaryConceptNodeId ? graphStore.getConceptNode(primaryConceptNodeId) : null;
    const firstGap = clean(debtById.get(memberIds[0])?.gapText || "").slice(0, 30);
    const title = primaryNode ? `${primaryNode.displayName}欠条簇` : (firstGap ? `${firstGap}相关欠条簇` : "欠条簇");
    const description = primaryNode
      ? `围绕「${primaryNode.displayName}」的 ${memberIds.length} 张关联欠条`
      : `${memberIds.length} 张关联欠条`;

    const existing = existingByMemberKey.get(memberKey);
    const now = new Date().toISOString();
    const cluster = await graphStore.saveDebtCluster({
      id: existing?.id || crypto.randomUUID(),
      userId: userId || "demo-user",
      title,
      description,
      primaryConceptNodeId,
      clusterType,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    keptClusterIds.add(cluster.id);

    for (const debtId of memberIds) {
      await graphStore.saveDebtClusterMember({
        clusterId: cluster.id,
        cognitiveDebtId: debtId,
        membershipConfidence: 1,
        createdAt: now
      });
    }
    resultClusters.push(cluster);
  }

  // 4. 删除不再成立的簇
  let removed = 0;
  for (const cluster of existingClusters) {
    if (!keptClusterIds.has(cluster.id)) {
      await graphStore.deleteDebtCluster(cluster.id);
      removed++;
    }
  }

  return { clusters: resultClusters, removed };
}

// ─── 簇掌握度派生（不存独立六维，查询时从 trainingStore 派生） ───

const MASTERY_DIMENSIONS = [
  "conceptualUnderstanding", "independentRecall", "hintIndependence",
  "misconceptionResistance", "transferAbility", "retentionStrength"
];

/**
 * 从成员欠条状态与 MasteryProfile 派生簇掌握度汇总：
 * 各状态计数 + 六维与 overallMastery 平均（仅计入有画像的成员）。
 */
export function deriveClusterMasterySummary({ memberDebtIds, debtsById, profilesByDebtId }) {
  const ids = Array.isArray(memberDebtIds) ? memberDebtIds : [];
  const statusCounts = {};
  const totals = { overallMastery: 0 };
  for (const dimension of MASTERY_DIMENSIONS) totals[dimension] = 0;
  let withProfile = 0;
  let totalRelapseCount = 0;

  for (const debtId of ids) {
    const debt = typeof debtsById?.get === "function" ? debtsById.get(debtId) : debtsById?.[debtId];
    const status = clean(debt?.status || "unknown") || "unknown";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    const profile = typeof profilesByDebtId?.get === "function" ? profilesByDebtId.get(debtId) : profilesByDebtId?.[debtId];
    if (profile) {
      withProfile++;
      totals.overallMastery += Number(profile.overallMastery) || 0;
      for (const dimension of MASTERY_DIMENSIONS) {
        totals[dimension] += Number(profile[dimension]) || 0;
      }
      totalRelapseCount += Number(profile.relapseCount) || 0;
    }
  }

  const averageMastery = {};
  for (const key of Object.keys(totals)) {
    averageMastery[key] = withProfile > 0 ? Math.round(totals[key] / withProfile) : 0;
  }

  return {
    memberCount: ids.length,
    withProfileCount: withProfile,
    statusCounts,
    averageMastery,
    totalRelapseCount
  };
}
