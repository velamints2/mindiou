import { readFileSync } from "node:fs";
import crypto from "node:crypto";

/**
 * 认知欠条智能分类（Phase 1）
 *
 * 纯函数 + 可注入 chatFn 的分类执行器。不持有任何全局状态，
 * 持久化通过 debt-intelligence-store.js 完成，LLM 调用通过
 * 注入的 chatFn（server.js 的 chatJson 同款封装）完成。
 */

export const TAXONOMY_VERSION = "debt-intelligence-taxonomy/v1";
export const PROMPT_VERSION = "debt-intelligence/v1";
export const MAX_CLASSIFY_ATTEMPTS = 3;

export const DOMAIN_ROOTS = Object.freeze([
  "software_engineering", "product_management", "business_strategy", "marketing",
  "hardware_engineering", "electronics", "mechanical_design", "artificial_intelligence",
  "data_analysis", "academic_research", "communication", "project_management",
  "finance", "legal"
]);

export const GAP_MECHANISMS = Object.freeze([
  "concept_gap", "mechanism_gap", "rationale_gap", "prerequisite_gap",
  "verification_gap", "boundary_gap", "tradeoff_gap", "dependency_gap",
  "transfer_gap", "implementation_gap", "decision_gap", "terminology_gap",
  "process_gap"
]);

export const TASK_STAGES = Object.freeze([
  "problem_definition", "information_collection", "planning", "solution_selection",
  "execution", "debugging", "evaluation", "decision_making", "communication",
  "reflection"
]);

// 只描述可观察的行为与情境；心理诊断/人格评价词汇永远不在枚举内，
// 且会被 BLOCKED_ROOT_CAUSE_TERMS 显式拒绝。
export const ROOT_CAUSES = Object.freeze([
  "missing_prerequisite", "accepted_ai_output_directly", "time_pressure",
  "tool_opacity", "insufficient_domain_experience", "skipped_validation",
  "unclear_goal", "over_complexity", "fragmented_knowledge", "false_familiarity",
  "unknown"
]);

export const BLOCKED_ROOT_CAUSE_TERMS = Object.freeze([
  "lazy", "low_intelligence", "stupid", "dumb", "careless", "unmotivated",
  "bad_attitude", "irresponsible"
]);

export const RISK_TYPES = Object.freeze([
  "no_material_risk", "quality_risk", "security_risk", "privacy_risk",
  "financial_risk", "compliance_risk", "reliability_risk", "decision_risk",
  "maintainability_risk", "communication_risk"
]);

// 人工纠正允许修改的字段（其余字段始终由系统生成）。
export const USER_CORRECTABLE_FIELDS = Object.freeze([
  "domainPath", "primaryGapMechanism", "secondaryGapMechanisms", "taskStage",
  "rootCauses", "riskTypes", "transferValue", "concepts", "prerequisiteConcepts"
]);

const DOMAIN_ROOT_SET = new Set(DOMAIN_ROOTS);
const GAP_MECHANISM_SET = new Set(GAP_MECHANISMS);
const TASK_STAGE_SET = new Set(TASK_STAGES);
const ROOT_CAUSE_SET = new Set(ROOT_CAUSES);
const RISK_TYPE_SET = new Set(RISK_TYPES);
const BLOCKED_TERM_SET = new Set(BLOCKED_ROOT_CAUSE_TERMS);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function normalizeConceptKey(key) {
  return clean(key).toLowerCase().slice(0, 120);
}

function normalizeConcepts(value, errors, fieldName) {
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array`);
    return [];
  }
  const normalized = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${fieldName}[${index}] must be an object with key and displayName`);
      return;
    }
    const key = normalizeConceptKey(item.key);
    const displayName = clean(item.displayName).slice(0, 120);
    if (!key || !displayName) {
      errors.push(`${fieldName}[${index}] requires non-empty key and displayName`);
      return;
    }
    normalized.push({ key, displayName });
  });
  return normalized;
}

function normalizeEnumArray(value, allowedSet, errors, fieldName, { minItems = 0 } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${fieldName} must be an array`);
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const normalized = clean(item).toLowerCase();
    if (!allowedSet.has(normalized)) {
      errors.push(`${fieldName} contains invalid value: ${String(item).slice(0, 60)}`);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  if (result.length < minItems) {
    errors.push(`${fieldName} requires at least ${minItems} item(s)`);
  }
  return result;
}

/**
 * 校验完整的 DebtIntelligenceAnalysis 记录。
 * 返回 { ok: true, value } 或 { ok: false, errors }。
 * 非法枚举、缺字段、越界一律拒绝；概念 key 规范化为小写。
 */
export function validateDebtIntelligence(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["analysis must be an object"] };
  }

  const cognitiveDebtId = clean(raw.cognitiveDebtId).slice(0, 100);
  if (!cognitiveDebtId) errors.push("cognitiveDebtId is required");

  // ── domainPath：长度 1-4，首段必须在领域枚举内 ──
  let domainPath = [];
  if (!Array.isArray(raw.domainPath)) {
    errors.push("domainPath must be an array");
  } else {
    domainPath = raw.domainPath
      .map(segment => clean(segment).toLowerCase().slice(0, 60))
      .filter(Boolean);
    if (domainPath.length < 1 || domainPath.length > 4) {
      errors.push("domainPath must contain 1-4 segments");
    }
    if (domainPath.length > 0 && !DOMAIN_ROOT_SET.has(domainPath[0])) {
      errors.push(`domainPath[0] must be one of the known domain roots, got: ${domainPath[0]}`);
    }
  }

  // ── 欠条机制 ──
  const primaryGapMechanism = clean(raw.primaryGapMechanism).toLowerCase();
  if (!GAP_MECHANISM_SET.has(primaryGapMechanism)) {
    errors.push(`primaryGapMechanism is required and must be a known mechanism, got: ${String(raw.primaryGapMechanism).slice(0, 60)}`);
  }
  const secondaryGapMechanisms = normalizeEnumArray(
    raw.secondaryGapMechanisms ?? [], GAP_MECHANISM_SET, errors, "secondaryGapMechanisms"
  ).filter(mechanism => mechanism !== primaryGapMechanism);

  // ── 任务阶段 ──
  const taskStage = clean(raw.taskStage).toLowerCase();
  if (!TASK_STAGE_SET.has(taskStage)) {
    errors.push(`taskStage is required and must be a known stage, got: ${String(raw.taskStage).slice(0, 60)}`);
  }

  // ── 根因（拒绝心理诊断词） ──
  const rawRootCauses = Array.isArray(raw.rootCauses) ? raw.rootCauses : [];
  for (const cause of rawRootCauses) {
    if (BLOCKED_TERM_SET.has(clean(cause).toLowerCase())) {
      errors.push(`rootCauses contains a prohibited psychological-diagnosis term: ${String(cause).slice(0, 60)}`);
    }
  }
  const rootCauses = normalizeEnumArray(raw.rootCauses, ROOT_CAUSE_SET, errors, "rootCauses", { minItems: 1 });

  // ── 风险类型 ──
  const riskTypes = normalizeEnumArray(raw.riskTypes, RISK_TYPE_SET, errors, "riskTypes", { minItems: 1 });
  if (riskTypes.includes("no_material_risk") && riskTypes.length > 1) {
    errors.push("riskTypes cannot combine no_material_risk with other risks");
  }

  // ── 迁移价值：整数 1-5 ──
  const transferValue = Number(raw.transferValue);
  if (!Number.isInteger(transferValue) || transferValue < 1 || transferValue > 5) {
    errors.push(`transferValue must be an integer between 1 and 5, got: ${String(raw.transferValue).slice(0, 20)}`);
  }

  // ── 概念 ──
  const concepts = normalizeConcepts(raw.concepts ?? [], errors, "concepts");
  const prerequisiteConcepts = normalizeConcepts(
    raw.prerequisiteConcepts ?? [], errors, "prerequisiteConcepts"
  );

  // ── 置信度：0-1 ──
  const classificationConfidence = Number(raw.classificationConfidence);
  if (!Number.isFinite(classificationConfidence) || classificationConfidence < 0 || classificationConfidence > 1) {
    errors.push(`classificationConfidence must be a number between 0 and 1, got: ${String(raw.classificationConfidence).slice(0, 20)}`);
  }

  // ── 证据：每项含 note 与引用来源 ──
  let evidence = [];
  if (!Array.isArray(raw.evidence)) {
    errors.push("evidence must be an array");
  } else {
    evidence = [];
    raw.evidence.forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        errors.push(`evidence[${index}] must be an object with note and source`);
        return;
      }
      const note = clean(item.note).slice(0, 300);
      const source = clean(item.source).slice(0, 60);
      if (!note || !source) {
        errors.push(`evidence[${index}] requires non-empty note and source`);
        return;
      }
      evidence.push({ note, source });
    });
  }

  // ── 元信息 ──
  const taxonomyVersion = clean(raw.taxonomyVersion);
  if (!taxonomyVersion) errors.push("taxonomyVersion is required");
  const promptVersion = clean(raw.promptVersion);
  if (!promptVersion) errors.push("promptVersion is required");
  const modelName = clean(raw.modelName);
  if (!modelName) errors.push("modelName is required");
  if (typeof raw.isUserCorrected !== "boolean") errors.push("isUserCorrected must be a boolean");
  const createdAt = clean(raw.createdAt);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) errors.push("createdAt must be an ISO timestamp");
  const updatedAt = clean(raw.updatedAt);
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) errors.push("updatedAt must be an ISO timestamp");

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      ...(raw.id ? { id: clean(raw.id).slice(0, 100) } : {}),
      cognitiveDebtId,
      userId: clean(raw.userId || "demo-user").slice(0, 100),
      domainPath,
      primaryGapMechanism,
      secondaryGapMechanisms,
      taskStage,
      rootCauses,
      riskTypes,
      transferValue,
      concepts,
      prerequisiteConcepts,
      classificationConfidence,
      evidence,
      taxonomyVersion,
      promptVersion,
      modelName,
      isUserCorrected: raw.isUserCorrected,
      isCurrent: raw.isCurrent !== false,
      createdAt,
      updatedAt
    }
  };
}

let cachedPrompt = null;

/**
 * 读取分类 Prompt（prompts/debt-intelligence/v1.md），进程内缓存。
 */
export function getDebtIntelligencePrompt() {
  if (!cachedPrompt) {
    cachedPrompt = readFileSync(new URL("./prompts/debt-intelligence/v1.md", import.meta.url), "utf8");
  }
  return cachedPrompt;
}

function buildClassificationInput(debt, reportContext) {
  const input = {
    debt: {
      gapText: clean(debt.gapText).slice(0, 500),
      gapEvidence: clean(debt.gapEvidence).slice(0, 1000),
      status: clean(debt.status || ""),
      recurrenceCount: Number(debt.recurrenceCount) || 0
    }
  };
  if (reportContext && typeof reportContext === "object") {
    input.reportContext = reportContext;
  }
  return input;
}

/**
 * 对一张认知欠条执行一次智能分类。
 * chatFn 为 server.js chatJson 同款封装：chatFn(messages, fallback, maxTokens)。
 * 模型输出缺失字段或非法时抛错，由调用方（classifyAndSave）记录 analysisRuns 并重试。
 */
export async function classifyDebt({ debt, reportContext, chatFn, modelName }) {
  if (!debt?.id) throw new Error("debt with id is required for classification");
  if (typeof chatFn !== "function") throw new Error("chatFn is required for classification");
  const raw = await chatFn(
    [
      { role: "system", content: getDebtIntelligencePrompt() },
      { role: "user", content: JSON.stringify(buildClassificationInput(debt, reportContext)) }
    ],
    () => ({}),
    2048
  );
  if (raw?.__fallback) {
    throw new Error(`classification unavailable: ${clean(raw.__fallbackError) || "AI fallback"}`);
  }
  const now = new Date().toISOString();
  const result = validateDebtIntelligence({
    ...raw,
    id: crypto.randomUUID(),
    cognitiveDebtId: debt.id,
    userId: debt.userId || "demo-user",
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: PROMPT_VERSION,
    modelName: clean(modelName) || "unknown",
    isUserCorrected: false,
    isCurrent: true,
    createdAt: now,
    updatedAt: now
  });
  if (!result.ok) {
    throw new Error(`classification output failed validation: ${result.errors.join("; ")}`.slice(0, 800));
  }
  return result.value;
}

/**
 * 分类 + 落库的编排器。不抛出分类错误：
 * 成功返回 { ok: true, analysis, run }；
 * 被人工纠正保护跳过返回 { ok: false, skipped: true, reason, run }；
 * 重试耗尽返回 { ok: false, error, run }（analysisRuns 已记录 errorMessage 与 attemptCount）。
 */
export async function classifyAndSave({
  store,
  debt,
  reportContext,
  chatFn,
  modelName,
  trigger = "auto",
  maxAttempts = MAX_CLASSIFY_ATTEMPTS
}) {
  const startedAt = new Date().toISOString();
  const run = {
    id: crypto.randomUUID(),
    cognitiveDebtId: debt?.id || "",
    userId: debt?.userId || "demo-user",
    trigger,
    status: "failed",
    attemptCount: 0,
    errorMessage: "",
    startedAt,
    finishedAt: startedAt
  };

  const current = debt?.id ? store.getCurrentAnalysis(debt.id) : null;
  if (current?.isUserCorrected) {
    run.status = "skipped";
    run.errorMessage = "user_corrected_analysis_locked";
    const savedRun = await store.saveAnalysisRun(run);
    return { ok: false, skipped: true, reason: "user_corrected", run: savedRun };
  }

  let lastError = null;
  const attempts = Math.max(1, Number(maxAttempts) || 1);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    run.attemptCount = attempt;
    try {
      const analysis = await classifyDebt({ debt, reportContext, chatFn, modelName });
      const saved = await store.saveAnalysis(analysis);
      run.status = "succeeded";
      run.errorMessage = "";
      run.finishedAt = new Date().toISOString();
      const savedRun = await store.saveAnalysisRun(run);
      return { ok: true, analysis: saved, run: savedRun };
    } catch (error) {
      lastError = error;
    }
  }
  run.errorMessage = String(lastError?.message || lastError || "unknown error").slice(0, 500);
  run.finishedAt = new Date().toISOString();
  const savedRun = await store.saveAnalysisRun(run);
  return { ok: false, error: run.errorMessage, run: savedRun };
}

/**
 * 用户人工纠正：以当前生效版本为基底，仅合并 USER_CORRECTABLE_FIELDS，
 * 整体重新校验后保存为新版本（isUserCorrected=true，isCurrent=true）。
 * 无当前版本时以 patch 为基底（要求 patch 覆盖全部必填分类字段）。
 */
export async function applyUserCorrection({ store, debt, patch, modelName }) {
  if (!debt?.id) throw new Error("debt with id is required for correction");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("correction patch must be an object");
  }
  const unknownFields = Object.keys(patch).filter(key => !USER_CORRECTABLE_FIELDS.includes(key));
  if (unknownFields.length > 0) {
    throw new Error(`fields not correctable: ${unknownFields.join(", ")}`);
  }
  const current = store.getCurrentAnalysis(debt.id);
  const now = new Date().toISOString();
  const base = current || {};
  const merged = { ...base };
  for (const field of USER_CORRECTABLE_FIELDS) {
    if (patch[field] !== undefined) merged[field] = patch[field];
  }
  const result = validateDebtIntelligence({
    ...merged,
    id: crypto.randomUUID(),
    cognitiveDebtId: debt.id,
    userId: debt.userId || base.userId || "demo-user",
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: base.promptVersion || PROMPT_VERSION,
    modelName: base.modelName || clean(modelName) || "user-correction",
    classificationConfidence: current ? merged.classificationConfidence : (merged.classificationConfidence ?? 1),
    evidence: current ? merged.evidence : (merged.evidence ?? [{ note: "用户人工纠正，无自动分类基底", source: "user_correction" }]),
    isUserCorrected: true,
    isCurrent: true,
    createdAt: now,
    updatedAt: now
  });
  if (!result.ok) {
    throw new Error(`correction failed validation: ${result.errors.join("; ")}`.slice(0, 800));
  }
  return store.saveAnalysis(result.value);
}

/**
 * 回填：对一批欠条逐个执行分类（幂等）。
 * 跳过：已有当前版本且 taxonomy 未过期、或当前版本为人工纠正。
 * 返回 { processed, skipped, failed, failures, nextOffset, hasMore }。
 */
export async function backfillDebtIntelligence({
  store,
  debts,
  chatFn,
  modelName,
  batchSize = 10,
  offset = 0,
  reportContextFor
}) {
  const list = Array.isArray(debts) ? debts : [];
  const safeBatchSize = Math.min(50, Math.max(1, Number(batchSize) || 10));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const slice = list.slice(safeOffset, safeOffset + safeBatchSize);
  let processed = 0;
  let skipped = 0;
  const failures = [];
  for (const debt of slice) {
    const current = store.getCurrentAnalysis(debt.id);
    if (current?.isUserCorrected || (current && current.taxonomyVersion === TAXONOMY_VERSION)) {
      skipped++;
      continue;
    }
    const result = await classifyAndSave({
      store,
      debt,
      reportContext: typeof reportContextFor === "function" ? reportContextFor(debt) : undefined,
      chatFn,
      modelName,
      trigger: "backfill"
    });
    if (result.ok) {
      processed++;
    } else if (result.skipped) {
      skipped++;
    } else {
      failures.push({ debtId: debt.id, error: String(result.error || "unknown error").slice(0, 300) });
    }
  }
  return {
    processed,
    skipped,
    failed: failures.length,
    failures,
    nextOffset: safeOffset + slice.length,
    hasMore: safeOffset + slice.length < list.length
  };
}
