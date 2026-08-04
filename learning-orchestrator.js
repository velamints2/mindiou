/**
 * 学习编排服务 — 最小版本
 *
 * 职责：
 * - 从所有权缺口类型生成训练推荐
 * - 映射 ownership gap → training stage
 * - 不负责直接修改 MasteryProfile 或 CognitiveDebt 状态
 * - 不负责自行实现训练提交
 *
 * 与 review-scheduler.js 的 recommendNextStage 互补：
 * - review-scheduler 关注"下一次复训时间"
 * - learning-orchestrator 关注"下一步验证什么能力"
 */

import {
  EVIDENCE_LEVEL,
  TRAINING_STAGE,
  MODULE_OWNERSHIP_STATUS,
  determineMissingEvidenceTypes,
  recommendNextStage,
  levelToString,
} from "./project-ownership.js";

// ─── 所有权缺口类型 → 训练阶段映射 ───

const GAP_TO_STAGE = {
  needs_initial_understanding: TRAINING_STAGE.initial_compensation,
  needs_error_boundary_validation: TRAINING_STAGE.misconception_check,
  needs_transfer_validation: TRAINING_STAGE.scenario_transfer,
  needs_real_work_validation: TRAINING_STAGE.real_work_validation,
};

// ─── 缺口类型人类可读描述 ───

const GAP_DESCRIPTIONS = {
  needs_initial_understanding: "需要初步理解：完成首次补偿训练或延迟回忆",
  needs_error_boundary_validation: "需要错误与边界验证：识别误区和边界条件",
  needs_transfer_validation: "需要迁移验证：在陌生场景中使用",
  needs_real_work_validation: "需要真实工作验证：在真实项目中独立修改并验证",
};

/**
 * 从模块所有权状态生成训练推荐
 *
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.workItemId
 * @param {string} [params.decisionId]
 * @param {string} [params.artifactId]
 * @param {string} params.ownershipGapType
 * @param {number} params.currentEvidenceLevel
 * @returns {Object} 推荐对象
 */
export function generateRecommendation({
  projectId,
  workItemId,
  decisionId,
  artifactId,
  ownershipGapType,
  currentEvidenceLevel,
}) {
  if (!ownershipGapType) {
    return null;
  }

  const recommendedStage = GAP_TO_STAGE[ownershipGapType] || TRAINING_STAGE.initial_compensation;
  const missingEvidenceTypes = determineMissingEvidenceTypes(currentEvidenceLevel);
  const description = GAP_DESCRIPTIONS[ownershipGapType] || "继续训练以提升所有权";

  return {
    projectId,
    workItemId,
    decisionId,
    artifactId,
    ownershipGapType,
    recommendedStage,
    currentEvidenceLevel,
    currentEvidenceLevelLabel: levelToString(currentEvidenceLevel),
    missingEvidenceTypes,
    description,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 从模块状态生成推荐
 */
export function generateModuleRecommendation(moduleView) {
  if (!moduleView || !moduleView.ownershipGapType) {
    return null;
  }

  return generateRecommendation({
    projectId: moduleView.projectId,
    workItemId: moduleView.workItemId,
    ownershipGapType: moduleView.ownershipGapType,
    currentEvidenceLevel: moduleView.highestEvidenceLevel,
  });
}

/**
 * 批量生成项目级推荐
 *
 * 对每个非 owned 模块生成一条推荐，按风险等级排序。
 */
export function generateProjectRecommendations(moduleViews = []) {
  return moduleViews
    .filter((m) => m.status !== MODULE_OWNERSHIP_STATUS.owned)
    .map((m) => generateModuleRecommendation(m))
    .filter(Boolean)
    .sort((a, b) => {
      // 高风险优先
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const aRisk = riskOrder[a.riskLevel] ?? 4;
      const bRisk = riskOrder[b.riskLevel] ?? 4;
      return aRisk - bRisk;
    });
}
