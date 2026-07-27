import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function emptyState() {
  return {
    version: 1,
    clearanceReports: [],
    drafts: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePreprocess(raw) {
  if (typeof raw !== "object" || raw === null) return null;
  return {
    strategy: clean(raw.strategy || "unknown").slice(0, 80),
    didCompress: Boolean(raw.didCompress),
    originalCharCount: Number(raw.originalCharCount) || 0,
    preparedCharCount: Number(raw.preparedCharCount) || 0,
    parsedEntries: Number(raw.parsedEntries) || 0,
    parseFailures: Number(raw.parseFailures) || 0
  };
}

function textArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => clean(item).slice(0, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeConfusions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map(entry => ({
    stepId: clean(entry?.stepId || "").slice(0, 100),
    stepTitle: clean(entry?.stepTitle || "").slice(0, 120),
    text: clean(entry?.text || "").slice(0, 1000)
  })).filter(entry => entry.text);
}

function normalizeTimelineSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps.slice(0, 10).map((step, idx) => ({
    id: clean(step?.id || `step-${idx + 1}`).slice(0, 100),
    title: clean(step?.title || `步骤 ${idx + 1}`).slice(0, 120),
    aiDid: clean(step?.aiDid || "").slice(0, 400),
    keyActions: textArray(step?.keyActions, 6, 200),
    keyConcepts: textArray(step?.keyConcepts, 3, 80),
    userConfusion: clean(step?.userConfusion || "").slice(0, 1000)
  }));
}

function normalizeResearchRecord(raw) {
  if (typeof raw !== "object" || raw === null) {
    return { status: "skipped", queries: [], sources: [] };
  }
  return {
    status: clean(raw.status || "skipped").slice(0, 20),
    queries: (Array.isArray(raw.queries) ? raw.queries : []).slice(0, 5).map(query => ({
      query: clean(query?.query || "").slice(0, 300),
      status: clean(query?.status || "unavailable").slice(0, 20),
      error: clean(query?.error || "").slice(0, 300)
    })),
    sources: (Array.isArray(raw.sources) ? raw.sources : []).slice(0, 10).map(source => ({
      title: clean(source?.title || "").slice(0, 200),
      url: clean(source?.url || "").slice(0, 500),
      snippet: clean(source?.snippet || "").slice(0, 500)
    })).filter(source => source.title || source.url)
  };
}

function normalizeConfusionResolutions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 20).map(entry => ({
    stepId: clean(entry?.stepId || "").slice(0, 100),
    confusion: clean(entry?.confusion || "").slice(0, 1000),
    resolution: entry?.resolution === "gap" ? "gap" : "not_capability_gap",
    gapRank: Number(entry?.gapRank) || 0,
    reason: clean(entry?.reason || "").slice(0, 300)
  }));
}

/**
 * MVP-0 store for cognitive-debt clearance reports.
 * Completely independent from spiral-store.js.
 * Uses atomic JSON file persistence.
 */
export function createMvp0Store(filePath) {
  const resolvedPath = path.resolve(filePath);
  let state = emptyState();
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
      state = {
        ...emptyState(),
        ...parsed,
        version: 1,
        clearanceReports: Array.isArray(parsed.clearanceReports) ? parsed.clearanceReports : [],
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`MVP-0 store could not be loaded: ${error.message}`);
      }
    }
    return state;
  }

  function persist() {
    const snapshot = JSON.stringify(state, null, 2);
    writeQueue = writeQueue.then(async () => {
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      const temporaryPath = `${resolvedPath}.tmp`;
      await writeFile(temporaryPath, snapshot);
      await rename(temporaryPath, resolvedPath);
    });
    return writeQueue;
  }

  async function saveReport(report) {
    const id = clean(report.id || crypto.randomUUID()).slice(0, 100);
    const now = new Date().toISOString();
    const record = {
      id,
      createdAt: report.createdAt || now,
      draftId: clean(report.draftId || "").slice(0, 100),
      input: {
        artifactText: String(report.input?.artifactText || "").slice(0, 30000),
        artifactType: clean(report.input?.artifactType || "other").slice(0, 40),
        charCount: Number(report.input?.charCount) || 0,
        preprocess: normalizePreprocess(report.input?.preprocess),
        confusions: normalizeConfusions(report.input?.confusions)
      },
      analysis: report.analysis || {
        artifactKind: "unknown",
        userCapability: {
          overall: "mixed",
          dimensions: {
            productProblemFraming: { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0 },
            aiAgentSteering: { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0 },
            systemMentalModel: { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0 },
            technicalDecisionComprehension: { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0 },
            validationAndQualityJudgment: { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0 }
          },
          currentDomain: "unknown",
          strongestDemonstratedAbility: "",
          highestPriorityGrowthArea: "",
          evidenceSignals: [],
          recommendedCardLevel: "foundation"
        }
      },
      generation: {
        fallback: Boolean(report.generation?.fallback),
        error: clean(report.generation?.error || "").slice(0, 300),
        failedStep: clean(report.generation?.failedStep || "").slice(0, 40)
      },
      sections: report.sections || {
        aiCompleted: [],
        userContributed: [],
        cognitiveProcessesOutsourced: [],
        dangerousGaps: [],
        cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
        feynmanCards: [],
        nextActions: []
      },
      research: normalizeResearchRecord(report.research),
      confusionResolutions: normalizeConfusionResolutions(report.confusionResolutions),
      corrections: Array.isArray(report.corrections) ? report.corrections : [],
      status: clean(report.status || "generated").slice(0, 20)
    };
    const existingIndex = state.clearanceReports.findIndex(item => item.id === id);
    if (existingIndex >= 0) {
      state.clearanceReports[existingIndex] = record;
    } else {
      state.clearanceReports.unshift(record);
    }
    await persist();
    return record;
  }

  function getReport(id) {
    const report = state.clearanceReports.find(item => item.id === id);
    if (!report) {
      throw new Error(`Report not found: ${id}`);
    }
    return report;
  }

  function listReports() {
    return [...state.clearanceReports]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function updateCardAnswer(reportId, cardId, answer, aiFollowUp) {
    const report = getReport(reportId);
    const card = report.sections.feynmanCards?.find(item => item.id === cardId);
    if (!card) {
      throw new Error(`Feynman card not found: ${cardId} in report ${reportId}`);
    }
    const previousAnswer = card.userAnswer || "";
    card.userAnswer = clean(answer).slice(0, 2000);
    card.aiFollowUp = clean(aiFollowUp || "").slice(0, 500);
    card.answeredAt = new Date().toISOString();
    if (report.status === "generated") {
      report.status = "interacted";
    }
    await persist();
    return { report, card, previousAnswer };
  }

  async function addCorrection(reportId, correction) {
    const report = getReport(reportId);
    const record = {
      id: clean(correction.id || crypto.randomUUID()).slice(0, 100),
      target: clean(correction.target || "attribution").slice(0, 30),
      targetId: clean(correction.targetId || "").slice(0, 100),
      originalValue: clean(correction.originalValue || "").slice(0, 500),
      correctedValue: clean(correction.correctedValue || "").slice(0, 500),
      reason: clean(correction.reason || "").slice(0, 300),
      correctedAt: correction.correctedAt || new Date().toISOString()
    };
    report.corrections.push(record);
    report.status = "corrected";
    await persist();
    return { report, correction: record };
  }

  async function saveDraft(draft) {
    const id = clean(draft.id || crypto.randomUUID()).slice(0, 100);
    const now = new Date().toISOString();
    const existing = state.drafts.find(item => item.id === id);
    const record = {
      id,
      createdAt: draft.createdAt || existing?.createdAt || now,
      updatedAt: now,
      reportId: clean(draft.reportId || existing?.reportId || "").slice(0, 100),
      input: {
        artifactText: String(draft.input?.artifactText || "").slice(0, 30000),
        artifactType: clean(draft.input?.artifactType || "other").slice(0, 40),
        charCount: Number(draft.input?.charCount) || 0
      },
      timeline: {
        steps: normalizeTimelineSteps(draft.timeline?.steps)
      },
      generation: {
        fallback: Boolean(draft.generation?.fallback),
        error: clean(draft.generation?.error || "").slice(0, 300)
      },
      status: clean(draft.status || existing?.status || "timeline").slice(0, 20)
    };
    const existingIndex = state.drafts.findIndex(item => item.id === id);
    if (existingIndex >= 0) {
      state.drafts[existingIndex] = record;
    } else {
      state.drafts.unshift(record);
    }
    await persist();
    return record;
  }

  function getDraft(id) {
    const draft = state.drafts.find(item => item.id === id);
    if (!draft) {
      throw new Error(`Draft not found: ${id}`);
    }
    return draft;
  }

  function listDrafts() {
    return [...state.drafts]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async function updateDraftConfusions(id, confusions) {
    const draft = getDraft(id);
    const byStepId = new Map(
      (Array.isArray(confusions) ? confusions : [])
        .map(entry => [clean(entry?.stepId || ""), clean(entry?.text || "").slice(0, 1000)])
    );
    for (const step of draft.timeline.steps) {
      if (byStepId.has(step.id)) {
        step.userConfusion = byStepId.get(step.id);
      }
    }
    draft.updatedAt = new Date().toISOString();
    await persist();
    return draft;
  }

  async function attachReportToDraft(id, reportId) {
    const draft = getDraft(id);
    draft.reportId = clean(reportId || "").slice(0, 100);
    draft.status = "reported";
    draft.updatedAt = new Date().toISOString();
    await persist();
    return draft;
  }

  function getState() {
    return state;
  }

  return {
    load,
    saveReport,
    getReport,
    listReports,
    updateCardAnswer,
    addCorrection,
    saveDraft,
    getDraft,
    listDrafts,
    updateDraftConfusions,
    attachReportToDraft,
    getState
  };
}
