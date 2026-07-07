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

const clearanceReportSystemPrompt = [
  "You are MindIOU, an AI cognitive-debt clearance analyst.",
  "Your job is NOT to summarize the input text.",
  "Your job is to identify what understanding processes were skipped when AI assisted the user, and produce a structured clearance report.",
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
  "## Step 4: Dangerous Gaps Rules",
  "",
  "dangerousGaps are NOT bug lists.",
  "dangerousGaps are understanding debts: things the user has NOT proven they understand.",
  "",
  "If a problem was already identified AND fixed AND tested in the input, do NOT list it as a current bug.",
  "Instead, transform it into a verification debt or understanding debt.",
  "",
  "WRONG gaps:",
  "- '刷新页面后数据丢失' (this was already fixed)",
  "- 'API跨端口问题' (this was already fixed)",
  "",
  "RIGHT gaps:",
  "- '用户尚未证明自己理解 sessionStorage + report id 恢复机制的边界'",
  "- '用户尚未证明自己理解为什么 normalization 不能只靠 prompt'",
  "- '用户尚未证明自己理解 fallback report 和 real AI report 的区别'",
  "- '用户尚未证明自己理解 Vite proxy 只解决开发环境问题'",
  "- '用户尚未证明自己理解测试全绿不等于产品语义正确'",
  "",
  "Requirements:",
  "- Exactly 5 gaps, ranked 1-5 by danger level",
  "- Each gap: { rank, gap, whyDangerous, evidence }",
  "- Gaps must focus on consequential understanding, not terminology",
  "",
  "## Step 5: Feynman Card Rules",
  "",
  "Feynman cards must test whether the user understands the judgments, code, tests, or engineering tradeoffs that AI made on their behalf.",
  "",
  "WRONG card prompt: '为什么刷新页面数据丢失是一个问题？'",
  "RIGHT card prompt: '为什么只保存 report id 到 sessionStorage 就能在刷新后恢复报告？这个方案的边界是什么？'",
  "",
  "Each card: { id, target, prompt, userAnswer: \"\", aiFollowUp: \"\", answeredAt: null }",
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
  '{"sections":{"aiCompleted":[],"userContributed":[],"dangerousGaps":[],"cognitiveStructure":{"facts":[],"hypotheses":[],"questions":[],"decisions":[],"tradeoffs":[]},"feynmanCards":[],"nextActions":[]}}',
  "",
  "Rules:",
  "- Do not fabricate evidence that does not exist in the source text.",
  "- Prefer Chinese when the source text is Chinese.",
  "- If the input is not an AI-assisted work artifact (e.g., it is a dictionary definition or random text), return empty arrays for aiCompleted and userContributed with a note in cognitiveStructure.questions explaining the issue."
].join("\n");

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
    const messages = [
      { role: "system", content: clearanceReportSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          artifactText: text,
          artifactType: type,
          charCount: clean(text).length,
          hint: "Analyze this artifact for cognitive debt. First determine the artifact type internally, then apply role attribution rules. Remember: evidence must explain WHY the excerpt proves attribution, not just copy the source."
        })
      }
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
