/**
 * 复训调度规则引擎
 *
 * 纯规则计算，不调用 AI 模型。
 * 根据训练阶段、评估结果、提示使用和当前掌握度计算下一次复训时间。
 */

// ─── 复训间隔（毫秒） ───

export const REVIEW_INTERVALS = {
  // 首次训练高质量完成且无提示
  initialHighQuality: 3 * 24 * 60 * 60 * 1000,   // 3天
  // 首次训练完成但使用少量提示
  initialWithHints: 1 * 24 * 60 * 60 * 1000,      // 1天
  // 首次训练高度依赖提示
  initialHighDependency: 6 * 60 * 60 * 1000,       // 6小时
  // 延迟回忆通过
  delayedRecallPassed: 7 * 24 * 60 * 60 * 1000,   // 7天
  // 迁移训练通过
  transferPassed: 14 * 24 * 60 * 60 * 1000,       // 14天
  // 连续稳定通过
  stableMastery: 30 * 24 * 60 * 60 * 1000,         // 30天
  // 复训失败
  reviewFailed: 12 * 60 * 60 * 1000,                // 12小时
  // 默认
  default: 1 * 24 * 60 * 60 * 1000                  // 1天
};

// ─── 提示依赖阈值 ───

const LOW_HINT_DEPENDENCY = 20;
const HIGH_HINT_DEPENDENCY = 60;

// ─── 核心调度函数 ───

/**
 * 计算下一次复训时间
 *
 * @param {Object} params
 * @param {string} params.trainingStage - 训练阶段
 * @param {Object} params.evaluation - 训练评估
 * @param {Array}  params.hintEvents - 提示事件
 * @param {Array}  params.previousAttempts - 历史训练记录
 * @param {Object} params.currentMastery - 当前掌握度
 * @returns {{ nextReviewAt: string, intervalMs: number, reason: string }}
 */
export function calculateNextReview({ trainingStage, evaluation, hintEvents, previousAttempts, currentMastery }) {
  const hintCount = Array.isArray(hintEvents) ? hintEvents.length : 0;
  const hintDependency = evaluation?.hintDependency ?? 50;
  const passed = evaluation?.passed ?? false;
  const now = Date.now();

  let intervalMs;
  let reason;

  if (!passed) {
    // 复训失败
    intervalMs = REVIEW_INTERVALS.reviewFailed;
    reason = "复训未通过，缩短间隔重新训练";
  } else {
    // 通过，根据训练阶段和表现安排
    switch (trainingStage) {
      case "initial_compensation":
        if (hintCount === 0 && hintDependency < LOW_HINT_DEPENDENCY) {
          intervalMs = REVIEW_INTERVALS.initialHighQuality;
          reason = "首次训练高质量完成且无提示，3天后复训";
        } else if (hintDependency > HIGH_HINT_DEPENDENCY) {
          intervalMs = REVIEW_INTERVALS.initialHighDependency;
          reason = "首次训练高度依赖提示，6小时后复训";
        } else {
          intervalMs = REVIEW_INTERVALS.initialWithHints;
          reason = "首次训练完成但使用少量提示，1天后复训";
        }
        break;

      case "delayed_recall":
        intervalMs = REVIEW_INTERVALS.delayedRecallPassed;
        reason = "延迟回忆通过，7天后复训";
        break;

      case "misconception_check":
        intervalMs = REVIEW_INTERVALS.delayedRecallPassed;
        reason = "误区识别通过，7天后进行迁移训练";
        break;

      case "scenario_transfer":
      case "error_detection":
        // 检查是否连续稳定通过
        const recentAttempts = (previousAttempts || []).slice(0, 3);
        const allPassed = recentAttempts.length >= 2 &&
          recentAttempts.every(a => a.evaluation?.passed);
        if (allPassed && currentMastery?.overallMastery >= 85) {
          intervalMs = REVIEW_INTERVALS.stableMastery;
          reason = "连续稳定通过，30天后复训";
        } else {
          intervalMs = REVIEW_INTERVALS.transferPassed;
          reason = "迁移训练通过，14天后复训";
        }
        break;

      case "real_work_validation":
        intervalMs = REVIEW_INTERVALS.stableMastery;
        reason = "真实工作验证通过，30天后复训";
        break;

      default:
        intervalMs = REVIEW_INTERVALS.default;
        reason = "默认1天后复训";
    }
  }

  const nextReviewAt = new Date(now + intervalMs).toISOString();
  return { nextReviewAt, intervalMs, reason };
}

// ─── 复训优先级排序 ───

/**
 * 对到期复训任务排序
 *
 * 优先级：
 * 1. 已到期的高风险欠条（mastered 但复发）
 * 2. 复训失败或复发欠条
 * 3. 高提示依赖欠条
 * 4. 普通到期欠条
 * 5. 新的首次补偿训练
 */
export function sortReviewTasks(tasks, masteryMap) {
  return [...tasks].sort((a, b) => {
    const ma = masteryMap[a.cognitiveDebtId];
    const mb = masteryMap[b.cognitiveDebtId];

    // 优先级 1: 复发欠条
    const aRelapse = (ma?.relapseCount || 0) > 0;
    const bRelapse = (mb?.relapseCount || 0) > 0;
    if (aRelapse && !bRelapse) return -1;
    if (!aRelapse && bRelapse) return 1;

    // 优先级 2: 失败次数多
    const aFailed = ma?.failedAttempts || 0;
    const bFailed = mb?.failedAttempts || 0;
    if (aFailed !== bFailed) return bFailed - aFailed;

    // 优先级 3: 高提示依赖（低 hintIndependence）
    const aHintDep = 100 - (ma?.hintIndependence || 100);
    const bHintDep = 100 - (mb?.hintIndependence || 100);
    if (aHintDep !== bHintDep) return bHintDep - aHintDep;

    // 优先级 4: 到期时间早的优先
    return String(a.dueAt || "").localeCompare(String(b.dueAt || ""));
  });
}

// ─── 时间预算任务选择 ───

// 任务类型预估时间（分钟）。学习编排（Phase 4）复用同一估时，保持口径一致。
export const TASK_TYPE_ESTIMATED_MINUTES = {
  feynman_explanation: 3,
  short_recall: 1,
  concept_comparison: 3,
  scenario_judgment: 5,
  error_detection: 3,
  micro_practice: 5
};

/**
 * 根据用户可用时间选择复训任务
 *
 * @param {Array} sortedTasks - 已排序的复训任务
 * @param {number} availableMinutes - 可用分钟数
 * @returns {Array} 选中的任务
 */
export function selectTasksByTimeBudget(sortedTasks, availableMinutes) {
  const selected = [];
  let remaining = availableMinutes;

  for (const task of sortedTasks) {
    const time = TASK_TYPE_ESTIMATED_MINUTES[task.taskType] || 3;
    if (time <= remaining) {
      selected.push(task);
      remaining -= time;
    }
    if (remaining <= 0) break;
  }

  return selected;
}

// ─── 下一个推荐训练阶段 ───

export function recommendNextStage(currentStage, evaluation, mastery) {
  if (!evaluation?.passed) {
    // 未通过，重复当前阶段
    return stageFromNumber(mastery?.currentStage || 1);
  }

  const stage = mastery?.currentStage || 1;

  if (stage < 2) return "delayed_recall";
  if (stage < 3) return "misconception_check";
  if (stage < 4) return "scenario_transfer";
  return "real_work_validation";
}

function stageFromNumber(n) {
  const stages = ["initial_compensation", "delayed_recall", "misconception_check", "scenario_transfer", "real_work_validation"];
  return stages[Math.max(0, Math.min(n - 1, stages.length - 1))];
}
