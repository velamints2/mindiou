import { selectPriorityInterventions } from "./priority-engine.js";

export const USER_COGNITIVE_PROFILE_SCHEMA_VERSION = "user-cognitive-profile-v1";
export const DOMAIN_CAPABILITY_DIMENSIONS = [
  "conceptualUnderstanding",
  "causalExplanation",
  "practicalReproduction",
  "boundariesAndRisks",
  "transferAbility"
];

const DOMAIN_CONFIG = {
  conceptualUnderstanding: {
    label: "概念理解",
    signal: /(概念|原理|定义|什么是|理解|explain|concept|definition|understand)/i
  },
  causalExplanation: {
    label: "因果解释",
    signal: /(为什么|原因|机制|影响|因果|why|cause|mechanism|impact)/i
  },
  practicalReproduction: {
    label: "实践复现",
    signal: /(实现|修改|运行|测试|复现|部署|调试|implement|run|test|build|debug|deploy)/i
  },
  boundariesAndRisks: {
    label: "边界与风险",
    signal: /(风险|限制|边界|不能|安全|隐私|规范|risk|limit|boundary|privacy|safety|compliance)/i
  },
  transferAbility: {
    label: "迁移应用",
    signal: /(迁移|类似|复用|新场景|适配|举一反三|transfer|adapt|reuse|new context)/i
  }
};

function clean(value, limit = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function normalizeDomain(value) {
  return clean(value, 200).replace(/[：:，,。；;]+$/g, "");
}

function evidenceFor(events, pattern, signal) {
  return events.filter(event => pattern.test(event.content)).slice(0, 5).map(event => ({
    activityId: event.id,
    occurredAt: event.occurredAt,
    excerpt: clean(event.content, 220),
    signal
  }));
}

function emptyDimension() {
  return { score: 0, level: "L1", stability: "unverified", evidence: [], evidenceStatus: "missing_evidence" };
}

function levelForScore(score) {
  if (score >= 80) return "L4";
  if (score >= 60) return "L3";
  if (score >= 35) return "L2";
  return "L1";
}

function mergeExistingDimension(existing, observed) {
  const oldScore = Number(existing?.score || 0);
  const nextScore = existing ? Math.round(oldScore * 0.7 + observed.score * 0.3) : observed.score;
  const evidence = [...(Array.isArray(existing?.evidence) ? existing.evidence : []), ...(observed.evidence || [])]
    .slice(-20);
  return {
    score: clamp(nextScore),
    level: levelForScore(nextScore),
    stability: evidence.length >= 3 ? "observed" : evidence.length ? "one_shot" : "unverified",
    evidence,
    evidenceStatus: evidence.length ? "observed" : "missing_evidence",
    updatedAt: observed.updatedAt
  };
}

function domainDebt({ domain, events, now }) {
  const explicitGap = /(不懂|不会|不理解|解释一下|原理是什么|缺少.{0,8}(知识|基础)|can't explain|don't understand|do not understand|lack knowledge)/i;
  const evidence = events.filter(event => explicitGap.test(event.content)).slice(0, 3).map(event => ({
    activityId: event.id,
    occurredAt: event.occurredAt,
    excerpt: clean(event.content, 240),
    signal: "explicit_domain_knowledge_gap"
  }));
  if (!domain || !evidence.length) return [];
  const id = "knowledge-debt-" + domain.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-").slice(0, 100);
  return [{
    id,
    kind: "knowledge_debt",
    category: "domain_capability",
    domain,
    title: domain + "：需要补齐的领域知识",
    status: "open",
    priority: "now",
    score: 28,
    confidence: evidence.length >= 2 ? "high" : "medium",
    why: "活动中出现了明确的领域知识缺口信号；它需要通过知识、训练、解释、迁移和真实工作验证来清偿。",
    evidence,
    interventionType: "knowledge_training",
    interventionPath: ["知识", "训练", "解释", "迁移", "真实工作验证"],
    nextAction: "先用自己的话解释一个核心概念，再把它迁移到当前真实任务并保留验证证据。",
    successCriteria: ["用自己的话解释核心概念", "在真实工作中完成一次迁移", "保留结果与验证证据"],
    createdAt: now,
    updatedAt: now
  }];
}

/**
 * Domain engine. It observes the same normalized Activity Events as the AI
 * collaboration engine, but asks a different question: what domain knowledge
 * and transferable professional capability is evidenced by the work?
 */
export function analyzeDomainCapabilities({
  userId,
  domain,
  activityEvents = [],
  existingProfiles = [],
  now = new Date().toISOString()
} = {}) {
  const normalizedDomain = normalizeDomain(domain);
  const events = Array.isArray(activityEvents) ? activityEvents : [];
  if (!normalizedDomain) {
    return { domainCapabilityProfiles: Array.isArray(existingProfiles) ? existingProfiles : [], knowledgeDebts: [], domain: "" };
  }
  const existing = (Array.isArray(existingProfiles) ? existingProfiles : []).find(item => item.userId === userId && item.domain === normalizedDomain);
  const dimensions = {};
  for (const dimension of DOMAIN_CAPABILITY_DIMENSIONS) {
    const config = DOMAIN_CONFIG[dimension];
    const evidence = evidenceFor(events, config.signal, "domain_capability_signal");
    const score = evidence.length ? clamp(24 + evidence.length * 19) : 0;
    dimensions[dimension] = mergeExistingDimension(existing?.dimensions?.[dimension], {
      score,
      evidence,
      updatedAt: now
    });
  }
  const weights = { conceptualUnderstanding: 0.25, causalExplanation: 0.25, practicalReproduction: 0.2, boundariesAndRisks: 0.15, transferAbility: 0.15 };
  const overallMastery = Math.round(DOMAIN_CAPABILITY_DIMENSIONS.reduce((sum, key) => sum + dimensions[key].score * weights[key], 0));
  const profile = {
    userId,
    domain: normalizedDomain,
    dimensions,
    overallMastery,
    stage: levelForScore(overallMastery),
    source: "activity_observed",
    sourceActivityIds: [...new Set(events.map(event => event.id))].slice(-100),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    dataSchemaVersion: "domain-capability-profile-v1"
  };
  const profiles = (Array.isArray(existingProfiles) ? existingProfiles : []).filter(item => !(item.userId === userId && item.domain === normalizedDomain));
  profiles.push(profile);
  return {
    domain: normalizedDomain,
    domainCapabilityProfiles: profiles,
    knowledgeDebts: domainDebt({ domain: normalizedDomain, events, now })
  };
}

function mergeRecords(existing, incoming) {
  const result = new Map((Array.isArray(existing) ? existing : []).map(item => [item.id, item]));
  for (const item of Array.isArray(incoming) ? incoming : []) result.set(item.id, item);
  return [...result.values()];
}

function mergeDomainProfiles(existing, incoming) {
  const result = new Map();
  for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    const key = String(item?.userId || "") + ":" + String(item?.domain || "");
    if (!item?.domain) continue;
    result.set(key, item);
  }
  return [...result.values()];
}

function blankProfile(userId, now) {
  return {
    schemaVersion: USER_COGNITIVE_PROFILE_SCHEMA_VERSION,
    userId,
    goal: "",
    projectIds: [],
    domainCapabilityProfiles: [],
    aiCollaborationProfile: [],
    knowledgeDebts: [],
    aiUsageDebts: [],
    priorityInterventions: [],
    lastActivityEventIds: [],
    lastLoopRunId: "",
    createdAt: now,
    updatedAt: now
  };
}

export function buildUserCognitiveProfile({
  userId,
  projectId,
  domain,
  projectContext,
  activityEvents = [],
  loopResult,
  existingProfile,
  existingCapabilityProfiles = [],
  now = new Date().toISOString()
} = {}) {
  const base = { ...blankProfile(userId, now), ...(existingProfile || {}) };
  const domainAnalysis = analyzeDomainCapabilities({
    userId,
    domain,
    activityEvents,
    existingProfiles: [...(Array.isArray(base.domainCapabilityProfiles) ? base.domainCapabilityProfiles : []), ...(Array.isArray(existingCapabilityProfiles) ? existingCapabilityProfiles : [])],
    now
  });
  const domainProfiles = domainAnalysis.domain
    ? domainAnalysis.domainCapabilityProfiles
    : mergeDomainProfiles(base.domainCapabilityProfiles, existingCapabilityProfiles);
  const knowledgeDebts = mergeRecords(base.knowledgeDebts, domainAnalysis.knowledgeDebts);
  const aiUsageDebts = Array.isArray(loopResult?.aiUsageDebts) ? loopResult.aiUsageDebts : [];
  const priorityInterventions = selectPriorityInterventions({
    knowledgeDebts,
    aiUsageDebts,
    contentItems: loopResult?.briefing?.items || [],
    max: 3,
    now
  });
  return {
    profile: {
      ...base,
      schemaVersion: USER_COGNITIVE_PROFILE_SCHEMA_VERSION,
      userId,
      goal: clean(projectContext || base.goal, 1200),
      projectIds: [...new Set([...(Array.isArray(base.projectIds) ? base.projectIds : []), clean(projectId, 160)].filter(Boolean))].slice(-50),
      domainCapabilityProfiles: domainProfiles,
      aiCollaborationProfile: Array.isArray(loopResult?.aiCollaborationProfile) ? loopResult.aiCollaborationProfile : [],
      knowledgeDebts,
      aiUsageDebts,
      priorityInterventions,
      lastActivityEventIds: [...new Set(activityEvents.map(event => event.id))].slice(-100),
      lastLoopRunId: clean(loopResult?.runId || base.lastLoopRunId, 160),
      updatedAt: now
    },
    domainAnalysis,
    priorityInterventions
  };
}

// Compatibility exports used by the learning-orchestrator and report
// presentation layers. The domain profile builder above owns the new
// capability aggregation; these stable labels/helpers keep older callers
// working while the two layers converge on one profile module.
export const TRAINING_STAGES = Object.freeze([
  "initial_compensation",
  "delayed_recall",
  "misconception_check",
  "scenario_transfer",
  "error_detection",
  "real_work_validation"
]);

export const DOMAIN_ROOT_LABELS = Object.freeze({
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

export function gapMechanismLabel(mechanism) {
  return GAP_MECHANISM_LABELS[mechanism] || mechanism || "未知机制";
}

export function riskTypeLabel(riskType) {
  return RISK_TYPE_LABELS[riskType] || riskType || "未知风险";
}

export function dimensionLabel(dimension) {
  return DOMAIN_CONFIG[dimension]?.label || dimension;
}

export function evidenceKeyForDebt(debt) {
  const sources = Array.isArray(debt?.sourceReports) ? debt.sourceReports.filter(Boolean) : [];
  if (sources.length > 0) return `report:${sources[0]}`;
  if (debt?.reportId) return `report:${debt.reportId}`;
  if (debt?.clearanceSessionId) return `session:${debt.clearanceSessionId}`;
  return `debt:${debt?.id || "unknown"}`;
}

export function skillNodeKeyFromDomainPath(domainPath) {
  if (!Array.isArray(domainPath)) return "";
  return domainPath.map(segment => clean(segment, 120).toLowerCase()).filter(Boolean).slice(0, 3).join(".");
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveSnapshotPeriod(snapshotType, now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (snapshotType === "monthly") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
  }
  if (snapshotType === "manual") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    return { periodStart: start.toISOString(), periodEnd: date.toISOString() };
  }
  const day = date.getUTCDay() || 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)));
  return { periodStart: monday.toISOString(), periodEnd: new Date(monday.getTime() + 7 * DAY_MS).toISOString() };
}
