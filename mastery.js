/**
 * 掌握度计算与认知欠条状态机
 *
 * 规则引擎，不调用 AI 模型。
 * 所有权重和阈值集中配置，方便未来调整。
 */

import crypto from "node:crypto";

// ─── 掌握度权重 ───

export const MASTERY_WEIGHTS = {
  conceptualUnderstanding: 0.25,
  independentRecall: 0.20,
  hintIndependence: 0.15,
  misconceptionResistance: 0.10,
  transferAbility: 0.20,
  retentionStrength: 0.10
};

// ─── 理解水平阈值 ───

export const UNDERSTANDING_THRESHOLDS = {
  not_understood: 0,
  prompt_supported: 30,
  initially_understood: 50,
  independently_explainable: 70,
  transferable: 85,
  stable_mastery: 90
};

// ─── 合法状态流转 ───

const VALID_TRANSITIONS = {
  new: ["initial_training", "ignored"],
  initial_training: ["initially_understood", "ignored"],
  initially_understood: ["review_scheduled", "relapsed", "ignored"],
  review_scheduled: ["review_due", "ignored"],
  review_due: ["independently_explainable", "initially_understood", "relapsed", "ignored"],
  independently_explainable: ["transfer_training", "review_scheduled", "relapsed"],
  transfer_training: ["mastered", "independently_explainable", "relapsed"],
  mastered: ["relapsed", "review_scheduled"],
  relapsed: ["initial_training", "ignored"],
  ignored: ["new"]
};

// ─── 状态流转 ───

export function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function transitionStatus(currentStatus, targetStatus) {
  if (!canTransition(currentStatus, targetStatus)) {
    throw new Error(`Invalid status transition: ${currentStatus} -> ${targetStatus}`);
  }
  return targetStatus;
}

// ─── 从训练阶段推导目标状态 ───

export function deriveStatusFromStage(trainingStage, evaluation) {
  if (!evaluation?.passed) {
    // 训练未通过，根据当前阶段回退
    if (trainingStage === "delayed_recall") return "initially_understood";
    if (trainingStage === "scenario_transfer" || trainingStage === "error_detection") {
      return "independently_explainable";
    }
    return "initial_training";
  }

  switch (trainingStage) {
    case "initial_compensation":
      return "initially_understood";
    case "delayed_recall":
      return "independently_explainable";
    case "misconception_check":
      return "independently_explainable";
    case "scenario_transfer":
    case "error_detection":
      return "transfer_training";
    case "real_work_validation":
      return "mastered";
    default:
      return "initially_understood";
  }
}

// ─── 掌握度计算 ───

/**
 * 从训练评估更新掌握度画像
 *
 * 关键规则：
 * - 提示依赖度高时，independentRecall 和 hintIndependence 降低
 * - 使用提示本身不惩罚 overallScore，但影响独立能力维度
 * - 迁移训练通过后才提高 transferAbility
 * - 延迟回忆通过后才提高 retentionStrength
 */
export function updateMasteryProfile(currentProfile, attempt) {
  const eval_ = attempt.evaluation;
  if (!eval_) throw new Error("Attempt evaluation is required");

  const profile = currentProfile ? { ...currentProfile } : createInitialMastery(attempt.cognitiveDebtId, attempt.capabilityId);

  // 根据训练阶段更新对应维度
  const stage = attempt.trainingStage;

  if (stage === "initial_compensation") {
    profile.conceptualUnderstanding = blend(profile.conceptualUnderstanding, eval_.conceptualAccuracy, 0.6);
    profile.hintIndependence = blend(profile.hintIndependence, 100 - eval_.hintDependency, 0.5);
    // 首次训练不直接更新 independentRecall，因为是在材料帮助下完成的
    profile.independentRecall = Math.min(profile.independentRecall, 100 - eval_.hintDependency * 0.5);
  }

  if (stage === "delayed_recall") {
    profile.independentRecall = blend(profile.independentRecall, eval_.independentRecall, 0.7);
    profile.hintIndependence = blend(profile.hintIndependence, 100 - eval_.hintDependency, 0.6);
    profile.retentionStrength = blend(profile.retentionStrength, eval_.independentRecall, 0.7);
  }

  if (stage === "misconception_check") {
    profile.misconceptionResistance = blend(profile.misconceptionResistance,
      eval_.conceptualAccuracy, 0.6);
  }

  if (stage === "scenario_transfer" || stage === "error_detection") {
    profile.transferAbility = blend(profile.transferAbility, eval_.transferAbility, 0.7);
    profile.misconceptionResistance = blend(profile.misconceptionResistance,
      eval_.conceptualAccuracy, 0.4);
  }

  if (stage === "real_work_validation") {
    profile.retentionStrength = blend(profile.retentionStrength, eval_.retentionStrength || 80, 0.5);
    profile.transferAbility = blend(profile.transferAbility, eval_.transferAbility, 0.4);
  }

  // 更新统计
  profile.lastAttemptAt = attempt.completedAt;
  if (eval_.passed) {
    profile.successfulAttempts += 1;
  } else {
    profile.failedAttempts += 1;
  }

  // 更新当前阶段
  const stageOrder = {
    initial_compensation: 1,
    delayed_recall: 2,
    misconception_check: 3,
    scenario_transfer: 4,
    error_detection: 4,
    real_work_validation: 5
  };
  const newStage = stageOrder[stage] || 1;
  if (eval_.passed && newStage > profile.currentStage) {
    profile.currentStage = newStage;
  }

  // 重新计算综合掌握度
  profile.overallMastery = calculateOverallMastery(profile);

  return profile;
}

function createInitialMastery(debtId, capabilityId) {
  return {
    cognitiveDebtId: debtId,
    capabilityId: capabilityId || undefined,
    conceptualUnderstanding: 0,
    independentRecall: 0,
    hintIndependence: 0,
    misconceptionResistance: 0,
    transferAbility: 0,
    retentionStrength: 0,
    overallMastery: 0,
    currentStage: 0,
    lastAttemptAt: undefined,
    nextReviewAt: undefined,
    successfulAttempts: 0,
    failedAttempts: 0,
    relapseCount: 0
  };
}

export function calculateOverallMastery(profile) {
  const w = MASTERY_WEIGHTS;
  return Math.round(
    (profile.conceptualUnderstanding * w.conceptualUnderstanding +
     profile.independentRecall * w.independentRecall +
     profile.hintIndependence * w.hintIndependence +
     profile.misconceptionResistance * w.misconceptionResistance +
     profile.transferAbility * w.transferAbility +
     profile.retentionStrength * w.retentionStrength)
  );
}

function blend(current, incoming, weight) {
  // 加权融合：新证据占 weight 比例，历史占 (1-weight)
  return Math.round(current * (1 - weight) + incoming * weight);
}

// ─── 理解水平判断 ───

export function deriveUnderstandingLevel(profile, latestEvaluation) {
  const score = profile.overallMastery;

  // 如果最近评估提示依赖度高，最高只能是 prompt_supported
  if (latestEvaluation && latestEvaluation.hintDependency > 60) {
    return score > 40 ? "prompt_supported" : "not_understood";
  }

  if (score >= UNDERSTANDING_THRESHOLDS.stable_mastery) return "stable_mastery";
  if (score >= UNDERSTANDING_THRESHOLDS.transferable) return "transferable";
  if (score >= UNDERSTANDING_THRESHOLDS.independently_explainable) return "independently_explainable";
  if (score >= UNDERSTANDING_THRESHOLDS.initially_understood) return "initially_understood";
  if (score >= UNDERSTANDING_THRESHOLDS.prompt_supported) return "prompt_supported";
  return "not_understood";
}

// ─── 用户可见的掌握度文案 ───

export function masteryLabel(level) {
  const labels = {
    not_understood: "正在补偿",
    prompt_supported: "在提示帮助下能够解释",
    initially_understood: "已初步理解",
    independently_explainable: "能够独立解释",
    transferable: "能够迁移使用",
    stable_mastery: "已形成稳定掌握"
  };
  return labels[level] || "正在补偿";
}

// ─── 复发处理 ───

export function handleRelapse(profile) {
  return {
    ...profile,
    relapseCount: profile.relapseCount + 1,
    // 复发时降低保持度和迁移能力
    retentionStrength: Math.max(0, Math.round(profile.retentionStrength * 0.5)),
    transferAbility: Math.max(0, Math.round(profile.transferAbility * 0.7)),
    overallMastery: 0 // 重新计算
  };
}

// ─── 认知欠条创建 ───

export function createCognitiveDebt({ userId, reportId, cardId, gapText, gapEvidence, capabilityId }) {
  return {
    id: crypto.randomUUID(),
    userId: userId || "demo-user",
    reportId,
    cardId,
    gapText: String(gapText || "").trim().slice(0, 500),
    gapEvidence: String(gapEvidence || "").trim().slice(0, 1000),
    capabilityId: capabilityId || undefined,
    status: "new",
    recurrenceCount: 0,
    sourceReports: [reportId].filter(Boolean),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// ─── 旧数据兼容 ───

/**
 * 将旧 MVP-1 会话转换为认知欠条和初始掌握度
 * 旧数据只有最终答案，没有提示记录，hintDependency 设为 unknown(50)
 */
export function migrateLegacySession(session, { userId, reportId, cardId, gapText } = {}) {
  const debt = createCognitiveDebt({
    userId: userId || session.userId || "demo-user",
    reportId: reportId || session.reportId,
    cardId: cardId || session.cardId,
    gapText: gapText || session.originalCard?.target || ""
  });

  // 旧已完成会话默认标记为 initially_understood，不标记为 mastered
  if (session.state === "ended" && session.finalResult) {
    debt.status = "initially_understood";
  }

  const profile = createInitialMastery(debt.id);
  if (session.finalResult) {
    const passed = session.finalResult.status === "provisionally_cleared";
    profile.conceptualUnderstanding = passed ? 50 : 20;
    profile.hintIndependence = 50; // unknown
    profile.successfulAttempts = passed ? 1 : 0;
    profile.failedAttempts = passed ? 0 : 1;
    profile.currentStage = passed ? 1 : 0;
    profile.lastAttemptAt = session.endedAt;
    profile.overallMastery = calculateOverallMastery(profile);
  }

  return { debt, profile };
}
