import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    debtIntelligenceAnalyses: [],
    analysisRuns: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 认知欠条智能分类持久化 store
 *
 * 保存 DebtIntelligenceAnalysis（同一欠条可多版本，isCurrent 标记当前生效版本）
 * 与 AnalysisRun（分类任务记录：status/attemptCount/errorMessage，支持重试追溯）。
 * 使用原子 JSON 文件写入，与 training-store.js 保持一致的模式。
 */
export function createDebtIntelligenceStore(filePath) {
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
        debtIntelligenceAnalyses: Array.isArray(parsed.debtIntelligenceAnalyses)
          ? parsed.debtIntelligenceAnalyses
          : [],
        analysisRuns: Array.isArray(parsed.analysisRuns) ? parsed.analysisRuns : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Debt intelligence store could not be loaded: ${error.message}`);
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

  // ─── DebtIntelligenceAnalysis（多版本，isCurrent 单点生效） ───

  async function saveAnalysis(analysis) {
    const id = clean(analysis?.id).slice(0, 100);
    if (!id) throw new Error("Debt intelligence analysis id is required");
    const debtId = clean(analysis?.cognitiveDebtId).slice(0, 100);
    if (!debtId) throw new Error("cognitiveDebtId is required for debt intelligence analysis");
    const existingVersions = state.debtIntelligenceAnalyses
      .filter(item => item.cognitiveDebtId === debtId)
      .map(item => Number(item.version) || 0);
    const record = {
      ...analysis,
      id,
      cognitiveDebtId: debtId,
      userId: clean(analysis.userId || "demo-user").slice(0, 100),
      version: Number(analysis.version) > 0 ? Number(analysis.version) : Math.max(0, ...existingVersions) + 1
    };
    // 同一欠条只允许一个当前生效版本；人工纠正版本通过 isCurrent=true 接管。
    if (record.isCurrent) {
      for (const item of state.debtIntelligenceAnalyses) {
        if (item.cognitiveDebtId === debtId && item.id !== id) item.isCurrent = false;
      }
    }
    const idx = state.debtIntelligenceAnalyses.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.debtIntelligenceAnalyses[idx] = record;
    } else {
      state.debtIntelligenceAnalyses.unshift(record);
    }
    await persist();
    return record;
  }

  function getCurrentAnalysis(cognitiveDebtId) {
    return state.debtIntelligenceAnalyses.find(
      item => item.cognitiveDebtId === cognitiveDebtId && item.isCurrent
    ) || null;
  }

  function listAnalyses(cognitiveDebtId) {
    return state.debtIntelligenceAnalyses
      .filter(item => item.cognitiveDebtId === cognitiveDebtId)
      .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0));
  }

  function countAnalyses(cognitiveDebtId) {
    return state.debtIntelligenceAnalyses.filter(item => item.cognitiveDebtId === cognitiveDebtId).length;
  }

  // ─── AnalysisRun（任务记录） ───

  async function saveAnalysisRun(run) {
    const id = clean(run?.id).slice(0, 100);
    if (!id) throw new Error("Analysis run id is required");
    const record = {
      ...run,
      id,
      cognitiveDebtId: clean(run.cognitiveDebtId || "").slice(0, 100),
      userId: clean(run.userId || "demo-user").slice(0, 100),
      status: clean(run.status || "failed").slice(0, 40),
      attemptCount: Math.max(0, Number(run.attemptCount) || 0),
      errorMessage: clean(run.errorMessage || "").slice(0, 500)
    };
    const idx = state.analysisRuns.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.analysisRuns[idx] = record;
    } else {
      state.analysisRuns.unshift(record);
    }
    await persist();
    return record;
  }

  function listAnalysisRuns(cognitiveDebtId) {
    const items = cognitiveDebtId !== undefined
      ? state.analysisRuns.filter(item => item.cognitiveDebtId === cognitiveDebtId)
      : [...state.analysisRuns];
    return items.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  }

  function getState() {
    return state;
  }

  return {
    load,
    saveAnalysis,
    getCurrentAnalysis,
    listAnalyses,
    countAnalyses,
    saveAnalysisRun,
    listAnalysisRuns,
    getState
  };
}
