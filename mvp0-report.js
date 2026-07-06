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
  "Your job is to help the user discover which understanding processes were skipped when AI assisted them.",
  "Analyze the provided AI-assisted work artifact and produce a structured clearance report.",
  "",
  "The report must contain exactly six sections:",
  "",
  "1. aiCompleted: What AI actually provided — structures, routes, judgments, assumptions, analyses, or expressions.",
  "   Each item: { item, evidence, isInference }",
  "   evidence must be a direct excerpt from the source when possible; isInference=true when no direct evidence exists.",
  "",
  "2. userContributed: What the user genuinely provided — real experience, scenarios, constraints, direction, feedback, judgments, evidence.",
  "   Each item: { item, evidence, isInference }",
  "",
  "3. dangerousGaps: Exactly 5 understanding gaps that would affect future judgment, risk control, or verification ability.",
  "   Prioritize high-risk gaps, not terminology.",
  "   Each item: { rank (1-5), gap, whyDangerous, evidence }",
  "",
  "4. cognitiveStructure: Reorganize the mixed AI conversation into a clear cognitive structure.",
  "   { facts: [{item, evidence}], hypotheses: [{item, evidence}], questions: [{item, evidence}], decisions: [{item, evidence}], tradeoffs: [{item, evidence}] }",
  "   Clearly distinguish original facts from AI inferences.",
  "",
  "5. feynmanCards: 3-5 cards requiring the user to explain key content in their own words.",
  "   Each card targets one dangerous gap.",
  "   Each item: { id, target, prompt, userAnswer: \"\", aiFollowUp: \"\", answeredAt: null }",
  "",
  "6. nextActions: Every unresolved debt must enter one of four routes:",
  "   verify (needs official docs, reliable sources, experiments, or tests)",
  "   note (has reuse value, should be written to long-term knowledge)",
  "   task (needs concrete execution, testing, modification, or verification)",
  "   ask (needs a teacher, mentor, domain expert, or qualified person)",
  "   Each item: { item, route, reason }",
  "   Explain why each item should enter its route.",
  "",
  "Rules:",
  "- Every claim must cite relevant input evidence or be labeled as inference (isInference: true).",
  "- Do not fabricate evidence that does not exist in the source text.",
  "- Gaps must focus on consequential understanding, not low-value terminology.",
  "- Return JSON only with this shape:",
  '{"sections":{"aiCompleted":[],"userContributed":[],"dangerousGaps":[],"cognitiveStructure":{"facts":[],"hypotheses":[],"questions":[],"decisions":[],"tradeoffs":[]},"feynmanCards":[],"nextActions":[]}}',
  "- Prefer Chinese when the source text is Chinese."
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
          charCount: clean(text).length
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
