import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function emptyState() {
  return {
    version: 1,
    clearanceReports: []
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
        clearanceReports: Array.isArray(parsed.clearanceReports) ? parsed.clearanceReports : []
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
      input: {
        artifactText: String(report.input?.artifactText || "").slice(0, 30000),
        artifactType: clean(report.input?.artifactType || "other").slice(0, 40),
        charCount: Number(report.input?.charCount) || 0,
        preprocess: normalizePreprocess(report.input?.preprocess)
      },
      analysis: report.analysis || {
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
      },
      sections: report.sections || {
        aiCompleted: [],
        userContributed: [],
        dangerousGaps: [],
        cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
        feynmanCards: [],
        nextActions: []
      },
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
    getState
  };
}
