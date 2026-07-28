/**
 * 复训任务生成模块
 *
 * AI 调用 4：复训任务生成
 *
 * 复训不是简单重复展示旧卡片。
 * 根据当前阶段、历史表现和上次失败点生成新的微型训练。
 * 每次复训只重点验证一到两个目标，保持碎片化。
 *
 * 避免：
 * - 连续生成相同措辞
 * - 直接泄露上次标准答案
 * - 把原卡片换个说法再次提问
 * - 用户背答案就能通过
 */

import crypto from "node:crypto";

// ─── 复训任务生成 Prompt ───

export function getReviewGenerationPrompt() {
  return [
    "You are MindIOU's review task generator.",
    "Generate ONE micro-training task that verifies a specific cognitive capability.",
    "",
    "You receive:",
    "- The original cognitive debt (gap text and evidence)",
    "- The original Feynman card prompt",
    "- The learner's first Feynman answer",
    "- Hint usage history (levels, types, what was exposed)",
    "- Previous review tasks (to avoid repetition)",
    "- Last missing points and misconceptions",
    "- Current mastery dimensions and training stage",
    "",
    "Rules:",
    "1. Do NOT repeat the original question wording.",
    "2. Do NOT reveal the original answer or scaffold content.",
    "3. Change the cognitive task: recall, compare, judge, detect errors, or transfer.",
    "4. Each task should take 1-5 minutes max.",
    "5. Match the learner's language.",
    "6. If the learner had high hint dependency, reduce scaffold further.",
    "7. If the learner failed a specific point, target that point from a new angle.",
    "",
    "Return JSON only:",
    JSON.stringify({
      taskType: "short_recall|concept_comparison|scenario_judgment|error_detection|micro_practice",
      prompt: "",
      hintsAllowed: false,
      maxHints: 0,
      targetDimension: "conceptualUnderstanding|independentRecall|hintIndependence|misconceptionResistance|transferAbility|retentionStrength",
      rationale: ""
    })
  ].join("\n");
}

// ─── 构建复训生成请求 ───

export function buildReviewRequest({ debt, card, firstAttempt, hintEvents, previousReviews, mastery, trainingStage }) {
  return {
    cognitiveDebt: {
      gapText: debt?.gapText || card?.target || "",
      evidence: debt?.gapEvidence || ""
    },
    originalPrompt: card?.prompt || "",
    firstAnswer: firstAttempt?.finalAnswer || firstAttempt?.initialAnswer || "",
    hintHistory: (hintEvents || []).map(h => ({
      level: h.level,
      type: h.hintType,
      exposedPoints: h.exposedKnowledgePoints || []
    })),
    previousReviews: (previousReviews || []).map(r => ({
      taskType: r.taskType,
      prompt: r.prompt
    })),
    currentMastery: mastery ? {
      conceptualUnderstanding: mastery.conceptualUnderstanding,
      independentRecall: mastery.independentRecall,
      hintIndependence: mastery.hintIndependence,
      misconceptionResistance: mastery.misconceptionResistance,
      transferAbility: mastery.transferAbility,
      retentionStrength: mastery.retentionStrength,
      overallMastery: mastery.overallMastery,
      currentStage: mastery.currentStage
    } : null,
    trainingStage: trainingStage || "delayed_recall",
    lastMissingPoints: firstAttempt?.evaluation?.missingPoints || [],
    lastMisconceptions: firstAttempt?.evaluation?.misconceptions || []
  };
}

// ─── 规范化复训任务 ───

export function normalizeReviewTask(raw, { userId, cognitiveDebtId, cardId, trainingStage, dueAt }) {
  const validTaskTypes = new Set([
    "short_recall", "concept_comparison", "scenario_judgment",
    "error_detection", "micro_practice", "feynman_explanation"
  ]);

  const fit = (v, max) => {
    const s = String(v || "").replace(/\s+/g, " ").trim();
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  };

  const taskType = validTaskTypes.has(raw?.taskType) ? raw.taskType : "short_recall";

  // 根据训练阶段设置提示策略
  const hintsAllowed = trainingStage === "delayed_recall"
    ? false  // 延迟回忆默认不允许提示
    : trainingStage === "scenario_transfer"
      ? false  // 迁移训练不允许提示
      : Boolean(raw?.hintsAllowed);

  const maxHints = hintsAllowed ? Math.min(3, Number(raw?.maxHints) || 2) : 0;

  return {
    id: crypto.randomUUID(),
    userId: userId || "demo-user",
    cognitiveDebtId,
    cardId,
    trainingStage: trainingStage || "delayed_recall",
    taskType,
    prompt: fit(raw?.prompt, 800),
    hintsAllowed,
    maxHints,
    createdAt: new Date().toISOString(),
    dueAt: dueAt || new Date().toISOString(),
    status: "pending"
  };
}

// ─── 规则化复训生成（fallback，不调用 AI） ───

/**
 * 当 AI 不可用时，基于规则生成复训任务。
 * 虽然不如 AI 生成的灵活，但确保复训不会因 AI 不可用而中断。
 */
export function generateRuleBasedReviewTask({ debt, card, firstAttempt, mastery, trainingStage, dueAt, userId }) {
  const gapText = debt?.gapText || card?.target || "核心概念";
  const missingPoints = firstAttempt?.evaluation?.missingPoints || [];
  const prompt = card?.prompt || "";

  let taskPrompt;
  let taskType;

  if (trainingStage === "delayed_recall") {
    // 延迟回忆：不展示原卡片，要求独立解释
    taskType = "short_recall";
    taskPrompt = `不看之前的材料，用你自己的话解释：${gapText}`;
    if (missingPoints.length > 0) {
      taskPrompt += `\n（上次你遗漏了：${missingPoints.slice(0, 2).join("、")}）`;
    }
  } else if (trainingStage === "misconception_check") {
    // 误区识别：给出错误说法让用户纠正
    taskType = "error_detection";
    taskPrompt = `判断以下说法是否准确，如果不准确请指出问题：\n"${debt?.gapEvidence || gapText}"`;
    if (missingPoints.length > 0) {
      taskPrompt = `有人说："${missingPoints[0]}"这个说法准确吗？请解释。`;
    }
  } else if (trainingStage === "scenario_transfer") {
    // 场景迁移：把概念放入新场景
    taskType = "scenario_judgment";
    taskPrompt = `在一个新场景中：${gapText}\n你会如何应用这个概念？请给出具体步骤。`;
  } else if (trainingStage === "error_detection") {
    // 错误识别
    taskType = "error_detection";
    taskPrompt = `以下关于"${gapText}"的说法中，哪些是准确的，哪些不准确？请逐一判断。\n${(missingPoints.length > 0 ? missingPoints : [gapText]).map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
  } else {
    // 默认：概念对比
    taskType = "concept_comparison";
    taskPrompt = `请解释"${gapText}"与相关概念的区别。`;
  }

  return normalizeReviewTask({
    taskType,
    prompt: taskPrompt,
    hintsAllowed: trainingStage !== "delayed_recall",
    maxHints: trainingStage === "delayed_recall" ? 0 : 2,
    rationale: `规则化生成：${trainingStage} 阶段复训`
  }, {
    userId,
    cognitiveDebtId: debt?.id,
    cardId: card?.id,
    trainingStage,
    dueAt
  });
}

// ─── 创建 TrainingAttempt（从 MVP-1 会话转换） ───

/**
 * 将 MVP-1 清偿会话转换为 TrainingAttempt。
 * 保留初始回答（第一次 attempt）和最终回答（最后一次 attempt）。
 */
export function createAttemptFromClearanceSession(session, { userId, cognitiveDebtId, hintEvents, evaluation }) {
  const attempts = session?.attempts || [];
  const firstAttempt = attempts[0];
  const lastAttempt = attempts[attempts.length - 1];

  return {
    id: crypto.randomUUID(),
    userId: userId || session?.userId || "demo-user",
    cardId: session?.cardId || "",
    cognitiveDebtId: cognitiveDebtId || "",
    trainingStage: "initial_compensation",
    taskType: "feynman_explanation",
    originalPrompt: session?.clearanceQuestion || session?.originalCard?.prompt || "",
    initialAnswer: firstAttempt?.answer || "",
    finalAnswer: lastAttempt?.answer || "",
    hintEvents: hintEvents || [],
    evaluation: evaluation || {},
    startedAt: session?.createdAt || new Date().toISOString(),
    completedAt: session?.endedAt || new Date().toISOString(),
    durationSeconds: session?.createdAt && session?.endedAt
      ? Math.round((new Date(session.endedAt) - new Date(session.createdAt)) / 1000)
      : undefined,
    clearanceSessionId: session?.id
  };
}
