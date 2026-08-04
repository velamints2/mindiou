import crypto from "node:crypto";
import { generateRuleBasedReviewTask } from "./review-generator.js";
import { TASK_TYPE_ESTIMATED_MINUTES } from "./review-scheduler.js";
import {
  DOMAIN_ROOT_LABELS,
  dimensionLabel,
  skillNodeKeyFromDomainPath,
  resolveSnapshotPeriod
} from "./cognitive-profile.js";

/**
 * 下一步学习编排（Phase 4）
 *
 * 纯函数 + 依赖注入的推荐编排器：
 *   gatherCandidates → scoreCandidate → 排序去重 → 确定性 reason 模板
 *   → 可选 chatFn 仅润色文案（失败/无 key 回退模板）→ 持久化。
 *
 * 职责边界（铁律）：
 * - 不重新计算复训日期（不调用 calculateNextReview），到期候选直接读
 *   trainingStore.listDueReviews；
 * - 不修改掌握度；接受推荐后走现有 review start/submit 链路；
 * - 优先级基础分全部由代码计算并记录进 scoreFactorsJson；
 * - 模型仅可润色推荐原因文案。
 */

export const SCORING_VERSION = "learning-orchestrator/v1";

export const RECOMMENDATION_TYPES = Object.freeze([
  "due_review", "prerequisite_training", "cluster_consolidation",
  "transfer_training", "real_work_validation", "weekly_focus"
]);

export const RECOMMENDATION_STATUSES = Object.freeze([
  "generated", "viewed", "accepted", "completed", "skipped", "expired"
]);

/** 活跃状态：参与去重，completed/skipped/expired 后可再生成 */
export const ACTIVE_STATUSES = Object.freeze(["generated", "viewed", "accepted"]);

export const SCORING_WEIGHTS = Object.freeze({
  reviewUrgency: 0.20,
  riskScore: 0.20,
  relapseScore: 0.15,
  currentProjectRelevance: 0.15,
  recurrenceFrequency: 0.10,
  prerequisiteBlocking: 0.10,
  transferValue: 0.10
});

/** 高风险类型：候选 B 的入选条件，riskScore 满分依据 */
export const HIGH_RISK_TYPES = Object.freeze([
  "security_risk", "privacy_risk", "reliability_risk", "financial_risk"
]);

/** 核心推荐上限；weekly_focus 单独 1 条不计入 */
export const MAX_CORE_RECOMMENDATIONS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
/** 逾期满 3 天 reviewUrgency 记为 1 */
const OVERDUE_FULL_URGENCY_DAYS = 3;
/** 非到期类推荐 7 天后过期 */
const RECOMMENDATION_TTL_DAYS = 7;
/** 六维全部 ≥70 视为可真实工作验证 */
const ALL_DIMENSIONS_HIGH_THRESHOLD = 70;
/** 前置阻塞推荐：阻塞方掌握度低于该值才推荐 */
const PREREQUISITE_MASTERY_THRESHOLD = 60;

const MASTERY_DIMENSIONS = Object.freeze([
  "conceptualUnderstanding", "independentRecall", "hintIndependence",
  "misconceptionResistance", "transferAbility", "retentionStrength"
]);

/** 最弱维度 → 推荐训练阶段 */
const STAGE_BY_WEAKEST_DIMENSION = Object.freeze({
  conceptualUnderstanding: "initial_compensation",
  independentRecall: "delayed_recall",
  hintIndependence: "delayed_recall",
  retentionStrength: "delayed_recall",
  misconceptionResistance: "misconception_check",
  transferAbility: "scenario_transfer"
});

/** 无现成任务时按推荐阶段估时的典型任务类型 */
const STAGE_TYPICAL_TASK_TYPE = Object.freeze({
  initial_compensation: "feynman_explanation",
  delayed_recall: "short_recall",
  misconception_check: "error_detection",
  scenario_transfer: "scenario_judgment",
  error_detection: "error_detection",
  real_work_validation: "micro_practice"
});

const STAGE_REASON_LABELS = Object.freeze({
  initial_compensation: "首次补偿训练",
  delayed_recall: "延迟回忆训练",
  misconception_check: "误区识别训练",
  scenario_transfer: "场景迁移训练",
  error_detection: "错误识别训练",
  real_work_validation: "真实工作验证"
});

const INACTIVE_DEBT_STATUSES = new Set(["mastered", "ignored"]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function toDate(now) {
  if (now instanceof Date) return now;
  const parsed = now ? new Date(now) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

// ─── 候选收集 ───

/**
 * 五类候选（纯读取，不写任何状态）：
 * A 到期复训（trainingStore.listDueReviews）
 * B 高风险未稳定欠条（riskTypes 含安全/隐私/可靠性/财务且非 mastered/ignored）
 * C 高频重复问题（簇内 ≥2 张或有 relapsed 成员的簇）
 * D 前置知识阻塞（prerequisite_of/blocks 关系中阻塞方掌握度 <60）
 * E 能力迁移（概念理解与独立回忆 ≥60 且迁移 <50）
 *
 * 返回候选与打分上下文（debt/profile/analysis 查找表、阻塞计数）。
 */
export function gatherCandidates(userId, deps, now) {
  const { trainingStore, intelligenceStore, graphStore } = deps;
  const nowDate = toDate(now);
  const nowIso = nowDate.toISOString();

  const debts = trainingStore.listCognitiveDebts(userId);
  const debtById = new Map(debts.map(debt => [debt.id, debt]));
  const profiles = new Map(
    trainingStore.listMasteryProfiles(userId).map(profile => [profile.cognitiveDebtId, profile])
  );
  const analyses = new Map();
  for (const debt of debts) {
    const analysis = intelligenceStore ? intelligenceStore.getCurrentAnalysis(debt.id) : null;
    if (analysis) analyses.set(debt.id, analysis);
  }
  const skillNodeKeyOf = debtId => skillNodeKeyFromDomainPath(analyses.get(debtId)?.domainPath) || "";
  const isActiveDebt = debt => debt && !INACTIVE_DEBT_STATUSES.has(debt.status);

  const candidates = [];

  // A 到期复训
  for (const task of trainingStore.listDueReviews(userId, nowIso)) {
    if (!debtById.has(task.cognitiveDebtId)) continue;
    candidates.push({
      recommendationType: "due_review",
      primaryDebtId: task.cognitiveDebtId,
      relatedDebtIds: [],
      existingReviewTaskId: task.id,
      reviewTask: task,
      skillNodeKey: skillNodeKeyOf(task.cognitiveDebtId)
    });
  }

  // B 高风险未稳定欠条
  for (const debt of debts) {
    if (!isActiveDebt(debt)) continue;
    const analysis = analyses.get(debt.id);
    if (!analysis) continue;
    const risks = Array.isArray(analysis.riskTypes) ? analysis.riskTypes : [];
    if (!risks.some(risk => HIGH_RISK_TYPES.includes(risk))) continue;
    candidates.push({
      recommendationType: "real_work_validation",
      primaryDebtId: debt.id,
      relatedDebtIds: [],
      skillNodeKey: skillNodeKeyOf(debt.id)
    });
  }

  const blockingCountByDebtId = new Map();

  if (graphStore) {
    // C 高频重复问题簇
    for (const cluster of graphStore.listDebtClusters(userId)) {
      const members = graphStore.listDebtClusterMembers({ clusterId: cluster.id });
      const memberDebts = members
        .map(member => debtById.get(member.cognitiveDebtId))
        .filter(Boolean);
      const hasRelapsed = memberDebts.some(debt => debt.status === "relapsed");
      if (memberDebts.length < 2 && !hasRelapsed) continue;
      const activeMembers = memberDebts.filter(isActiveDebt);
      if (activeMembers.length === 0) continue;
      const primary = [...activeMembers].sort((a, b) => {
        const aRelapsed = a.status === "relapsed" ? 1 : 0;
        const bRelapsed = b.status === "relapsed" ? 1 : 0;
        if (aRelapsed !== bRelapsed) return bRelapsed - aRelapsed;
        return (Number(b.recurrenceCount) || 0) - (Number(a.recurrenceCount) || 0);
      })[0];
      candidates.push({
        recommendationType: "cluster_consolidation",
        primaryDebtId: primary.id,
        relatedDebtIds: memberDebts.map(debt => debt.id).filter(id => id !== primary.id),
        clusterId: cluster.id,
        clusterTitle: clean(cluster.title || ""),
        clusterMemberCount: memberDebts.length,
        skillNodeKey: skillNodeKeyOf(primary.id)
      });
    }

    // D 前置知识阻塞：source 为阻塞方（B），target 为被阻塞方（A）
    const blockingRelations = graphStore.listDebtRelations({
      userId,
      relationType: ["prerequisite_of", "blocks"],
      status: ["auto_confirmed", "pending_confirmation", "user_confirmed"]
    });
    const blockingMap = new Map();
    for (const relation of blockingRelations) {
      if (!blockingMap.has(relation.sourceDebtId)) blockingMap.set(relation.sourceDebtId, new Set());
      blockingMap.get(relation.sourceDebtId).add(relation.targetDebtId);
    }
    for (const [sourceId, targets] of blockingMap) {
      blockingCountByDebtId.set(sourceId, targets.size);
      const sourceDebt = debtById.get(sourceId);
      if (!isActiveDebt(sourceDebt)) continue;
      const mastery = Number(profiles.get(sourceId)?.overallMastery) || 0;
      if (mastery >= PREREQUISITE_MASTERY_THRESHOLD) continue;
      candidates.push({
        recommendationType: "prerequisite_training",
        primaryDebtId: sourceId,
        relatedDebtIds: [...targets],
        blockedCount: targets.size,
        skillNodeKey: skillNodeKeyOf(sourceId)
      });
    }
  }

  // E 能力迁移
  for (const debt of debts) {
    if (!isActiveDebt(debt)) continue;
    const profile = profiles.get(debt.id);
    if (!profile) continue;
    if (
      Number(profile.conceptualUnderstanding) >= 60
      && Number(profile.independentRecall) >= 60
      && Number(profile.transferAbility) < 50
    ) {
      candidates.push({
        recommendationType: "transfer_training",
        primaryDebtId: debt.id,
        relatedDebtIds: [],
        skillNodeKey: skillNodeKeyOf(debt.id)
      });
    }
  }

  return { candidates, debts, debtById, profiles, analyses, blockingCountByDebtId, nowMs: nowDate.getTime() };
}

// ─── 优先级打分 ───

/**
 * 优先级基础分全部由代码计算：
 * priorityScore = 0.20×reviewUrgency + 0.20×riskScore + 0.15×relapseScore
 *   + 0.15×currentProjectRelevance + 0.10×recurrenceFrequency
 *   + 0.10×prerequisiteBlocking + 0.10×transferValue
 * 各因子归一化 0-1 并记录进 scoreFactorsJson。
 */
export function scoreCandidate(candidate, context, now) {
  const nowMs = now ? toDate(now).getTime() : (context.nowMs ?? Date.now());
  const { debtById, profiles, analyses, blockingCountByDebtId } = context;
  const debt = debtById?.get(candidate.primaryDebtId) || null;
  const profile = profiles?.get(candidate.primaryDebtId) || null;
  const analysis = analyses?.get(candidate.primaryDebtId) || null;

  // reviewUrgency：逾期时长归一化（满 3 天记 1），未到期/无任务为 0
  let reviewUrgency = 0;
  const dueAt = candidate.reviewTask?.dueAt;
  if (dueAt) {
    const dueMs = Date.parse(dueAt);
    if (Number.isFinite(dueMs) && dueMs < nowMs) {
      reviewUrgency = clamp01((nowMs - dueMs) / (OVERDUE_FULL_URGENCY_DAYS * DAY_MS));
    }
  }

  // riskScore：高风险类型记 1，其他实质风险记 0.5，无风险 0
  const risks = (Array.isArray(analysis?.riskTypes) ? analysis.riskTypes : [])
    .filter(risk => risk && risk !== "no_material_risk");
  const riskScore = risks.some(risk => HIGH_RISK_TYPES.includes(risk))
    ? 1
    : (risks.length > 0 ? 0.5 : 0);

  // relapseScore：当前复发记 1；历史复发按次数衰减计分
  let relapseScore = 0;
  if (debt?.status === "relapsed") {
    relapseScore = 1;
  } else if ((Number(profile?.relapseCount) || 0) > 0) {
    relapseScore = clamp01(0.4 + 0.2 * Number(profile.relapseCount));
  }

  // currentProjectRelevance：近 7 天活跃记 1，近 30 天记 0.5
  let currentProjectRelevance = 0;
  const activityMs = Date.parse(debt?.updatedAt || debt?.createdAt || "");
  if (Number.isFinite(activityMs)) {
    const ageDays = (nowMs - activityMs) / DAY_MS;
    if (ageDays <= 7) currentProjectRelevance = 1;
    else if (ageDays <= 30) currentProjectRelevance = 0.5;
  }

  // recurrenceFrequency：复发计数归一化（3 次记满）
  const recurrenceFrequency = clamp01((Number(debt?.recurrenceCount) || 0) / 3);

  // prerequisiteBlocking：该欠条阻塞的其他欠条数归一化（2 条记满）
  const blockedCount = Number(candidate.blockedCount)
    || Number(blockingCountByDebtId?.get(candidate.primaryDebtId))
    || 0;
  const prerequisiteBlocking = clamp01(blockedCount / 2);

  // transferValue：分类迁移价值 1-5 归一化
  const transferValue = analysis ? clamp01((Number(analysis.transferValue) || 1) / 5) : 0;

  const factors = {
    reviewUrgency: round3(reviewUrgency),
    riskScore: round3(riskScore),
    relapseScore: round3(relapseScore),
    currentProjectRelevance: round3(currentProjectRelevance),
    recurrenceFrequency: round3(recurrenceFrequency),
    prerequisiteBlocking: round3(prerequisiteBlocking),
    transferValue: round3(transferValue)
  };
  const priorityScore = round3(
    SCORING_WEIGHTS.reviewUrgency * factors.reviewUrgency
    + SCORING_WEIGHTS.riskScore * factors.riskScore
    + SCORING_WEIGHTS.relapseScore * factors.relapseScore
    + SCORING_WEIGHTS.currentProjectRelevance * factors.currentProjectRelevance
    + SCORING_WEIGHTS.recurrenceFrequency * factors.recurrenceFrequency
    + SCORING_WEIGHTS.prerequisiteBlocking * factors.prerequisiteBlocking
    + SCORING_WEIGHTS.transferValue * factors.transferValue
  );
  return { priorityScore, scoreFactorsJson: factors };
}

// ─── 推荐训练阶段 ───

/**
 * 按最弱维度映射推荐训练阶段；六维均 ≥70 推荐真实工作验证。
 * 无画像时默认首次补偿训练。
 */
export function selectRecommendedStage(masteryProfile) {
  if (!masteryProfile) return "initial_compensation";
  const values = MASTERY_DIMENSIONS.map(dimension => ({
    dimension,
    value: Number(masteryProfile[dimension]) || 0
  }));
  if (values.every(item => item.value >= ALL_DIMENSIONS_HIGH_THRESHOLD)) {
    return "real_work_validation";
  }
  values.sort((a, b) => a.value - b.value);
  return STAGE_BY_WEAKEST_DIMENSION[values[0].dimension];
}

function stageForCandidate(candidate, context) {
  if (candidate.recommendationType === "due_review" && candidate.reviewTask?.trainingStage) {
    return candidate.reviewTask.trainingStage;
  }
  if (candidate.recommendationType === "transfer_training") {
    return "scenario_transfer";
  }
  return selectRecommendedStage(context.profiles?.get(candidate.primaryDebtId) || null);
}

// ─── 估时（复用 review-scheduler 的任务类型估时口径） ───

function estimatedMinutesFor(candidate, stage) {
  if (candidate.recommendationType === "due_review" && candidate.reviewTask?.taskType) {
    return TASK_TYPE_ESTIMATED_MINUTES[candidate.reviewTask.taskType] || 3;
  }
  const taskType = STAGE_TYPICAL_TASK_TYPE[stage] || "feynman_explanation";
  return TASK_TYPE_ESTIMATED_MINUTES[taskType] || 3;
}

// ─── 确定性 reason 模板 ───

function buildCandidateReason(candidate, context) {
  const { debtById, profiles } = context;
  const debt = debtById?.get(candidate.primaryDebtId) || null;
  const profile = profiles?.get(candidate.primaryDebtId) || null;

  let opener;
  switch (candidate.recommendationType) {
    case "due_review": {
      const dueMs = Date.parse(candidate.reviewTask?.dueAt || "");
      const overdueDays = Number.isFinite(dueMs)
        ? Math.floor((context.nowMs - dueMs) / DAY_MS)
        : 0;
      opener = overdueDays >= 1 ? `这条欠条已经逾期 ${overdueDays} 天` : "这条欠条今天到期";
      break;
    }
    case "real_work_validation":
      opener = "这条欠条涉及高风险（安全/隐私/可靠性/财务），建议尽快在真实工作中验证";
      break;
    case "cluster_consolidation":
      opener = `同类问题已聚集成 ${candidate.clusterMemberCount || 2} 张欠条的问题簇，集中清偿效果更好`;
      break;
    case "prerequisite_training":
      opener = `这条前置欠条阻塞了 ${candidate.blockedCount || 1} 条其他欠条的清偿`;
      break;
    case "transfer_training":
      opener = "你的概念理解和独立回忆已经达标，但迁移训练还没有通过";
      break;
    default:
      opener = "这条欠条需要训练";
  }

  const extras = [];
  if (debt?.status === "relapsed") extras.push("并且曾经复发");
  const recurrenceTotal = (Number(debt?.recurrenceCount) || 0) + 1;
  if (recurrenceTotal >= 2) extras.push(`同类问题最近出现了 ${recurrenceTotal} 次`);

  const sentences = [`${opener}${extras.length > 0 ? `，${extras.join("，")}` : ""}。`];

  const stage = candidate.recommendedTrainingStage;
  const stageText = STAGE_REASON_LABELS[stage] || "训练";
  if (profile) {
    const values = MASTERY_DIMENSIONS.map(dimension => ({
      dimension,
      value: Number(profile[dimension]) || 0
    }));
    const strongest = [...values].sort((a, b) => b.value - a.value)[0];
    const weakest = [...values].sort((a, b) => a.value - b.value)[0];
    if (stage === "real_work_validation") {
      sentences.push(`你的六个能力维度都已达标，本次将进行${stageText}。`);
    } else if (strongest.value >= 60 && strongest.dimension !== weakest.dimension) {
      sentences.push(
        `你的${dimensionLabel(strongest.dimension)}较高，但${dimensionLabel(weakest.dimension)}较弱，本次将进行${stageText}。`
      );
    } else {
      sentences.push(`你的${dimensionLabel(weakest.dimension)}较弱，本次将进行${stageText}。`);
    }
  } else if (stage) {
    sentences.push(`本次将进行${stageText}。`);
  }
  return sentences.join("");
}

function skillDisplayName(domainPath) {
  const segments = (Array.isArray(domainPath) ? domainPath : []).filter(Boolean).slice(0, 3);
  if (segments.length === 0) return "未分类";
  const [root, ...rest] = segments;
  const rootLabel = DOMAIN_ROOT_LABELS[root] || root;
  return rest.length > 0 ? `${rootLabel} / ${rest.join(" / ")}` : rootLabel;
}

// ─── 记录构建 ───

const TITLE_PREFIX_BY_TYPE = Object.freeze({
  due_review: "到期复训",
  real_work_validation: "高风险验证",
  cluster_consolidation: "问题簇巩固",
  prerequisite_training: "前置知识补齐",
  transfer_training: "能力迁移训练"
});

function buildRecommendationRecord(userId, candidate, context, nowDate) {
  const debt = context.debtById?.get(candidate.primaryDebtId) || null;
  const gapText = clean(debt?.gapText).slice(0, 40) || "认知欠条";
  const nowIso = nowDate.toISOString();
  return {
    id: crypto.randomUUID(),
    userId,
    recommendationType: candidate.recommendationType,
    primaryDebtId: candidate.primaryDebtId,
    relatedDebtIds: candidate.relatedDebtIds || [],
    clusterId: candidate.clusterId || null,
    skillNodeId: candidate.skillNodeKey || null,
    recommendedTrainingStage: candidate.recommendedTrainingStage || null,
    existingReviewTaskId: candidate.existingReviewTaskId || null,
    title: `${TITLE_PREFIX_BY_TYPE[candidate.recommendationType] || "学习推荐"}：${gapText}`,
    reason: buildCandidateReason(candidate, context),
    priorityScore: candidate.priorityScore,
    scoreFactorsJson: candidate.scoreFactorsJson,
    estimatedMinutes: estimatedMinutesFor(candidate, candidate.recommendedTrainingStage),
    status: "generated",
    scoringVersion: SCORING_VERSION,
    generatedAt: nowIso,
    expiresAt: candidate.recommendationType === "due_review"
      ? null
      : new Date(nowDate.getTime() + RECOMMENDATION_TTL_DAYS * DAY_MS).toISOString()
  };
}

// ─── 每周学习重点 ───

/**
 * 每周一个主题：取候选中 priorityScore 最高的 skillNodeKey，聚合其下 1-3 个
 * 优先任务。同一周（UTC 周）内幂等；主题更替时旧的活跃重点标记过期。
 */
async function ensureWeeklyFocus(userId, deps, context, scoredCandidates, nowDate) {
  const week = resolveSnapshotPeriod("weekly", nowDate);
  const nowIso = nowDate.toISOString();
  const existing = deps.store
    .listRecommendations(userId, { status: [...ACTIVE_STATUSES], recommendationType: "weekly_focus" })[0] || null;
  if (existing && String(existing.generatedAt || "") >= week.periodStart) {
    return { created: null };
  }

  const groups = new Map();
  for (const candidate of scoredCandidates) {
    if (!candidate.skillNodeKey) continue;
    if (!groups.has(candidate.skillNodeKey)) groups.set(candidate.skillNodeKey, []);
    groups.get(candidate.skillNodeKey).push(candidate);
  }
  if (groups.size === 0) return { created: null };

  let bestKey = null;
  let bestScore = -1;
  let bestCount = 0;
  for (const [key, members] of groups) {
    const topScore = Math.max(...members.map(member => member.priorityScore));
    if (topScore > bestScore || (topScore === bestScore && members.length > bestCount)) {
      bestKey = key;
      bestScore = topScore;
      bestCount = members.length;
    }
  }
  const members = groups.get(bestKey).slice(0, 3);
  const displayName = skillDisplayName(context.analyses?.get(members[0].primaryDebtId)?.domainPath);

  if (existing) {
    await deps.store.saveRecommendation({ ...existing, status: "expired", expiresAt: nowIso });
  }

  const record = {
    id: crypto.randomUUID(),
    userId,
    recommendationType: "weekly_focus",
    primaryDebtId: null,
    relatedDebtIds: members.map(member => member.primaryDebtId),
    clusterId: null,
    skillNodeId: bestKey,
    recommendedTrainingStage: members[0]?.recommendedTrainingStage || null,
    existingReviewTaskId: null,
    title: `本周学习重点：${displayName}`,
    reason: `本周你在「${displayName}」主题下有 ${members.length} 条高优先级欠条，建议集中清偿。`,
    priorityScore: round3(bestScore),
    scoreFactorsJson: members[0]?.scoreFactorsJson || {},
    estimatedMinutes: members.reduce(
      (sum, member) => sum + estimatedMinutesFor(member, member.recommendedTrainingStage),
      0
    ),
    status: "generated",
    scoringVersion: SCORING_VERSION,
    generatedAt: nowIso,
    expiresAt: week.periodEnd
  };
  const saved = await deps.store.saveRecommendation(record);
  return { created: saved };
}

// ─── 可选 AI 措辞润色（仅润色 reason，失败/无 key 回退确定性模板） ───

const POLISH_SYSTEM_PROMPT = [
  "你是学习产品的文案编辑。输入是一批学习推荐条目（JSON），每条包含已由确定性规则算好的推荐理由。",
  "你的唯一任务是把每条 reason 改写得更自然、更易读，面向中文用户。",
  "硬性要求：不得新增、删除或修改任何数字、天数、次数、训练阶段名称与欠条主题；",
  "不得添加原理由中没有的事实或建议；不得输出心理诊断或人格评价词汇。保持每条 id 不变。",
  "只返回 JSON：{\"reasons\":[{\"id\":\"...\",\"reason\":\"...\"}]}"
].join("");

async function maybePolishReasons(records, chatFn) {
  if (typeof chatFn !== "function" || records.length === 0) return [];
  try {
    const raw = await chatFn(
      [
        { role: "system", content: POLISH_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            reasons: records.map(item => ({ id: item.id, reason: item.reason }))
          })
        }
      ],
      () => ({}),
      2048
    );
    if (raw?.__fallback || !Array.isArray(raw?.reasons)) return [];
    const reasonById = new Map();
    for (const item of raw.reasons) {
      const id = clean(item?.id).slice(0, 100);
      const reason = clean(item?.reason).slice(0, 1000);
      if (id && reason) reasonById.set(id, reason);
    }
    return records
      .filter(item => reasonById.has(item.id))
      .map(item => ({ ...item, reason: reasonById.get(item.id) }));
  } catch {
    return [];
  }
}

// ─── 推荐生成（读时生成，幂等） ───

/**
 * 候选 → 打分 → 排序 → 去重（同 userId+primaryDebtId+recommendationType 且
 * 状态在 generated/viewed/accepted 的不重复生成；同一欠条只保留最高分推荐）
 * → 核心推荐 cap 3 条（weekly_focus 单独 1 条不计入）→ 确定性 reason
 * → 可选 chatFn 润色（失败回退模板）→ 持久化。
 */
export async function generateRecommendations(userId, deps, { chatFn, now } = {}) {
  if (!deps?.store || !deps?.trainingStore) {
    throw new Error("store and trainingStore are required in deps");
  }
  const nowDate = toDate(now);
  const context = gatherCandidates(userId, deps, nowDate);
  const scored = context.candidates
    .map(candidate => ({
      ...candidate,
      ...scoreCandidate(candidate, context, nowDate),
      recommendedTrainingStage: stageForCandidate(candidate, context)
    }))
    .sort((a, b) =>
      b.priorityScore - a.priorityScore
      || String(a.primaryDebtId || "").localeCompare(String(b.primaryDebtId || ""))
    );

  // 同一欠条只保留最高分的候选
  const seenDebts = new Set();
  const deduped = [];
  for (const candidate of scored) {
    if (seenDebts.has(candidate.primaryDebtId)) continue;
    seenDebts.add(candidate.primaryDebtId);
    deduped.push(candidate);
  }

  // 活跃推荐占用核心名额（weekly_focus 独立）
  const activeCore = deps.store
    .listRecommendations(userId, { status: [...ACTIVE_STATUSES] })
    .filter(item => item.recommendationType !== "weekly_focus");
  const activeKeys = new Set(activeCore.map(item => `${item.primaryDebtId}::${item.recommendationType}`));
  const activeDebts = new Set(activeCore.map(item => item.primaryDebtId));
  const openSlots = Math.max(0, MAX_CORE_RECOMMENDATIONS - activeCore.length);

  const picked = [];
  for (const candidate of deduped) {
    if (picked.length >= openSlots) break;
    if (activeKeys.has(`${candidate.primaryDebtId}::${candidate.recommendationType}`)) continue;
    if (activeDebts.has(candidate.primaryDebtId)) continue;
    picked.push(candidate);
  }

  const created = [];
  for (const candidate of picked) {
    const saved = await deps.store.saveRecommendation(
      buildRecommendationRecord(userId, candidate, context, nowDate)
    );
    created.push(saved);
    activeDebts.add(candidate.primaryDebtId);
  }

  const focus = await ensureWeeklyFocus(userId, deps, context, deduped, nowDate);

  // 可选：AI 仅润色推荐理由文案，任何异常都保留确定性模板
  const polished = await maybePolishReasons(
    [...created, ...(focus.created ? [focus.created] : [])],
    chatFn
  );
  for (const item of polished) {
    await deps.store.saveRecommendation(item);
  }

  return {
    created: created.length + (focus.created ? 1 : 0),
    createdIds: [...created.map(item => item.id), ...(focus.created ? [focus.created.id] : [])]
  };
}

// ─── 状态懒更新 ───

/**
 * 读时联动：对应 reviewTask 已完成的推荐标记 completed；任务被跳过或
 * 推荐超过 expiresAt 的标记 expired。返回变更条数。
 */
export async function syncRecommendationStatuses(userId, deps, now) {
  const nowDate = toDate(now);
  const nowMs = nowDate.getTime();
  const nowIso = nowDate.toISOString();
  const active = deps.store.listRecommendations(userId, { status: [...ACTIVE_STATUSES] });
  let changed = 0;
  for (const recommendation of active) {
    let next = null;
    if (recommendation.existingReviewTaskId) {
      let task = null;
      try {
        task = deps.trainingStore.getReviewTask(recommendation.existingReviewTaskId, userId);
      } catch {
        task = null;
      }
      if (task?.status === "completed") {
        next = { status: "completed", completedAt: nowIso };
      } else if (task?.status === "skipped" && recommendation.status !== "accepted") {
        next = { status: "expired" };
      }
    }
    if (!next && recommendation.expiresAt && Date.parse(recommendation.expiresAt) <= nowMs) {
      next = { status: "expired" };
    }
    if (next) {
      await deps.store.saveRecommendation({ ...recommendation, ...next });
      changed++;
    }
  }
  return changed;
}

// ─── 查询载荷组装 ───

function enrichRecommendation(recommendation, deps, userId, weeklyFocusSkillNodeId) {
  let debtSummary = null;
  if (recommendation.primaryDebtId) {
    try {
      const debt = deps.trainingStore.getCognitiveDebt(recommendation.primaryDebtId, userId);
      debtSummary = {
        id: debt.id,
        gapText: debt.gapText,
        status: debt.status,
        recurrenceCount: Number(debt.recurrenceCount) || 0
      };
    } catch {
      debtSummary = null;
    }
  }
  let reviewTask = null;
  if (recommendation.existingReviewTaskId) {
    try {
      reviewTask = deps.trainingStore.getReviewTask(recommendation.existingReviewTaskId, userId);
    } catch {
      reviewTask = null;
    }
  }
  let clusterTitle = recommendation.clusterId ? null : null;
  if (recommendation.clusterId && deps.graphStore) {
    clusterTitle = deps.graphStore.getDebtCluster(recommendation.clusterId)?.title || null;
  }
  const relatedDebtSummaries = (Array.isArray(recommendation.relatedDebtIds) ? recommendation.relatedDebtIds : [])
    .map(debtId => {
      try {
        const debt = deps.trainingStore.getCognitiveDebt(debtId, userId);
        return {
          id: debt.id,
          gapText: debt.gapText,
          status: debt.status,
          recurrenceCount: Number(debt.recurrenceCount) || 0
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return {
    ...recommendation,
    debtSummary,
    reviewTask,
    clusterTitle,
    relatedDebtSummaries,
    isWeeklyFocusRelated: Boolean(
      weeklyFocusSkillNodeId
      && recommendation.skillNodeId
      && recommendation.skillNodeId === weeklyFocusSkillNodeId
    )
  };
}

/**
 * 今日推荐：懒更新状态 → 幂等补缺生成 → 返回当前有效推荐
 * （generated/viewed/accepted，按 priorityScore 排序，核心 ≤3）；
 * 首次读到的 generated 推荐标记为 viewed。
 */
export async function getTodayRecommendations(userId, deps, options = {}) {
  const nowDate = toDate(options.now);
  const nowIso = nowDate.toISOString();
  await syncRecommendationStatuses(userId, deps, nowDate);
  const generation = await generateRecommendations(userId, deps, options);

  const active = deps.store.listRecommendations(userId, { status: [...ACTIVE_STATUSES] });
  const core = active
    .filter(item => item.recommendationType !== "weekly_focus")
    .sort((a, b) =>
      b.priorityScore - a.priorityScore
      || String(b.generatedAt || "").localeCompare(String(a.generatedAt || ""))
    )
    .slice(0, MAX_CORE_RECOMMENDATIONS);
  const focus = active
    .filter(item => item.recommendationType === "weekly_focus")
    .sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")))[0] || null;

  // 首次读取：generated → viewed
  const visible = [...core, ...(focus ? [focus] : [])];
  const visibleById = new Map(visible.map(item => [item.id, item]));
  for (const item of visible) {
    if (item.status === "generated") {
      const saved = await deps.store.saveRecommendation({ ...item, status: "viewed", viewedAt: nowIso });
      visibleById.set(item.id, saved);
    }
  }

  const focusSkillNodeId = visibleById.get(focus?.id)?.skillNodeId || null;
  const enrich = item => enrichRecommendation(item, deps, userId, focusSkillNodeId);
  return {
    recommendations: core.map(item => enrich(visibleById.get(item.id) || item)),
    weeklyFocus: focus ? enrich(visibleById.get(focus.id) || focus) : null,
    generated: generation.created
  };
}

/**
 * 本周学习重点：复用今日推荐的懒更新与幂等生成；无数据时返回明确空态。
 */
export async function getWeeklyFocus(userId, deps, options = {}) {
  const today = await getTodayRecommendations(userId, deps, options);
  if (!today.weeklyFocus) {
    return { weeklyFocus: null, message: "本周暂无学习重点，完成更多训练后会出现。" };
  }
  return { weeklyFocus: today.weeklyFocus };
}

// ─── 接受 / 跳过 ───

/**
 * 接受推荐：status=accepted 并返回现有 review start/submit 链路入口。
 * - due_review：直接返回现有 task（绝不新建）；
 * - 其他类型：该欠条已有 pending/in_progress task 时复用，否则按
 *   recommendedTrainingStage 用现有 generateRuleBasedReviewTask 创建
 *   dueAt=now 的 reviewTask（不自写任务结构）。
 */
export async function acceptRecommendation({ store, trainingStore, userId, recommendationId, now } = {}) {
  const nowDate = toDate(now);
  const nowIso = nowDate.toISOString();
  const recommendation = store.getRecommendation(recommendationId, userId);
  if (!recommendation) {
    const error = new Error(`Learning recommendation not found: ${recommendationId}`);
    error.statusCode = 404;
    throw error;
  }
  // 只有 generated/viewed 可接受；accepted 已进入训练流程，重复接受按 409 处理
  if (!["generated", "viewed"].includes(recommendation.status)) {
    const error = new Error(`Recommendation is ${recommendation.status} and cannot be accepted`);
    error.statusCode = 409;
    throw error;
  }
  const targetDebtId = recommendation.primaryDebtId || recommendation.relatedDebtIds?.[0] || null;
  if (!targetDebtId) {
    const error = new Error("Recommendation has no target debt");
    error.statusCode = 409;
    throw error;
  }

  let reviewTask = null;
  if (recommendation.recommendationType === "due_review" && recommendation.existingReviewTaskId) {
    try {
      reviewTask = trainingStore.getReviewTask(recommendation.existingReviewTaskId, userId);
    } catch {
      reviewTask = null;
    }
    if (!reviewTask || !["pending", "in_progress"].includes(reviewTask.status)) {
      if (reviewTask?.status === "completed") {
        await store.saveRecommendation({ ...recommendation, status: "completed", completedAt: nowIso });
      }
      const error = new Error("关联的复训任务已不可开始");
      error.statusCode = 409;
      throw error;
    }
  } else {
    reviewTask = trainingStore.listReviewTasks(userId, { cognitiveDebtId: targetDebtId, status: "pending" })[0]
      || trainingStore.listReviewTasks(userId, { cognitiveDebtId: targetDebtId, status: "in_progress" })[0]
      || null;
    if (!reviewTask) {
      const debt = trainingStore.getCognitiveDebt(targetDebtId, userId);
      const mastery = trainingStore.getMasteryProfile(targetDebtId);
      const firstAttempt = trainingStore.listAttempts(userId, { cognitiveDebtId: targetDebtId })[0] || null;
      reviewTask = generateRuleBasedReviewTask({
        debt,
        card: { id: debt.cardId || "", target: debt.gapText, prompt: "" },
        firstAttempt,
        mastery,
        trainingStage: recommendation.recommendedTrainingStage || "delayed_recall",
        dueAt: nowIso,
        userId
      });
      await trainingStore.saveReviewTask(reviewTask);
    }
  }

  const saved = await store.saveRecommendation({
    ...recommendation,
    status: "accepted",
    acceptedAt: nowIso,
    existingReviewTaskId: reviewTask.id
  });
  return {
    recommendation: saved,
    reviewTaskId: reviewTask.id,
    reviewStartEndpoint: `/api/training/reviews/${reviewTask.id}/start`,
    recommendedTrainingStage: saved.recommendedTrainingStage,
    relatedDebtIds: saved.relatedDebtIds,
    reviewTask
  };
}

/**
 * 跳过推荐：status=skipped + 可选 skipReason；已终结的推荐幂等返回。
 */
export async function skipRecommendation({ store, userId, recommendationId, skipReason, now } = {}) {
  const nowIso = toDate(now).toISOString();
  const recommendation = store.getRecommendation(recommendationId, userId);
  if (!recommendation) {
    const error = new Error(`Learning recommendation not found: ${recommendationId}`);
    error.statusCode = 404;
    throw error;
  }
  if (!ACTIVE_STATUSES.includes(recommendation.status)) {
    return { recommendation, alreadyResolved: true };
  }
  const saved = await store.saveRecommendation({
    ...recommendation,
    status: "skipped",
    skippedAt: nowIso,
    skipReason: clean(skipReason).slice(0, 200) || null
  });
  return { recommendation: saved, alreadyResolved: false };
}
