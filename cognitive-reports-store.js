import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    cognitiveReports: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 周期认知报告持久化 store（Phase 5：周期性认知报告）
 *
 * 保存 CognitiveReport（周报 / 月报）记录。报告五节内容（inputsJson /
 * trainingJson / patternsJson / progressJson / nextFocusJson）由
 * cognitive-reports.js 的确定性统计生成；本 store 只做原子 JSON 读写与
 * 字段清洗，与 cognitive-profile-store.js / learning-orchestrator-store.js
 * 保持一致的模式。
 *
 * 幂等策略：同一 userId + reportType + periodStart 的重算整体替换该周期
 * 旧记录（新 id、新 createdAt）；历史周期的报告永不触碰。
 */
export function createCognitiveReportsStore(filePath) {
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
        cognitiveReports: Array.isArray(parsed.cognitiveReports) ? parsed.cognitiveReports : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Cognitive reports store could not be loaded: ${error.message}`);
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

  // ─── CognitiveReport ───

  /**
   * 幂等重算：替换同 userId + reportType + periodStart 的旧记录后插入新记录。
   * 其他周期的报告保持不变。
   */
  async function saveReport(report) {
    const id = clean(report?.id).slice(0, 100);
    if (!id) throw new Error("Cognitive report id is required");
    const uid = clean(report?.userId).slice(0, 100);
    if (!uid) throw new Error("userId is required for report");
    const reportType = clean(report?.reportType).slice(0, 40);
    if (!["weekly", "monthly"].includes(reportType)) {
      throw new Error("reportType must be weekly or monthly");
    }
    const periodStart = clean(report?.periodStart);
    if (!periodStart) throw new Error("periodStart is required for report");
    const record = {
      ...report,
      id,
      userId: uid,
      reportType,
      periodStart,
      periodEnd: clean(report.periodEnd),
      inputsJson: report.inputsJson && typeof report.inputsJson === "object" ? report.inputsJson : {},
      trainingJson: report.trainingJson && typeof report.trainingJson === "object" ? report.trainingJson : {},
      patternsJson: report.patternsJson && typeof report.patternsJson === "object" ? report.patternsJson : {},
      progressJson: report.progressJson && typeof report.progressJson === "object" ? report.progressJson : {},
      nextFocusJson: report.nextFocusJson && typeof report.nextFocusJson === "object" ? report.nextFocusJson : {},
      summaryText: clean(report.summaryText || "").slice(0, 1200),
      calculationVersion: clean(report.calculationVersion || "").slice(0, 60),
      createdAt: clean(report.createdAt) || new Date().toISOString()
    };
    state.cognitiveReports = state.cognitiveReports.filter(
      item => !(item.userId === uid && item.reportType === reportType && item.periodStart === periodStart)
    );
    state.cognitiveReports.unshift(record);
    await persist();
    return record;
  }

  function getReport(id, userId) {
    const report = state.cognitiveReports.find(item => item.id === id);
    if (!report || (userId !== undefined && report.userId !== userId)) return null;
    return report;
  }

  function findReport(userId, reportType, periodStart) {
    return state.cognitiveReports.find(
      item => item.userId === userId && item.reportType === reportType && item.periodStart === periodStart
    ) || null;
  }

  /** 历史列表：按周期新到旧排序。 */
  function listReports(userId, filters = {}) {
    let items = userId !== undefined
      ? state.cognitiveReports.filter(item => item.userId === userId)
      : [...state.cognitiveReports];
    if (filters.reportType) {
      const allowed = new Set(Array.isArray(filters.reportType) ? filters.reportType : [filters.reportType]);
      items = items.filter(item => allowed.has(item.reportType));
    }
    return items.sort((a, b) => String(b.periodStart || "").localeCompare(String(a.periodStart || "")));
  }

  function getState() {
    return state;
  }

  return {
    load,
    saveReport,
    getReport,
    findReport,
    listReports,
    getState
  };
}
