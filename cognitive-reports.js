import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import {
  DOMAIN_ROOT_LABELS,
  TRAINING_STAGES,
  dimensionLabel,
  evidenceKeyForDebt,
  gapMechanismLabel,
  resolveSnapshotPeriod,
  riskTypeLabel,
  skillNodeKeyFromDomainPath
} from "./cognitive-profile.js";
import { deriveClusterMasterySummary } from "./debt-relations.js";
import { getTodayRecommendations } from "./learning-orchestrator.js";

/**
 * 周期性认知报告（Phase 5）
 *
 * 周报 / 月报的全部数字由确定性统计生成（数量、通过率、分布、趋势、对比），
 * 不经模型。大模型仅可通过可选 chatFn 润色已算好的 summaryText 措辞
 * （失败 / 无 key 时回退确定性模板），绝不直接读原始数据自由生成报告。
 *
 * 下周重点不另起排序：直接读取学习编排（Phase 4）getTodayRecommendations
 * 产出的 weeklyFocus 与核心推荐，保证周报重点与"今日复训"页一致。
 *
 * 幂等：同一 userId + reportType + periodStart 重算整体替换；历史周期不改写。
 */

export const CALCULATION_VERSION = "cognitive-reports/v1";
export const PROMPT_VERSION = "weekly-report-summary/v1";

export const REPORT_TYPES = Object.freeze(["weekly", "monthly"]);

/** 提示依赖度 ≤40 视为独立作答，≥60 视为提示依赖（与 Phase 3 同口径） */
const HINT_INDEPENDENT_THRESHOLD = 40;
const HINT_DEPENDENT_THRESHOLD = 60;
const TRANSFER_STAGES = new Set(["scenario_transfer", "error_detection"]);
const POST_INITIAL_STAGES = new Set([
  "delayed_recall", "misconception_check", "scenario_transfer", "error_detection", "real_work_validation"
]);

const MASTERY_DIMENSIONS = Object.freeze([
  "conceptualUnderstanding", "independentRecall", "hintIndependence",
  "misconceptionResistance", "transferAbility", "retentionStrength"
]);

const STAGE_LABELS = Object.freeze({
  initial_compensation: "首次补偿训练",
  delayed_recall: "延迟回忆",
  misconception_check: "误区识别",
  scenario_transfer: "场景迁移",
  error_detection: "错误识别",
  real_work_validation: "真实工作验证"
});

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toMs(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? ms : null;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function toDate(now) {
  if (now instanceof Date) return now;
  const parsed = now ? new Date(now) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function isWithinPeriod(ms, period) {
  const start = toMs(period.periodStart);
  const end = toMs(period.periodEnd);
  return ms !== null && start !== null && end !== null && ms >= start && ms < end;
}

function skillDisplayName(domainPath) {
  const segments = (Array.isArray(domainPath) ? domainPath : []).filter(Boolean).slice(0, 3);
  if (segments.length === 0) return "未分类";
  const [root, ...rest] = segments;
  const rootLabel = DOMAIN_ROOT_LABELS[root] || root;
  return rest.length > 0 ? `${rootLabel} / ${rest.join(" / ")}` : rootLabel;
}

/** 读取报告周期内欠条的来源键（sourceReports 首个 / reportId，与独立证据口径一致）。 */
function sourceKeyForDebt(debt) {
  const sources = Array.isArray(debt?.sourceReports) ? debt.sourceReports.filter(Boolean) : [];
  return sources[0] || debt?.reportId || "";
}

// ─── 周报各节 ───

/** 本周输入：新增欠条数、领域分布、产生欠条最多的来源。 */
export function buildInputsSection({ debts, analysesByDebtId, period }) {
  const newDebts = (Array.isArray(debts) ? debts : [])
    .filter(debt => isWithinPeriod(toMs(debt.createdAt), period))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));

  const byDomain = new Map();
  const bySource = new Map();
  for (const debt of newDebts) {
    const analysis = analysesByDebtId?.get ? analysesByDebtId.get(debt.id) : null;
    const domainPath = Array.isArray(analysis?.domainPath) ? analysis.domainPath : [];
    const key = skillNodeKeyFromDomainPath(domainPath) || "unclassified";
    if (!byDomain.has(key)) {
      byDomain.set(key, { skillNodeKey: key, displayName: key === "unclassified" ? "未分类" : skillDisplayName(domainPath), count: 0 });
    }
    byDomain.get(key).count++;
    const source = sourceKeyForDebt(debt) || "unknown";
    bySource.set(source, (bySource.get(source) || 0) + 1);
  }

  return {
    insufficientData: newDebts.length === 0,
    newDebtCount: newDebts.length,
    domainDistribution: [...byDomain.values()]
      .sort((a, b) => b.count - a.count || a.skillNodeKey.localeCompare(b.skillNodeKey)),
    topSources: [...bySource.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
      .slice(0, 5),
    newDebtIds: newDebts.map(debt => debt.id)
  };
}

/** 本周训练：训练次数、各阶段通过率、提示使用、复发情况。 */
export function buildTrainingSection({ debts, attempts, period }) {
  const periodAttempts = (Array.isArray(attempts) ? attempts : [])
    .filter(attempt => isWithinPeriod(toMs(attempt.completedAt), period))
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));

  const stagePassRates = {};
  for (const stage of TRAINING_STAGES) {
    const stageAttempts = periodAttempts.filter(attempt => attempt.trainingStage === stage);
    if (stageAttempts.length === 0) {
      stagePassRates[stage] = null;
      continue;
    }
    const passed = stageAttempts.filter(attempt => attempt.evaluation?.passed).length;
    stagePassRates[stage] = {
      attempts: stageAttempts.length,
      passed,
      passRate: round2(passed / stageAttempts.length)
    };
  }

  const averageHintsPerAttempt = periodAttempts.length > 0
    ? round2(periodAttempts.reduce((sum, attempt) => sum + (Array.isArray(attempt.hintEvents) ? attempt.hintEvents.length : 0), 0) / periodAttempts.length)
    : null;

  // 提示依赖趋势：周期内按时间前后两半均值对比（与 Phase 3 同口径，±5 阈值）
  const withHintDependency = periodAttempts
    .filter(attempt => Number.isFinite(Number(attempt.evaluation?.hintDependency)));
  let hintDependencyTrend = "insufficient_data";
  if (withHintDependency.length >= 2) {
    const half = Math.floor(withHintDependency.length / 2);
    const avg = items => items.reduce((sum, attempt) => sum + Number(attempt.evaluation.hintDependency), 0) / items.length;
    const earlier = avg(withHintDependency.slice(0, half));
    const later = avg(withHintDependency.slice(half));
    if (later < earlier - 5) hintDependencyTrend = "improving";
    else if (later > earlier + 5) hintDependencyTrend = "declining";
    else hintDependencyTrend = "stable";
  }

  const relapsedDebts = (Array.isArray(debts) ? debts : [])
    .filter(debt => debt.status === "relapsed" && isWithinPeriod(toMs(debt.updatedAt), period));

  return {
    insufficientData: periodAttempts.length === 0,
    totalAttempts: periodAttempts.length,
    passedAttempts: periodAttempts.filter(attempt => attempt.evaluation?.passed).length,
    stagePassRates,
    averageHintsPerAttempt,
    hintDependencyTrend,
    relapsedDebtCount: relapsedDebts.length,
    relapsedDebts: relapsedDebts.map(debt => ({ debtId: debt.id, gapText: clean(debt.gapText).slice(0, 200) }))
  };
}

/** 本周认知模式：最高频机制、重复问题簇、高风险问题、最弱掌握维度。 */
export function buildPatternsSection({ debts, analysesByDebtId, profilesByDebtId, graphStore, userId, period }) {
  const newDebts = (Array.isArray(debts) ? debts : [])
    .filter(debt => isWithinPeriod(toMs(debt.createdAt), period));

  const byMechanism = new Map();
  for (const debt of newDebts) {
    const analysis = analysesByDebtId?.get ? analysesByDebtId.get(debt.id) : null;
    const mechanism = clean(analysis?.primaryGapMechanism).toLowerCase();
    if (!mechanism) continue;
    if (!byMechanism.has(mechanism)) byMechanism.set(mechanism, { evidenceKeys: new Set(), debtIds: [] });
    const entry = byMechanism.get(mechanism);
    entry.evidenceKeys.add(evidenceKeyForDebt(debt));
    entry.debtIds.push(debt.id);
  }
  const mechanismDistribution = [...byMechanism.entries()]
    .map(([key, entry]) => ({
      key,
      label: gapMechanismLabel(key),
      count: entry.evidenceKeys.size,
      evidenceDebtIds: entry.debtIds
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const topMechanism = mechanismDistribution[0] || null;

  // 重复出现的问题：本周有新欠条加入的欠条簇
  const newDebtIds = new Set(newDebts.map(debt => debt.id));
  const recurringClusters = [];
  if (graphStore && userId) {
    for (const cluster of graphStore.listDebtClusters(userId)) {
      const members = graphStore.listDebtClusterMembers({ clusterId: cluster.id });
      const memberDebtIds = members.map(member => member.cognitiveDebtId);
      if (!memberDebtIds.some(id => newDebtIds.has(id))) continue;
      recurringClusters.push({
        clusterId: cluster.id,
        title: clean(cluster.title || "") || cluster.id,
        clusterType: clean(cluster.clusterType || ""),
        memberCount: memberDebtIds.length,
        newDebtIdsInPeriod: memberDebtIds.filter(id => newDebtIds.has(id))
      });
    }
    recurringClusters.sort((a, b) => b.memberCount - a.memberCount || a.clusterId.localeCompare(b.clusterId));
  }

  const highRiskDebts = [];
  for (const debt of newDebts) {
    const analysis = analysesByDebtId?.get ? analysesByDebtId.get(debt.id) : null;
    const riskTypes = (Array.isArray(analysis?.riskTypes) ? analysis.riskTypes : [])
      .map(risk => clean(risk).toLowerCase())
      .filter(risk => risk && risk !== "no_material_risk");
    if (riskTypes.length === 0) continue;
    highRiskDebts.push({
      debtId: debt.id,
      gapText: clean(debt.gapText).slice(0, 200),
      riskTypes,
      riskLabels: riskTypes.map(riskTypeLabel)
    });
  }

  // 最弱掌握维度：当前全部欠条的六维聚合最低维
  let weakestDimension = null;
  const debtList = Array.isArray(debts) ? debts : [];
  const debtsById = new Map(debtList.map(debt => [debt.id, debt]));
  const masterySummary = deriveClusterMasterySummary({
    memberDebtIds: debtList.map(debt => debt.id),
    debtsById,
    profilesByDebtId
  });
  if (masterySummary.withProfileCount > 0) {
    const weakest = MASTERY_DIMENSIONS
      .map(dimension => ({ dimension, value: Number(masterySummary.averageMastery[dimension]) || 0 }))
      .sort((a, b) => a.value - b.value)[0];
    weakestDimension = {
      dimension: weakest.dimension,
      label: dimensionLabel(weakest.dimension),
      value: weakest.value
    };
  }

  return {
    insufficientData: mechanismDistribution.length === 0 && recurringClusters.length === 0 && highRiskDebts.length === 0,
    topMechanism,
    mechanismDistribution,
    recurringClusters: recurringClusters.slice(0, 5),
    highRiskDebts,
    weakestDimension
  };
}

/** 本周进步：六维聚合提升、进入 mastered、提示依赖转独立、迁移训练通过。 */
export function buildProgressSection({ debts, attempts, profilesByDebtId, snapshots, period }) {
  const debtList = Array.isArray(debts) ? debts : [];
  const debtById = new Map(debtList.map(debt => [debt.id, debt]));
  const periodAttempts = (Array.isArray(attempts) ? attempts : [])
    .filter(attempt => isWithinPeriod(toMs(attempt.completedAt), period))
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));

  // 进入 mastered 的欠条（欠条时间线按时间排序）
  const masteredDebts = debtList
    .filter(debt => debt.status === "mastered" && isWithinPeriod(toMs(debt.updatedAt), period))
    .sort((a, b) => String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")))
    .map(debt => ({ debtId: debt.id, gapText: clean(debt.gapText).slice(0, 200), masteredAt: debt.updatedAt }));

  // 从提示依赖到独立解释：周期内独立通过后段训练，且历史曾高度依赖提示
  const allAttempts = (Array.isArray(attempts) ? attempts : [])
    .slice()
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
  const hintToIndependent = [];
  for (const attempt of periodAttempts) {
    if (!POST_INITIAL_STAGES.has(attempt.trainingStage)) continue;
    if (!attempt.evaluation?.passed) continue;
    if (!(Number(attempt.evaluation?.hintDependency) <= HINT_INDEPENDENT_THRESHOLD)) continue;
    const hadDependentHistory = allAttempts.some(prior =>
      prior.cognitiveDebtId === attempt.cognitiveDebtId
      && String(prior.completedAt || "") < String(attempt.completedAt || "")
      && Number(prior.evaluation?.hintDependency) >= HINT_DEPENDENT_THRESHOLD
    );
    if (!hadDependentHistory) continue;
    if (hintToIndependent.some(item => item.debtId === attempt.cognitiveDebtId)) continue;
    const debt = debtById.get(attempt.cognitiveDebtId);
    hintToIndependent.push({
      debtId: attempt.cognitiveDebtId,
      gapText: clean(debt?.gapText || "").slice(0, 200)
    });
  }

  // 通过迁移训练的欠条
  const transferPassed = [];
  for (const attempt of periodAttempts) {
    if (!TRANSFER_STAGES.has(attempt.trainingStage)) continue;
    if (!attempt.evaluation?.passed) continue;
    if (transferPassed.some(item => item.debtId === attempt.cognitiveDebtId)) continue;
    const debt = debtById.get(attempt.cognitiveDebtId);
    transferPassed.push({
      debtId: attempt.cognitiveDebtId,
      gapText: clean(debt?.gapText || "").slice(0, 200),
      stage: attempt.trainingStage,
      stageLabel: STAGE_LABELS[attempt.trainingStage] || attempt.trainingStage
    });
  }

  // 六维聚合：当前值 + 与上一周快照的 overallMastery 对比
  let mastery = null;
  const debtsById = new Map(debtList.map(debt => [debt.id, debt]));
  const summary = deriveClusterMasterySummary({
    memberDebtIds: debtList.map(debt => debt.id),
    debtsById,
    profilesByDebtId
  });
  if (summary.withProfileCount > 0) {
    const current = {};
    for (const dimension of MASTERY_DIMENSIONS) {
      current[dimension] = Number(summary.averageMastery[dimension]) || 0;
    }
    current.overallMastery = Number(summary.averageMastery.overallMastery) || 0;
    let previousOverall = null;
    let comparedSnapshotPeriodStart = null;
    const priorSnapshots = (Array.isArray(snapshots) ? snapshots : [])
      .filter(snapshot => String(snapshot?.periodStart || "") < String(period.periodStart));
    const previousSnapshot = priorSnapshots[0] || null;
    if (previousSnapshot) {
      previousOverall = weightedOverallFromSnapshot(previousSnapshot);
      comparedSnapshotPeriodStart = previousSnapshot.periodStart;
    }
    mastery = {
      current,
      previousOverallMastery: previousOverall,
      overallDelta: previousOverall !== null ? current.overallMastery - previousOverall : null,
      comparedSnapshotPeriodStart
    };
  }

  return {
    insufficientData: !mastery && masteredDebts.length === 0 && hintToIndependent.length === 0 && transferPassed.length === 0,
    mastery,
    masteredDebts,
    hintToIndependent,
    transferPassed
  };
}

/** 快照的六维聚合 overall：各领域 averageOverallMastery 按欠条数加权平均。 */
function weightedOverallFromSnapshot(snapshot) {
  const skills = snapshot?.skillSummaryJson?.skills;
  if (!Array.isArray(skills)) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const skill of skills) {
    const overall = Number(skill?.averageOverallMastery);
    const count = Number(skill?.relatedDebtCount) || 0;
    if (!Number.isFinite(overall) || count <= 0) continue;
    weightedSum += overall * count;
    weightTotal += count;
  }
  return weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;
}

// ─── 下周重点（复用学习编排推荐结果，不另起排序） ───

/**
 * 恰好 1 个能力主题 + 1-3 个优先任务 + 预计时间 + 推荐原因。
 * 数据来自 getTodayRecommendations 的 weeklyFocus 与核心推荐（只读调用其
 * 幂等生成结果），周报重点与"今日复训"页完全一致。
 */
export async function buildNextFocusSection(userId, deps, { now } = {}) {
  if (!deps?.orchestratorStore || !deps?.trainingStore) {
    return { insufficientData: true, theme: null, tasks: [], totalEstimatedMinutes: 0, reason: null };
  }
  const today = await getTodayRecommendations(userId, {
    store: deps.orchestratorStore,
    trainingStore: deps.trainingStore,
    intelligenceStore: deps.intelligenceStore,
    graphStore: deps.graphStore
  }, { now });
  const focus = today.weeklyFocus;
  if (!focus) {
    return { insufficientData: true, theme: null, tasks: [], totalEstimatedMinutes: 0, reason: null };
  }

  const displayName = clean(focus.title || "").replace(/^本周学习重点：/, "") || focus.skillNodeId || "未分类";
  const relatedIds = Array.isArray(focus.relatedDebtIds) ? focus.relatedDebtIds : [];
  const summaries = new Map((focus.relatedDebtSummaries || []).map(item => [item.id, item]));
  const recommendations = Array.isArray(today.recommendations) ? today.recommendations : [];
  const tasks = relatedIds.slice(0, 3).map(debtId => {
    const recommendation = recommendations.find(item => item.primaryDebtId === debtId) || null;
    const summary = summaries.get(debtId) || null;
    return {
      recommendationId: recommendation?.id || null,
      debtId,
      gapText: clean(summary?.gapText || recommendation?.debtSummary?.gapText || "").slice(0, 200),
      reason: clean(recommendation?.reason || focus.reason || "").slice(0, 1000),
      estimatedMinutes: Number.isFinite(Number(recommendation?.estimatedMinutes))
        ? Number(recommendation.estimatedMinutes)
        : Math.max(1, Math.ceil((Number(focus.estimatedMinutes) || 0) / Math.max(1, relatedIds.length))),
      recommendedTrainingStage: recommendation?.recommendedTrainingStage || focus.recommendedTrainingStage || null
    };
  });

  return {
    insufficientData: false,
    theme: {
      skillNodeId: focus.skillNodeId || null,
      displayName
    },
    tasks,
    totalEstimatedMinutes: Number(focus.estimatedMinutes) || 0,
    reason: clean(focus.reason || "").slice(0, 1000)
  };
}

// ─── 月报（基于月度快照的月度趋势对比） ───

function snapshotOverall(snapshot) {
  return weightedOverallFromSnapshot(snapshot);
}

function snapshotRelapseRate(snapshot) {
  const skills = snapshot?.skillSummaryJson?.skills;
  if (!Array.isArray(skills)) return null;
  const total = skills.reduce((sum, skill) => sum + (Number(skill?.relatedDebtCount) || 0), 0);
  if (total <= 0) return null;
  const relapsed = skills.reduce((sum, skill) => sum + (Number(skill?.relapsedDebtCount) || 0), 0);
  return round2(relapsed / total);
}

/**
 * 月报：对比最近两个月度快照（能力领域变化、机制分布变化、六维聚合变化、
 * 复发率变化、迁移能力变化）。不足两个月快照时各节标记 insufficient_data。
 */
export async function buildMonthlyReport(userId, period, deps) {
  const snapshots = deps?.profileStore
    ? deps.profileStore.listSnapshots(userId, { snapshotType: "monthly" })
    : [];
  const insufficientSection = { insufficientData: true };

  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return {
      insufficientData: true,
      comparedPeriods: null,
      inputs: { ...insufficientSection },
      training: { ...insufficientSection },
      patterns: { ...insufficientSection },
      progress: { ...insufficientSection },
      nextFocus: { insufficientData: true, theme: null, tasks: [], totalEstimatedMinutes: 0, reason: null }
    };
  }

  const current = snapshots[0];
  const previous = snapshots[1];
  const comparedPeriods = {
    current: { periodStart: current.periodStart, periodEnd: current.periodEnd },
    previous: { periodStart: previous.periodStart, periodEnd: previous.periodEnd }
  };

  // 能力领域变化
  const previousSkills = new Map(
    (previous.skillSummaryJson?.skills || []).map(skill => [skill.skillNodeKey, skill])
  );
  const skillChanges = (current.skillSummaryJson?.skills || [])
    .map(skill => {
      const before = previousSkills.get(skill.skillNodeKey) || null;
      const ratioAfter = Number(skill.masteredRatio);
      const ratioBefore = Number(before?.masteredRatio);
      return {
        skillNodeKey: skill.skillNodeKey,
        displayName: skill.displayName || skill.skillNodeKey,
        relatedDebtCount: Number(skill.relatedDebtCount) || 0,
        masteredRatioBefore: Number.isFinite(ratioBefore) ? ratioBefore : null,
        masteredRatioAfter: Number.isFinite(ratioAfter) ? ratioAfter : null,
        delta: Number.isFinite(ratioBefore) && Number.isFinite(ratioAfter) ? round2(ratioAfter - ratioBefore) : null,
        trend: skill.trend || "insufficient_data"
      };
    })
    .sort((a, b) => Math.abs(b.delta ?? -1) - Math.abs(a.delta ?? -1) || a.skillNodeKey.localeCompare(b.skillNodeKey));

  // 迁移能力变化（含训练量）
  const currentLearning = current.learningBehaviorSummaryJson || {};
  const previousLearning = previous.learningBehaviorSummaryJson || {};
  const transferAfter = Number(currentLearning.transferPassRate?.passRate);
  const transferBefore = Number(previousLearning.transferPassRate?.passRate);

  // 机制分布变化
  const mechanismOf = snapshot => (snapshot?.gapPatternSummaryJson?.distribution || [])
    .map(item => ({
      mechanism: item.mechanism,
      label: gapMechanismLabel(item.mechanism),
      count: Number(item.count) || 0,
      share: Number(item.share) || 0
    }))
    .slice(0, 5);

  // 六维聚合变化 + 复发率变化
  const overallBefore = snapshotOverall(previous);
  const overallAfter = snapshotOverall(current);
  const relapseBefore = snapshotRelapseRate(previous);
  const relapseAfter = snapshotRelapseRate(current);

  const nextFocus = await buildNextFocusSection(userId, deps, { now: deps?.now });

  return {
    insufficientData: false,
    comparedPeriods,
    inputs: {
      insufficientData: skillChanges.length === 0,
      skillChanges
    },
    training: {
      insufficientData: !Number.isFinite(transferAfter) && !Number.isFinite(transferBefore),
      attemptsBefore: Number(previousLearning.totalAttempts) || 0,
      attemptsAfter: Number(currentLearning.totalAttempts) || 0,
      transferPassRateBefore: Number.isFinite(transferBefore) ? transferBefore : null,
      transferPassRateAfter: Number.isFinite(transferAfter) ? transferAfter : null,
      transferDelta: Number.isFinite(transferBefore) && Number.isFinite(transferAfter)
        ? round2(transferAfter - transferBefore)
        : null,
      hintDependencyTrendAfter: currentLearning.hintDependencyTrend || "insufficient_data"
    },
    patterns: {
      insufficientData: mechanismOf(current).length === 0 && mechanismOf(previous).length === 0,
      mechanismBefore: mechanismOf(previous),
      mechanismAfter: mechanismOf(current)
    },
    progress: {
      insufficientData: overallBefore === null && overallAfter === null,
      overallMasteryBefore: overallBefore,
      overallMasteryAfter: overallAfter,
      overallDelta: overallBefore !== null && overallAfter !== null ? overallAfter - overallBefore : null,
      relapseRateBefore: relapseBefore,
      relapseRateAfter: relapseAfter,
      relapseDelta: relapseBefore !== null && relapseAfter !== null ? round2(relapseAfter - relapseBefore) : null
    },
    nextFocus
  };
}

// ─── 确定性 summaryText 模板 ───

function formatMonthDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function buildWeeklySummaryText({ period, inputs, training, patterns, progress, nextFocus }) {
  const sentences = [];
  const range = `本周（${formatMonthDay(period.periodStart)} ~ ${formatMonthDay(period.periodEnd)}）`;
  if (inputs.insufficientData) {
    sentences.push(`${range}没有新增认知欠条。`);
  } else {
    const topDomain = inputs.domainDistribution[0];
    const topSource = inputs.topSources[0];
    let sentence = `${range}新增 ${inputs.newDebtCount} 张认知欠条`;
    if (topDomain) sentence += `，主要集中在「${topDomain.displayName}」（${topDomain.count} 张）`;
    if (topSource) sentence += `；产生欠条最多的来源是 ${topSource.source}（${topSource.count} 张）`;
    sentences.push(`${sentence}。`);
  }
  if (training.insufficientData) {
    sentences.push("本周没有完成训练。");
  } else {
    const passRate = training.totalAttempts > 0
      ? Math.round((training.passedAttempts / training.totalAttempts) * 100)
      : 0;
    let sentence = `完成 ${training.totalAttempts} 次训练，通过率 ${passRate}%`;
    if (training.averageHintsPerAttempt !== null) sentence += `，平均每次使用 ${training.averageHintsPerAttempt} 次提示`;
    if (training.relapsedDebtCount > 0) sentence += `；${training.relapsedDebtCount} 张欠条出现复发`;
    sentences.push(`${sentence}。`);
  }
  if (!patterns.insufficientData) {
    const parts = [];
    if (patterns.topMechanism) parts.push(`最高频机制是「${patterns.topMechanism.label}」（${patterns.topMechanism.count} 条独立证据）`);
    if (patterns.recurringClusters.length > 0) parts.push(`${patterns.recurringClusters.length} 个问题在重复出现`);
    if (patterns.highRiskDebts.length > 0) parts.push(`${patterns.highRiskDebts.length} 张欠条涉及实质风险`);
    if (patterns.weakestDimension) parts.push(`当前最弱维度是「${patterns.weakestDimension.label}」(${patterns.weakestDimension.value})`);
    if (parts.length > 0) sentences.push(`${parts.join("；")}。`);
  }
  if (!progress.insufficientData) {
    const parts = [];
    if (progress.mastery?.overallDelta !== null && progress.mastery?.overallDelta !== undefined) {
      const delta = progress.mastery.overallDelta;
      parts.push(`六维聚合掌握度较上一周期${delta >= 0 ? "提升" : "下降"} ${Math.abs(delta)} 分（当前 ${progress.mastery.current.overallMastery}）`);
    } else if (progress.mastery) {
      parts.push(`当前六维聚合掌握度 ${progress.mastery.current.overallMastery}`);
    }
    if (progress.masteredDebts.length > 0) parts.push(`${progress.masteredDebts.length} 张欠条进入已掌握`);
    if (progress.hintToIndependent.length > 0) parts.push(`${progress.hintToIndependent.length} 张欠条从提示依赖转为独立解释`);
    if (progress.transferPassed.length > 0) parts.push(`${progress.transferPassed.length} 张欠条通过迁移训练`);
    if (parts.length > 0) sentences.push(`${parts.join("；")}。`);
  }
  if (!nextFocus.insufficientData && nextFocus.theme) {
    sentences.push(
      `下周重点：「${nextFocus.theme.displayName}」，${nextFocus.tasks.length} 个优先任务，预计 ${nextFocus.totalEstimatedMinutes} 分钟。`
    );
  }
  return sentences.join("");
}

export function buildMonthlySummaryText({ period, comparedPeriods, inputs, training, patterns, progress, nextFocus, insufficientData }) {
  const range = `本月（${formatMonthDay(period.periodStart)} ~ ${formatMonthDay(period.periodEnd)}）`;
  if (insufficientData) {
    return `${range}月度报告数据不足：需要至少两个月度画像快照才能对比趋势。请继续使用并等待每月快照生成。`;
  }
  const sentences = [`${range}与上一月度快照相比：`];
  const improved = inputs.skillChanges.filter(item => (item.delta ?? 0) > 0);
  const declined = inputs.skillChanges.filter(item => (item.delta ?? 0) < 0);
  const domainParts = [];
  if (improved.length > 0) {
    domainParts.push(`掌握比例上升的领域：${improved.map(item => `「${item.displayName}」(${Math.round((item.masteredRatioBefore ?? 0) * 100)}%→${Math.round((item.masteredRatioAfter ?? 0) * 100)}%)`).join("、")}`);
  }
  if (declined.length > 0) {
    domainParts.push(`下降的领域：${declined.map(item => `「${item.displayName}」`).join("、")}`);
  }
  if (domainParts.length > 0) sentences.push(`${domainParts.join("；")}。`);
  if (progress.overallDelta !== null && progress.overallDelta !== undefined) {
    sentences.push(`六维聚合掌握度 ${progress.overallMasteryBefore} → ${progress.overallMasteryAfter}（${progress.overallDelta >= 0 ? "+" : ""}${progress.overallDelta}）。`);
  }
  if (training.transferDelta !== null && training.transferDelta !== undefined) {
    sentences.push(`迁移训练通过率 ${Math.round((training.transferPassRateBefore ?? 0) * 100)}% → ${Math.round((training.transferPassRateAfter ?? 0) * 100)}%。`);
  }
  if (progress.relapseDelta !== null && progress.relapseDelta !== undefined) {
    sentences.push(`复发率 ${Math.round((progress.relapseRateBefore ?? 0) * 100)}% → ${Math.round((progress.relapseRateAfter ?? 0) * 100)}%。`);
  }
  const topMechanism = patterns.mechanismAfter[0];
  if (topMechanism) {
    sentences.push(`本月最高频机制是「${topMechanism.label}」（${topMechanism.count} 条独立证据）。`);
  }
  if (!nextFocus.insufficientData && nextFocus.theme) {
    sentences.push(`下月重点：「${nextFocus.theme.displayName}」，${nextFocus.tasks.length} 个优先任务，预计 ${nextFocus.totalEstimatedMinutes} 分钟。`);
  }
  return sentences.join("");
}

// ─── 可选 AI 措辞润色（仅润色 summaryText，失败/无 key 回退确定性模板） ───

let cachedSummaryPrompt = null;

/** 读取摘要润色 Prompt（prompts/weekly-report-summary/v1.md），进程内缓存。 */
export function getReportSummaryPrompt() {
  if (!cachedSummaryPrompt) {
    cachedSummaryPrompt = readFileSync(new URL("./prompts/weekly-report-summary/v1.md", import.meta.url), "utf8");
  }
  return cachedSummaryPrompt;
}

async function maybePolishSummary(templateText, chatFn) {
  if (typeof chatFn !== "function" || !templateText) {
    return { text: templateText, aiEnhanced: false };
  }
  try {
    const raw = await chatFn(
      [
        { role: "system", content: getReportSummaryPrompt() },
        { role: "user", content: JSON.stringify({ summary: templateText }) }
      ],
      () => ({}),
      1024
    );
    if (raw?.__fallback) return { text: templateText, aiEnhanced: false };
    const polished = clean(raw?.summary).slice(0, 1200);
    if (polished.length < 10) return { text: templateText, aiEnhanced: false };
    return { text: polished, aiEnhanced: true };
  } catch {
    return { text: templateText, aiEnhanced: false };
  }
}

// ─── 周报构建 ───

function collectProfileInputs(userId, deps) {
  const debts = deps.trainingStore.listCognitiveDebts(userId);
  const analysesByDebtId = new Map();
  for (const debt of debts) {
    const analysis = deps.intelligenceStore ? deps.intelligenceStore.getCurrentAnalysis(debt.id) : null;
    if (analysis) analysesByDebtId.set(debt.id, analysis);
  }
  const profilesByDebtId = new Map(
    deps.trainingStore.listMasteryProfiles(userId).map(profile => [profile.cognitiveDebtId, profile])
  );
  const attempts = deps.trainingStore.listAttempts(userId);
  return { debts, analysesByDebtId, profilesByDebtId, attempts };
}

/**
 * 构建周报五节内容（不落库）。deps：
 * { trainingStore, intelligenceStore, profileStore, graphStore, orchestratorStore, now, chatFn }
 */
export async function buildWeeklyReport(userId, period, deps) {
  const { debts, analysesByDebtId, profilesByDebtId, attempts } = collectProfileInputs(userId, deps);
  const snapshots = deps.profileStore ? deps.profileStore.listSnapshots(userId, { snapshotType: "weekly" }) : [];

  const inputs = buildInputsSection({ debts, analysesByDebtId, period });
  const training = buildTrainingSection({ debts, attempts, period });
  const patterns = buildPatternsSection({
    debts, analysesByDebtId, profilesByDebtId,
    graphStore: deps.graphStore, userId, period
  });
  const progress = buildProgressSection({ debts, attempts, profilesByDebtId, snapshots, period });
  const nextFocus = await buildNextFocusSection(userId, deps, { now: deps.now });
  return { inputs, training, patterns, progress, nextFocus };
}

// ─── 生成并保存（幂等替换同周期记录） ───

/**
 * 生成并保存周报。同 userId + weekly + periodStart 已存在时整体替换，
 * 历史周期不触碰。
 */
export async function generateWeeklyReport(userId, deps, { chatFn, now } = {}) {
  if (!deps?.store || !deps?.trainingStore) {
    throw new Error("store and trainingStore are required in deps");
  }
  const nowDate = toDate(now ?? deps.now);
  const period = resolveSnapshotPeriod("weekly", nowDate);
  const built = await buildWeeklyReport(userId, period, { ...deps, now: nowDate });
  const template = buildWeeklySummaryText({ period, ...built });
  const summary = await maybePolishSummary(template, chatFn);
  return deps.store.saveReport({
    id: crypto.randomUUID(),
    userId,
    reportType: "weekly",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    inputsJson: built.inputs,
    trainingJson: built.training,
    patternsJson: built.patterns,
    progressJson: built.progress,
    nextFocusJson: built.nextFocus,
    summaryText: summary.text,
    calculationVersion: CALCULATION_VERSION,
    createdAt: nowDate.toISOString()
  });
}

/**
 * 生成并保存月报（当前月周期；内容为最近两个月度快照对比，
 * 不足两快照时各节 insufficient_data）。幂等同 generateWeeklyReport。
 */
export async function generateMonthlyReport(userId, deps, { chatFn, now } = {}) {
  if (!deps?.store || !deps?.trainingStore) {
    throw new Error("store and trainingStore are required in deps");
  }
  const nowDate = toDate(now ?? deps.now);
  const period = resolveSnapshotPeriod("monthly", nowDate);
  const built = await buildMonthlyReport(userId, period, { ...deps, now: nowDate });
  const template = buildMonthlySummaryText({ period, ...built });
  const summary = await maybePolishSummary(template, chatFn);
  return deps.store.saveReport({
    id: crypto.randomUUID(),
    userId,
    reportType: "monthly",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    inputsJson: built.inputs,
    trainingJson: built.training,
    patternsJson: built.patterns,
    progressJson: built.progress,
    nextFocusJson: built.nextFocus,
    summaryText: summary.text,
    calculationVersion: CALCULATION_VERSION,
    createdAt: nowDate.toISOString()
  });
}

/**
 * 最近周报：当前周期已有报告则直接返回（幂等），否则读时生成并保存。
 */
export async function getLatestWeeklyReport(userId, deps, { chatFn, now } = {}) {
  const nowDate = toDate(now ?? deps?.now);
  const period = resolveSnapshotPeriod("weekly", nowDate);
  const existing = deps.store.findReport(userId, "weekly", period.periodStart);
  if (existing) return { report: existing, generated: false };
  const report = await generateWeeklyReport(userId, deps, { chatFn, now: nowDate });
  return { report, generated: true };
}

/**
 * 最近月报：当前月周期已有报告则直接返回（幂等），否则读时生成并保存。
 */
export async function getLatestMonthlyReport(userId, deps, { chatFn, now } = {}) {
  const nowDate = toDate(now ?? deps?.now);
  const period = resolveSnapshotPeriod("monthly", nowDate);
  const existing = deps.store.findReport(userId, "monthly", period.periodStart);
  if (existing) return { report: existing, generated: false };
  const report = await generateMonthlyReport(userId, deps, { chatFn, now: nowDate });
  return { report, generated: true };
}
