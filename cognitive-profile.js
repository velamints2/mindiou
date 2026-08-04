import crypto from "node:crypto";
import { deriveClusterMasterySummary } from "./debt-relations.js";

/**
 * 用户长期认知画像（Phase 3）
 *
 * 确定性聚合模块：数量、比例、通过率、复发率、趋势、分布、最弱维度全部由
 * 代码计算，不经模型。大模型仅可通过可选 chatFn 润色已算好结论的措辞
 * （失败 / 无 key 时回退确定性模板文案），绝不直接读原始数据自由生成画像。
 *
 * 不创建第二套掌握度：领域六维聚合复用 deriveClusterMasterySummary 从现有
 * MasteryProfile 平均派生，只算不存（快照中的汇总 JSON 除外）。
 */

export const CALCULATION_VERSION = "cognitive-profile/v1";

export const INSIGHT_TYPES = Object.freeze([
  "skill_strength", "skill_gap", "recurring_pattern", "ai_collaboration_pattern",
  "learning_pattern", "risk_pattern", "growth_trend"
]);

export const TRAINING_STAGES = Object.freeze([
  "initial_compensation", "delayed_recall", "misconception_check",
  "scenario_transfer", "error_detection", "real_work_validation"
]);

const TRANSFER_STAGES = new Set(["scenario_transfer", "error_detection"]);

const MASTERY_DIMENSIONS = Object.freeze([
  "conceptualUnderstanding", "independentRecall", "hintIndependence",
  "misconceptionResistance", "transferAbility", "retentionStrength"
]);

const DIMENSION_LABELS = Object.freeze({
  conceptualUnderstanding: "概念理解",
  independentRecall: "独立回忆",
  hintIndependence: "提示独立性",
  misconceptionResistance: "误区抵抗力",
  transferAbility: "迁移能力",
  retentionStrength: "延迟保持"
});

const DOMAIN_ROOT_LABELS = Object.freeze({
  software_engineering: "软件工程",
  product_management: "产品管理",
  business_strategy: "商业战略",
  marketing: "市场营销",
  hardware_engineering: "硬件工程",
  electronics: "电子",
  mechanical_design: "机械设计",
  artificial_intelligence: "人工智能",
  data_analysis: "数据分析",
  academic_research: "学术研究",
  communication: "沟通表达",
  project_management: "项目管理",
  finance: "金融财务",
  legal: "法律合规"
});

const GAP_MECHANISM_LABELS = Object.freeze({
  concept_gap: "概念缺口",
  mechanism_gap: "机制缺口",
  rationale_gap: "原理缺口",
  prerequisite_gap: "前置知识缺口",
  verification_gap: "验证缺口",
  boundary_gap: "边界条件缺口",
  tradeoff_gap: "权衡缺口",
  dependency_gap: "依赖关系缺口",
  transfer_gap: "迁移缺口",
  implementation_gap: "实现细节缺口",
  decision_gap: "决策依据缺口",
  terminology_gap: "术语缺口",
  process_gap: "流程缺口"
});

const ROOT_CAUSE_LABELS = Object.freeze({
  missing_prerequisite: "缺少前置知识",
  accepted_ai_output_directly: "直接接受了 AI 输出",
  time_pressure: "时间压力",
  tool_opacity: "工具黑盒",
  insufficient_domain_experience: "领域经验不足",
  skipped_validation: "跳过了验证",
  unclear_goal: "目标不清",
  over_complexity: "复杂度过高",
  fragmented_knowledge: "知识碎片化",
  false_familiarity: "似懂非懂",
  unknown: "原因未知"
});

const RISK_TYPE_LABELS = Object.freeze({
  no_material_risk: "无实质风险",
  quality_risk: "质量风险",
  security_risk: "安全风险",
  privacy_risk: "隐私风险",
  financial_risk: "财务风险",
  compliance_risk: "合规风险",
  reliability_risk: "可靠性风险",
  decision_risk: "决策风险",
  maintainability_risk: "可维护性风险",
  communication_risk: "沟通风险"
});

const STAGE_LABELS = Object.freeze({
  initial_compensation: "首次补偿训练",
  delayed_recall: "延迟回忆",
  misconception_check: "误区识别",
  scenario_transfer: "场景迁移",
  error_detection: "错误识别",
  real_work_validation: "真实工作验证"
});

const TREND_LABELS = Object.freeze({
  improving: "上升",
  declining: "下降",
  stable: "平稳",
  insufficient_data: "数据不足"
});

// 趋势判定阈值：掌握比例变化超过 5 个百分点才算上升/下降
const TREND_DELTA_THRESHOLD = 0.05;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function lookupFrom(source) {
  if (source instanceof Map) return key => source.get(key) || null;
  if (typeof source === "function") return key => source(key) || null;
  if (source && typeof source === "object") return key => source[key] || null;
  return () => null;
}

export function gapMechanismLabel(mechanism) {
  return GAP_MECHANISM_LABELS[mechanism] || mechanism || "未知机制";
}

export function riskTypeLabel(riskType) {
  return RISK_TYPE_LABELS[riskType] || riskType || "未知风险";
}

export function dimensionLabel(dimension) {
  return DIMENSION_LABELS[dimension] || dimension;
}

export function trendLabel(trend) {
  return TREND_LABELS[trend] || trend;
}

// ─── 独立证据计数 ───

/**
 * 独立证据去重键：同一报告 / 同一会话产生的多张相似欠条计为 1 条独立证据。
 */
export function evidenceKeyForDebt(debt) {
  const sources = Array.isArray(debt?.sourceReports) ? debt.sourceReports.filter(Boolean) : [];
  if (sources.length > 0) return `report:${sources[0]}`;
  if (debt?.reportId) return `report:${debt.reportId}`;
  if (debt?.clearanceSessionId) return `session:${debt.clearanceSessionId}`;
  return `debt:${debt?.id || "unknown"}`;
}

export function countIndependentEvidence(debts) {
  const list = Array.isArray(debts) ? debts : [];
  return new Set(list.map(evidenceKeyForDebt)).size;
}

/**
 * 最低证据规则：
 * - 1 条及以下：不生成结论（confidence = 0）
 * - 2-3 条：初步观察（confidence = 0.4）
 * - 4-7 条：中等置信度（0.7）
 * - ≥8 条：稳定模式（0.9）
 */
export function confidenceFromEvidenceCount(count) {
  const n = Number(count) || 0;
  if (n < 2) return 0;
  if (n <= 3) return 0.4;
  if (n <= 7) return 0.7;
  return 0.9;
}

// ─── 领域（技能节点）聚合 ───

/** skillNodeKey = domainPath 前三段拼接，如 software_engineering.backend.distributed_systems */
export function skillNodeKeyFromDomainPath(domainPath) {
  if (!Array.isArray(domainPath)) return "";
  return domainPath.map(seg => clean(seg).toLowerCase()).filter(Boolean).slice(0, 3).join(".");
}

function skillDisplayName(domainPath) {
  const segments = Array.isArray(domainPath) ? domainPath.filter(Boolean).slice(0, 3) : [];
  if (segments.length === 0) return "未分类";
  const [root, ...rest] = segments;
  const rootLabel = DOMAIN_ROOT_LABELS[root] || root;
  return rest.length > 0 ? `${rootLabel} / ${rest.join(" / ")}` : rootLabel;
}

function trendFromDelta(delta) {
  if (!Number.isFinite(delta)) return "insufficient_data";
  if (delta > TREND_DELTA_THRESHOLD) return "improving";
  if (delta < -TREND_DELTA_THRESHOLD) return "declining";
  return "stable";
}

function masteredRatioOf(debts) {
  if (!debts.length) return null;
  return debts.filter(debt => debt.status === "mastered").length / debts.length;
}

/**
 * 领域趋势：优先对比最近两个包含该领域的快照；快照不足时回退为
 * 近 30 天新增欠条前后两半的 mastered 比例对比；都不足则为 insufficient_data。
 */
function computeSkillTrend({ skillNodeKey, groupDebts, snapshots, nowMs }) {
  const withSkill = (Array.isArray(snapshots) ? snapshots : []).filter(snapshot => {
    const skills = snapshot?.skillSummaryJson?.skills;
    return Array.isArray(skills) && skills.some(item => item?.skillNodeKey === skillNodeKey);
  });
  if (withSkill.length >= 2) {
    const ratioOf = snapshot => {
      const entry = snapshot.skillSummaryJson.skills.find(item => item?.skillNodeKey === skillNodeKey);
      const ratio = Number(entry?.masteredRatio);
      return Number.isFinite(ratio) ? ratio : null;
    };
    const latest = ratioOf(withSkill[0]);
    const previous = ratioOf(withSkill[1]);
    if (latest !== null && previous !== null) return trendFromDelta(latest - previous);
  }
  const cutoff = nowMs - 30 * DAY_MS;
  const recent = groupDebts
    .filter(debt => {
      const ms = toMs(debt.createdAt);
      return ms !== null && ms >= cutoff && ms <= nowMs;
    })
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  if (recent.length < 2) return "insufficient_data";
  const half = Math.floor(recent.length / 2);
  const earlierHalf = recent.slice(0, half);
  const laterHalf = recent.slice(half);
  // 两半在时间上没有严格先后之分（如同一天创建的欠条）时，
  // 拆分点本身是任意噪声，不产出趋势结论。
  const earlierEnd = toMs(earlierHalf[earlierHalf.length - 1]?.createdAt);
  const laterStart = toMs(laterHalf[0]?.createdAt);
  if (earlierEnd === null || laterStart === null || earlierEnd >= laterStart) return "insufficient_data";
  const earlier = masteredRatioOf(earlierHalf);
  const later = masteredRatioOf(laterHalf);
  if (earlier === null || later === null) return "insufficient_data";
  return trendFromDelta(later - earlier);
}

/**
 * 我的能力领域聚合。
 * analysesByDebtId / profilesByDebtId 可传 Map、普通对象或查找函数。
 */
export function aggregateSkillProfile(userId, { debts = [], analysesByDebtId, profilesByDebtId, snapshots = [], now } = {}) {
  const getAnalysis = lookupFrom(analysesByDebtId);
  const getProfile = lookupFrom(profilesByDebtId);
  const nowMs = now instanceof Date ? now.getTime() : (toMs(now) ?? Date.now());

  const groups = new Map();
  let unclassifiedDebtCount = 0;
  for (const debt of Array.isArray(debts) ? debts : []) {
    const analysis = getAnalysis(debt.id);
    const domainPath = Array.isArray(analysis?.domainPath) ? analysis.domainPath : [];
    const key = skillNodeKeyFromDomainPath(domainPath);
    if (!key) {
      unclassifiedDebtCount++;
      continue;
    }
    if (!groups.has(key)) groups.set(key, { skillNodeKey: key, domainPath: domainPath.slice(0, 3), debts: [] });
    groups.get(key).debts.push(debt);
  }

  const skills = [];
  for (const group of groups.values()) {
    const memberDebtIds = group.debts.map(debt => debt.id);
    const debtsById = new Map(group.debts.map(debt => [debt.id, debt]));
    const profilesMap = new Map();
    for (const debt of group.debts) {
      const profile = getProfile(debt.id);
      if (profile) profilesMap.set(debt.id, profile);
    }
    // 六维聚合直接复用簇掌握度汇总：从现有 MasteryProfile 平均派生
    const masterySummary = deriveClusterMasterySummary({
      memberDebtIds,
      debtsById,
      profilesByDebtId: profilesMap
    });
    const averageMastery = masterySummary.withProfileCount > 0 ? masterySummary.averageMastery : null;
    const weakestDimensions = averageMastery
      ? MASTERY_DIMENSIONS
        .map(dimension => ({ dimension, label: DIMENSION_LABELS[dimension], value: averageMastery[dimension] }))
        .sort((a, b) => a.value - b.value)
        .slice(0, 2)
      : [];
    const independentEvidenceCount = countIndependentEvidence(group.debts);
    const masteredDebtCount = group.debts.filter(debt => debt.status === "mastered").length;
    skills.push({
      skillNodeKey: group.skillNodeKey,
      domainPath: group.domainPath,
      displayName: skillDisplayName(group.domainPath),
      relatedDebtCount: group.debts.length,
      masteredDebtCount,
      masteredRatio: group.debts.length > 0 ? round2(masteredDebtCount / group.debts.length) : 0,
      relapsedDebtCount: group.debts.filter(debt => debt.status === "relapsed").length,
      totalRelapseCount: masterySummary.totalRelapseCount,
      averageMastery,
      withProfileCount: masterySummary.withProfileCount,
      weakestDimensions,
      independentEvidenceCount,
      confidence: confidenceFromEvidenceCount(independentEvidenceCount),
      trend: computeSkillTrend({ skillNodeKey: group.skillNodeKey, groupDebts: group.debts, snapshots, nowMs }),
      evidenceDebtIds: memberDebtIds
    });
  }
  skills.sort((a, b) => b.relatedDebtCount - a.relatedDebtCount || a.skillNodeKey.localeCompare(b.skillNodeKey));

  return {
    userId,
    skills,
    unclassifiedDebtCount,
    insufficientData: countIndependentEvidence(Array.isArray(debts) ? debts : []) < 2
  };
}

// ─── 欠条机制（认知模式）聚合 ───

/**
 * 统计周期内（默认近 30 天，按欠条创建时间）primaryGapMechanism 分布，
 * 计数按独立证据去重；附确定性结论文案与每条证据欠条。
 */
export function aggregateGapPatterns({ debts = [], analysesByDebtId, periodDays = 30, now } = {}) {
  const getAnalysis = lookupFrom(analysesByDebtId);
  const days = Math.max(1, Number(periodDays) || 30);
  const nowMs = now instanceof Date ? now.getTime() : (toMs(now) ?? Date.now());
  const startMs = nowMs - days * DAY_MS;

  const periodDebts = (Array.isArray(debts) ? debts : []).filter(debt => {
    const ms = toMs(debt.createdAt);
    return ms !== null && ms >= startMs && ms <= nowMs;
  });

  const byMechanism = new Map();
  const byRootCause = new Map();
  const collect = (map, key, debt) => {
    if (!map.has(key)) map.set(key, { evidenceKeys: new Set(), debtIds: [] });
    const entry = map.get(key);
    entry.evidenceKeys.add(evidenceKeyForDebt(debt));
    entry.debtIds.push(debt.id);
  };
  for (const debt of periodDebts) {
    const analysis = getAnalysis(debt.id);
    if (!analysis) continue;
    const mechanism = clean(analysis.primaryGapMechanism).toLowerCase();
    if (mechanism) collect(byMechanism, mechanism, debt);
    for (const cause of Array.isArray(analysis.rootCauses) ? analysis.rootCauses : []) {
      const normalized = clean(cause).toLowerCase();
      if (normalized) collect(byRootCause, normalized, debt);
    }
  }

  const toDistribution = (map, labelOf) => {
    const entries = [...map.entries()].map(([key, entry]) => ({
      key,
      label: labelOf(key),
      count: entry.evidenceKeys.size,
      debtCount: entry.debtIds.length,
      evidenceDebtIds: entry.debtIds
    }));
    const total = entries.reduce((sum, item) => sum + item.count, 0);
    return entries
      .map(item => ({ ...item, share: total > 0 ? round2(item.count / total) : 0 }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  };

  const distribution = toDistribution(byMechanism, gapMechanismLabel);
  const rootCauseDistribution = toDistribution(byRootCause, cause => ROOT_CAUSE_LABELS[cause] || cause);
  const totalIndependentEvidence = distribution.reduce((sum, item) => sum + item.count, 0);

  let conclusion = null;
  if (totalIndependentEvidence >= 2 && distribution.length > 0) {
    const top = distribution[0];
    const second = distribution[1];
    if (second && second.count >= 1) {
      conclusion = `最近${days}天，你更常在「${top.label}」和「${second.label}」两个环节产生认知欠条（合计 ${top.count + second.count} 条独立证据，占 ${Math.round((top.share + second.share) * 100)}%）。`;
    } else {
      conclusion = `最近${days}天，你产生的认知欠条主要集中在「${top.label}」（${top.count} 条独立证据，占 ${Math.round(top.share * 100)}%）。`;
    }
  }

  return {
    periodStart: new Date(startMs).toISOString(),
    periodEnd: new Date(nowMs).toISOString(),
    periodDays: days,
    totalIndependentEvidence,
    distribution,
    rootCauseDistribution,
    conclusion,
    confidence: confidenceFromEvidenceCount(totalIndependentEvidence),
    insufficientData: totalIndependentEvidence < 2
  };
}

// ─── 学习行为聚合 ───

/**
 * 复用 TrainingAttempt / HintEvent / MasteryProfile 计算学习模式。
 * 每个分项数据不足时返回 null 并在 insufficientFields 中标注。
 */
export function aggregateLearningBehavior({ debts = [], attempts = [], profilesByDebtId } = {}) {
  const getProfile = lookupFrom(profilesByDebtId);
  const list = Array.isArray(attempts) ? attempts : [];
  const debtList = Array.isArray(debts) ? debts : [];
  const insufficientFields = [];

  const stagePassRates = {};
  for (const stage of TRAINING_STAGES) {
    const stageAttempts = list.filter(attempt => attempt.trainingStage === stage);
    if (stageAttempts.length === 0) {
      stagePassRates[stage] = null;
      continue;
    }
    const passed = stageAttempts.filter(attempt => attempt.evaluation?.passed).length;
    stagePassRates[stage] = {
      attempts: stageAttempts.length,
      passed,
      passRate: round2(passed / stageAttempts.length),
      evidenceAttemptIds: stageAttempts.map(attempt => attempt.id)
    };
  }
  if (list.length === 0) insufficientFields.push("stagePassRates");

  const averageHintsPerAttempt = list.length > 0
    ? round2(list.reduce((sum, attempt) => sum + (Array.isArray(attempt.hintEvents) ? attempt.hintEvents.length : 0), 0) / list.length)
    : null;
  if (averageHintsPerAttempt === null) insufficientFields.push("averageHintsPerAttempt");

  const withBothAnswers = list.filter(attempt => clean(attempt.initialAnswer) && clean(attempt.finalAnswer));
  const answerRevision = withBothAnswers.length > 0
    ? {
      total: withBothAnswers.length,
      revised: withBothAnswers.filter(attempt => clean(attempt.initialAnswer) !== clean(attempt.finalAnswer)).length,
      rate: round2(withBothAnswers.filter(attempt => clean(attempt.initialAnswer) !== clean(attempt.finalAnswer)).length / withBothAnswers.length)
    }
    : null;
  if (!answerRevision) insufficientFields.push("answerRevisionRate");

  const transferAttempts = list.filter(attempt => TRANSFER_STAGES.has(attempt.trainingStage));
  const transferPassRate = transferAttempts.length > 0
    ? {
      attempts: transferAttempts.length,
      passed: transferAttempts.filter(attempt => attempt.evaluation?.passed).length,
      passRate: round2(transferAttempts.filter(attempt => attempt.evaluation?.passed).length / transferAttempts.length),
      evidenceAttemptIds: transferAttempts.map(attempt => attempt.id)
    }
    : null;
  if (!transferPassRate) insufficientFields.push("transferPassRate");

  const trainedDebts = debtList.filter(debt => getProfile(debt.id) || list.some(attempt => attempt.cognitiveDebtId === debt.id));
  const relapsedDebts = trainedDebts.filter(debt => debt.status === "relapsed");
  const relapseRate = trainedDebts.length > 0
    ? {
      trainedDebtCount: trainedDebts.length,
      relapsedDebtCount: relapsedDebts.length,
      totalRelapseEvents: debtList.reduce((sum, debt) => sum + (Number(debt.recurrenceCount) || 0), 0),
      rate: round2(relapsedDebts.length / trainedDebts.length),
      evidenceDebtIds: relapsedDebts.map(debt => debt.id)
    }
    : null;
  if (!relapseRate) insufficientFields.push("relapseRate");

  const withDuration = list.filter(attempt => Number.isFinite(Number(attempt.durationSeconds)));
  const averageDurationSeconds = withDuration.length > 0
    ? Math.round(withDuration.reduce((sum, attempt) => sum + Number(attempt.durationSeconds), 0) / withDuration.length)
    : null;
  if (averageDurationSeconds === null) insufficientFields.push("averageDurationSeconds");

  const withHintDependency = list
    .filter(attempt => Number.isFinite(Number(attempt.evaluation?.hintDependency)) && toMs(attempt.completedAt) !== null)
    .sort((a, b) => String(a.completedAt || "").localeCompare(String(b.completedAt || "")));
  let hintDependencyTrend = "insufficient_data";
  if (withHintDependency.length >= 2) {
    const half = Math.floor(withHintDependency.length / 2);
    const avg = items => items.reduce((sum, attempt) => sum + Number(attempt.evaluation.hintDependency), 0) / items.length;
    const earlier = avg(withHintDependency.slice(0, half));
    const later = avg(withHintDependency.slice(half));
    // 提示依赖度下降为改善
    if (later < earlier - 5) hintDependencyTrend = "improving";
    else if (later > earlier + 5) hintDependencyTrend = "declining";
    else hintDependencyTrend = "stable";
  }
  if (hintDependencyTrend === "insufficient_data") insufficientFields.push("hintDependencyTrend");

  return {
    totalAttempts: list.length,
    stagePassRates,
    averageHintsPerAttempt,
    answerRevisionRate: answerRevision,
    transferPassRate,
    relapseRate,
    averageDurationSeconds,
    hintDependencyTrend,
    hintDependencyEvidenceAttemptIds: withHintDependency.map(attempt => attempt.id),
    insufficientData: list.length < 2,
    insufficientFields
  };
}

// ─── 风险画像聚合 ───

/** 只聚合含实质风险（排除 no_material_risk）的欠条，按风险类型计数。 */
export function aggregateRiskProfile({ debts = [], analysesByDebtId } = {}) {
  const getAnalysis = lookupFrom(analysesByDebtId);
  const byRisk = new Map();
  let totalRiskDebts = 0;
  for (const debt of Array.isArray(debts) ? debts : []) {
    const analysis = getAnalysis(debt.id);
    const riskTypes = (Array.isArray(analysis?.riskTypes) ? analysis.riskTypes : [])
      .map(risk => clean(risk).toLowerCase())
      .filter(risk => risk && risk !== "no_material_risk");
    if (riskTypes.length === 0) continue;
    totalRiskDebts++;
    for (const riskType of new Set(riskTypes)) {
      if (!byRisk.has(riskType)) byRisk.set(riskType, { evidenceKeys: new Set(), debtIds: [] });
      const entry = byRisk.get(riskType);
      entry.evidenceKeys.add(evidenceKeyForDebt(debt));
      entry.debtIds.push(debt.id);
    }
  }
  const distribution = [...byRisk.entries()]
    .map(([riskType, entry]) => ({
      riskType,
      label: riskTypeLabel(riskType),
      count: entry.evidenceKeys.size,
      debtCount: entry.debtIds.length,
      evidenceDebtIds: entry.debtIds
    }))
    .sort((a, b) => b.count - a.count || a.riskType.localeCompare(b.riskType));
  return {
    totalRiskDebts,
    distribution,
    insufficientData: totalRiskDebts < 2
  };
}

// ─── 洞察生成（确定性模板 + 可选 AI 措辞润色） ───

const POLISH_SYSTEM_PROMPT = [
  "你是学习产品的文案编辑。输入是一批已经由确定性规则计算好的用户认知画像结论（JSON）。",
  "你的唯一任务是把每条 title 和 description 改写得更自然、更易读，面向中文用户。",
  "硬性要求：不得新增、删除或修改任何数字、比例、领域名、机制名；不得添加原结论中没有的事实或建议；",
  "不得输出心理诊断或人格评价词汇。保持每条 id 不变。",
  "只返回 JSON：{\"insights\":[{\"id\":\"...\",\"title\":\"...\",\"description\":\"...\"}]}"
].join("");

function buildInsight({ userId, insightType, title, description, metricValue, metricUnit, evidenceDebtIds, evidenceAttemptIds, evidenceClusterIds, confidence, periodStart, periodEnd, now }) {
  return {
    id: crypto.randomUUID(),
    userId,
    insightType,
    title: clean(title).slice(0, 200),
    description: clean(description).slice(0, 1000),
    ...(Number.isFinite(Number(metricValue)) ? { metricValue: Number(metricValue) } : {}),
    ...(metricUnit ? { metricUnit: clean(metricUnit).slice(0, 40) } : {}),
    evidenceDebtIds: Array.isArray(evidenceDebtIds) ? evidenceDebtIds : [],
    evidenceAttemptIds: Array.isArray(evidenceAttemptIds) ? evidenceAttemptIds : [],
    evidenceClusterIds: Array.isArray(evidenceClusterIds) ? evidenceClusterIds : [],
    confidence: Number(confidence) || 0,
    periodStart,
    periodEnd,
    calculationVersion: CALCULATION_VERSION,
    aiEnhanced: false,
    createdAt: (now instanceof Date ? now : new Date(now || Date.now())).toISOString()
  };
}

/**
 * 把聚合结果转成 CognitiveProfileInsight 记录。
 * 仅当证据数满足最低证据规则（confidence > 0）时才生成对应结论。
 * 传入 store 时按（userId + period）幂等替换旧记录；传入 chatFn 时仅润色
 * 措辞，输出经结构校验，失败或无 key 时保留确定性模板文案。
 */
export async function generateInsights({
  userId,
  skills,
  gapPatterns,
  learningBehavior,
  risks,
  periodStart,
  periodEnd,
  store,
  chatFn,
  now = new Date()
}) {
  const insights = [];
  const base = { userId, periodStart, periodEnd, now };

  // ── 能力领域：优势 / 待加强 ──
  for (const skill of skills?.skills || []) {
    if (!(skill.confidence > 0)) continue;
    const pct = Math.round((skill.masteredRatio || 0) * 100);
    const avgText = skill.averageMastery ? `六维平均掌握度 ${skill.averageMastery.overallMastery}。` : "尚无掌握度画像。";
    const weakestText = skill.weakestDimensions.length > 0
      ? `最弱维度为${skill.weakestDimensions.map(item => `「${item.label}」(${item.value})`).join(" 和 ")}。`
      : "";
    if ((skill.masteredRatio || 0) >= 0.5 && skill.masteredDebtCount >= 1) {
      insights.push(buildInsight({
        ...base,
        insightType: "skill_strength",
        title: `优势领域：${skill.displayName}`,
        description: `该领域 ${skill.relatedDebtCount} 张欠条中已掌握 ${skill.masteredDebtCount} 张（${pct}%）。${avgText}${weakestText}`,
        metricValue: pct,
        metricUnit: "%",
        evidenceDebtIds: skill.evidenceDebtIds,
        confidence: skill.confidence
      }));
    } else {
      insights.push(buildInsight({
        ...base,
        insightType: "skill_gap",
        title: `待加强领域：${skill.displayName}`,
        description: `该领域 ${skill.relatedDebtCount} 张欠条中已掌握 ${skill.masteredDebtCount} 张（${pct}%）。${avgText}${weakestText}`,
        metricValue: pct,
        metricUnit: "%",
        evidenceDebtIds: skill.evidenceDebtIds,
        confidence: skill.confidence
      }));
    }
  }

  // ── 认知模式：高频欠条机制 ──
  if (gapPatterns?.conclusion && gapPatterns.confidence > 0) {
    const top = gapPatterns.distribution[0];
    const second = gapPatterns.distribution[1];
    const topEvidence = [top, second].filter(Boolean).flatMap(item => item.evidenceDebtIds);
    insights.push(buildInsight({
      ...base,
      insightType: "recurring_pattern",
      title: `高频欠条机制：${[top, second].filter(Boolean).map(item => item.label).join("、")}`,
      description: gapPatterns.conclusion,
      metricValue: Math.round((top.share + (second?.share || 0)) * 100),
      metricUnit: "%",
      evidenceDebtIds: topEvidence,
      confidence: gapPatterns.confidence
    }));
  }

  // ── AI 协作模式：高频根因 ──
  const topCause = gapPatterns?.rootCauseDistribution?.[0];
  if (topCause && topCause.count >= 2) {
    insights.push(buildInsight({
      ...base,
      insightType: "ai_collaboration_pattern",
      title: `高频根因：${topCause.label}`,
      description: `最近${gapPatterns.periodDays}天的认知欠条中，「${topCause.label}」出现 ${topCause.count} 次（占 ${Math.round(topCause.share * 100)}%），是你与 AI 协作中最值得注意的环节。`,
      metricValue: Math.round(topCause.share * 100),
      metricUnit: "%",
      evidenceDebtIds: topCause.evidenceDebtIds,
      confidence: confidenceFromEvidenceCount(topCause.count)
    }));
  }

  // ── 学习模式 ──
  if (learningBehavior) {
    const transfer = learningBehavior.transferPassRate;
    if (transfer && transfer.attempts >= 2) {
      insights.push(buildInsight({
        ...base,
        insightType: "learning_pattern",
        title: `迁移训练通过率 ${Math.round(transfer.passRate * 100)}%`,
        description: `迁移类训练（场景迁移 / 错误识别）共完成 ${transfer.attempts} 次，通过 ${transfer.passed} 次。${transfer.passRate >= 0.7 ? "迁移能力表现稳定。" : "迁移环节仍是薄弱点，建议优先完成到期的迁移训练。"}`,
        metricValue: Math.round(transfer.passRate * 100),
        metricUnit: "%",
        evidenceAttemptIds: transfer.evidenceAttemptIds,
        confidence: confidenceFromEvidenceCount(transfer.attempts)
      }));
    }
    if (learningBehavior.hintDependencyTrend && learningBehavior.hintDependencyTrend !== "insufficient_data") {
      const trend = learningBehavior.hintDependencyTrend;
      const trendText = {
        improving: "近期训练中对提示的依赖在下降，独立作答能力在增强。",
        declining: "近期训练中对提示的依赖在上升，建议尝试先独立作答再查看提示。",
        stable: "近期训练中对提示的依赖总体平稳。"
      }[trend];
      insights.push(buildInsight({
        ...base,
        insightType: "learning_pattern",
        title: `提示依赖趋势：${trendLabel(trend)}`,
        description: trendText,
        evidenceAttemptIds: (learningBehavior.hintDependencyEvidenceAttemptIds || []).slice(0, 20),
        confidence: confidenceFromEvidenceCount((learningBehavior.hintDependencyEvidenceAttemptIds || []).length)
      }));
    }
  }

  // ── 风险画像 ──
  const topRisk = risks?.distribution?.[0];
  if (topRisk && topRisk.count >= 2) {
    insights.push(buildInsight({
      ...base,
      insightType: "risk_pattern",
      title: `主要风险：${topRisk.label}`,
      description: `${topRisk.count} 条独立证据涉及「${topRisk.label}」（相关欠条 ${topRisk.debtCount} 张）。这些欠条若不清偿，可能在真实工作中造成实际影响。`,
      metricValue: topRisk.count,
      metricUnit: "条",
      evidenceDebtIds: topRisk.evidenceDebtIds,
      confidence: confidenceFromEvidenceCount(topRisk.count)
    }));
  }

  // ── 成长趋势 ──
  const trended = (skills?.skills || []).filter(skill => skill.confidence > 0 && (skill.trend === "improving" || skill.trend === "declining"));
  if (trended.length > 0) {
    const improving = trended.filter(skill => skill.trend === "improving");
    const declining = trended.filter(skill => skill.trend === "declining");
    const parts = [];
    if (improving.length > 0) parts.push(`上升：${improving.map(skill => skill.displayName).join("、")}`);
    if (declining.length > 0) parts.push(`下降：${declining.map(skill => skill.displayName).join("、")}`);
    insights.push(buildInsight({
      ...base,
      insightType: "growth_trend",
      title: `掌握趋势：${improving.length} 个领域上升 / ${declining.length} 个领域下降`,
      description: `与上一个周期相比，${parts.join("；")}。`,
      evidenceDebtIds: trended.flatMap(skill => skill.evidenceDebtIds),
      confidence: Math.max(...trended.map(skill => skill.confidence))
    }));
  }

  const polished = await maybePolishInsights(insights, chatFn);
  if (store) {
    const saved = await store.replaceInsightsForPeriod(userId, periodStart, periodEnd, polished);
    return { insights: saved, aiEnhanced: polished.some(item => item.aiEnhanced) };
  }
  return { insights: polished, aiEnhanced: polished.some(item => item.aiEnhanced) };
}

/** AI 仅润色措辞：校验 id 对应与字段长度，任何异常都回退模板文案。 */
async function maybePolishInsights(insights, chatFn) {
  if (typeof chatFn !== "function" || insights.length === 0) return insights;
  try {
    const raw = await chatFn(
      [
        { role: "system", content: POLISH_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ insights: insights.map(item => ({ id: item.id, title: item.title, description: item.description })) }) }
      ],
      () => ({}),
      2048
    );
    if (raw?.__fallback || !Array.isArray(raw?.insights)) return insights;
    const wordingById = new Map();
    for (const item of raw.insights) {
      const id = clean(item?.id).slice(0, 100);
      const title = clean(item?.title).slice(0, 200);
      const description = clean(item?.description).slice(0, 1000);
      if (id && title && description) wordingById.set(id, { title, description });
    }
    return insights.map(item => {
      const wording = wordingById.get(item.id);
      return wording ? { ...item, ...wording, aiEnhanced: true } : item;
    });
  } catch {
    return insights;
  }
}

// ─── 快照 ───

/**
 * 快照周期边界（UTC）：
 * - weekly：本周一 00:00 至下周一 00:00
 * - monthly：本月 1 日至下月 1 日
 * - manual：当日 00:00 至当前时刻（同一天内重复生成视为同周期，幂等跳过）
 */
export function resolveSnapshotPeriod(snapshotType, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (snapshotType === "monthly") {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
  }
  if (snapshotType === "manual") {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    return { periodStart: start.toISOString(), periodEnd: d.toISOString() };
  }
  const day = d.getUTCDay() || 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (day - 1)));
  const nextMonday = new Date(monday.getTime() + 7 * DAY_MS);
  return { periodStart: monday.toISOString(), periodEnd: nextMonday.toISOString() };
}

/**
 * 生成并保存一份不可变快照（五类汇总 JSON）。
 * 同 userId + snapshotType + periodStart 已存在时跳过（created = false），
 * 历史快照永不删除/改写。
 */
export async function createSnapshot({ store, userId, snapshotType, periodStart, periodEnd, skills, gapPatterns, learningBehavior, risks, now = new Date() }) {
  if (!store) throw new Error("store is required for snapshot");
  const type = ["weekly", "monthly", "manual"].includes(snapshotType) ? snapshotType : "manual";
  const period = periodStart && periodEnd
    ? { periodStart, periodEnd }
    : resolveSnapshotPeriod(type, now);
  const skillList = skills?.skills || [];
  const record = {
    id: crypto.randomUUID(),
    userId,
    snapshotType: type,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    skillSummaryJson: {
      skills: skillList.map(skill => ({
        skillNodeKey: skill.skillNodeKey,
        displayName: skill.displayName,
        relatedDebtCount: skill.relatedDebtCount,
        masteredDebtCount: skill.masteredDebtCount,
        masteredRatio: skill.masteredRatio,
        relapsedDebtCount: skill.relapsedDebtCount,
        averageOverallMastery: skill.averageMastery ? skill.averageMastery.overallMastery : null,
        trend: skill.trend
      })),
      unclassifiedDebtCount: skills?.unclassifiedDebtCount || 0
    },
    gapPatternSummaryJson: {
      periodDays: gapPatterns?.periodDays ?? 30,
      totalIndependentEvidence: gapPatterns?.totalIndependentEvidence || 0,
      distribution: (gapPatterns?.distribution || []).map(item => ({
        mechanism: item.key, count: item.count, share: item.share
      }))
    },
    learningBehaviorSummaryJson: {
      totalAttempts: learningBehavior?.totalAttempts || 0,
      stagePassRates: Object.fromEntries(
        Object.entries(learningBehavior?.stagePassRates || {}).map(([stage, value]) => [
          stage,
          value ? { attempts: value.attempts, passed: value.passed, passRate: value.passRate } : null
        ])
      ),
      averageHintsPerAttempt: learningBehavior?.averageHintsPerAttempt ?? null,
      transferPassRate: learningBehavior?.transferPassRate
        ? { attempts: learningBehavior.transferPassRate.attempts, passed: learningBehavior.transferPassRate.passed, passRate: learningBehavior.transferPassRate.passRate }
        : null,
      hintDependencyTrend: learningBehavior?.hintDependencyTrend || "insufficient_data"
    },
    riskSummaryJson: {
      totalRiskDebts: risks?.totalRiskDebts || 0,
      distribution: (risks?.distribution || []).map(item => ({
        riskType: item.riskType, count: item.count
      }))
    },
    growthSummaryJson: {
      improving: skillList.filter(skill => skill.trend === "improving").map(skill => skill.skillNodeKey),
      declining: skillList.filter(skill => skill.trend === "declining").map(skill => skill.skillNodeKey),
      stable: skillList.filter(skill => skill.trend === "stable").map(skill => skill.skillNodeKey)
    },
    calculationVersion: CALCULATION_VERSION,
    createdAt: (now instanceof Date ? now : new Date(now)).toISOString()
  };
  return store.saveSnapshot(record);
}

/**
 * 读取某用户的全部原始数据并计算四类聚合（读时计算，不存派生掌握度）。
 */
export function computeProfileAggregates({ userId, trainingStore, intelligenceStore, profileStore, periodDays = 30, now = new Date() }) {
  const debts = trainingStore.listCognitiveDebts(userId);
  const analysesByDebtId = new Map();
  for (const debt of debts) {
    const analysis = intelligenceStore.getCurrentAnalysis(debt.id);
    if (analysis) analysesByDebtId.set(debt.id, analysis);
  }
  const profilesByDebtId = new Map(
    trainingStore.listMasteryProfiles(userId).map(profile => [profile.cognitiveDebtId, profile])
  );
  const attempts = trainingStore.listAttempts(userId);
  const snapshots = profileStore ? profileStore.listSnapshots(userId) : [];
  return {
    debts,
    analysesByDebtId,
    profilesByDebtId,
    attempts,
    skills: aggregateSkillProfile(userId, { debts, analysesByDebtId, profilesByDebtId, snapshots, now }),
    patterns: aggregateGapPatterns({ debts, analysesByDebtId, periodDays, now }),
    learningBehavior: aggregateLearningBehavior({ debts, attempts, profilesByDebtId }),
    risks: aggregateRiskProfile({ debts, analysesByDebtId })
  };
}

/** 计算聚合并保存一份快照。 */
export async function buildAndSaveSnapshot({ profileStore, trainingStore, intelligenceStore, userId, snapshotType, now = new Date() }) {
  const aggregates = computeProfileAggregates({ userId, trainingStore, intelligenceStore, profileStore, now });
  return createSnapshot({
    store: profileStore,
    userId,
    snapshotType,
    skills: aggregates.skills,
    gapPatterns: aggregates.patterns,
    learningBehavior: aggregates.learningBehavior,
    risks: aggregates.risks,
    now
  });
}

/**
 * 周/月定时快照：对所有有欠条的用户各生成一份 weekly 与 monthly 快照。
 * 幂等：同一周期已存在则跳过。单个用户失败仅记录，不影响其他用户。
 */
export async function generatePeriodicSnapshots({ profileStore, trainingStore, intelligenceStore, now = new Date() } = {}) {
  if (!profileStore || !trainingStore || !intelligenceStore) {
    throw new Error("profileStore, trainingStore and intelligenceStore are required");
  }
  const debts = trainingStore.listCognitiveDebts();
  const userIds = [...new Set(debts.map(debt => debt.userId || "demo-user"))];
  let created = 0;
  let skipped = 0;
  const errors = [];
  for (const userId of userIds) {
    for (const snapshotType of ["weekly", "monthly"]) {
      try {
        const result = await buildAndSaveSnapshot({
          profileStore, trainingStore, intelligenceStore, userId, snapshotType, now
        });
        if (result.created) created++;
        else skipped++;
      } catch (error) {
        errors.push({ userId, snapshotType, error: String(error?.message || error).slice(0, 300) });
      }
    }
  }
  return { users: userIds.length, created, skipped, errors };
}
