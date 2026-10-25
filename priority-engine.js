export const PRIORITY_ENGINE_SCHEMA_VERSION = "priority-engine-v1";

function clean(value, limit = 500) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function priorityWeight(priority) {
  return priority === "now" ? 34 : priority === "next" ? 18 : 4;
}

function aiInterventionType(debt) {
  const explicit = clean(debt?.interventionType, 80);
  if (explicit) return explicit;
  return {
    problem_modeling: "behavior_experiment",
    task_decomposition: "delegation",
    context: "context",
    verification: "verification",
    iteration: "behavior_experiment",
    workflow: "workflow_upgrade",
    ai_world_model: "boundary_judgment"
  }[debt?.dimension] || "behavior_experiment";
}

function domainIntervention(debt) {
  const path = ["知识", "训练", "解释", "迁移", "真实工作验证"];
  return {
    category: "domain_capability",
    interventionType: "knowledge_training",
    interventionPath: path,
    action: clean(debt?.nextAction, 600) || "围绕这个领域缺口完成一次知识解释和真实工作验证。"
  };
}

function aiIntervention(debt) {
  const interventionType = aiInterventionType(debt);
  const pathByType = {
    behavior_experiment: ["行为实验"],
    delegation: ["委派", "行为实验"],
    verification: ["验证", "行为实验"],
    context: ["上下文", "工作流升级"],
    workflow_upgrade: ["工作流升级", "行为实验"],
    boundary_judgment: ["边界判断", "验证"]
  };
  return {
    category: "ai_collaboration",
    interventionType,
    interventionPath: pathByType[interventionType] || ["行为实验"],
    action: clean(debt?.nextAction, 600) || "在下一个真实任务中改变一个可观察的 AI 协作行为。"
  };
}

/**
 * Pick one shared intervention queue across domain gaps, AI-usage gaps and
 * frontier content. The engine deliberately returns a small queue: attention
 * is a product constraint, not an accidental consequence of sorting.
 */
export function selectPriorityInterventions({
  knowledgeDebts = [],
  aiUsageDebts = [],
  contentItems = [],
  max = 3,
  now = new Date().toISOString()
} = {}) {
  const candidates = [];
  for (const debt of Array.isArray(knowledgeDebts) ? knowledgeDebts : []) {
    const domain = domainIntervention(debt);
    candidates.push({
      id: "intervention-domain-" + clean(debt.id, 160),
      sourceId: clean(debt.id, 160),
      category: domain.category,
      interventionType: domain.interventionType,
      interventionPath: domain.interventionPath,
      title: clean(debt.title, 260) || "领域能力知识缺口",
      action: domain.action,
      evidence: Array.isArray(debt.evidence) ? debt.evidence.slice(0, 3) : [],
      score: Math.round(clamp((100 - Number(debt.score || 0)) + priorityWeight(debt.priority))),
      priority: clean(debt.priority, 20) || "next",
      reason: clean(debt.why, 600) || "这个领域缺口需要通过知识、训练和真实工作验证逐步清偿。",
      createdAt: now
    });
  }
  for (const debt of Array.isArray(aiUsageDebts) ? aiUsageDebts : []) {
    const ai = aiIntervention(debt);
    candidates.push({
      id: "intervention-ai-" + clean(debt.id, 160),
      sourceId: clean(debt.id, 160),
      category: ai.category,
      interventionType: ai.interventionType,
      interventionPath: ai.interventionPath,
      title: clean(debt.title, 260) || "AI 协作行为缺口",
      action: ai.action,
      evidence: Array.isArray(debt.evidence) ? debt.evidence.slice(0, 3) : [],
      score: Math.round(clamp((100 - Number(debt.score || 0)) + priorityWeight(debt.priority))),
      priority: clean(debt.priority, 20) || "next",
      reason: clean(debt.why, 600) || "这个 AI 协作缺口应该通过一次真实行为实验来验证，而不是继续阅读同类信息。",
      createdAt: now
    });
  }
  for (const item of Array.isArray(contentItems) ? contentItems : []) {
    if (item?.decision === "skip") continue;
    const score = clamp(Number(item?.score || 0));
    candidates.push({
      id: "intervention-frontier-" + clean(item.id, 160),
      sourceId: clean(item.id, 160),
      category: "frontier_information",
      interventionType: item?.decision === "watch_segment" ? "focused_reading" : "capability_update",
      interventionPath: ["前沿信息过滤", "能力变化判断"],
      title: clean(item.title, 260) || "一条值得关注的前沿能力变化",
      action: item?.decision === "watch_segment" ? "只观看与当前缺口直接相关的片段，再把变化连接到一个真实任务。" : "先读摘要，判断这项能力变化是否会改变你的工作方式。",
      evidence: [{ source: clean(item.sourceName, 160), excerpt: clean(item.summary, 260), signal: "frontier_candidate" }],
      score: Math.round(score * 0.75 + Number(item?.contentRecord?.evidenceStrength || 0) * 25),
      priority: score >= 75 ? "now" : "next",
      reason: clean(item.decisionReason, 600) || "这条信息与当前能力缺口有直接关系。",
      createdAt: now
    });
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const previous = unique.get(candidate.id);
    if (!previous || candidate.score > previous.score) unique.set(candidate.id, candidate);
  }
  return [...unique.values()]
    .sort((left, right) => right.score - left.score || left.category.localeCompare(right.category))
    .slice(0, Math.max(1, Math.min(3, Number(max) || 3)));
}
