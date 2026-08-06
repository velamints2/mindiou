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

/**
 * Three-layer capability snapshot.
 *
 * L1 (ai_collaboration): cross-domain transferable AI-collaboration skills,
 *   aggregated from historical reports' analysis.userCapability. Used to decide
 *   what to check and how hard cards should be.
 * L2 (domain): domain-bound capability per area (e.g. database, frontend).
 *   Aggregated from capabilityProfile domain buckets. Cannot be inferred across
 *   domains.
 * L3 (knowledge_points): specific knowledge-point depth per domain, from
 *   capabilityProfile dimensions (conceptualUnderstanding, etc.). Feynman cards
 *   train this layer.
 *
 * The snapshot is a PRIOR. Material evidence in the current artifact always
 * overrides it. one_shot stability means a single observation and is a weak
 * prior; stable means >=2 user_verified attempts.
 */
export function buildCapabilitySnapshot({ reports = [], capabilityProfiles = [], userId, now = new Date().toISOString() } = {}) {
  const snapshot = {
    schemaVersion: "capability_snapshot_v1",
    collectedAt: now,
    userId: clean(userId).slice(0, 100) || null,
    source: "capability_profile_v1+report_history",
    layers: {
      L1_ai_collaboration: { available: false, dimensions: {}, note: "" },
      L2_domain: { available: false, domains: [] },
      L3_knowledge_points: { available: false, domains: [] }
    },
    rules: [
      "Material evidence in the current artifact always overrides this prior.",
      "L1 is cross-domain transferable; L2 is domain-bound; L3 is knowledge-point specific.",
      "one_shot stability = single observation (weak prior); stable = >=2 user_verified attempts.",
      "Absence of a layer means no history yet; do not infer capability from silence."
    ]
  };

  // ── L1: aggregate historical reports' userCapability (cross-domain) ──
  const recentReports = (Array.isArray(reports) ? reports : [])
    .filter(r => r && r.analysis?.userCapability && !r.generation?.fallback)
    .slice(0, 10);
  if (recentReports.length > 0) {
    const dimAccum = {};
    let overallAccum = [];
    for (const r of recentReports) {
      const uc = r.analysis.userCapability;
      const dims = uc.dimensions || {};
      for (const [dim, val] of Object.entries(dims)) {
        if (!val || typeof val !== "object") continue;
        if (!dimAccum[dim]) dimAccum[dim] = { levels: [], evidences: [], confidences: [] };
        if (val.level) dimAccum[dim].levels.push(val.level);
        if (val.evidenceStatus) dimAccum[dim].evidences.push(val.evidenceStatus);
        if (typeof val.confidence === "number") dimAccum[dim].confidences.push(val.confidence);
      }
      if (uc.overall) overallAccum.push(uc.overall);
    }
    const l1Dims = {};
    for (const [dim, acc] of Object.entries(dimAccum)) {
      const levelCounts = acc.levels.reduce((m, l) => (m[l] = (m[l] || 0) + 1, m), {});
      const topLevel = Object.entries(levelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "L0";
      const evidenceCounts = acc.evidences.reduce((m, e) => (m[e] = (m[e] || 0) + 1, m), {});
      const topEvidence = Object.entries(evidenceCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "unobserved";
      const avgConf = acc.confidences.length > 0
        ? Math.round((acc.confidences.reduce((s, c) => s + c, 0) / acc.confidences.length) * 100) / 100
        : 0;
      l1Dims[dim] = {
        inferredLevel: topLevel,
        commonEvidenceStatus: topEvidence,
        avgConfidence: avgConf,
        observationCount: acc.levels.length
      };
    }
    snapshot.layers.L1_ai_collaboration = {
      available: Object.keys(l1Dims).length > 0,
      dimensions: l1Dims,
      overallMode: overallAccum.length > 0
        ? overallAccum.reduce((m, o) => (m[o] = (m[o] || 0) + 1, m), {})
        : {},
      reportCount: recentReports.length,
      note: recentReports.length >= 3
        ? "Aggregated from recent reports; treat as moderate-strength prior."
        : "Few historical reports; treat as weak prior."
    };
  } else {
    snapshot.layers.L1_ai_collaboration.note = "No non-fallback historical reports; L1 unknown.";
  }

  // ── L2 + L3: aggregate capabilityProfile by domain ──
  const profiles = (Array.isArray(capabilityProfiles) ? capabilityProfiles : [])
    .filter(p => p && p.userId === userId && p.dimensions);
  if (profiles.length > 0) {
    const l2Domains = [];
    const l3Domains = [];
    for (const p of profiles) {
      const domain = clean(p.domain) || "general";
      const dims = p.dimensions;
      const dimEntries = Object.entries(dims).filter(([, v]) => v && typeof v === "object");
      if (dimEntries.length === 0) continue;
      const scores = dimEntries.map(([, v]) => Number(v.score) || 0);
      const overallScore = scores.length > 0
        ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
        : 0;
      const stableCount = dimEntries.filter(([, v]) => v.stability === "stable").length;
      const verifiedEvidenceCount = dimEntries
        .flatMap(([, v]) => Array.isArray(v.evidence) ? v.evidence : [])
        .filter(e => e?.source === "user_verified").length;
      l2Domains.push({
        domain,
        overallScore,
        stability: stableCount >= dimEntries.length / 2 ? "stable" : "one_shot",
        userVerifiedEvidenceCount: verifiedEvidenceCount,
        updatedAt: p.updatedAt || null
      });
      const l3Dims = {};
      for (const [dim, v] of dimEntries) {
        l3Dims[dim] = {
          score: Number(v.score) || 0,
          level: clean(v.level) || "L1",
          stability: v.stability === "stable" ? "stable" : "one_shot",
          evidenceCount: Array.isArray(v.evidence) ? v.evidence.length : 0
        };
      }
      l3Domains.push({ domain, dimensions: l3Dims, updatedAt: p.updatedAt || null });
    }
    snapshot.layers.L2_domain = {
      available: l2Domains.length > 0,
      domains: l2Domains
    };
    snapshot.layers.L3_knowledge_points = {
      available: l3Domains.length > 0,
      domains: l3Domains
    };
  }

  return snapshot;
}

/**
 * Format the prior profile as a concise hint for Step A. Emphasizes that
 * material evidence overrides prior, and that the three layers have different
 * transferability.
 */
function formatPriorProfileHint(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== "capability_snapshot_v1") return "";
  const lines = [];
  const l1 = snapshot.layers?.L1_ai_collaboration;
  const l2 = snapshot.layers?.L2_domain;
  const l3 = snapshot.layers?.L3_knowledge_points;
  const hasAny = (l1?.available) || (l2?.available) || (l3?.available);
  if (!hasAny) return "";
  lines.push("【用户历史能力先验（三层模型，PRIOR，不可覆盖本次材料证据）】");
  lines.push("规则：本次材料证据优先；先验仅作参考。L1 可跨领域迁移；L2 仅限本领域；L3 是具体知识点。one_shot=弱先验，stable=强先验。");
  if (l1?.available) {
    const dimLines = Object.entries(l1.dimensions || {}).map(([dim, v]) =>
      `${dim}: ${v.inferredLevel} (evidenceStatus常见=${v.commonEvidenceStatus}, 平均置信度=${v.avgConfidence}, 观察次数=${v.observationCount})`);
    lines.push(`L1 通用AI协作能力（来自${l1.reportCount}份历史报告，${l1.note}）：`);
    lines.push(...dimLines.map(s => "  " + s));
  }
  if (l2?.available) {
    const domLines = (l2.domains || []).map(d =>
      `${d.domain}: 总分${d.overallScore} (${d.stability}, user_verified证据${d.userVerifiedEvidenceCount}条)`);
    lines.push("L2 领域能力（不跨领域推断）：");
    lines.push(...domLines.map(s => "  " + s));
  }
  if (l3?.available) {
    lines.push("L3 具体知识点（费曼卡片训练层，按领域分桶）：");
    for (const d of (l3.domains || [])) {
      const dimLines = Object.entries(d.dimensions || {}).map(([dim, v]) =>
        `${dim}: ${v.score}/${v.level} (${v.stability}, 证据${v.evidenceCount}条)`);
      lines.push(`  [${d.domain}] ` + dimLines.join("; "));
    }
  }
  lines.push("使用方式：L1帮助判断该检查什么、卡片多难；L2帮助判断用户缺的是AI协作还是领域知识；L3帮助定位具体知识点深度。");
  return lines.join("\n");
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
  "4. 教学方式必须匹配材料已经证明的用户背景与当前水平；可使用系统图、流程、类比、场景预测、决策比较等形式。类比必须准确，不得为了通俗而失真。",
  "5. 已解决的具体问题（已识别+已处理+已验证）不得写成未解决问题；把它转化为用户尚未解释的决策、验证债务或训练材料。",
  "6. 教师表达：不羞辱用户。强调“当前材料尚未证明”而不是“用户不懂”。先肯定已具备的能力，再指出下一个成长点。",
  "7. 只返回合法 JSON，不要 Markdown、解释或额外文字。",
  "8. 用户载荷含 outputLanguage 时，所有面向用户的分析必须使用该语言；原始证据引用保留原文。未指定时才跟随原文语言。"
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
  "- 卡片测的是心智模型，不是术语记忆：让用户画系统图/数据流、打类比、做场景预测、解释决策、比较方案、设计验证。",
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
  '{"feynmanCards":[{"id":"card-1","target":"缺口标题或 dangerousGap-1","cardType":"system_map","prompt":"费曼式问题",',
  '"targetLevel":"L2","difficulty":"foundation|intermediate|advanced","evaluationCriteria":["什么算答对"],',
  '"userAnswer":"","aiFollowUp":"","answeredAt":null}],',
  '"nextActions":[{"item":"","route":"verify|note|task|ask","reason":"","relatedCapability":""}]}',
  "",
  "Step D 自检清单：卡片测系统理解而非术语；每张卡映射一个缺口；身份中立且难度匹配；",
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
 * @param {object|null} [options.priorProfile] - Three-layer capability snapshot from
 *   buildCapabilitySnapshot(). Used as a PRIOR for Step A; material evidence always
 *   overrides it. When null/absent (cold start), behavior is unchanged.
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
  const priorProfile = options.priorProfile && options.priorProfile.schemaVersion === "capability_snapshot_v1"
    ? options.priorProfile
    : null;
  const priorProfileHint = formatPriorProfileHint(priorProfile);

  function fallbackReport(error, failedStep) {
    const report = generateFallbackReport(text, type);
    report.locale = options.locale === "en" ? "en" : "zh-CN";
    report.display = deriveReportDisplay({ ...report, display: null });
    report.input.preprocess = preprocess;
    report.input.confusions = confusions;
    if (priorProfile) report.priorProfile = priorProfile;
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
    const stepAHintParts = [
      "分析这份材料中的认知债务：先归因，再校准能力。",
      "Capability signals detected: " + (detectCapabilitySignals(text).join(" ") || "none auto-detected; infer from content."),
      preprocess?.didCompress
        ? `Input strategy: ${preprocess.strategy}. Treat this as a balanced evidence digest from a larger artifact, not the full chronological transcript.`
        : "Input strategy: plain text."
    ];
    if (priorProfileHint) {
      stepAHintParts.push(priorProfileHint);
    }
    const stepA = validateStepA(await callStep(chatFn, stepASystemPrompt, {
      artifactText: text,
      artifactType: type,
      outputLanguage,
      charCount: clean(text).length,
      preprocess,
      hint: stepAHintParts.join(" ")
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
      dangerousGaps: stepB.dangerousGaps,
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
    if (priorProfile) report.priorProfile = priorProfile;

    return withGenerationStatus(report, false);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fallbackReport(message, currentStep);
  }
}
