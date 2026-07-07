import crypto from "node:crypto";

/**
 * MVP-0 fallback report generator and normalization.
 * Used when AI is unavailable. Produces a schema-valid clearance report
 * with visibly degraded quality (all items marked as inference).
 *
 * No OpenAI calls. No UI. No server endpoints.
 */

const VALID_ROUTES = ["verify", "note", "task", "ask"];
const VALID_STATUSES = ["generated", "interacted", "corrected"];
const VALID_ARTIFACT_TYPES = [
  "chatgpt", "claude", "cursor", "codex", "hackathon", "meeting", "article", "other"
];
const MAX_TEXT = 30000;
const TARGET_GAPS = 5;
const MIN_CARDS = 3;
const MAX_CARDS = 5;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? text.slice(0, max) : text;
}

function uuid() {
  return crypto.randomUUID();
}

function splitIntoSentences(text) {
  const trimmed = clean(text);
  if (!trimmed) return [];
  const rough = trimmed.split(/(?<=[.!?。！？\n])\s+/);
  return rough
    .map(s => clean(s))
    .filter(s => s.length > 10);
}

function splitIntoChunks(text, count) {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return [];
  if (sentences.length <= count) return sentences;
  const chunkSize = Math.ceil(sentences.length / count);
  const chunks = [];
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, sentences.length);
    const chunk = sentences.slice(start, end).join(" ");
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function extractFirstSentence(text) {
  const sentences = splitIntoSentences(text);
  return sentences[0] || truncate(text, 80);
}

function makeInferenceItem(item, evidence) {
  return {
    item: truncate(item, 500),
    evidence: truncate(evidence, 300),
    isInference: true
  };
}

function makeGap(rank, text) {
  const excerpt = truncate(text, 150);
  return {
    rank,
    gap: excerpt || `Understanding gap ${rank}`,
    whyDangerous: "AI unavailable; cannot assess danger. Manual review required.",
    evidence: "inference"
  };
}

function makeCard(id, target, prompt) {
  return {
    id,
    target: truncate(target, 150),
    prompt: truncate(prompt, 300),
    targetLevel: "L1",
    difficulty: "foundation",
    userAnswer: "",
    aiFollowUp: "",
    answeredAt: null
  };
}

function makeAction(item, route, reason) {
  return {
    item: truncate(item, 500),
    route: VALID_ROUTES.includes(route) ? route : "task",
    reason: truncate(reason, 300)
  };
}

/**
 * Normalize any report-like object into a schema-valid clearance report.
 * Fills missing fields, enforces constraints, and labels inferences.
 *
 * @param {object} raw - Partial report object (may be from AI or fallback)
 * @returns {object} Normalized report matching the MVP-0 schema
 */
export function normalizeReport(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("normalizeReport requires a report object");
  }

  const now = new Date().toISOString();
  const sections = raw.sections || {};

  // Normalize each section array
  function normalizeItemArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(item => {
      if (typeof item !== "object" || item === null) {
        return makeInferenceItem(String(item), "inference");
      }
      const hasEvidence = Boolean(item.evidence);
      const isDirectQuote = hasEvidence && (
        item.evidence.startsWith('"') ||
        item.evidence.startsWith("'") ||
        item.evidence.length > 20
      );
      return {
        item: truncate(item.item, 500),
        evidence: truncate(item.evidence || "", 300),
        isInference: item.isInference !== undefined
          ? Boolean(item.isInference)
          : !isDirectQuote
      };
    });
  }

  function normalizeGapArray(arr) {
    if (!Array.isArray(arr)) arr = [];
    const gaps = arr
      .map((gap, idx) => {
        if (typeof gap !== "object" || gap === null) {
          return makeGap(idx + 1, String(gap));
        }
        return {
          rank: Number(gap.rank) || (idx + 1),
          gap: truncate(gap.gap, 500),
          whyDangerous: truncate(gap.whyDangerous || "Manual review required.", 300),
          evidence: truncate(gap.evidence || "inference", 300)
        };
      })
      .sort((a, b) => a.rank - b.rank);
    // Enforce exactly TARGET_GAPS (5)
    while (gaps.length < TARGET_GAPS) {
      gaps.push(makeGap(gaps.length + 1, "Manual review required"));
    }
    return gaps.slice(0, TARGET_GAPS);
  }

  function normalizeCognitiveStructure(cs) {
    const structure = cs || {};
    return {
      facts: normalizeItemArray(structure.facts),
      hypotheses: normalizeItemArray(structure.hypotheses),
      questions: normalizeItemArray(structure.questions),
      decisions: normalizeItemArray(structure.decisions),
      tradeoffs: normalizeItemArray(structure.tradeoffs)
    };
  }

  function normalizeCardArray(arr) {
    if (!Array.isArray(arr)) arr = [];
    const validLevels = ["L0", "L1", "L2", "L3", "L4", "L5"];
    const validDifficulties = ["foundation", "intermediate", "advanced"];
    const cards = arr.map(card => {
      if (typeof card !== "object" || card === null) {
        return makeCard(uuid(), "unknown", String(card));
      }
      return {
        id: clean(card.id || uuid()).slice(0, 100),
        target: truncate(card.target, 150),
        prompt: truncate(card.prompt, 300),
        targetLevel: validLevels.includes(card.targetLevel) ? card.targetLevel : "L1",
        difficulty: validDifficulties.includes(card.difficulty) ? card.difficulty : "foundation",
        userAnswer: truncate(card.userAnswer, 2000),
        aiFollowUp: truncate(card.aiFollowUp, 500),
        answeredAt: card.answeredAt || null
      };
    });
    // Enforce 3-5 cards
    while (cards.length < MIN_CARDS) {
      cards.push(makeCard(
        uuid(),
        `Topic ${cards.length + 1}`,
        "Explain in your own words: what did you understand from this section?"
      ));
    }
    return cards.slice(0, MAX_CARDS);
  }

  function normalizeActionArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(action => {
      if (typeof action !== "object" || action === null) {
        return makeAction(String(action), "task", "AI unavailable; manual review required.");
      }
      return makeAction(action.item, action.route, action.reason);
    });
  }

  function normalizeAnalysis(raw) {
    if (typeof raw !== "object" || raw === null) {
      return {
        artifactKind: "unknown",
        userCapability: {
          overall: "mixed",
          dimensions: {
            domainProductUnderstanding: "L1",
            aiAgentSteering: "L1",
            technicalDomainImplementation: "L1",
            validationDebugging: "L1"
          },
          currentDomain: "unknown",
          evidenceSignals: [],
          confidence: 0,
          recommendedCardLevel: "foundation"
        }
      };
    }
    const validKinds = [
      "ai_workflow_transcript", "ai_chat", "ai_coding_log",
      "ai_generated_document", "meeting_notes", "unknown"
    ];
    const validLevels = ["L0", "L1", "L2", "L3", "L4", "L5", "mixed"];
    const validCardLevels = ["foundation", "intermediate", "advanced"];
    const rawCap = raw.userCapability || {};
    const rawDims = rawCap.dimensions || {};
    return {
      artifactKind: validKinds.includes(raw.artifactKind) ? raw.artifactKind : "unknown",
      userCapability: {
        overall: validLevels.includes(rawCap.overall) ? rawCap.overall : "mixed",
        dimensions: {
          domainProductUnderstanding: validLevels.includes(rawDims.domainProductUnderstanding)
            ? rawDims.domainProductUnderstanding : "L1",
          aiAgentSteering: validLevels.includes(rawDims.aiAgentSteering)
            ? rawDims.aiAgentSteering : "L1",
          technicalDomainImplementation: validLevels.includes(rawDims.technicalDomainImplementation)
            ? rawDims.technicalDomainImplementation : "L1",
          validationDebugging: validLevels.includes(rawDims.validationDebugging)
            ? rawDims.validationDebugging : "L1"
        },
        currentDomain: truncate(rawCap.currentDomain || "unknown", 100),
        evidenceSignals: Array.isArray(rawCap.evidenceSignals)
          ? rawCap.evidenceSignals.slice(0, 10).map(s => truncate(s, 300))
          : [],
        confidence: Math.max(0, Math.min(1, Number(rawCap.confidence) || 0)),
        recommendedCardLevel: validCardLevels.includes(rawCap.recommendedCardLevel)
          ? rawCap.recommendedCardLevel : "foundation"
      }
    };
  }

  const normalized = {
    id: clean(raw.id || uuid()).slice(0, 100),
    createdAt: raw.createdAt || now,
    input: {
      artifactText: truncate(raw.input?.artifactText, MAX_TEXT),
      artifactType: VALID_ARTIFACT_TYPES.includes(raw.input?.artifactType)
        ? raw.input.artifactType
        : "other",
      charCount: Number(raw.input?.charCount) || (raw.input?.artifactText ? clean(raw.input.artifactText).length : 0)
    },
    analysis: normalizeAnalysis(raw.analysis),
    sections: {
      aiCompleted: normalizeItemArray(sections.aiCompleted),
      userContributed: normalizeItemArray(sections.userContributed),
      dangerousGaps: normalizeGapArray(sections.dangerousGaps),
      cognitiveStructure: normalizeCognitiveStructure(sections.cognitiveStructure),
      feynmanCards: normalizeCardArray(sections.feynmanCards),
      nextActions: normalizeActionArray(sections.nextActions)
    },
    corrections: Array.isArray(raw.corrections)
      ? raw.corrections.map(c => ({
          id: clean(c.id || uuid()).slice(0, 100),
          target: clean(c.target || "attribution").slice(0, 30),
          targetId: clean(c.targetId || "").slice(0, 100),
          originalValue: truncate(c.originalValue, 500),
          correctedValue: truncate(c.correctedValue, 500),
          reason: truncate(c.reason, 300),
          correctedAt: c.correctedAt || now
        }))
      : [],
    status: VALID_STATUSES.includes(raw.status) ? raw.status : "generated"
  };

  return normalized;
}

/**
 * Generate a fallback clearance report when AI is unavailable.
 *
 * Strategy:
 * - Split text into rough chunks by sentence boundaries
 * - Use chunks to populate aiCompleted and userContributed as inference-only
 * - Generate exactly 5 dangerousGaps from sentence excerpts
 * - Generate 3-5 feynmanCards from first sentences
 * - All nextActions default to "task" with AI-unavailable reason
 *
 * @param {string} artifactText - Raw input text from the user
 * @param {string} artifactType - Type of artifact (chatgpt, claude, etc.)
 * @returns {object} Schema-valid clearance report with degraded quality
 */
export function generateFallbackReport(artifactText, artifactType) {
  const text = truncate(artifactText, MAX_TEXT);
  const type = VALID_ARTIFACT_TYPES.includes(artifactType) ? artifactType : "other";
  const sentences = splitIntoSentences(text);
  const chunks = splitIntoChunks(text, 5);
  const cardSources = sentences.length >= 3 ? sentences.slice(0, 5) : chunks;

  // AI completed: extract rough items from text chunks, all inference
  const aiCompleted = chunks.map(chunk =>
    makeInferenceItem(
      extractFirstSentence(chunk),
      "Extracted from artifact text; AI analysis unavailable"
    )
  );
  // Ensure at least one entry
  if (aiCompleted.length === 0) {
    aiCompleted.push(makeInferenceItem(
      "Unable to analyze artifact; AI unavailable",
      "inference"
    ));
  }

  // User contributed: also inference, placeholder
  const userContributed = [
    makeInferenceItem(
      "Unable to separate user contributions; AI unavailable",
      "inference"
    )
  ];

  // Dangerous gaps: exactly 5
  const dangerousGaps = [];
  for (let i = 0; i < TARGET_GAPS; i++) {
    const source = sentences[i] || chunks[i] || `Section ${i + 1}`;
    dangerousGaps.push(makeGap(i + 1, source));
  }

  // Cognitive structure: all empty arrays, structural shell
  const cognitiveStructure = {
    facts: [],
    hypotheses: [],
    questions: [],
    decisions: [],
    tradeoffs: []
  };

  // Feynman cards: 3-5 cards from first sentences
  const cardCount = Math.min(Math.max(cardSources.length, MIN_CARDS), MAX_CARDS);
  const feynmanCards = [];
  for (let i = 0; i < cardCount; i++) {
    const source = cardSources[i] || `Topic ${i + 1}`;
    const firstSentence = extractFirstSentence(source);
    feynmanCards.push(makeCard(
      uuid(),
      truncate(firstSentence, 150),
      `Explain in your own words: ${truncate(firstSentence, 200)}`
    ));
  }
  // Pad to minimum 3 if we have too few sources
  while (feynmanCards.length < MIN_CARDS) {
    feynmanCards.push(makeCard(
      uuid(),
      `Topic ${feynmanCards.length + 1}`,
      `Explain in your own words: what did you understand from this section?`
    ));
  }

  // Next actions: all routed to task
  const nextActions = [
    makeAction(
      "Review AI-completed items and identify which were actually AI-suggested",
      "task",
      "AI unavailable; manual review required to verify attributions"
    ),
    makeAction(
      "Review dangerous gaps and prioritize which to address first",
      "task",
      "AI unavailable; manual review required to assess gap severity"
    ),
    makeAction(
      "Answer Feynman cards to test your understanding",
      "task",
      "AI unavailable; cards generated from text structure, not deep analysis"
    ),
    makeAction(
      "Check original artifact for facts vs AI inferences",
      "verify",
      "AI unavailable; manual verification needed since all items are marked as inference"
    )
  ];

  const report = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    input: {
      artifactText: text,
      artifactType: type,
      charCount: clean(text).length
    },
    sections: {
      aiCompleted,
      userContributed,
      dangerousGaps,
      cognitiveStructure,
      feynmanCards,
      nextActions
    },
    corrections: [],
    status: "generated"
  };

  // Run through normalization to guarantee schema compliance
  return normalizeReport(report);
}
