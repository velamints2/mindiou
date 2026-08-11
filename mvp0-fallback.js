import crypto from "node:crypto";
import { deriveReportDisplay } from "./report-display.js";

/**
 * MVP-0 fallback report generator and normalization.
 * Used when AI is unavailable. Produces a schema-valid clearance report
 * with visibly degraded quality (all items marked as inference).
 *
 * Schema (seven sections):
 *   aiCompleted, userContributed, cognitiveProcessesOutsourced,
 *   dangerousGaps (2-4 root-capability gaps), cognitiveStructure,
 *   feynmanCards (3-5), nextActions.
 *
 * No OpenAI calls. No UI. No server endpoints.
 */

const VALID_ROUTES = ["verify", "note", "task", "ask"];
const VALID_STATUSES = ["generated", "interacted", "corrected"];
const VALID_ARTIFACT_TYPES = [
  "chatgpt", "claude", "cursor", "codex", "hackathon", "meeting", "article", "other"
];
const VALID_CARD_TYPES = [
  "system_map", "analogy", "prediction", "decision_explanation",
  "comparison", "transfer", "validation_design"
];
const VALID_EVIDENCE_STATUSES = ["proven", "partial", "unobserved", "misconception"];
const VALID_RESEARCH_STATUSES = ["ok", "unavailable", "failed", "skipped"];
const VALID_DECISION_OWNERS = ["user", "ai", "shared", "unclear"];
const CAPABILITY_DIMENSIONS = [
  "productProblemFraming",
  "aiAgentSteering",
  "systemMentalModel",
  "technicalDecisionComprehension",
  "validationAndQualityJudgment"
];
// Legacy MVP-0 reports used four dimensions with plain string levels.
// Map them onto the new dimension keys so old reports still load and render.
const LEGACY_DIMENSION_MAP = {
  domainProductUnderstanding: "productProblemFraming",
  aiAgentSteering: "aiAgentSteering",
  technicalDomainImplementation: "technicalDecisionComprehension",
  validationDebugging: "validationAndQualityJudgment"
};
const MAX_TEXT = 30000;
const MIN_GAPS = 2;
const MAX_GAPS = 4;
const FALLBACK_GAP_COUNT = 3;
const MIN_CARDS = 3;
const MAX_CARDS = 5;
const TEXT_ONLY_INTERACTION_PATTERN = /画出|画图|绘制|手绘|流程图|系统图|数据流图|架构图|示意图|拍照|上传|图片|照片|附件|录音|音频|视频|截图|draw|sketch|diagram|flowchart|upload|photo|image|audio|video/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = clean(value);
  return text.length > max ? text.slice(0, max) : text;
}

// Web and glasses clearance currently accept text only. Keep this guard in
// normalization as a second line of defense when a model ignores the prompt.
function normalizeTextOnlyText(value, max = 500) {
  let text = truncate(value, max);
  if (!text) return "";
  text = text
    .replace(/你可以[^。！？\n]*(?:手绘|拍照|上传|图片|照片|附件)[^。！？\n]*[。！？]?/giu, "")
    .replace(/(?:请你?|请)?\s*(?:画出|画图|绘制|手绘|画一张|draw|sketch)/giu, "请用文字说明")
    .replace(/数据流图/giu, "文字数据流")
    .replace(/流程图/giu, "文字流程")
    .replace(/系统图/giu, "文字系统关系")
    .replace(/架构图/giu, "文字架构关系")
    .replace(/(?:示意图|图示|diagram|flowchart)/giu, "文字步骤与关键关系")
    .replace(/(?:拍照|上传|图片|照片|附件|录音|音频|视频|截图|upload|photo|image|audio|video)/giu, "")
    .replace(/\s+([，。！？：；])/g, "$1")
    .trim();
  return text.length >= 8 && !TEXT_ONLY_INTERACTION_PATTERN.test(text) ? text : "";
}

function normalizeTextOnlyQuestion(value, fallback = "请用自己的话说明关键步骤、判断依据和边界。") {
  const text = normalizeTextOnlyText(value, 500);
  if (!text) return fallback;
  return text.startsWith("请只用文字回答") ? text : `请只用文字回答：${text}`;
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function textArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => truncate(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
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
  const excerpt = truncate(text, 300);
  return {
    rank,
    title: "需要人工复核的理解缺口",
    gap: excerpt || `Understanding gap ${rank}: manual review required`,
    underlyingCapability: "unknown",
    surfaceSignals: excerpt ? [truncate(excerpt, 150)] : ["AI 输出缺口数量不足"],
    whyDangerous: "AI unavailable or returned too few gaps; cannot assess danger. Manual review required.",
    transferScenarios: [],
    confidence: 0,
    alternativeExplanations: ["材料可能确实只有少量高价值缺口"],
    diagnosticQuestion: "",
    masteryCriteria: []
  };
}

function makeCard(id, target, prompt) {
  return {
    id,
    target: truncate(target, 150),
    cardType: "system_map",
    prompt: truncate(prompt, 300),
    targetLevel: "L1",
    difficulty: "foundation",
    evaluationCriteria: [],
    userAnswer: "",
    aiFollowUp: "",
    answeredAt: null
  };
}

function makeAction(item, route, reason) {
  return {
    item: truncate(item, 500),
    route: VALID_ROUTES.includes(route) ? route : "task",
    reason: truncate(reason, 300),
    relatedCapability: ""
  };
}

function normalizePreprocess(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  return {
    strategy: truncate(raw.strategy || "unknown", 80),
    didCompress: Boolean(raw.didCompress),
    originalCharCount: Number(raw.originalCharCount) || 0,
    preparedCharCount: Number(raw.preparedCharCount) || 0,
    parsedEntries: Number(raw.parsedEntries) || 0,
    parseFailures: Number(raw.parseFailures) || 0
  };
}

function normalizeConfusions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map(entry => ({
    stepId: truncate(entry?.stepId, 100),
    stepTitle: truncate(entry?.stepTitle, 120),
    text: truncate(entry?.text, 1000)
  })).filter(entry => entry.text);
}

/**
 * Normalize any report-like object into a schema-valid clearance report.
 * Fills missing fields, enforces constraints, and labels inferences.
 * Tolerates legacy six-section reports (plain-string capability dimensions,
 * gaps without root-capability fields) by mapping them into the new schema.
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

  // Normalize { item, evidence, isInference } arrays
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

  function normalizeOutsourcedArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(entry => {
      if (typeof entry !== "object" || entry === null) {
        return {
          process: truncate(String(entry), 200),
          surfaceTask: "",
          whyItMatters: "",
          evidence: "",
          isInference: true
        };
      }
      return {
        process: truncate(entry.process, 200),
        surfaceTask: truncate(entry.surfaceTask, 300),
        whyItMatters: truncate(entry.whyItMatters, 300),
        evidence: truncate(entry.evidence || "", 300),
        isInference: entry.isInference !== undefined ? Boolean(entry.isInference) : true
      };
    }).filter(entry => entry.process);
  }

  function normalizeGapArray(arr) {
    if (!Array.isArray(arr)) arr = [];
    const gaps = arr
      .map((gap, idx) => {
        if (typeof gap !== "object" || gap === null) {
          return makeGap(idx + 1, String(gap));
        }
        const surfaceSignals = textArray(gap.surfaceSignals, 6, 300);
        // Legacy gaps carried a single `evidence` string; fold it into surfaceSignals.
        if (surfaceSignals.length === 0 && gap.evidence) {
          surfaceSignals.push(truncate(gap.evidence, 300));
        }
        const gapText = truncate(gap.gap, 500);
        // A root-capability gap must explain at least two surface signals;
        // otherwise lower confidence instead of padding signals.
        let confidence = clamp01(gap.confidence);
        if (surfaceSignals.length < 2) {
          confidence = Math.min(confidence, 0.5);
        }
        return {
          rank: Number(gap.rank) || (idx + 1),
          title: truncate(gap.title, 120) || truncate(gapText, 60) || `理解缺口 ${idx + 1}`,
          gap: gapText,
          underlyingCapability: truncate(gap.underlyingCapability, 200),
          surfaceSignals,
          whyDangerous: truncate(gap.whyDangerous || "Manual review required.", 300),
          transferScenarios: textArray(gap.transferScenarios, 4, 300),
          confidence,
          alternativeExplanations: textArray(gap.alternativeExplanations, 4, 300),
          diagnosticQuestion: normalizeTextOnlyQuestion(gap.diagnosticQuestion, "请用自己的话解释这个理解缺口，并说明你的判断依据。"),
          masteryCriteria: textArray(gap.masteryCriteria, 5, 300)
        };
      })
      .sort((a, b) => a.rank - b.rank);
    // Enforce 2-4 root gaps: pad with cautious manual-review gaps, truncate extras.
    while (gaps.length < MIN_GAPS) {
      gaps.push(makeGap(gaps.length + 1, "Manual review required"));
    }
    return gaps.slice(0, MAX_GAPS).map((gap, idx) => ({ ...gap, rank: idx + 1 }));
  }

  function normalizeCognitiveStructure(cs) {
    const structure = cs || {};
    return {
      facts: normalizeItemArray(structure.facts),
      hypotheses: (Array.isArray(structure.hypotheses) ? structure.hypotheses : []).map(item => {
        const base = typeof item === "object" && item !== null ? item : { item: String(item) };
        return {
          item: truncate(base.item, 500),
          evidence: truncate(base.evidence || "", 300),
          isInference: base.isInference !== undefined ? Boolean(base.isInference) : true,
          confidence: clamp01(base.confidence),
          alternativeExplanation: truncate(base.alternativeExplanation, 300)
        };
      }),
      questions: normalizeItemArray(structure.questions),
      decisions: (Array.isArray(structure.decisions) ? structure.decisions : []).map(item => {
        const base = typeof item === "object" && item !== null ? item : { item: String(item) };
        return {
          item: truncate(base.item, 500),
          evidence: truncate(base.evidence || "", 300),
          isInference: base.isInference !== undefined ? Boolean(base.isInference) : true,
          decisionOwner: VALID_DECISION_OWNERS.includes(base.decisionOwner)
            ? base.decisionOwner
            : "unclear"
        };
      }),
      tradeoffs: normalizeItemArray(structure.tradeoffs)
    };
  }

  function normalizeCardArray(arr) {
    if (!Array.isArray(arr)) arr = [];
    const validLevels = ["L0", "L1", "L2", "L3", "L4", "L5"];
    const validDifficulties = ["foundation", "intermediate", "advanced"];
    const normalizedGaps = normalizeGapArray(sections.dangerousGaps);
    function normalizeCardTarget(target) {
      const value = clean(target);
      const match = value.match(/^dangerousGap-(\d+)$/i);
      if (!match) return truncate(value, 150);
      const gap = normalizedGaps[Number(match[1]) - 1];
      return truncate(gap?.gap || value, 150);
    }
    const cards = arr.map(card => {
      if (typeof card !== "object" || card === null) {
        return makeCard(uuid(), "unknown", String(card));
      }
      return {
        id: clean(card.id || uuid()).slice(0, 100),
        target: normalizeCardTarget(card.target),
        cardType: VALID_CARD_TYPES.includes(card.cardType) ? card.cardType : "system_map",
        prompt: normalizeTextOnlyQuestion(card.prompt),
        targetLevel: validLevels.includes(card.targetLevel) ? card.targetLevel : "L1",
        difficulty: validDifficulties.includes(card.difficulty) ? card.difficulty : "foundation",
        evaluationCriteria: textArray(card.evaluationCriteria, 5, 300).map(item => normalizeTextOnlyText(item, 300) || "回答应包含关键步骤、判断依据或边界"),
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
      return {
        ...makeAction(action.item, action.route, action.reason),
        relatedCapability: truncate(action.relatedCapability, 100)
      };
    });
  }

  function normalizeDimension(rawDim) {
    const fallback = { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0 };
    if (typeof rawDim === "string") {
      // Legacy plain-string level
      const validLevels = ["L0", "L1", "L2", "L3", "L4", "L5"];
      return validLevels.includes(rawDim)
        ? { ...fallback, level: rawDim, evidenceStatus: "partial" }
        : fallback;
    }
    if (typeof rawDim !== "object" || rawDim === null) return fallback;
    const validLevels = ["L0", "L1", "L2", "L3", "L4", "L5"];
    return {
      level: validLevels.includes(rawDim.level) ? rawDim.level : "L1",
      evidenceStatus: VALID_EVIDENCE_STATUSES.includes(rawDim.evidenceStatus)
        ? rawDim.evidenceStatus
        : "unobserved",
      evidence: textArray(rawDim.evidence, 5, 300),
      confidence: clamp01(rawDim.confidence)
    };
  }

  function normalizeAnalysis(rawAnalysis) {
    const validLevels = ["L0", "L1", "L2", "L3", "L4", "L5", "mixed"];
    const validCardLevels = ["foundation", "intermediate", "advanced"];
    if (typeof rawAnalysis !== "object" || rawAnalysis === null) {
      return {
        artifactKind: "unknown",
        userCapability: {
          overall: "mixed",
          dimensions: Object.fromEntries(
            CAPABILITY_DIMENSIONS.map(dim => [dim, normalizeDimension(null)])
          ),
          currentDomain: "unknown",
          strongestDemonstratedAbility: "",
          highestPriorityGrowthArea: "",
          evidenceSignals: [],
          recommendedCardLevel: "foundation"
        }
      };
    }
    const validKinds = [
      "ai_workflow_transcript", "ai_chat", "ai_coding_log",
      "ai_generated_document", "meeting_notes", "unknown"
    ];
    const rawCap = rawAnalysis.userCapability || {};
    const rawDims = rawCap.dimensions || {};
    // Start from legacy-mapped keys, then overlay new-style keys.
    const mappedDims = {};
    for (const [legacyKey, newKey] of Object.entries(LEGACY_DIMENSION_MAP)) {
      if (rawDims[legacyKey] !== undefined && mappedDims[newKey] === undefined) {
        mappedDims[newKey] = rawDims[legacyKey];
      }
    }
    for (const dim of CAPABILITY_DIMENSIONS) {
      if (rawDims[dim] !== undefined) mappedDims[dim] = rawDims[dim];
    }
    return {
      artifactTitle: truncate(rawAnalysis.artifactTitle, 120),
      artifactKind: validKinds.includes(rawAnalysis.artifactKind) ? rawAnalysis.artifactKind : "unknown",
      userCapability: {
        overall: validLevels.includes(rawCap.overall) ? rawCap.overall : "mixed",
        dimensions: Object.fromEntries(
          CAPABILITY_DIMENSIONS.map(dim => [dim, normalizeDimension(mappedDims[dim])])
        ),
        currentDomain: truncate(rawCap.currentDomain || "unknown", 100),
        strongestDemonstratedAbility: truncate(rawCap.strongestDemonstratedAbility, 200),
        highestPriorityGrowthArea: truncate(rawCap.highestPriorityGrowthArea, 200),
        evidenceSignals: Array.isArray(rawCap.evidenceSignals)
          ? rawCap.evidenceSignals.slice(0, 10).map(s => truncate(s, 300))
          : [],
        recommendedCardLevel: validCardLevels.includes(rawCap.recommendedCardLevel)
          ? rawCap.recommendedCardLevel : "foundation"
      }
    };
  }

  function normalizeResearch(rawResearch) {
    const empty = { status: "skipped", queries: [], sources: [] };
    if (typeof rawResearch !== "object" || rawResearch === null) return empty;
    return {
      status: VALID_RESEARCH_STATUSES.includes(rawResearch.status) ? rawResearch.status : "skipped",
      queries: (Array.isArray(rawResearch.queries) ? rawResearch.queries : []).slice(0, 5).map(query => ({
        query: truncate(query?.query, 300),
        status: VALID_RESEARCH_STATUSES.includes(query?.status) ? query.status : "unavailable",
        error: truncate(query?.error || "", 300)
      })),
      sources: (Array.isArray(rawResearch.sources) ? rawResearch.sources : [])
        .slice(0, 10)
        .map(source => ({
          title: truncate(source?.title, 200),
          url: truncate(source?.url, 500),
          snippet: truncate(source?.snippet, 500)
        }))
        .filter(source => source.title || source.url)
    };
  }

  function normalizeConfusionResolutions(rawResolutions) {
    if (!Array.isArray(rawResolutions)) return [];
    return rawResolutions.slice(0, 20).map(entry => {
      const resolution = entry?.resolution === "gap" ? "gap" : "not_capability_gap";
      return {
        stepId: truncate(entry?.stepId, 100),
        confusion: truncate(entry?.confusion, 1000),
        resolution,
        gapRank: Number(entry?.gapRank) || 0,
        reason: truncate(entry?.reason || "", 300)
      };
    });
  }

  const normalized = {
    id: clean(raw.id || uuid()).slice(0, 100),
    locale: raw.locale === "en" ? "en" : "zh-CN",
    createdAt: raw.createdAt || now,
    input: {
      artifactText: truncate(raw.input?.artifactText, MAX_TEXT),
      artifactType: VALID_ARTIFACT_TYPES.includes(raw.input?.artifactType)
        ? raw.input.artifactType
        : "other",
      charCount: Number(raw.input?.charCount) || (raw.input?.artifactText ? clean(raw.input.artifactText).length : 0),
      preprocess: normalizePreprocess(raw.input?.preprocess),
      confusions: normalizeConfusions(raw.input?.confusions)
    },
    analysis: normalizeAnalysis(raw.analysis),
    sections: {
      aiCompleted: normalizeItemArray(sections.aiCompleted),
      userContributed: normalizeItemArray(sections.userContributed),
      cognitiveProcessesOutsourced: normalizeOutsourcedArray(sections.cognitiveProcessesOutsourced),
      dangerousGaps: normalizeGapArray(sections.dangerousGaps),
      cognitiveStructure: normalizeCognitiveStructure(sections.cognitiveStructure),
      feynmanCards: normalizeCardArray(sections.feynmanCards),
      nextActions: normalizeActionArray(sections.nextActions)
    },
    research: normalizeResearch(raw.research),
    confusionResolutions: normalizeConfusionResolutions(raw.confusionResolutions),
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

  normalized.display = deriveReportDisplay({ ...normalized, display: raw.display });

  return normalized;
}

/**
 * Generate a fallback clearance report when AI is unavailable.
 *
 * Strategy:
 * - Split text into rough chunks by sentence boundaries
 * - Use chunks to populate aiCompleted and userContributed as inference-only
 * - Generate FALLBACK_GAP_COUNT cautious dangerousGaps from sentence excerpts
 * - Generate 3-5 feynmanCards from first sentences
 * - All nextActions default to "task" with AI-unavailable reason
 * - Research is marked skipped (it never ran)
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

  // Outsourced cognitive processes: single cautious placeholder
  const cognitiveProcessesOutsourced = [{
    process: "Unable to identify outsourced cognitive processes; AI unavailable",
    surfaceTask: "",
    whyItMatters: "Manual review required to identify which thinking steps were delegated to AI",
    evidence: "inference",
    isInference: true
  }];

  // Dangerous gaps: cautious placeholders
  const dangerousGaps = [];
  for (let i = 0; i < FALLBACK_GAP_COUNT; i++) {
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
      charCount: clean(text).length,
      confusions: []
    },
    analysis: {
      artifactKind: "unknown",
      userCapability: {
        overall: "mixed",
        dimensions: {},
        currentDomain: "unknown",
        strongestDemonstratedAbility: "",
        highestPriorityGrowthArea: "",
        evidenceSignals: [],
        recommendedCardLevel: "foundation"
      }
    },
    sections: {
      aiCompleted,
      userContributed,
      cognitiveProcessesOutsourced,
      dangerousGaps,
      cognitiveStructure,
      feynmanCards,
      nextActions
    },
    research: { status: "skipped", queries: [], sources: [] },
    confusionResolutions: [],
    corrections: [],
    status: "generated"
  };

  // Run through normalization to guarantee schema compliance
  return normalizeReport(report);
}
