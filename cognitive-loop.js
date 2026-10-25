import crypto from "node:crypto";

export const COGNITIVE_LOOP_SCHEMA_VERSION = "cognitive-loop-mvp-2";
export const AI_COLLABORATION_DIMENSIONS = [
  "problem_modeling",
  "task_decomposition",
  "context",
  "verification",
  "iteration",
  "workflow",
  "ai_world_model"
];

const DIMENSION_CONFIG = {
  problem_modeling: {
    label: "问题建模",
    labelEn: "Problem modeling",
    positive: /(目标|目的|约束|成功标准|验收标准|背景|问题是|goal|objective|constraint|success criteria|acceptance criteria|assumption)/i,
    negative: /(直接帮我|先做再说|不需要说明|just give me the answer|do it first)/i,
    diagnosis: "把目标、约束和成功标准写清楚，再让 AI 反向澄清。",
    diagnosisEn: "State the goal, constraints, and success criteria before asking AI to act.",
    action: "在下一次 AI 请求前，先写下目标、约束和可验收结果。"
  },
  task_decomposition: {
    label: "任务拆解与委派",
    labelEn: "Task decomposition and delegation",
    positive: /(拆解|分解|步骤|子任务|委派|并行|delegate|decompose|subtask|parallel)/i,
    negative: /(一步到位|全部手动|每一步都要|一问一答|one step at a time|do every step myself)/i,
    diagnosis: "把完整目标交给 AI 判断执行路径，只保留必要的边界和验收点。",
    diagnosisEn: "Give AI the complete goal and guardrails, keeping only the necessary boundaries and acceptance checks.",
    action: "选择一个低风险完整任务，只定义目标、上下文、约束和验收标准，不预先设计中间步骤。"
  },
  context: {
    label: "上下文构造",
    labelEn: "Context engineering",
    positive: /(项目|仓库|repo|文件|历史|决策|上下文|记忆|memory|context|source|资料|规范)/i,
    negative: /(再解释一遍|重复解释|没有背景|每次都要说|without context|repeat the background|start over)/i,
    diagnosis: "把稳定背景和历史决策沉淀成可复用的项目上下文。",
    diagnosisEn: "Turn stable background and decisions into reusable project context.",
    action: "把当前项目的目标、约束、决策和术语整理成一份可复用的上下文。"
  },
  verification: {
    label: "判断与验证",
    labelEn: "Judgment and verification",
    positive: /(验证|核实|查证|证据|测试|试验|对照|回滚|监控|来源|verify|evidence|test|check|validate|cross-check|rollback|benchmark)/i,
    negative: /(直接采用|看起来对|应该没问题|不用测试|先上线|接受第一版|accept the first|looks fine|no need to test|ship it)/i,
    diagnosis: "不要把第一版输出当作结论；为高影响结果设计独立证据。",
    diagnosisEn: "Treat the first output as a hypothesis and design independent evidence for high-impact results.",
    action: "挑一个高影响结论，用测试、独立来源或可回滚实验核验。"
  },
  iteration: {
    label: "多轮协作与反馈",
    labelEn: "Iterative collaboration and feedback",
    positive: /(多轮|迭代|追问|修改|反馈|比较|版本|refine|iterate|feedback|revise|follow[- ]?up|compare)/i,
    negative: /(一问一答|直接接受|不再修改|第一版就用|first answer|no revision|accept immediately)/i,
    diagnosis: "把 AI 输出当成可以被反馈和修订的工作材料，而不是一次性交付。",
    diagnosisEn: "Treat AI output as work material that can be revised through feedback, not as a one-shot delivery.",
    action: "在下一次任务中明确一次反馈回合，并记录结果如何因此改变。"
  },
  workflow: {
    label: "工作流与委派",
    labelEn: "Workflow and delegation",
    positive: /(拆分|分解|步骤|委派|并行|工具|模板|自动化|工作流|重复|批量|agent|tool|template|automation|workflow|parallel|delegate)/i,
    negative: /(一次性|手动复制|每次重新|一问一答|one-off|copy paste|start from scratch|single prompt)/i,
    diagnosis: "把重复的一问一答升级为目标 → 智能代理执行 → 测试 → 复核的闭环。",
    diagnosisEn: "Upgrade repeated one-off chats into goal → agent execution → test → review.",
    action: "选择一个低风险重复任务，试做一次可复用的智能代理工作流。"
  },
  ai_world_model: {
    label: "AI 能力边界认知",
    labelEn: "AI capability-boundary awareness",
    positive: /(能力边界|模型限制|适合|不适合|不确定|风险|来源|最新|工具选择|capability|limitation|uncertain|risk|source|tool choice)/i,
    negative: /(万能|什么都能|完全准确|无需判断|always correct|can do anything|no judgment needed)/i,
    diagnosis: "持续更新对 AI 能做什么、不能做什么以及何时需要人类负责的判断。",
    diagnosisEn: "Keep updating what AI can and cannot do, and when a human must remain accountable.",
    action: "为一个真实任务写出 AI 可以做、不能做、必须由人最终判断的三栏边界。"
  }
};

const DEFAULT_CONTENT_CANDIDATES = [
  {
    id: "curated-verification-workflow",
    title: "把 AI 输出当成假设：验证优先的协作工作流",
    sourceName: "MindIOU 策展演示",
    sourceType: "curated_demo",
    summary: "用一个低风险真实任务演示：先定义成功标准，再让 AI 执行，最后用独立证据复核。",
    keyPoints: ["先写成功标准", "保留独立验证", "为失败准备回滚"],
    evidenceStrength: 0.8,
    durationMinutes: 9
  },
  {
    id: "curated-project-context",
    title: "把反复解释背景改造成长期项目上下文",
    sourceName: "MindIOU 策展演示",
    sourceType: "curated_demo",
    summary: "演示如何把项目目标、约束、历史决策和术语整理成一份可持续维护的上下文。",
    keyPoints: ["抽取稳定背景", "记录历史决策", "减少重复解释"],
    evidenceStrength: 0.75,
    durationMinutes: 12
  }
];

function clean(value, limit = 4000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeDate(value, fallback) {
  const date = new Date(value || fallback);
  return Number.isNaN(date.getTime()) ? new Date(fallback).toISOString() : date.toISOString();
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function excerpt(text, match) {
  const source = clean(text, 5000);
  if (!source) return "";
  const index = match?.index == null ? 0 : Math.max(0, match.index - 54);
  return source.slice(index, index + 180);
}

function normalizeActivity(input, index, fallbackNow) {
  const content = clean(input?.content || input?.transcript || input?.text, 12000);
  if (!content) return null;
  const occurredAt = normalizeDate(input?.occurredAt || input?.createdAt, fallbackNow);
  return {
    id: clean(input?.id, 120) || "activity-" + (index + 1),
    title: clean(input?.title, 200) || "AI 协作活动 " + (index + 1),
    content,
    occurredAt,
    source: clean(input?.source || input?.platform, 80) || "ai_conversation",
    eventType: clean(input?.eventType, 80) || "ai_collaboration"
  };
}

/**
 * Normalize once at the ingestion boundary. The returned event objects are
 * intentionally reusable by both the AI-collaboration and domain engines so
 * the two profiles cannot silently score different activity inputs.
 */
export function normalizeActivityEvents(inputs, fallbackNow = new Date().toISOString()) {
  return (Array.isArray(inputs) ? inputs : [])
    .map((item, index) => normalizeActivity(item, index, fallbackNow))
    .filter(Boolean)
    .slice(0, 100)
    .map(item => ({
      ...item,
      contentHash: stableHash(item.content)
    }));
}

function normalizeCandidate(input, index) {
  const title = clean(input?.title, 300);
  const summary = clean(input?.summary || input?.description || input?.transcript, 2400);
  if (!title && !summary) return null;
  const segments = Array.isArray(input?.segments)
    ? input.segments.slice(0, 8).map(segment => ({
      startSeconds: Math.max(0, Number(segment?.startSeconds || segment?.start || 0)),
      endSeconds: Math.max(0, Number(segment?.endSeconds || segment?.end || 0)),
      title: clean(segment?.title, 200),
      reason: clean(segment?.reason, 500)
    })).filter(segment => segment.title || segment.endSeconds > segment.startSeconds)
    : [];
  return {
    id: clean(input?.id, 120) || "content-" + (index + 1),
    title: title || "未命名内容",
    url: clean(input?.url, 1000),
    sourceName: clean(input?.sourceName || input?.creator, 200) || "用户固定信息源",
    sourceType: clean(input?.sourceType, 80) || "fixed_source",
    summary: summary || "暂无摘要；需要先读取字幕或文字结构。",
    transcript: clean(input?.transcript, 6000),
    keyPoints: Array.isArray(input?.keyPoints)
      ? input.keyPoints.slice(0, 6).map(item => clean(item, 300)).filter(Boolean)
      : [],
    segments,
    evidenceStrength: clamp(Number(input?.evidenceStrength ?? 0.6) * 100, 0, 100) / 100,
    durationMinutes: Math.max(0, Number(input?.durationMinutes || 0))
  };
}

function scoreDimension(dimension, activities) {
  const config = DIMENSION_CONFIG[dimension];
  const evidence = [];
  let positive = 0;
  let negative = 0;
  for (const activity of activities) {
    const positiveMatch = activity.content.match(config.positive);
    const negativeMatch = activity.content.match(config.negative);
    if (positiveMatch) {
      positive += 1;
      evidence.push({
        activityId: activity.id,
        occurredAt: activity.occurredAt,
        excerpt: excerpt(activity.content, positiveMatch),
        signal: "observed_positive"
      });
    }
    if (negativeMatch) {
      negative += 1;
      evidence.push({
        activityId: activity.id,
        occurredAt: activity.occurredAt,
        excerpt: excerpt(activity.content, negativeMatch),
        signal: "observed_risk"
      });
    }
  }
  const score = clamp(35 + positive * 18 - negative * 15 + Math.min(activities.length, 3) * 4);
  const confidence = activities.length >= 5 && evidence.length >= 3
    ? "high"
    : activities.length >= 2 && evidence.length >= 1
      ? "medium"
      : "low";
  return {
    dimension,
    label: config.label,
    labelEn: config.labelEn,
    score: Math.round(score),
    confidence,
    evidenceStatus: evidence.length ? "observed" : "missing_evidence",
    evidence: evidence.slice(0, 5),
    diagnosis: config.diagnosis,
    diagnosisEn: config.diagnosisEn,
    nextAction: config.action
  };
}

function debtForProfile(profile, runId, createdAt) {
  const config = DIMENSION_CONFIG[profile.dimension];
  const priority = profile.score <= 45 ? "now" : profile.score <= 65 ? "next" : "later";
  const why = profile.evidence.length
    ? "近 7 天活动显示「" + profile.label + "」仍有可观察风险；下一步应该改变行为，而不是继续消费相似内容。"
    : "近 7 天没有足够的「" + profile.label + "」行为证据，先用一个真实任务补齐验证。";
  const interventionType = {
    problem_modeling: "behavior_experiment",
    task_decomposition: "delegation",
    context: "context",
    verification: "verification",
    iteration: "behavior_experiment",
    workflow: "workflow_upgrade",
    ai_world_model: "boundary_judgment"
  }[profile.dimension] || "behavior_experiment";
  const successCriteria = {
    problem_modeling: ["写出目标、约束和成功标准", "让 AI 先反向澄清一个问题"],
    task_decomposition: ["只定义目标、上下文、约束和验收标准", "让 AI 自己决定至少一个中间执行路径"],
    context: ["形成一份可复用的项目上下文", "下一次不再重复解释稳定背景"],
    verification: ["至少保留一条独立证据", "明确结论仍有哪些不确定性"],
    iteration: ["至少完成一轮有记录的反馈和修订", "说明反馈如何改变了最终结果"],
    workflow: ["把一个重复任务拆成可委派步骤", "保留测试与人类复核环节"],
    ai_world_model: ["写出 AI 可以做、不能做和必须由人判断的边界", "为一个高影响判断保留责任归属"]
  }[profile.dimension] || ["完成一次真实任务行为实验", "保留结果证据并复盘" ];
  return {
    id: "ai-usage-debt-" + profile.dimension,
    kind: "ai_usage_debt",
    dimension: profile.dimension,
    title: profile.label + "缺口",
    status: "open",
    priority,
    score: profile.score,
    confidence: profile.confidence,
    why,
    evidence: profile.evidence.slice(0, 3),
    nextAction: config.action,
    interventionType,
    successCriteria,
    createdAt,
    runId
  };
}

function normalizedTokens(value) {
  return new Set(clean(value, 3000).toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/i).filter(token => token.length > 1));
}

function overlap(left, right) {
  const a = normalizedTokens(left);
  const b = normalizedTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.max(a.size, b.size);
}

function contentIntelligence(candidate, debt, context) {
  const relevance = clamp(25 + overlap(candidate.title + " " + candidate.summary, debt.title + " " + context) * 75);
  const novelty = candidate.sourceType === "curated_demo" ? 72 : 60;
  const score = Math.round(relevance * 0.55 + novelty * 0.2 + candidate.evidenceStrength * 100 * 0.25);
  const decision = score >= 58
    ? candidate.segments.length ? "watch_segment" : "read_summary"
    : "skip";
  const keyPoints = candidate.keyPoints.length
    ? candidate.keyPoints
    : clean(candidate.transcript || candidate.summary).split(/[。！？.!?]/).map(item => clean(item, 220)).filter(Boolean).slice(0, 4);
  return {
    ...candidate,
    relevance: Math.round(relevance),
    novelty,
    score,
    decision,
    decisionReason: decision === "skip"
      ? "与当前缺口的边际价值不足，今天可以跳过，避免增加重复信息。"
      : "与当前缺口直接相关，且提供了可转成真实行为的证据或演示。",
    keyPoints,
    contentRecord: {
      coreArgument: clean(candidate.summary, 500),
      evidenceStrength: candidate.evidenceStrength,
      timeline: candidate.segments,
      action: decision
    }
  };
}

function feedbackPayload(feedback) {
  return feedback && typeof feedback.payload === "object" && feedback.payload ? feedback.payload : {};
}

function debtFeedbackAdjustment(dimension, feedback = []) {
  return feedback.reduce((adjustment, item) => {
    if (item?.kind !== "correction" || item.targetId !== "ai-usage-debt-" + dimension) return adjustment;
    const accepted = feedbackPayload(item).accepted;
    if (accepted === false) return adjustment + 35;
    if (accepted === true) return adjustment - 5;
    return adjustment;
  }, 0);
}

function contentFeedbackAdjustment(candidateId, feedback = []) {
  return feedback.reduce((adjustment, item) => {
    if (item?.kind !== "recommendation" || item.targetId !== candidateId) return adjustment;
    const accepted = feedbackPayload(item).accepted;
    if (accepted === false) return adjustment - 25;
    if (accepted === true) return adjustment + 10;
    return adjustment;
  }, 0);
}

function applyContentFeedback(candidate, feedback = []) {
  const adjustment = contentFeedbackAdjustment(candidate.id, feedback);
  if (!adjustment) return candidate;
  const score = Math.round(clamp(candidate.score + adjustment));
  const feedbackNote = adjustment < 0
    ? "用户上一轮将此内容标记为不相关，已在本轮降权。"
    : "用户上一轮认可此内容，已在本轮适度加权。";
  return {
    ...candidate,
    score,
    feedbackAdjustment: adjustment,
    decision: score >= 58 ? (candidate.segments.length ? "watch_segment" : "read_summary") : "skip",
    decisionReason: feedbackNote + " " + candidate.decisionReason
  };
}

function buildBriefing(candidates, debt, context, feedback = []) {
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = stableHash(clean(candidate.title + "|" + candidate.summary, 1000).toLowerCase());
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(applyContentFeedback(contentIntelligence(candidate, debt, context), feedback));
  }
  const ranked = unique.sort((a, b) => b.score - a.score).slice(0, 3);
  const top = ranked[0];
  return {
    title: "本周 Cognitive Briefing",
    attentionBudget: 1,
    items: top ? [top] : [],
    noRecommendation: !top || top.decision === "skip",
    explanation: top
      ? top.decision === "skip"
        ? "今天没有足够高边际价值的内容；系统建议直接跳过，把注意力留给工作流实验。"
        : "只保留一条与当前 AI Usage Debt 直接相关的内容，并把阅读动作连接到真实任务。"
      : "当前没有可审计的信息源候选，系统不主动增加内容噪音。",
    informationDiet: {
      candidateCount: candidates.length,
      uniqueCount: unique.length,
      duplicateCount: Math.max(0, candidates.length - unique.length),
      recommendedCount: top && top.decision !== "skip" ? 1 : 0
    }
  };
}

function buildExperiment(debt, runId, now) {
  const common = {
    id: "workflow-experiment-" + runId,
    type: "workflow_experiment",
    status: "planned",
    debtId: debt.id,
    createdAt: now,
    dueAt: addDays(now, 7),
    verification: {
      status: "pending",
      method: "下一周导入同一项目的活动，比较同一维度是否出现新的正向证据。"
    }
  };
  if (debt.dimension === "verification") {
    return {
      ...common,
      title: "给一个高影响 AI 结论加独立验证",
      instruction: "选择一个真实结论，明确可观察的成功标准，再用测试、独立来源或可回滚实验复核。",
      successCriteria: debt.successCriteria
    };
  }
  if (debt.dimension === "context") {
    return {
      ...common,
      title: "建立一份可复用的项目上下文",
      instruction: "把目标、约束、历史决策和术语写进项目上下文；下一次只引用它，不重复粘贴整段背景。",
      successCriteria: debt.successCriteria
    };
  }
  if (debt.dimension === "problem_modeling") {
    return {
      ...common,
      title: "先写目标、约束和成功标准",
      instruction: "在下一次 AI 请求前先写三行问题定义，并要求 AI 先指出缺失约束。",
      successCriteria: debt.successCriteria
    };
  }
  if (debt.dimension === "task_decomposition") {
    return {
      ...common,
      title: "把一个完整任务交给智能代理",
      instruction: "只定义目标、上下文、约束和验收标准，不预先设计中间步骤；观察智能代理如何选择执行路径。",
      successCriteria: debt.successCriteria
    };
  }
  if (debt.dimension === "iteration") {
    return {
      ...common,
      title: "记录一次反馈如何改变 AI 结果",
      instruction: "保留第一版、你的反馈和最终版，明确指出反馈带来的具体变化。",
      successCriteria: debt.successCriteria
    };
  }
  if (debt.dimension === "ai_world_model") {
    return {
      ...common,
      title: "画出一次 AI 协作的责任边界",
      instruction: "为一个真实任务分别写下 AI 可以做、不能做、必须由人最终判断的内容。",
      successCriteria: debt.successCriteria
    };
  }
  return {
    ...common,
    title: "把一个重复任务升级成智能代理工作流",
    instruction: "选择一个低风险重复任务，写成目标 → 智能代理执行 → 自动测试 → 人类复核的最小流程。",
    successCriteria: debt.successCriteria
  };
}

export function defaultContentCandidates() {
  return DEFAULT_CONTENT_CANDIDATES.map(candidate => ({ ...candidate, keyPoints: [...candidate.keyPoints] }));
}

export function analyzeCognitiveLoop(input = {}) {
  const now = normalizeDate(input.now, new Date().toISOString());
  const windowDays = Math.max(1, Math.min(30, Number(input.windowDays || 7)));
  const windowStart = addDays(now, -windowDays);
  const activities = (Array.isArray(input.activityEvents) ? input.activityEvents : normalizeActivityEvents(input.activities, now))
    .map((item, index) => normalizeActivity(item, index, now))
    .filter(Boolean)
    .filter(item => new Date(item.occurredAt).getTime() >= new Date(windowStart).getTime())
    .slice(0, 100);
  const context = clean(input.projectContext || input.context, 3000);
  const runId = clean(input.runId, 120) || "run-" + stableHash({ now, context, activities }).slice(0, 20);
  const previousFeedback = Array.isArray(input.previousFeedback) ? input.previousFeedback : [];
  const profile = AI_COLLABORATION_DIMENSIONS.map(dimension => scoreDimension(dimension, activities));
  const rankedProfiles = [...profile].sort((a, b) => {
    const scoreA = a.score + debtFeedbackAdjustment(a.dimension, previousFeedback);
    const scoreB = b.score + debtFeedbackAdjustment(b.dimension, previousFeedback);
    return scoreA - scoreB;
  });
  const selectedProfile = rankedProfiles[0];
  const generatedAt = now;
  const debts = rankedProfiles.map(item => debtForProfile(item, runId, generatedAt));
  const debt = debts[0];
  const candidates = (Array.isArray(input.contentCandidates) && input.contentCandidates.length
    ? input.contentCandidates
    : defaultContentCandidates())
    .map((item, index) => normalizeCandidate(item, index))
    .filter(Boolean);
  const briefing = buildBriefing(candidates, debt, context, previousFeedback);
  return {
    schemaVersion: COGNITIVE_LOOP_SCHEMA_VERSION,
    runId,
    source: "rule_fallback",
    sourceLabel: "结构化行为规则（可审计降级）",
    generatedAt,
    window: { days: windowDays, start: windowStart, end: now },
    projectContext: context,
    inputSummary: {
      activityCount: activities.length,
      sourceTypes: [...new Set(activities.map(item => item.source))],
      contentCandidateCount: candidates.length,
      previousFeedbackCount: previousFeedback.length
    },
    activities: activities.map(item => ({
      id: item.id,
      title: item.title,
      occurredAt: item.occurredAt,
      source: item.source,
      contentHash: stableHash(item.content),
      excerpt: item.content.slice(0, 160)
    })),
    aiCollaborationProfile: profile,
    aiUsageDebts: debts,
    briefing,
    experiment: buildExperiment(debt, runId, generatedAt),
    verification: {
      status: "pending",
      dueAt: addDays(generatedAt, 7),
      nextInput: "下周导入同一项目的 AI 活动，观察本轮训练是否改变行为。"
    },
    evidencePolicy: "仅把输入活动中的可观察信号作为证据；没有证据时标记为 missing_evidence，不把推断包装成长期能力结论。"
  };
}
