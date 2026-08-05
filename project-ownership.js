/**
 * 项目认知所有权地图 — 计算引擎
 *
 * 纯规则计算，不调用 AI 模型，不直接修改 MasteryProfile 或 CognitiveDebt 状态。
 *
 * 职责：
 * - 从 EvidenceRecord 和 TrainingAttempt 推导证据等级 E0-E5
 * - 计算每项重要决策的所有权状态
 * - 聚合模块（WorkItem）状态
 * - 计算项目顶部摘要
 * - 生成缺失证据类型和下一步训练入口
 *
 * 所有权状态由确定性代码根据事实记录计算，不由大模型判断。
 */

import crypto from "node:crypto";

// ─── 证据等级 E0-E5 ───

export const EVIDENCE_LEVEL = {
  E0: 0, // 只有 AI 产出，没有用户理解证据
  E1: 1, // 用户阅读、查看或接受过 AI 输出
  E2: 2, // 用户在不查看原答案的情况下能够独立解释
  E3: 3, // 用户能够识别错误、边界条件和关键风险
  E4: 4, // 用户能够在新的陌生场景中迁移使用
  E5: 5, // 用户能够在真实项目中独立修改、预测影响并完成验证
};

export const EVIDENCE_LEVEL_LABELS = {
  E0: "无证据",
  E1: "初步理解",
  E2: "能独立解释",
  E3: "能识别错误",
  E4: "能迁移使用",
  E5: "能独立修改",
};

// ─── 证据类型 ───

export const EVIDENCE_TYPE = {
  reading_acceptance: "reading_acceptance",
  independent_explanation: "independent_explanation",
  delayed_recall: "delayed_recall",
  error_detection: "error_detection",
  misconception_check: "misconception_check",
  scenario_transfer: "scenario_transfer",
  real_work_modification: "real_work_modification",
  test_passed: "test_passed",
  manual_review: "manual_review",
};

// ─── 决策级所有权状态 ───

export const DECISION_OWNERSHIP_STATUS = {
  high_risk_unowned: "high_risk_unowned",
  owned: "owned",
  missing_verification: "missing_verification",
  initial_understanding: "initial_understanding",
  unverified: "unverified",
};

export const DECISION_STATUS_LABELS = {
  high_risk_unowned: "高风险无人负责",
  owned: "已具备人类所有权",
  missing_verification: "缺少验证",
  initial_understanding: "只有初步理解",
  unverified: "未验证",
};

// ─── 模块级所有权状态 ───

export const MODULE_OWNERSHIP_STATUS = {
  high_risk_unowned: "high_risk_unowned",
  needs_initial_understanding: "needs_initial_understanding",
  needs_error_boundary_validation: "needs_error_boundary_validation",
  needs_transfer_validation: "needs_transfer_validation",
  needs_real_work_validation: "needs_real_work_validation",
  owned: "owned",
};

export const MODULE_STATUS_LABELS = {
  high_risk_unowned: "高风险无人负责",
  needs_initial_understanding: "缺少初步理解",
  needs_error_boundary_validation: "缺少错误与边界验证",
  needs_transfer_validation: "缺少迁移验证",
  needs_real_work_validation: "缺少独立修改证据",
  owned: "已具备人类所有权",
};

// ─── 风险类型 ───

export const RISK_TYPE = {
  security_risk: "security_risk",
  privacy_risk: "privacy_risk",
  financial_risk: "financial_risk",
  compliance_risk: "compliance_risk",
  reliability_risk: "reliability_risk",
};

export const HIGH_RISK_TYPES = new Set(Object.values(RISK_TYPE));

// ─── 训练阶段（与 mastery.js / training-evaluation.js 一致） ───

export const TRAINING_STAGE = {
  initial_compensation: "initial_compensation",
  delayed_recall: "delayed_recall",
  misconception_check: "misconception_check",
  scenario_transfer: "scenario_transfer",
  error_detection: "error_detection",
  real_work_validation: "real_work_validation",
};

// ─── 提示依赖阈值 ───

const HIGH_HINT_DEPENDENCY = 60;

// ─── 计算版本 ───

export const OWNERSHIP_CALCULATION_VERSION = "1.0.0";

// ═══════════════════════════════════════════════════════════
//  证据等级推导
// ═══════════════════════════════════════════════════════════

/**
 * 从 EvidenceRecord 列表推导最高证据等级
 *
 * EvidenceRecord 是可追溯事实，每条记录有明确的 evidenceLevel。
 * 取所有有效证据中的最高等级。
 */
export function highestEvidenceLevelFromRecords(evidenceRecords = []) {
  if (!Array.isArray(evidenceRecords) || evidenceRecords.length === 0) {
    return EVIDENCE_LEVEL.E0;
  }
  return evidenceRecords.reduce((max, record) => {
    const level = record.evidenceLevel ?? EVIDENCE_LEVEL.E0;
    return Math.max(max, level);
  }, EVIDENCE_LEVEL.E0);
}

/**
 * 从 TrainingAttempt 列表推导证据等级候选
 *
 * 映射规则（来自规格第五节）：
 * - 尚未训练 → E0
 * - 只查看过内容或完成普通首次训练 → 最高 E1
 * - delayed_recall 通过且没有依赖高等级提示 → E2 候选
 * - misconception_check 通过 或 error_detection 通过 → E3 候选
 * - scenario_transfer 通过且任务不是原题复述 → E4 候选
 * - real_work_validation 通过并存在真实 Artifact → E5 候选
 *
 * 重要限制：
 * - 测试通过 ≠ 用户掌握
 * - 代码已上线 ≠ 用户掌握
 * - 用户点击"我懂了" ≠ E5
 * - AI 评价很高 ≠ E5
 * - E5 必须具有真实项目中的人类独立操作证据
 */
export function deriveEvidenceLevelFromAttempts(attempts = []) {
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return EVIDENCE_LEVEL.E0;
  }

  let level = EVIDENCE_LEVEL.E0;

  for (const attempt of attempts) {
    const eval_ = attempt.evaluation;
    if (!eval_) continue;

    const passed = eval_.passed === true;
    const hintDep = eval_.hintDependency ?? 50;
    const stage = attempt.trainingStage;

    if (!passed) continue;

    // initial_compensation 通过 → 最高 E1
    if (stage === TRAINING_STAGE.initial_compensation) {
      level = Math.max(level, EVIDENCE_LEVEL.E1);
    }

    // delayed_recall 通过且没有依赖高等级提示 → E2 候选
    if (stage === TRAINING_STAGE.delayed_recall && hintDep < HIGH_HINT_DEPENDENCY) {
      level = Math.max(level, EVIDENCE_LEVEL.E2);
    }

    // misconception_check 通过 → E3 候选
    if (stage === TRAINING_STAGE.misconception_check) {
      level = Math.max(level, EVIDENCE_LEVEL.E3);
    }

    // error_detection 通过 → E3 候选
    if (stage === TRAINING_STAGE.error_detection) {
      level = Math.max(level, EVIDENCE_LEVEL.E3);
    }

    // scenario_transfer 通过且任务不是原题复述 → E4 候选
    if (stage === TRAINING_STAGE.scenario_transfer) {
      // 检查是否原题复述（transferAbility > 0 表示有迁移表现）
      const transferAbility = eval_.transferAbility ?? 0;
      if (transferAbility > 0 || hintDep < HIGH_HINT_DEPENDENCY) {
        level = Math.max(level, EVIDENCE_LEVEL.E4);
      }
    }

    // real_work_validation 通过 → E5 候选，但需要 artifact 证据
    // 注意：此处只标记候选，实际 E5 需要 artifact 证据
    // deriveEvidenceLevel 函数会合并 artifact 证据
    if (stage === TRAINING_STAGE.real_work_validation) {
      // 不能仅凭训练通过就到 E5，需要配合 artifact 证据
      // 但如果训练通过，至少可以到 E4
      level = Math.max(level, EVIDENCE_LEVEL.E4);
    }
  }

  return level;
}

/**
 * 综合推导证据等级
 *
 * 合并 EvidenceRecord 和 TrainingAttempt 两个来源的证据，
 * 取最高等级。E5 需要同时有 real_work_validation 通过
 * 和真实 Artifact 证据（代码修改/测试通过/人工评审）。
 */
export function deriveEvidenceLevel({
  evidenceRecords = [],
  trainingAttempts = [],
  artifacts = [],
}) {
  const fromRecords = highestEvidenceLevelFromRecords(evidenceRecords);
  const fromAttempts = deriveEvidenceLevelFromAttempts(trainingAttempts);
  const baseLevel = Math.max(fromRecords, fromAttempts);

  // E5 特殊判定：需要 real_work_validation 通过 AND 真实 artifact 证据
  const hasRealWorkValidationPassed = trainingAttempts.some(
    (a) => a.trainingStage === TRAINING_STAGE.real_work_validation && a.evaluation?.passed
  );

  const hasCodeModification = artifacts.some(
    (a) => a.artifactType === "code_modification" || a.artifactType === "commit"
  );
  const hasTestPassed = artifacts.some((a) => a.artifactType === "test");
  const hasManualReview = artifacts.some((a) => a.artifactType === "manual_review");

  const hasRealArtifactEvidence = hasCodeModification || hasTestPassed || hasManualReview;

  if (hasRealWorkValidationPassed && hasRealArtifactEvidence) {
    return EVIDENCE_LEVEL.E5;
  }

  // 如果有显式 E5 证据记录，也认可
  if (fromRecords >= EVIDENCE_LEVEL.E5 && hasRealArtifactEvidence) {
    return EVIDENCE_LEVEL.E5;
  }

  return baseLevel;
}

/**
 * 将数值等级转为 E0-E5 字符串
 */
export function levelToString(level) {
  for (const [key, value] of Object.entries(EVIDENCE_LEVEL)) {
    if (value === level) return key;
  }
  return "E0";
}

/**
 * 将 E0-E5 字符串转为数值
 */
export function stringToLevel(str) {
  return EVIDENCE_LEVEL[str] ?? EVIDENCE_LEVEL.E0;
}

// ═══════════════════════════════════════════════════════════
//  决策级状态计算
// ═══════════════════════════════════════════════════════════

/**
 * 判断决策是否为"重要 AI 决策"
 *
 * importance = high 或 critical
 * 并且 decisionMaker = agent 或 collaborative
 */
export function isImportantAIDecision(decision) {
  if (!decision) return false;
  const isHighOrCritical =
    decision.importance === "high" || decision.importance === "critical";
  const isAgentOrCollaborative =
    decision.decisionMaker === "agent" || decision.decisionMaker === "collaborative";
  return isHighOrCritical && isAgentOrCollaborative;
}

/**
 * 计算单个重要决策的所有权状态
 *
 * 优先级从高到低：
 * 1. high_risk_unowned
 * 2. owned
 * 3. missing_verification
 * 4. initial_understanding
 * 5. unverified
 *
 * 每个决策只进入一个状态，保证顶部数字能相加。
 */
export function calculateDecisionOwnershipStatus({
  decision,
  evidenceLevel,
  linkedDebts = [],
}) {
  // 确保是重要 AI 决策
  if (!isImportantAIDecision(decision)) {
    return null;
  }

  const isCritical = decision.importance === "critical";
  const level = evidenceLevel ?? EVIDENCE_LEVEL.E0;

  // 检查关联的高风险欠条
  const highRiskDebts = linkedDebts.filter((d) => {
    const riskType = d.riskType || d.intelligenceAnalysis?.riskType;
    return riskType && HIGH_RISK_TYPES.has(riskType);
  });

  const hasUnstableHighRiskDebt = highRiskDebts.some((d) => {
    const status = d.status;
    return (
      status === "relapsed" ||
      status === "new" ||
      status === "initial_training" ||
      status === undefined
    );
  });

  // 1. high_risk_unowned
  // 条件 a: critical 决策且最高证据低于 E2
  if (isCritical && level < EVIDENCE_LEVEL.E2) {
    return DECISION_OWNERSHIP_STATUS.high_risk_unowned;
  }
  // 条件 b: 关联高风险欠条且欠条未稳定掌握/relapsed/无独立解释证据
  if (hasUnstableHighRiskDebt && level < EVIDENCE_LEVEL.E2) {
    return DECISION_OWNERSHIP_STATUS.high_risk_unowned;
  }

  // 2. owned
  // 条件: 最高有效证据达到 E5 并且所有关联 critical 欠条不存在未处理或 relapsed 状态
  const criticalDebts = linkedDebts.filter((d) => {
    const riskType = d.riskType || d.intelligenceAnalysis?.riskType;
    return (
      riskType &&
      (riskType === RISK_TYPE.security_risk || riskType === RISK_TYPE.privacy_risk) &&
      d.importance !== "low" &&
      d.importance !== "medium"
    );
  });
  const hasUnprocessedCriticalDebt = criticalDebts.some((d) => {
    const status = d.status;
    return status === "new" || status === "relapsed" || status === "initial_training";
  });

  if (level >= EVIDENCE_LEVEL.E5 && !hasUnprocessedCriticalDebt) {
    return DECISION_OWNERSHIP_STATUS.owned;
  }

  // 3. missing_verification
  // 条件 a: 最高证据为 E2、E3 或 E4 但尚未达到 E5
  if (level >= EVIDENCE_LEVEL.E2 && level < EVIDENCE_LEVEL.E5) {
    return DECISION_OWNERSHIP_STATUS.missing_verification;
  }
  // 条件 b: 用户能够解释，但没有错误识别证据 (E2 without E3)
  // 条件 c: 用户能识别错误，但没有迁移证据 (E3 without E4)
  // 条件 d: 用户能迁移，但没有真实项目独立修改证据 (E4 without E5)
  // 以上都已被条件 a 覆盖

  // 4. initial_understanding
  // 条件: 最高证据为 E1 或仅完成首次补偿训练或只有"阅读、接受、查看"证据
  if (level === EVIDENCE_LEVEL.E1) {
    return DECISION_OWNERSHIP_STATUS.initial_understanding;
  }

  // 5. unverified
  // 没有任何有效证据
  return DECISION_OWNERSHIP_STATUS.unverified;
}

// ═══════════════════════════════════════════════════════════
//  模块级状态聚合
// ═══════════════════════════════════════════════════════════

/**
 * 聚合模块（WorkItem）状态
 *
 * 聚合优先级（不是平均分）：
 * 1. 存在 high_risk_unowned 决策 → high_risk_unowned
 * 2. 存在无 E2 证据的重要决策 → needs_initial_understanding
 * 3. 最高证据只有 E2 → needs_error_boundary_validation
 * 4. 最高证据达到 E3，但缺少 E4 → needs_transfer_validation
 * 5. 最高证据达到 E4，但缺少 E5 → needs_real_work_validation
 * 6. 所有 high/critical 决策达到 E5 且没有未处理高风险欠条 → owned
 *
 * 不得简单使用平均分。
 */
export function aggregateModuleStatus(decisionViews = []) {
  if (!Array.isArray(decisionViews) || decisionViews.length === 0) {
    return MODULE_OWNERSHIP_STATUS.owned; // 空模块视为已拥有
  }

  const importantDecisions = decisionViews.filter((d) => d.isImportant);
  if (importantDecisions.length === 0) {
    return MODULE_OWNERSHIP_STATUS.owned; // 无重要决策的模块视为已拥有
  }

  // 1. 存在 high_risk_unowned 决策
  if (importantDecisions.some((d) => d.status === DECISION_OWNERSHIP_STATUS.high_risk_unowned)) {
    return MODULE_OWNERSHIP_STATUS.high_risk_unowned;
  }

  // 2. 存在无 E2 证据的重要决策
  if (importantDecisions.some((d) => d.evidenceLevel < EVIDENCE_LEVEL.E2)) {
    return MODULE_OWNERSHIP_STATUS.needs_initial_understanding;
  }

  // 获取所有重要决策的最高证据等级
  const maxLevel = importantDecisions.reduce(
    (max, d) => Math.max(max, d.evidenceLevel ?? EVIDENCE_LEVEL.E0),
    EVIDENCE_LEVEL.E0
  );

  // 3. 最高证据只有 E2
  if (maxLevel === EVIDENCE_LEVEL.E2) {
    return MODULE_OWNERSHIP_STATUS.needs_error_boundary_validation;
  }

  // 4. 最高证据达到 E3，但缺少 E4
  if (maxLevel === EVIDENCE_LEVEL.E3) {
    return MODULE_OWNERSHIP_STATUS.needs_transfer_validation;
  }

  // 5. 最高证据达到 E4，但缺少 E5
  if (maxLevel === EVIDENCE_LEVEL.E4) {
    return MODULE_OWNERSHIP_STATUS.needs_real_work_validation;
  }

  // 6. 所有 high/critical 决策达到 E5 且没有未处理高风险欠条
  const allOwned = importantDecisions.every(
    (d) => d.status === DECISION_OWNERSHIP_STATUS.owned
  );
  if (allOwned) {
    return MODULE_OWNERSHIP_STATUS.owned;
  }

  // 如果有些决策还在 missing_verification 但不是高风险
  return MODULE_OWNERSHIP_STATUS.needs_real_work_validation;
}

/**
 * 计算模块风险等级
 */
export function calculateModuleRiskLevel(decisionViews = [], linkedDebts = []) {
  const importantDecisions = decisionViews.filter((d) => d.isImportant);

  if (importantDecisions.some((d) => d.importance === "critical" && d.evidenceLevel < EVIDENCE_LEVEL.E2)) {
    return "critical";
  }

  const highRiskDebtCount = linkedDebts.filter((d) => {
    const riskType = d.riskType || d.intelligenceAnalysis?.riskType;
    return riskType && HIGH_RISK_TYPES.has(riskType);
  }).length;

  if (importantDecisions.some((d) => d.importance === "critical") || highRiskDebtCount > 0) {
    return "high";
  }

  if (importantDecisions.some((d) => d.importance === "high")) {
    return "medium";
  }

  return "low";
}

// ═══════════════════════════════════════════════════════════
//  缺失证据类型和下一步训练
// ═══════════════════════════════════════════════════════════

/**
 * 根据当前证据等级确定缺失的证据类型
 */
export function determineMissingEvidenceTypes(currentLevel) {
  const missing = [];

  if (currentLevel < EVIDENCE_LEVEL.E1) {
    missing.push(EVIDENCE_TYPE.reading_acceptance);
  }
  if (currentLevel < EVIDENCE_LEVEL.E2) {
    missing.push(EVIDENCE_TYPE.independent_explanation);
    missing.push(EVIDENCE_TYPE.delayed_recall);
  }
  if (currentLevel < EVIDENCE_LEVEL.E3) {
    missing.push(EVIDENCE_TYPE.error_detection);
    missing.push(EVIDENCE_TYPE.misconception_check);
  }
  if (currentLevel < EVIDENCE_LEVEL.E4) {
    missing.push(EVIDENCE_TYPE.scenario_transfer);
  }
  if (currentLevel < EVIDENCE_LEVEL.E5) {
    missing.push(EVIDENCE_TYPE.real_work_modification);
    missing.push(EVIDENCE_TYPE.test_passed);
    missing.push(EVIDENCE_TYPE.manual_review);
  }

  return missing;
}

/**
 * 根据缺失证据类型推荐下一步训练阶段
 *
 * 映射：
 * - 缺少 E2 → delayed_recall 或 initial_compensation
 * - 缺少 E3 → misconception_check / error_detection
 * - 缺少 E4 → scenario_transfer
 * - 缺少 E5 → real_work_validation
 */
export function recommendNextStage(currentLevel, missingTypes = []) {
  if (currentLevel < EVIDENCE_LEVEL.E1) {
    return TRAINING_STAGE.initial_compensation;
  }
  if (currentLevel < EVIDENCE_LEVEL.E2) {
    return TRAINING_STAGE.delayed_recall;
  }
  if (currentLevel < EVIDENCE_LEVEL.E3) {
    return TRAINING_STAGE.misconception_check;
  }
  if (currentLevel < EVIDENCE_LEVEL.E4) {
    return TRAINING_STAGE.scenario_transfer;
  }
  if (currentLevel < EVIDENCE_LEVEL.E5) {
    return TRAINING_STAGE.real_work_validation;
  }
  return null; // 已达 E5，无下一步
}

/**
 * 根据模块状态映射所有权缺口类型
 */
export function ownershipGapFromModuleStatus(moduleStatus) {
  const map = {
    [MODULE_OWNERSHIP_STATUS.high_risk_unowned]: "needs_initial_understanding",
    [MODULE_OWNERSHIP_STATUS.needs_initial_understanding]: "needs_initial_understanding",
    [MODULE_OWNERSHIP_STATUS.needs_error_boundary_validation]: "needs_error_boundary_validation",
    [MODULE_OWNERSHIP_STATUS.needs_transfer_validation]: "needs_transfer_validation",
    [MODULE_OWNERSHIP_STATUS.needs_real_work_validation]: "needs_real_work_validation",
    [MODULE_OWNERSHIP_STATUS.owned]: null,
  };
  return map[moduleStatus] || null;
}

// ═══════════════════════════════════════════════════════════
//  项目摘要计算
// ═══════════════════════════════════════════════════════════

/**
 * 计算项目所有权摘要
 *
 * 顶部统计：
 * - importantDecisionCount: 重要 AI 决策总数
 * - ownedDecisionCount: 已拥有
 * - initialUnderstandingCount: 只有初步理解
 * - missingVerificationCount: 缺少验证
 * - highRiskUnownedCount: 高风险无人负责
 *
 * 四个分类互斥且总数一致。
 */
export function calculateProjectSummary({
  projectId,
  decisionViews = [],
  moduleViews = [],
}) {
  const importantDecisions = decisionViews.filter((d) => d.isImportant);

  const ownedDecisionCount = importantDecisions.filter(
    (d) => d.status === DECISION_OWNERSHIP_STATUS.owned
  ).length;
  const initialUnderstandingCount = importantDecisions.filter(
    (d) => d.status === DECISION_OWNERSHIP_STATUS.initial_understanding ||
           d.status === DECISION_OWNERSHIP_STATUS.unverified
  ).length;
  const missingVerificationCount = importantDecisions.filter(
    (d) => d.status === DECISION_OWNERSHIP_STATUS.missing_verification
  ).length;
  const highRiskUnownedCount = importantDecisions.filter(
    (d) => d.status === DECISION_OWNERSHIP_STATUS.high_risk_unowned
  ).length;

  const ownedModuleCount = moduleViews.filter(
    (m) => m.status === MODULE_OWNERSHIP_STATUS.owned
  ).length;
  const highRiskModuleCount = moduleViews.filter(
    (m) => m.status === MODULE_OWNERSHIP_STATUS.high_risk_unowned
  ).length;

  // 所有权覆盖率 = owned high/critical decisions ÷ all high/critical AI decisions
  const ownershipCoverage = importantDecisions.length > 0
    ? Math.round((ownedDecisionCount / importantDecisions.length) * 100)
    : 0;

  // 缺少真实工作验证的模块数
  const needsRealWorkModuleCount = moduleViews.filter(
    (m) => m.status === MODULE_OWNERSHIP_STATUS.needs_real_work_validation
  ).length;

  return {
    projectId,
    importantDecisionCount: importantDecisions.length,
    ownedDecisionCount,
    initialUnderstandingCount,
    missingVerificationCount,
    highRiskUnownedCount,

    moduleCount: moduleViews.length,
    ownedModuleCount,
    highRiskModuleCount,
    needsRealWorkModuleCount,

    ownershipCoverage,

    calculatedAt: new Date().toISOString(),
    calculationVersion: OWNERSHIP_CALCULATION_VERSION,
  };
}

// ═══════════════════════════════════════════════════════════
//  实体创建工厂
// ═══════════════════════════════════════════════════════════

export function createProject({ id, userId, name, description, repositoryUrl }) {
  return {
    id: id || crypto.randomUUID(),
    userId: userId || "demo-user",
    name: String(name || "").slice(0, 200),
    description: String(description || "").slice(0, 2000),
    repositoryUrl: repositoryUrl ? String(repositoryUrl).slice(0, 500) : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createWorkItem({ id, projectId, title, description, moduleType }) {
  return {
    id: id || crypto.randomUUID(),
    projectId,
    title: String(title || "").slice(0, 200),
    description: String(description || "").slice(0, 2000),
    moduleType: moduleType || "feature",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createAgentSession({ id, projectId, workItemId, source, title, implementationSummary }) {
  return {
    id: id || crypto.randomUUID(),
    projectId,
    workItemId,
    source: source || "codex", // codex, trae, claude_code, other
    title: String(title || "").slice(0, 300),
    implementationSummary: String(implementationSummary || "").slice(0, 5000),
    importedAt: new Date().toISOString(),
  };
}

export function createArtifact({ id, projectId, workItemId, sessionId, artifactType, path, functionName, commitSha, prUrl, diffSummary }) {
  return {
    id: id || crypto.randomUUID(),
    projectId,
    workItemId,
    sessionId,
    artifactType: artifactType || "file", // file, function, commit, pr, api, migration, test, code_modification, manual_review
    path: path ? String(path).slice(0, 500) : undefined,
    functionName: functionName ? String(functionName).slice(0, 200) : undefined,
    commitSha: commitSha ? String(commitSha).slice(0, 40) : undefined,
    prUrl: prUrl ? String(prUrl).slice(0, 500) : undefined,
    diffSummary: diffSummary ? String(diffSummary).slice(0, 2000) : undefined,
    createdAt: new Date().toISOString(),
  };
}

export function createDecisionRecord({
  id, projectId, workItemId, sessionId,
  title, decision, rationale,
  decisionType, importance, decisionMaker, userParticipation,
}) {
  return {
    id: id || crypto.randomUUID(),
    projectId,
    workItemId,
    sessionId,
    title: String(title || "").slice(0, 300),
    decision: String(decision || "").slice(0, 5000),
    rationale: rationale ? String(rationale).slice(0, 2000) : undefined,
    decisionType: decisionType || "other",
    importance: importance || "medium",
    decisionMaker: decisionMaker || "agent",
    userParticipation: userParticipation || "none",
    createdAt: new Date().toISOString(),
  };
}

export function createEvidenceRecord({
  id, userId, projectId, workItemId, decisionId, cognitiveDebtId,
  evidenceType, evidenceLevel,
  source, sourceId, description,
  trainingStage, passed, hintDependency,
  artifactId, hasCodeModification, hasTestPassed, hasManualReview,
}) {
  return {
    id: id || crypto.randomUUID(),
    userId: userId || "demo-user",
    projectId,
    workItemId,
    decisionId,
    cognitiveDebtId,
    evidenceType: evidenceType || EVIDENCE_TYPE.reading_acceptance,
    evidenceLevel: evidenceLevel ?? EVIDENCE_LEVEL.E1,
    source: source || "manual",
    sourceId,
    description: String(description || "").slice(0, 2000),
    trainingStage,
    passed,
    hintDependency,
    artifactId,
    hasCodeModification,
    hasTestPassed,
    hasManualReview,
    createdAt: new Date().toISOString(),
  };
}

export function createDecisionDebtLink({ decisionId, cognitiveDebtId, riskType }) {
  return {
    id: crypto.randomUUID(),
    decisionId,
    cognitiveDebtId,
    riskType,
    createdAt: new Date().toISOString(),
  };
}

export function createDecisionArtifactLink({ decisionId, artifactId }) {
  return {
    id: crypto.randomUUID(),
    decisionId,
    artifactId,
    createdAt: new Date().toISOString(),
  };
}

export function createOwnershipSnapshot({ projectId, summary, moduleSummary }) {
  return {
    id: crypto.randomUUID(),
    projectId,
    importantDecisionCount: summary.importantDecisionCount,
    ownedDecisionCount: summary.ownedDecisionCount,
    initialUnderstandingCount: summary.initialUnderstandingCount,
    missingVerificationCount: summary.missingVerificationCount,
    highRiskUnownedCount: summary.highRiskUnownedCount,
    moduleSummaryJson: JSON.stringify(moduleSummary),
    calculationVersion: OWNERSHIP_CALCULATION_VERSION,
    createdAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════
//  模块详情视图构建
// ═══════════════════════════════════════════════════════════

/**
 * 构建模块详情视图
 *
 * 按以下顺序组织：
 * 1. AI 做了什么（AgentSession + DecisionRecord + Artifact）
 * 2. 关键 AI 决策（每项含决策内容、采用原因、决策者、用户参与程度、重要性、关联文件和函数）
 * 3. 用户目前能证明什么（真实证据列表）
 * 4. 仍然欠下什么（未处理 CognitiveDebt、relapsed 欠条、高风险欠条）
 * 5. 下一步怎样证明掌握（缺失证据 → 训练入口）
 * 6. 真实产出物（文件、函数、Commit、PR、API、数据库迁移、测试）
 */
export function buildModuleDetailView({
  workItem,
  agentSessions = [],
  decisions = [],
  artifacts = [],
  evidenceRecords = [],
  cognitiveDebts = [],
  decisionDebtLinks = [],
  decisionArtifactLinks = [],
  trainingAttempts = [],
}) {
  const workItemId = workItem?.id;

  // 筛选本模块的决策
  const moduleDecisions = decisions.filter((d) => d.workItemId === workItemId);

  // 构建决策视图
  const decisionViews = moduleDecisions.map((decision) => {
    const linkedDebtIds = decisionDebtLinks
      .filter((l) => l.decisionId === decision.id)
      .map((l) => l.cognitiveDebtId);
    const linkedDebts = cognitiveDebts.filter((d) => linkedDebtIds.includes(d.id));

    // 为决策添加风险类型
    const debtsWithRisk = linkedDebts.map((d) => {
      const link = decisionDebtLinks.find(
        (l) => l.decisionId === decision.id && l.cognitiveDebtId === d.id
      );
      return { ...d, riskType: link?.riskType };
    });

    const linkedArtifactIds = decisionArtifactLinks
      .filter((l) => l.decisionId === decision.id)
      .map((l) => l.artifactId);
    const linkedArtifacts = artifacts.filter((a) => linkedArtifactIds.includes(a.id));

    // 证据：按 decisionId 筛选
    const decisionEvidence = evidenceRecords.filter(
      (e) => e.decisionId === decision.id || e.workItemId === workItemId
    );

    // 训练记录：通过 cognitiveDebtId 关联
    const decisionDebtIds = linkedDebts.map((d) => d.id);
    const decisionAttempts = trainingAttempts.filter(
      (a) => a.workItemId === workItemId || decisionDebtIds.includes(a.cognitiveDebtId)
    );

    const evidenceLevel = deriveEvidenceLevel({
      evidenceRecords: decisionEvidence,
      trainingAttempts: decisionAttempts,
      artifacts: linkedArtifacts,
    });

    const status = calculateDecisionOwnershipStatus({
      decision,
      evidenceLevel,
      linkedDebts: debtsWithRisk,
    });

    return {
      decisionId: decision.id,
      title: decision.title,
      decision: decision.decision,
      rationale: decision.rationale,
      decisionType: decision.decisionType,
      importance: decision.importance,
      decisionMaker: decision.decisionMaker,
      userParticipation: decision.userParticipation,
      isImportant: isImportantAIDecision(decision),
      status,
      evidenceLevel,
      evidenceLevelLabel: levelToString(evidenceLevel),
      linkedArtifacts: linkedArtifacts.map((a) => ({
        artifactType: a.artifactType,
        path: a.path,
        functionName: a.functionName,
        commitSha: a.commitSha,
        prUrl: a.prUrl,
        diffSummary: a.diffSummary,
      })),
      linkedDebts: debtsWithRisk.map((d) => ({
        id: d.id,
        gapText: d.gapText,
        status: d.status,
        riskType: d.riskType,
      })),
    };
  });

  // 聚合模块状态
  const moduleStatus = aggregateModuleStatus(decisionViews);
  const riskLevel = calculateModuleRiskLevel(decisionViews, cognitiveDebts);

  // 最高证据等级
  const maxEvidenceLevel = decisionViews.reduce(
    (max, d) => Math.max(max, d.evidenceLevel),
    EVIDENCE_LEVEL.E0
  );

  // 缺失证据类型
  const missingEvidenceTypes = determineMissingEvidenceTypes(maxEvidenceLevel);

  // 下一步训练阶段
  const nextRecommendedStage = recommendNextStage(maxEvidenceLevel, missingEvidenceTypes);

  // 所有制缺口类型
  const ownershipGapType = ownershipGapFromModuleStatus(moduleStatus);

  // 按证据类型组织用户证据
  const userEvidence = organizeUserEvidence(evidenceRecords, trainingAttempts, artifacts);

  // 将 riskType 从 decisionDebtLinks 合并到 cognitiveDebts
  const debtsWithRiskType = cognitiveDebts.map((d) => {
    const link = decisionDebtLinks.find((l) => l.cognitiveDebtId === d.id);
    return { ...d, riskType: d.riskType || link?.riskType };
  });

  // 未处理/relapsed/高风险欠条
  const openDebts = debtsWithRiskType.filter((d) => {
    const status = d.status;
    return status !== "mastered" && status !== "ignored";
  });
  const relapsedDebts = debtsWithRiskType.filter((d) => d.status === "relapsed");
  const highRiskDebts = debtsWithRiskType.filter((d) => {
    const riskType = d.riskType;
    return riskType && HIGH_RISK_TYPES.has(riskType);
  });

  // 最近活动时间
  const allTimestamps = [
    ...agentSessions.map((s) => s.importedAt),
    ...moduleDecisions.map((d) => d.createdAt),
    ...evidenceRecords.map((e) => e.createdAt),
    ...trainingAttempts.map((a) => a.completedAt),
  ].filter(Boolean);
  const latestActivityAt = allTimestamps.length > 0
    ? allTimestamps.sort().reverse()[0]
    : undefined;

  return {
    workItemId,
    title: workItem?.title,
    status: moduleStatus,
    statusLabel: MODULE_STATUS_LABELS[moduleStatus],
    riskLevel,

    importantDecisionCount: decisionViews.filter((d) => d.isImportant).length,
    highestEvidenceLevel: maxEvidenceLevel,
    highestEvidenceLevelLabel: levelToString(maxEvidenceLevel),

    relatedSessionCount: agentSessions.length,
    relatedArtifactCount: artifacts.length,
    openDebtCount: openDebts.length,
    highRiskDebtCount: highRiskDebts.length,

    missingEvidenceTypes,
    nextRecommendedStage,
    ownershipGapType,
    latestActivityAt,

    // 详情数据
    aiWork: {
      agentSessions: agentSessions.map((s) => ({
        id: s.id,
        source: s.source,
        title: s.title,
        implementationSummary: s.implementationSummary,
      })),
      decisions: decisionViews,
      artifacts: artifacts.map((a) => ({
        id: a.id,
        artifactType: a.artifactType,
        path: a.path,
        functionName: a.functionName,
        commitSha: a.commitSha,
        prUrl: a.prUrl,
        diffSummary: a.diffSummary,
      })),
    },

    userEvidence,

    remainingDebts: {
      openDebts: openDebts.map((d) => ({
        id: d.id,
        gapText: d.gapText,
        status: d.status,
        riskType: d.riskType,
      })),
      relapsedDebts: relapsedDebts.map((d) => ({
        id: d.id,
        gapText: d.gapText,
        riskType: d.riskType,
      })),
      highRiskDebts: highRiskDebts.map((d) => ({
        id: d.id,
        gapText: d.gapText,
        status: d.status,
        riskType: d.riskType,
      })),
    },
  };
}

/**
 * 按证据类型组织用户证据
 */
function organizeUserEvidence(evidenceRecords, trainingAttempts, artifacts) {
  const evidence = {
    independentExplanation: [],
    delayedRecall: [],
    errorDetection: [],
    misconceptionCheck: [],
    scenarioTransfer: [],
    realWorkModification: [],
    testPassed: [],
    manualReview: [],
  };

  // 从 EvidenceRecord 组织
  for (const record of evidenceRecords) {
    const item = {
      id: record.id,
      description: record.description,
      source: record.source,
      sourceId: record.sourceId,
      evidenceLevel: record.evidenceLevel,
      evidenceLevelLabel: levelToString(record.evidenceLevel ?? EVIDENCE_LEVEL.E0),
      createdAt: record.createdAt,
    };

    switch (record.evidenceType) {
      case EVIDENCE_TYPE.independent_explanation:
        evidence.independentExplanation.push(item);
        break;
      case EVIDENCE_TYPE.delayed_recall:
        evidence.delayedRecall.push(item);
        break;
      case EVIDENCE_TYPE.error_detection:
        evidence.errorDetection.push(item);
        break;
      case EVIDENCE_TYPE.misconception_check:
        evidence.misconceptionCheck.push(item);
        break;
      case EVIDENCE_TYPE.scenario_transfer:
        evidence.scenarioTransfer.push(item);
        break;
      case EVIDENCE_TYPE.real_work_modification:
        evidence.realWorkModification.push(item);
        break;
      case EVIDENCE_TYPE.test_passed:
        evidence.testPassed.push(item);
        break;
      case EVIDENCE_TYPE.manual_review:
        evidence.manualReview.push(item);
        break;
    }
  }

  // 从 TrainingAttempt 补充
  for (const attempt of trainingAttempts) {
    if (!attempt.evaluation?.passed) continue;

    const item = {
      id: attempt.id,
      description: `${attempt.trainingStage} 训练通过`,
      source: "training",
      sourceId: attempt.id,
      trainingStage: attempt.trainingStage,
      hintDependency: attempt.evaluation.hintDependency,
      overallScore: attempt.evaluation.overallScore,
      createdAt: attempt.completedAt,
    };

    switch (attempt.trainingStage) {
      case TRAINING_STAGE.delayed_recall:
        evidence.delayedRecall.push(item);
        break;
      case TRAINING_STAGE.misconception_check:
        evidence.misconceptionCheck.push(item);
        break;
      case TRAINING_STAGE.error_detection:
        evidence.errorDetection.push(item);
        break;
      case TRAINING_STAGE.scenario_transfer:
        evidence.scenarioTransfer.push(item);
        break;
      case TRAINING_STAGE.real_work_validation:
        evidence.realWorkModification.push(item);
        break;
    }
  }

  // 从 Artifact 补充 E5 证据
  for (const artifact of artifacts) {
    const item = {
      id: artifact.id,
      description: artifact.diffSummary || artifact.path || artifact.functionName || "",
      source: "artifact",
      sourceId: artifact.id,
      artifactType: artifact.artifactType,
      createdAt: artifact.createdAt,
    };

    if (artifact.artifactType === "test") {
      evidence.testPassed.push(item);
    } else if (artifact.artifactType === "manual_review") {
      evidence.manualReview.push(item);
    } else if (artifact.artifactType === "code_modification" || artifact.artifactType === "commit") {
      evidence.realWorkModification.push(item);
    }
  }

  return evidence;
}
