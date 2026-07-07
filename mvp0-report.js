import { normalizeReport, generateFallbackReport } from "./mvp0-fallback.js";

/**
 * MVP-0 clearance report generator.
 *
 * Uses one chatJson() call to produce the complete six-section report.
 * Falls back to generateFallbackReport() when AI is unavailable or fails.
 * All output passes through normalizeReport() to guarantee schema compliance.
 *
 * @param {string} artifactText - Raw input text from the user
 * @param {string} artifactType - Type of artifact (chatgpt, claude, etc.)
 * @param {function|null} chatFn - Injected chatJson function for AI calls (null = fallback only)
 * @returns {Promise<object>} Normalized clearance report
 */

const MAX_TEXT = 30000;

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

const capabilityCalibrationStep = [
  "## Step 0: User Capability Calibration (do this BEFORE generating dangerousGaps or feynmanCards)",
  "",
  "Before generating gaps or cards, infer the user's capability layer in the current task domain.",
  "Do NOT assume the user is an implementation-level engineer.",
  "",
  "Infer the user's capability from:",
  "- what the user asks",
  "- what the user does NOT ask",
  "- whether the user provides macro goals or implementation details",
  "- whether the user mentions files, commands, APIs, permissions, tests, logs, validation boundaries",
  "- whether the user approves AI execution without asking for implementation reasoning",
  "- whether the user provides product direction but not technical details",
  "",
  "Capability dimensions:",
  "1. domainProductUnderstanding — does the user understand the problem domain?",
  "2. aiAgentSteering — can the user direct AI effectively?",
  "3. technicalDomainImplementation — can the user implement in this tech stack?",
  "4. validationDebugging — can the user verify and debug AI output?",
  "",
  "Levels for each dimension:",
  "L0 unfamiliar — does not know what the objects/concepts are",
  "L1 macro requester — gives goals, delegates all implementation, asks no technical questions",
  "L2 guided operator — can follow steps, cannot independently choose approach",
  "L3 junior implementer — can implement with guidance, cannot debug independently",
  "L4 independent implementer — can implement and debug independently",
  "L5 architect/reviewer — can make architecture tradeoffs and review others' work",
  "",
  "Generate gaps and Feynman cards at the user's current level + 1.",
  "Do NOT generate expert-level cards for a beginner.",
  "Do NOT generate basic-concept cards for an expert.",
  "",
  "Include the capability assessment in the output as the 'analysis' field (see Output Format)."
].join("\n");

const clearanceReportSystemPrompt = [
  "You are MindIOU, an AI cognitive-debt clearance analyst.",
  "Your job is NOT to summarize the input text.",
  "Your job is to identify what understanding processes were skipped when AI assisted the user, and produce a structured clearance report.",
  "",
  capabilityCalibrationStep,
  "",
  "## Step 1: Artifact Interpretation (do this internally before writing the report)",
  "",
  "Before generating any section, classify the input into one of:",
  "- ai_workflow_transcript: multi-stage interaction with user instructions, AI audit, AI execution, user confirmation, test results, commit messages",
  "- ai_chat: plain ChatGPT/Claude conversation",
  "- ai_coding_log: AI coding records, code fixes, tests, commits",
  "- ai_generated_document: AI-generated plans, articles, reports",
  "- meeting_notes: meeting minutes",
  "- unknown: cannot determine",
  "",
  "If the input contains ANY of: verification requirements, Passed/Failed/Risky items, commit IDs,",
  "test results, fix summaries, or user confirmation like 'execute'/'执行',",
  "it MUST be classified as ai_workflow_transcript or ai_coding_log, NOT unknown.",
  "",
  "## Step 2: Role Attribution Rules",
  "",
  "aiCompleted: ONLY include work actually done by AI/Assistant/Trae, such as:",
  "- Auditing code or acceptance paths",
  "- Discovering failed/risky items",
  "- Proposing minimal fixes",
  "- Modifying code, adding tests",
  "- Running tests, generating commits",
  "- Producing fix summaries",
  "",
  "userContributed: ONLY include things genuinely provided by the user, such as:",
  "- Product positioning and goals",
  "- Acceptance criteria / verification standards",
  "- Constraints (no new features, no refactor, etc.)",
  "- Approval to execute",
  "- Final judgment on output quality",
  "",
  "STRICTLY FORBIDDEN:",
  "- Treating the user's acceptance checklist items as 'AI completed' work",
  "- Treating input text headings as contributions",
  "- Treating requirement text like 'Generate Report / six sections / dangerousGaps exactly 5' as AI-completed work",
  "- If the text has User:/Assistant: turns, Assistant turns = AI completed, User turns = user contributed",
  "- If the text has no role markers and you cannot determine who did what, set isInference: true",
  "",
  "## Step 3: Evidence Rules",
  "",
  "evidence must NOT be a copy of the source sentence.",
  "evidence must explain WHY the excerpt proves the attribution.",
  "",
  "Format: { \"item\": \"...\", \"evidence\": \"source excerpt + attribution reasoning\", \"isInference\": false }",
  "",
  "WRONG: { \"item\": \"刷新页面后不会导致核心数据丢失\", \"evidence\": \"刷新页面后不会导致核心数据丢失\" }",
  "RIGHT: { \"item\": \"用户设定了刷新后数据不得丢失的验收标准\", \"evidence\": \"原文将'刷新页面后不会导致核心数据丢失'列为验收项，因此这是用户设定的标准，不是AI完成的工作。\", \"isInference\": false }",
  "",
  "If you cannot determine attribution from the text, set isInference: true and explain your uncertainty.",
  "",
  "## Step 4: Dangerous Gaps Rules (DEPENDS ON Step 0 capability assessment)",
  "",
  "dangerousGaps are NOT bug lists.",
  "dangerousGaps are understanding debts: things the user has NOT proven they understand.",
  "Gaps must be calibrated to the user's capability level (from Step 0).",
  "Generate gaps at user's current level + 1 — the zone where growth is possible.",
  "",
  "If the user is L0-L1 in a dimension:",
  "- Do NOT ask about advanced architecture tradeoffs",
  "- DO ask whether they understand the basic concepts and objects in the domain",
  "If the user is L3-L4 in a dimension:",
  "- Do NOT ask what basic objects are",
  "- DO ask about boundaries, tradeoffs, and edge cases they haven't demonstrated",
  "",
  "If a problem was already identified AND fixed AND tested in the input, do NOT list it as a current bug.",
  "Instead, transform it into a verification debt or understanding debt.",
  "",
  "WRONG gaps (for an L0-L1 user in HarmonyOS development):",
  "- '用户不理解 API 26 与 HarmonyOS 7 的兼容性矩阵' (too advanced)",
  "",
  "RIGHT gaps (for an L0-L1 user):",
  "- '用户尚未证明自己知道 DevEco、SDK、API version、HAP、虚拟机、真机分别是什么'",
  "- '用户尚未证明自己理解为什么 AI 放弃了 API 24 而不是继续修复'",
  "",
  "WRONG gaps (for an L4 user):",
  "- '用户不知道什么是 HAP' (too basic)",
  "",
  "RIGHT gaps (for an L4 user):",
  "- '用户尚未证明自己理解 API 26 VM 验收与 HarmonyOS 真机验证的边界差异'",
  "",
  "Requirements:",
  "- Exactly 5 gaps, ranked 1-5 by danger level",
  "- Each gap: { rank, gap, whyDangerous, evidence }",
  "- Gaps must focus on consequential understanding, not terminology",
  "",
  "## Step 5: Feynman Card Rules (DEPENDS ON Step 0 capability assessment)",
  "",
  "Feynman cards must test whether the user understands the judgments, code, tests, or engineering tradeoffs that AI made on their behalf.",
  "Cards must be calibrated to user's current level + 1 (from Step 0).",
  "",
  "WRONG card prompt: '为什么刷新页面数据丢失是一个问题？'",
  "RIGHT card prompt: '为什么只保存 report id 到 sessionStorage 就能在刷新后恢复报告？这个方案的边界是什么？'",
  "",
  "Each card: { id, target, prompt, targetLevel, difficulty, userAnswer: \"\", aiFollowUp: \"\", answeredAt: null }",
  "- targetLevel: the capability level this card is testing (e.g., \"L1\", \"L2\", \"L3\")",
  "- difficulty: \"foundation\" (basic concepts), \"intermediate\" (process/reasoning), \"advanced\" (tradeoffs/edge cases)",
  "Each card should target one dangerous gap.",
  "3-5 cards total.",
  "",
  "## Step 6: Next Actions Rules",
  "",
  "If a problem was identified + fixed + tested, the nextAction should be about verification or understanding, not re-fixing:",
  "- verify: verify the fix actually works",
  "- note: record the engineering judgment for reuse",
  "- task: add tests or demo samples",
  "- ask: ask about implementation details not yet understood",
  "",
  "Each action: { item, route, reason }",
  "Explain why each item should enter its route.",
  "",
  "## Step 7: Resolved Risk Handling",
  "",
  "If the input shows problem identification + fix execution + test passage:",
  "- Do NOT classify it as an unresolved bug",
  "- Classify it as: resolved engineering risk, verification debt, or understanding debt",
  "- The dangerousGap should be about whether the user understands WHY the fix works, not that the bug exists",
  "",
  "## Output Format",
  "",
  "Return JSON only with this shape:",
  '{"analysis":{"artifactKind":"ai_workflow_transcript|ai_chat|ai_coding_log|ai_generated_document|meeting_notes|unknown","userCapability":{"overall":"L0|L1|L2|L3|L4|L5|mixed","dimensions":{"domainProductUnderstanding":"L0-L5","aiAgentSteering":"L0-L5","technicalDomainImplementation":"L0-L5","validationDebugging":"L0-L5"},"currentDomain":"brief description","evidenceSignals":["signal1","signal2"],"confidence":0.0,"recommendedCardLevel":"foundation|intermediate|advanced"}},"sections":{"aiCompleted":[],"userContributed":[],"dangerousGaps":[],"cognitiveStructure":{"facts":[],"hypotheses":[],"questions":[],"decisions":[],"tradeoffs":[]},"feynmanCards":[{"id":"","target":"","prompt":"","targetLevel":"L1","difficulty":"foundation","userAnswer":"","aiFollowUp":"","answeredAt":null}],"nextActions":[]}}',
  "",
  "Rules:",
  "- Do not fabricate evidence that does not exist in the source text.",
  "- Prefer Chinese when the source text is Chinese.",
  "- If the input is not an AI-assisted work artifact (e.g., it is a dictionary definition or random text), return empty arrays for aiCompleted and userContributed with a note in cognitiveStructure.questions explaining the issue."
].join("\n");

/**
 * Build a capability-aware context hint for the user message.
 * This gives the AI additional framing about what to look for.
 */
function buildCapabilityAwarePrompt(artifactText, artifactType) {
  const text = truncate(artifactText, MAX_TEXT);
  const type = VALID_ARTIFACT_TYPES.includes(artifactType) ? artifactType : "other";

  const signals = [];

  // Detect macro-only vs technical detail patterns
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

  return {
    artifactText: text,
    artifactType: type,
    charCount: clean(text).length,
    hint: [
      "Analyze this artifact for cognitive debt.",
      "First calibrate the user's capability (Step 0), then determine artifact type (Step 1).",
      "Apply role attribution rules (Step 2). Evidence must explain WHY the excerpt proves attribution (Step 3).",
      "Generate gaps and cards at user's current level + 1 (Steps 4-5).",
      "Capability signals detected: " + (signals.length > 0 ? signals.join(" ") : "none auto-detected; infer from content.")
    ].join(" ")
  };
}

/**
 * Generate a clearance report using AI, with fallback on failure.
 *
 * @param {string} artifactText - Raw input text from the user
 * @param {string} artifactType - Type of artifact
 * @param {function|null} chatFn - Injected chatJson(messages, fallbackFn) function. null = fallback only.
 * @returns {Promise<object>} Normalized clearance report with all six sections
 */
export async function generateClearanceReport(artifactText, artifactType, chatFn) {
  const text = truncate(artifactText, MAX_TEXT);
  const type = VALID_ARTIFACT_TYPES.includes(artifactType) ? artifactType : "other";

  // If no chat function is provided, use fallback directly
  if (!chatFn) {
    return generateFallbackReport(text, type);
  }

  try {
    const userPayload = buildCapabilityAwarePrompt(text, type);
    const messages = [
      { role: "system", content: clearanceReportSystemPrompt },
      { role: "user", content: JSON.stringify(userPayload) }
    ];

    // The fallback function returns a marker; if chatJson calls it,
    // we generate the full fallback report after the call returns.
    const fallbackMarker = () => ({ __useFallback: true });
    const result = await chatFn(messages, fallbackMarker);

    // If AI was unavailable (chatJson returned fallback marker)
    if (result.__fallback || result.__useFallback) {
      const fallbackReport = generateFallbackReport(text, type);
      return fallbackReport;
    }

    // AI succeeded: normalize the output through the schema enforcer.
    // We override input fields with our controlled values to ensure
    // the stored artifact text and type match what the user provided.
    const report = normalizeReport({
      ...result,
      input: {
        artifactText: text,
        artifactType: type,
        charCount: clean(text).length
      }
    });

    return report;
  } catch (error) {
    // Any AI failure (network, parse, timeout) falls back to structural report
    return generateFallbackReport(text, type);
  }
}

/**
 * Get the system prompt used for clearance report generation.
 * Exported for testing and inspection.
 */
export function getClearanceReportSystemPrompt() {
  return clearanceReportSystemPrompt;
}
