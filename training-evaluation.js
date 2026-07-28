/**
 * 训练评估模块
 *
 * 将 MVP-1 清偿会话的 analysis 转换为结构化 TrainingEvaluation。
 * 评估不仅看最终答案，还考虑：
 * - 初始独立回答
 * - 提示使用前后的变化
 * - 提示是否直接暴露了答案
 * - 用户是否只是复述提示
 *
 * AI 调用 3：训练评估
 */

import crypto from "node:crypto";

// ─── 评估 Prompt ───

export function getTrainingEvaluationPrompt() {
  return [
    "You are MindIOU's training evaluator. You assess a single Feynman training attempt.",
    "",
    "You receive:",
    "- The original question / card prompt",
    "- The learner's initial answer (before any hints, may be empty)",
    "- The final answer (after hints if used)",
    "- The hint events log (level, type, content, answer before/after each hint)",
    "- The card's core knowledge points and evaluation criteria",
    "- The learner's capability level",
    "",
    "You must:",
    "1. Separately examine the initial answer — what did the learner produce independently?",
    "2. Examine what changed after each hint — did the learner add new content or just copy the hint?",
    "3. Tag which knowledge points came from the learner's own expression vs. appeared only after a hint was exposed.",
    "4. Judge whether the learner is merely parroting hints vs. genuinely understanding.",
    "5. Identify core misconceptions.",
    "6. Distinguish 'completed with scaffold support' from 'can explain independently'.",
    "7. Recommend the single most valuable capability to verify next.",
    "8. Do NOT penalize hint usage itself — hints are scaffolds, not failures.",
    "9. But high hint dependency must NOT be scored as independent mastery.",
    "10. For non-technical users, accept analogies if the logic is accurate.",
    "",
    "Use the learner's language for all learner-facing fields.",
    "",
    "Return JSON only with this shape:",
    JSON.stringify({
      overallScore: 0,
      passed: false,
      conceptualAccuracy: 0,
      completeness: 0,
      independentRecall: 0,
      hintDependency: 0,
      transferAbility: 0,
      retentionStrength: null,
      understandingLevel: "not_understood|prompt_supported|initially_understood|independently_explainable|transferable|stable_mastery",
      strengths: [],
      missingPoints: [],
      misconceptions: [],
      nextTrainingGoal: "",
      recommendedNextStage: "initial_compensation|delayed_recall|misconception_check|scenario_transfer|error_detection|real_work_validation",
      userFeedback: ""
    })
  ].join("\n");
}

// ─── 构建评估请求 ───

export function buildEvaluationRequest({ card, attempt, hintEvents, capabilityLevel }) {
  return {
    originalPrompt: card?.prompt || attempt?.originalPrompt || "",
    initialAnswer: attempt?.initialAnswer || "",
    finalAnswer: attempt?.finalAnswer || "",
    hintEvents: (hintEvents || []).map(h => ({
      level: h.level,
      hintType: h.hintType,
      content: h.content,
      answerBeforeHint: h.answerBeforeHint || "",
      answerAfterHint: h.answerAfterHint || "",
      exposedKnowledgePoints: h.exposedKnowledgePoints || []
    })),
    evaluationCriteria: card?.evaluationCriteria || [],
    targetLevel: card?.targetLevel || "",
    capabilityLevel: capabilityLevel || "unknown"
  };
}

// ─── 规范化评估结果 ───

export function normalizeEvaluation(raw) {
  const clamp = (v, min = 0, max = 100) =>
    Math.max(min, Math.min(max, Math.round(Number(v) || 0)));

  const validLevels = new Set([
    "not_understood", "prompt_supported", "initially_understood",
    "independently_explainable", "transferable", "stable_mastery"
  ]);

  const validStages = new Set([
    "initial_compensation", "delayed_recall", "misconception_check",
    "scenario_transfer", "error_detection", "real_work_validation"
  ]);

  const fit = (v, max) => {
    const s = String(v || "").replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };

  const textArray = (arr, maxLen, maxItems) =>
    (Array.isArray(arr) ? arr : [])
      .map(item => fit(item, maxLen))
      .filter(Boolean)
      .slice(0, maxItems);

  return {
    overallScore: clamp(raw?.overallScore),
    passed: Boolean(raw?.passed),
    conceptualAccuracy: clamp(raw?.conceptualAccuracy),
    completeness: clamp(raw?.completeness),
    independentRecall: clamp(raw?.independentRecall),
    hintDependency: clamp(raw?.hintDependency),
    transferAbility: clamp(raw?.transferAbility),
    retentionStrength: raw?.retentionStrength != null ? clamp(raw.retentionStrength) : undefined,
    understandingLevel: validLevels.has(raw?.understandingLevel)
      ? raw.understandingLevel : "not_understood",
    strengths: textArray(raw?.strengths, 300, 8),
    missingPoints: textArray(raw?.missingPoints, 300, 8),
    misconceptions: textArray(raw?.misconceptions, 300, 6),
    nextTrainingGoal: fit(raw?.nextTrainingGoal, 500),
    recommendedNextStage: validStages.has(raw?.recommendedNextStage)
      ? raw.recommendedNextStage : "delayed_recall",
    userFeedback: fit(raw?.userFeedback, 1000)
  };
}

// ─── 从 MVP-1 analysis 生成评估（兼容路径） ───

/**
 * 当不调用 AI 评估时，从 MVP-1 的 analysis 字段推导 TrainingEvaluation。
 * 这是一个规则化的 fallback，不是完整评估。
 */
export function deriveEvaluationFromAnalysis(analysis, hintEvents, trainingStage) {
  if (!analysis) {
    return createFallbackEvaluation(trainingStage);
  }

  const hintCount = Array.isArray(hintEvents) ? hintEvents.length : 0;
  const coverage = Math.round((analysis.coverage || 0) * 100);
  const passed = analysis.status === "provisionally_cleared";

  // 提示依赖度：基于提示次数和级别
  let hintDependency = 0;
  if (hintCount === 0) {
    hintDependency = 0;
  } else {
    const maxLevel = Math.max(...hintEvents.map(h => h.level || 1));
    hintDependency = Math.min(100, hintCount * 15 + maxLevel * 8);
  }

  // 理解水平
  let understandingLevel = "not_understood";
  if (passed && hintCount === 0) {
    understandingLevel = trainingStage === "delayed_recall"
      ? "independently_explainable"
      : "initially_understood";
  } else if (passed) {
    understandingLevel = "prompt_supported";
  } else if (coverage > 30) {
    understandingLevel = "prompt_supported";
  }

  return {
    overallScore: Math.round(coverage * (1 - hintDependency / 200)),
    passed,
    conceptualAccuracy: coverage,
    completeness: coverage,
    independentRecall: hintCount === 0 ? coverage : Math.round(coverage * 0.5),
    hintDependency,
    transferAbility: trainingStage === "scenario_transfer" ? coverage : 0,
    retentionStrength: trainingStage === "delayed_recall" ? coverage : undefined,
    understandingLevel,
    strengths: analysis.demonstrated || [],
    missingPoints: analysis.missing || [],
    misconceptions: analysis.misconceptions || [],
    nextTrainingGoal: analysis.feedback || "继续练习核心概念",
    recommendedNextStage: passed
      ? (trainingStage === "initial_compensation" ? "delayed_recall" : "scenario_transfer")
      : "initial_compensation",
    userFeedback: analysis.feedback || analysis.teaching || ""
  };
}

function createFallbackEvaluation(trainingStage) {
  return {
    overallScore: 0,
    passed: false,
    conceptualAccuracy: 0,
    completeness: 0,
    independentRecall: 0,
    hintDependency: 50,
    transferAbility: 0,
    retentionStrength: undefined,
    understandingLevel: "not_understood",
    strengths: [],
    missingPoints: ["无法获取训练评估结果"],
    misconceptions: [],
    nextTrainingGoal: "重新尝试训练",
    recommendedNextStage: trainingStage || "initial_compensation",
    userFeedback: "评估服务暂时不可用，请稍后重试。"
  };
}

// ─── 提示事件创建 ───

export function createHintEvent({ level, hintType, content, answerBeforeHint, answerAfterHint, exposedKnowledgePoints }) {
  return {
    id: crypto.randomUUID(),
    level: Math.max(1, Math.min(6, Number(level) || 1)),
    hintType: hintType || "direction",
    content: String(content || "").slice(0, 1000),
    requestedAt: new Date().toISOString(),
    answerBeforeHint: answerBeforeHint ? String(answerBeforeHint).slice(0, 2000) : undefined,
    answerAfterHint: answerAfterHint ? String(answerAfterHint).slice(0, 2000) : undefined,
    exposedKnowledgePoints: Array.isArray(exposedKnowledgePoints)
      ? exposedKnowledgePoints.map(p => String(p).slice(0, 200)).slice(0, 10)
      : []
  };
}
