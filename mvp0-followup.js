import crypto from "node:crypto";

/**
 * MVP-0 Feynman card follow-up generator.
 *
 * When a user answers a Feynman card, this function produces one short
 * follow-up question or a sufficient summary. It uses the same chatJson()
 * pattern as tutor(), with a Feynman-specific system prompt.
 *
 * Does NOT modify the report generation prompt.
 * Does NOT touch the UI.
 */

const MAX_ANSWER = 2000;
const MAX_FOLLOWUP = 500;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? text.slice(0, max) : text;
}

const feynmanFollowUpSystemPrompt = [
  "You are MindIOU, a Feynman technique coach for cognitive-debt clearance.",
  "The user has answered a Feynman card that targets a specific understanding gap.",
  "Evaluate the answer and respond with exactly one of two outcomes:",
  "",
  "1. A short follow-up question that probes what the answer missed or left vague.",
  "   Use this when the answer is partial, surface-level, or missing a key connection.",
  "   The question must be specific to the gap, not a generic 'can you explain more?'.",
  "",
  "2. A sufficient summary that confirms the user demonstrated understanding.",
  "   Use this when the answer correctly explains the core idea in the user's own words.",
  "   Keep it to 1-2 sentences. Do not praise excessively.",
  "",
  "Rules:",
  "- Never criticize the user. If the answer is wrong, ask a guiding question.",
  "- Do not lecture. One question or one summary, not both.",
  "- Prefer Chinese when the user's answer is in Chinese.",
  "- Return JSON only:",
  '{"followUp":"","summary":"","shouldFollowUp":true}',
  "- followUp: one short question (max 200 chars). Empty when answer is sufficient.",
  "- summary: 1-2 sentence confirmation. Empty when asking a follow-up.",
  "- shouldFollowUp: true when followUp is non-empty, false when summary is used."
].join("\n");

/**
 * Fallback follow-up when AI is unavailable.
 * Produces a structural question based on the card prompt.
 */
function fallbackFollowUp(card, userAnswer) {
  const prompt = truncate(card.prompt, 200);
  const answer = truncate(userAnswer, MAX_ANSWER);
  const hasAnswer = answer.length > 5;

  if (!hasAnswer) {
    return {
      followUp: truncate(`Try answering the card prompt in your own words: ${prompt}`, 200),
      summary: "",
      shouldFollowUp: true
    };
  }

  return {
    followUp: "",
    summary: "AI evaluation unavailable. Your answer has been recorded. Review it against the card prompt to check your understanding.",
    shouldFollowUp: false
  };
}

/**
 * Normalize the AI result into a consistent shape.
 */
function normalizeFollowUpResult(input, card, userAnswer) {
  const fallback = fallbackFollowUp(card, userAnswer);

  const followUp = truncate(
    typeof input.followUp === "string" && input.followUp.trim()
      ? input.followUp
      : (typeof input.nextQuestion === "string" ? input.nextQuestion : ""),
    200
  );
  const summary = truncate(
    typeof input.summary === "string" ? input.summary : "",
    300
  );
  const shouldFollowUp = typeof input.shouldFollowUp === "boolean"
    ? input.shouldFollowUp
    : Boolean(followUp);

  // Enforce mutual exclusivity: if shouldFollowUp is true, use followUp; otherwise use summary
  if (shouldFollowUp && !followUp) {
    return fallback;
  }
  if (!shouldFollowUp && !summary) {
    return fallback;
  }

  return {
    followUp: shouldFollowUp ? followUp : "",
    summary: shouldFollowUp ? "" : summary,
    shouldFollowUp
  };
}

/**
 * Generate a Feynman card follow-up after the user answers.
 *
 * @param {object} card - The Feynman card object with at least { id, target, prompt }
 * @param {string} userAnswer - The user's answer text
 * @param {function|null} chatFn - Injected chatJson(messages, fallbackFn) for AI calls. null = fallback only.
 * @returns {Promise<object>} { followUp, summary, shouldFollowUp }
 */
export async function feynmanFollowUp(card, userAnswer, chatFn) {
  const safeCard = card || {};
  const answer = truncate(userAnswer, MAX_ANSWER);

  // If no chat function is provided, use fallback directly
  if (!chatFn) {
    return fallbackFollowUp(safeCard, answer);
  }

  try {
    const messages = [
      { role: "system", content: feynmanFollowUpSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          card: {
            id: clean(safeCard.id || "").slice(0, 100),
            target: truncate(safeCard.target, 150),
            prompt: truncate(safeCard.prompt, 300)
          },
          userAnswer: answer
        })
      }
    ];

    const fallbackFn = () => ({ __useFallback: true });
    const result = await chatFn(messages, fallbackFn);

    if (result.__fallback || result.__useFallback) {
      return fallbackFollowUp(safeCard, answer);
    }

    return normalizeFollowUpResult(result, safeCard, answer);
  } catch (error) {
    return fallbackFollowUp(safeCard, answer);
  }
}

/**
 * Get the system prompt used for Feynman follow-up.
 * Exported for testing and inspection.
 */
export function getFeynmanFollowUpSystemPrompt() {
  return feynmanFollowUpSystemPrompt;
}
