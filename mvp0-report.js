import { normalizeReport, generateFallbackReport } from "./mvp0-fallback.js";
import { deriveReportDisplay } from "./report-display.js";
import { prepareArtifactForReport } from "./mvp0-artifact-preprocess.js";

/**
 * MVP-0 diagnostic clearance report generator (multi-step pipeline).
 *
 * Pipeline:
 *   Step A "attribution + calibration"  — artifact kind, aiCompleted,
 *     userContributed, cognitiveProcessesOutsourced, 5-dimension capability.
 *   Step B "root gap synthesis"         — 2-4 root-capability dangerousGaps +
 *     cognitiveStructure. USER CONFUSIONS from the collaboration timeline are
 *     first-class input: every confusion must be addressed by exactly one gap
 *     or explicitly explained as not-a-capability-gap.
 *   Step C "bounded research"           — at most 3 queries via the injected
 *     researchFn, per-query timeout, transparent degradation. Never fatal.
 *   Step D "cards + next actions"       — 3-5 Feynman cards (cardType +
 *     evaluationCriteria) and routed nextActions.
 *
 * Any AI step failure produces generateFallbackReport() with
 * generation.fallback=true, generation.error and generation.failedStep.
 * Research failure alone never fails the report.
 *
 * Backward compatible: generateClearanceReport(text, type, chatFn) without
 * options still works (no timeline, no user confusions, research skipped).
 *
 * Audience for every prompt: the user who supplied the artifact. Their role,
 * industry, and technical background must be inferred only from direct evidence.
 * This is a diagnostic-teacher report about the USER's mental models.
 */

const MAX_TEXT = 30000;
const MAX_RESEARCH_QUERIES = 3;
const DEFAULT_RESEARCH_TIMEOUT_MS = 15000;

const VALID_ARTIFACT_TYPES = [
  "chatgpt", "claude", "cursor", "codex", "hackathon", "meeting", "article", "other"
];

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? text.slice(0, max) : text;
}

function withGenerationStatus(report, fallback, error = "", failedStep = "") {
  report.generation = {
    fallback: Boolean(fallback),
    error: truncate(error, 300),
    failedStep: truncate(failedStep, 40)
  };
  return report;
}

/* ── Prompts: the "诊断型教师" (diagnostic teacher), split across steps ── */

const teacherPreamble = [
  "你是 MindIOU 的诊断型教师。你的读者是提交这份材料的用户。",
  "只根据材料中的明确证据判断用户的职业、行业、职责和技术背景；证据不足时统一称为“用户”，不得补全或默认任何身份。",
  "你输出的不是当前任务的风险清单，而是关于【用户能力与心智模型】的诊断报告。",
  "",
  "核心准则：",
  "1. 分析对象是用户的能力与心智模型，不是当前的具体问题。任务中的术语、故障或实现细节只是表面信号；",
  "   你要合成能解释至少 2 个表面信号的根能力缺口，它们必须可迁移、可验证、有掌握标准。",
  "2. 不得把“没有提到”等同于“不会”。证据有四种状态：proven（材料直接证明会）、partial（部分证明）、",
  "   unobserved（材料未涉及，不能下结论）、misconception（有直接矛盾证据才能用）。",
  "3. 深层推断必须走三步：observedSignals（观察到的信号）→ capabilityHypothesis（能力假设）→ diagnosticQuestion（诊断问题）。",
  "4. 本产品当前只支持文字对话和文字回答。所有 diagnosticQuestion、feynmanCards.prompt、evaluationCriteria 和 nextActions 必须能在文本框中完成；禁止要求用户画图、绘图、手绘、拍照、上传图片/附件、录音、视频或提交文件。需要表达系统图/流程图时，改成“请用文字按顺序说明步骤、交付物、判断依据和边界”，可使用编号、箭头和缩进纯文字表达。",
  "5. 教学方式必须匹配材料已经证明的用户背景与当前水平；可使用文字流程、文字系统关系、类比、场景预测、决策比较等形式。类比必须准确，不得为了通俗而失真。",
  "6. 已解决的具体问题（已识别+已处理+已验证）不得写成未解决问题；把它转化为用户尚未解释的决策、验证债务或训练材料。",
  "7. 教师表达：不羞辱用户。强调“当前材料尚未证明”而不是“用户不懂”。先肯定已具备的能力，再指出下一个成长点。",
  "8. 只返回合法 JSON，不要 Markdown、解释或额外文字。",
  "9. 用户载荷含 outputLanguage 时，所有面向用户的分析必须使用该语言；原始证据引用保留原文。未指定时才跟随原文语言。"
].join("\n");

const stepASystemPrompt = [
  teacherPreamble,
  "",
  "## Step A：归因与能力校准（attribution + calibration）",
  "",
  "任务：判断材料类型，分清 AI 和用户各自完成了什么，识别哪些认知过程被外包给了 AI，并校准用户能力。",
  "",
  "归因规则：",
  "- aiCompleted 只列 AI/助手实际完成的工作（分析、修改、解释、操作、测试、总结）。",
  "- userContributed 只列用户真实提供的东西（目标、背景、标准、约束、批准、最终判断）。",
  "- 严禁把用户的验收清单条目当作 AI 完成的工作；有 User:/Assistant: 角色标记时按角色归因；",
  "  无法判断归因时设 isInference: true。",
  "- evidence 不得照抄原文，必须解释为什么这段文字证明该归因。",
  "",
  "cognitiveProcessesOutsourced：列出用户把哪些【思考过程】外包给了 AI（不是任务本身），每条含：",
  "- process：被外包的认知过程（如“方案权衡”“错误定位”“验收判断”）；",
  "- surfaceTask：它在材料中的表面任务形态；",
  "- whyItMatters：为什么这个思考过程对用户达成当前目标重要；",
  "- evidence：支撑证据 + 归因理由；isInference：是否为推断。",
  "",
  "能力校准五个维度（先判断维度等级，再生成后续内容；按用户当前水平 +1 出题）：",
  "- productProblemFraming：能否自己界定当前任务的目标、问题和范围；字段名仅为兼容保留，不代表用户从事特定岗位；",
  "- aiAgentSteering：能否有效指挥 AI（目标、约束、验收）；",
  "- systemMentalModel：是否建立了系统如何运转的心智模型；",
  "- technicalDecisionComprehension：是否理解 AI 代做的技术决策及其后果；",
  "- validationAndQualityJudgment：能否独立验证和判断产出质量。",
  "每个维度输出 { level: L0-L5, evidenceStatus: proven|partial|unobserved|misconception, evidence: [证据], confidence: 0-1 }。",
  "L0 不了解对象；L1 只提宏观目标、全部委托；L2 能跟随步骤；L3 能在指导下实现；L4 能独立实现与调试；L5 能做架构取舍与评审。",
  "",
  "返回 JSON：",
  '{"artifactTitle":"用具体任务或主题概括材料，12-40字，不写用户能力评价",',
  '"artifactKind":"ai_workflow_transcript|ai_chat|ai_coding_log|ai_generated_document|meeting_notes|unknown",',
  '"aiCompleted":[{"item":"","evidence":"","isInference":false}],',
  '"userContributed":[{"item":"","evidence":"","isInference":false}],',
  '"cognitiveProcessesOutsourced":[{"process":"","surfaceTask":"","whyItMatters":"","evidence":"","isInference":true}],',
  '"userCapability":{"overall":"L0-L5|mixed","dimensions":{"productProblemFraming":{"level":"L1","evidenceStatus":"unobserved","evidence":[],"confidence":0},',
  '"aiAgentSteering":{"level":"L1","evidenceStatus":"unobserved","evidence":[],"confidence":0},',
  '"systemMentalModel":{"level":"L1","evidenceStatus":"unobserved","evidence":[],"confidence":0},',
  '"technicalDecisionComprehension":{"level":"L1","evidenceStatus":"unobserved","evidence":[],"confidence":0},',
  '"validationAndQualityJudgment":{"level":"L1","evidenceStatus":"unobserved","evidence":[],"confidence":0}},',
  '"currentDomain":"","strongestDemonstratedAbility":"","highestPriorityGrowthArea":"","evidenceSignals":[],"recommendedCardLevel":"foundation|intermediate|advanced"}}',
  "currentDomain 必须提取材料的具体主题领域（例如‘3D打印与增材制造’、‘AR眼镜硬件协同设计’），不要填用户能力等级；只有材料主题确实无法判断时才填 unknown，不要把所有主题都归为 general。",
  "",
  "Step A 自检清单：归因区分 AI 与用户；evidence 含归因理由；四种证据状态区分；未观察到的维度标 unobserved 而不是猜；只返回合法 JSON。"
].join("\n");

const stepBSystemPrompt = [
  teacherPreamble,
  "",
  "## Step B：根能力缺口合成（root gap synthesis）",
  "",
  "输入包含：Step A 的归因与能力校准结果、协作时间线摘要、以及【用户在时间线上亲手标注的困惑】。",
  "",
  "最高优先级规则：用户亲手标注的每一条困惑，都必须被恰好一个缺口的 surfaceSignals/diagnosticQuestion 覆盖；",
  "如果你判断某条困惑不构成能力缺口，必须在 confusionResolutions 中显式说明理由。不得静默忽略任何一条用户困惑。",
  "没有用户困惑时，缺口全部来自你的推断，必须相应降低 confidence 并在 alternativeExplanations 中说明。",
  "",
  "dangerousGaps 规则：",
  "- 只产出 2-4 个【根能力缺口】。不得为了凑数把一个根问题拆成多个，也不得填充凑数缺口。",
  "- 每个缺口必须能解释至少 2 个表面信号（surfaceSignals）；解释不了 2 个就降低 confidence。",
  "- diagnosticQuestion 只能使用该缺口的 observedSignals、材料原文和对应领域概念；禁止凭空加入老人、跌倒、支付、速度、加速度等新人物、场景、指标或应用。",
  "- 每个缺口必须：可迁移（transferScenarios 至少 1 个别的场景）、可验证（diagnosticQuestion）、有掌握标准（masteryCriteria）。",
  "- 缺口不是 Bug 列表，是用户尚未证明自己理解的根能力。已识别+已修复+已测试的问题转化为理解决策或验证债务。",
  "- 每个缺口给出 confidence（0-1）和 alternativeExplanations（缺口可能的其他解释）。",
  "- 按危险程度排序 rank 1 起。",
  "",
  "cognitiveStructure：",
  "- facts：材料中的事实；",
  "- hypotheses：你的假设，每条带 confidence 和 alternativeExplanation；",
  "- questions：仍未回答的问题；",
  "- decisions：材料中的决策，每条标 decisionOwner: user|ai|shared|unclear；",
  "- tradeoffs：用与材料匹配且普通用户可理解的语言写——得到什么、放弃什么、依赖什么、失败影响谁。",
  "",
  "返回 JSON：",
  '{"dangerousGaps":[{"rank":1,"title":"一句话缺口名","gap":"根能力缺口描述","underlyingCapability":"对应的底层能力",',
  '"surfaceSignals":["至少 2 个表面信号"],"whyDangerous":"为什么会妨碍用户达成当前目标","transferScenarios":["至少 1 个迁移场景"],',
  '"confidence":0.0,"alternativeExplanations":[""],"diagnosticQuestion":"一个能诊断该缺口的具体问题","masteryCriteria":["掌握后能做到什么"]}],',
  '"cognitiveStructure":{"facts":[{"item":"","evidence":"","isInference":false}],',
  '"hypotheses":[{"item":"","evidence":"","isInference":true,"confidence":0.0,"alternativeExplanation":""}],',
  '"questions":[{"item":"","evidence":"","isInference":true}],',
  '"decisions":[{"item":"","evidence":"","isInference":false,"decisionOwner":"user|ai|shared|unclear"}],',
  '"tradeoffs":[{"item":"","evidence":"","isInference":true}]},',
  '"confusionResolutions":[{"stepId":"","confusion":"","resolution":"gap|not_capability_gap","gapRank":1,"reason":"resolution 为 not_capability_gap 时必填"}]}',
  "",
  "Step B 自检清单：没有 Bug 被当成根缺口；每个缺口解释 ≥2 个表面信号；每条用户困惑都有去向；",
  "confidence 与 alternativeExplanations 齐备；至少一个迁移场景；只返回合法 JSON。"
].join("\n");

const stepDSystemPrompt = [
  teacherPreamble,
  "",
  "## Step D：费曼补偿卡与下一步行动（cards + next actions）",
  "",
  "输入包含：根能力缺口、能力校准结果、用户亲手标注的困惑、以及有界研究摘要（可能不可用）。",
  "",
  "feynmanCards 规则（3-5 张）：",
  "- 每张卡必须映射到一个根能力缺口（target 写缺口标题或 dangerousGap-N）。",
  "- 返回 sourceGapId（对应 dangerousGaps 中的 sourceGapId）和 gapRank；不能只依赖卡片数组顺序。cognitiveDebtId 生成前留空即可。",
  "- 卡片测的是心智模型，不是术语记忆：让用户用文字描述系统关系/数据流、打类比、做场景预测、解释决策、比较方案、设计验证。不得要求画图、手绘、拍照、上传图片或附件。",
  "- 卡片必须匹配材料中有证据的用户背景和任务场景；不得预设写代码或不写代码，也不得要求与目标缺口无关的实现细节。",
  "- 用户标注过困惑的缺口优先配卡。",
  "- 按用户当前水平 +1 出题：不给初学者出架构题，不给专家出概念题。",
  "- cardType 必须是：system_map | analogy | prediction | decision_explanation | comparison | transfer | validation_design。",
  "- evaluationCriteria：2-4 条可判定的评分标准（什么算答对），供后续 AI 反馈使用。",
  "",
  "nextActions 规则：",
  "- 每条行动必须能建设能力，而不是重新修 Bug：verify 验证理解、note 沉淀判断、task 产出练习、ask 请教具体的人。",
  "- 每条含 relatedCapability（对应五个能力维度之一或根能力名）。",
  "- 研究摘要可用时，verify 类行动优先指向研究来源；研究不可用时不得编造来源。",
  "",
  "返回 JSON：",
  '{"feynmanCards":[{"id":"card-1","sourceGapId":"gap-1","gapRank":1,"cognitiveDebtId":"","target":"缺口标题或 dangerousGap-1","cardType":"system_map","prompt":"费曼式问题",',
  '"targetLevel":"L2","difficulty":"foundation|intermediate|advanced","evaluationCriteria":["什么算答对"],',
  '"userAnswer":"","aiFollowUp":"","answeredAt":null}],',
  '"nextActions":[{"item":"","route":"verify|note|task|ask","reason":"","relatedCapability":""}]}',
  "",
  "Step D 自检清单：卡片测系统理解而非术语；每张卡映射一个缺口；身份中立且难度匹配；所有问题都能只用文字回答，不含画图、拍照、上传或文件要求；",
  "evaluationCriteria 可判定；行动建设能力；只返回合法 JSON。"
].join("\n");

/**
 * Get the per-step system prompts. Exported for testing and inspection.
 */
export function getReportStepPrompts() {
  return {
    attribution: stepASystemPrompt,
    rootGaps: stepBSystemPrompt,
    cards: stepDSystemPrompt
  };
}

/* ── Pipeline helpers ── */

function isFallbackMarker(result) {
  return Boolean(result?.__fallback || result?.__useFallback);
}

function fallbackError(result) {
  return result?.__fallbackError || "AI generation was unavailable";
}

async function callStep(chatFn, systemPrompt, userPayload) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userPayload) }
  ];
  const result = await chatFn(messages, () => ({ __useFallback: true }));
  if (isFallbackMarker(result)) {
    throw new Error(fallbackError(result));
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("AI returned malformed step output");
  }
  return result;
}

function validateStepA(step) {
  if (!Array.isArray(step.aiCompleted) && typeof step.userCapability !== "object") {
    throw new Error("Step A output missing aiCompleted and userCapability");
  }
  return step;
}

function validateStepB(step) {
  if (!Array.isArray(step.dangerousGaps)) {
    throw new Error("Step B output missing dangerousGaps");
  }
  return step;
}

function validateStepD(step) {
  if (!Array.isArray(step.feynmanCards) && !Array.isArray(step.nextActions)) {
    throw new Error("Step D output missing feynmanCards and nextActions");
  }
  return step;
}

function detectCapabilitySignals(text) {
  const signals = [];
  const hasTechnicalTerms = /\b(file|command|api|permission|test|log|debug|build|deploy|config|sdk|port|route|endpoint)\b/i.test(text);
  const hasMacroGoals = /(帮我|给我|做一个|实现一个|我想要|需要|应该|产品|功能|需求|目标)/i.test(text);
  const hasApprovalWithoutReasoning = /(执行吧|继续|好的|可以|没问题|go ahead|proceed|do it)/i.test(text);
  const hasQuestions = /[?？]/.test(text);
  if (hasMacroGoals && !hasTechnicalTerms) {
    signals.push("User provides macro goals but does not mention technical implementation details.");
  }
  if (hasApprovalWithoutReasoning && !hasQuestions) {
    signals.push("User approves AI execution without asking for implementation reasoning.");
  }
  if (!hasQuestions) {
    signals.push("User does not ask technical questions in the artifact.");
  }
  return signals;
}

function buildTimelineDigest(timeline) {
  const steps = Array.isArray(timeline?.steps) ? timeline.steps : [];
  if (steps.length === 0) return null;
  return steps.map(step => ({
    id: truncate(step.id, 100),
    title: truncate(step.title, 120),
    keyConcepts: Array.isArray(step.keyConcepts) ? step.keyConcepts.slice(0, 3).map(c => truncate(c, 80)) : [],
    userConfusion: truncate(step.userConfusion, 1000)
  }));
}

function normalizeConfusionsInput(confusions) {
  if (!Array.isArray(confusions)) return [];
  return confusions.slice(0, 20).map(entry => ({
    stepId: truncate(entry?.stepId, 100),
    stepTitle: truncate(entry?.stepTitle, 120),
    text: truncate(entry?.text, 1000)
  })).filter(entry => entry.text);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`research timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function extractResearchSources(result) {
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  return sources.map(source => ({
    title: truncate(source?.title || "", 200),
    url: truncate(source?.url || "", 500),
    snippet: truncate(source?.snippet || source?.text || "", 500)
  })).filter(source => source.title || source.url);
}

/**
 * Step C: bounded research. At most MAX_RESEARCH_QUERIES queries extracted
 * from the root gaps, each with its own timeout. Any failure degrades to
 * status "unavailable" transparently; sources are never fabricated.
 */
async function runBoundedResearch(gaps, researchFn, timeoutMs) {
  if (typeof researchFn !== "function") {
    return { status: "skipped", queries: [], sources: [] };
  }
  const queries = [];
  const seen = new Set();
  for (const gap of gaps) {
    const query = clean(gap.underlyingCapability || gap.title || gap.gap);
    if (!query || seen.has(query)) continue;
    seen.add(query);
    queries.push(query);
    if (queries.length >= MAX_RESEARCH_QUERIES) break;
  }
  if (queries.length === 0) {
    return { status: "skipped", queries: [], sources: [] };
  }
  const queryResults = [];
  const sources = [];
  let okCount = 0;
  for (const query of queries) {
    try {
      const result = await withTimeout(Promise.resolve(researchFn(query)), timeoutMs);
      queryResults.push({ query, status: "ok", error: "" });
      sources.push(...extractResearchSources(result));
      okCount += 1;
    } catch (error) {
      queryResults.push({
        query,
        status: "unavailable",
        error: truncate(error instanceof Error ? error.message : String(error), 300)
      });
    }
  }
  return {
    status: okCount > 0 ? "ok" : "unavailable",
    queries: queryResults,
    sources: sources.slice(0, 10)
  };
}

/**
 * Generate a diagnostic clearance report using the multi-step AI pipeline.
 *
 * @param {string} artifactText - Raw input text from the user
 * @param {string} artifactType - Type of artifact
 * @param {function|null} chatFn - Injected chatJson(messages, fallbackFn). null = fallback only.
 * @param {object} [options]
 * @param {function|null} [options.researchFn] - async (query) => { sources?: [{title,url,snippet}] }
 * @param {object|null} [options.timeline] - Collaboration timeline ({ steps: [...] })
 * @param {Array} [options.confusions] - [{ stepId, stepTitle, text }] user-annotated confusions
 * @param {number} [options.researchTimeoutMs] - Per-query research timeout
 * @returns {Promise<object>} Normalized clearance report with all seven sections
 */
export async function generateClearanceReport(artifactText, artifactType, chatFn, options = {}) {
  const type = VALID_ARTIFACT_TYPES.includes(artifactType) ? artifactType : "other";
  const prepared = prepareArtifactForReport(artifactText, type, { maxText: MAX_TEXT });
  const text = truncate(prepared.text, MAX_TEXT);
  const preprocess = prepared.metadata;
  const researchFn = typeof options.researchFn === "function" ? options.researchFn : null;
  const researchTimeoutMs = Number(options.researchTimeoutMs) || DEFAULT_RESEARCH_TIMEOUT_MS;
  const timeline = options.timeline && typeof options.timeline === "object" ? options.timeline : null;
  const confusions = normalizeConfusionsInput(options.confusions);
  const outputLanguage = options.locale === "en" ? "English" : "Chinese";

  function fallbackReport(error, failedStep) {
    const report = generateFallbackReport(text, type);
    report.locale = options.locale === "en" ? "en" : "zh-CN";
    report.display = deriveReportDisplay({ ...report, display: null });
    report.input.preprocess = preprocess;
    report.input.confusions = confusions;
    return withGenerationStatus(report, true, error, failedStep);
  }

  if (!chatFn) {
    return fallbackReport("AI is not configured", "attribution");
  }

  const timelineDigest = buildTimelineDigest(timeline);
  const confusionNote = confusions.length > 0
    ? `用户亲手标注了 ${confusions.length} 条困惑，必须全部处理（见 userConfusions）。`
    : "未提供用户困惑标注：缺口全部来自你的推断，请相应降低 confidence 并在 alternativeExplanations 中说明。";

  let currentStep = "attribution";
  try {
    // ── Step A: attribution + calibration ──
    const stepA = validateStepA(await callStep(chatFn, stepASystemPrompt, {
      artifactText: text,
      artifactType: type,
      outputLanguage,
      charCount: clean(text).length,
      preprocess,
      hint: [
        "分析这份材料中的认知债务：先归因，再校准能力。",
        "Capability signals detected: " + (detectCapabilitySignals(text).join(" ") || "none auto-detected; infer from content."),
        preprocess?.didCompress
          ? `Input strategy: ${preprocess.strategy}. Treat this as a balanced evidence digest from a larger artifact, not the full chronological transcript.`
          : "Input strategy: plain text."
      ].join(" ")
    }));

    // ── Step B: root gap synthesis (user confusions are first-class input) ──
    currentStep = "root_gaps";
    const stepB = validateStepB(await callStep(chatFn, stepBSystemPrompt, {
      artifactKind: stepA.artifactKind || "unknown",
      outputLanguage,
      aiCompleted: Array.isArray(stepA.aiCompleted) ? stepA.aiCompleted : [],
      userContributed: Array.isArray(stepA.userContributed) ? stepA.userContributed : [],
      cognitiveProcessesOutsourced: Array.isArray(stepA.cognitiveProcessesOutsourced)
        ? stepA.cognitiveProcessesOutsourced
        : [],
      userCapability: stepA.userCapability || null,
      timelineDigest,
      userConfusions: confusions,
      confusionNote
    }));

    // ── Step C: bounded research (never fatal) ──
    const researchDigest = await runBoundedResearch(
      Array.isArray(stepB.dangerousGaps) ? stepB.dangerousGaps : [],
      researchFn,
      researchTimeoutMs
    );

    // ── Step D: cards + next actions ──
    currentStep = "cards";
    const stepD = validateStepD(await callStep(chatFn, stepDSystemPrompt, {
      outputLanguage,
      dangerousGaps: (Array.isArray(stepB.dangerousGaps) ? stepB.dangerousGaps : []).map((gap, index) => ({
        ...gap,
        sourceGapId: gap.sourceGapId || `gap-${Number(gap.rank) || index + 1}`
      })),
      userCapability: stepA.userCapability || null,
      userConfusions: confusions,
      researchDigest: {
        status: researchDigest.status,
        sources: researchDigest.sources
      }
    }));

    const report = normalizeReport({
      locale: options.locale === "en" ? "en" : "zh-CN",
      analysis: {
        artifactTitle: stepA.artifactTitle,
        artifactKind: stepA.artifactKind,
        userCapability: stepA.userCapability
      },
      sections: {
        aiCompleted: stepA.aiCompleted,
        userContributed: stepA.userContributed,
        cognitiveProcessesOutsourced: stepA.cognitiveProcessesOutsourced,
        dangerousGaps: stepB.dangerousGaps,
        cognitiveStructure: stepB.cognitiveStructure,
        feynmanCards: stepD.feynmanCards,
        nextActions: stepD.nextActions
      },
      research: researchDigest,
      confusionResolutions: stepB.confusionResolutions,
      input: {
        artifactText: text,
        artifactType: type,
        charCount: clean(text).length,
        preprocess,
        confusions
      }
    });

    return withGenerationStatus(report, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallbackReport(message, currentStep);
  }
}
