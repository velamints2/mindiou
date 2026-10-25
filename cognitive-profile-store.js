import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    cognitiveProfileInsights: [],
    cognitiveProfileSnapshots: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => clean(item).slice(0, 100)).filter(Boolean);
}

/**
 * 认知画像持久化 store（Phase 3：用户长期认知画像）
 *
 * 保存 CognitiveProfileInsight（每条画像结论独立保存、可追溯，证据字段必填）
 * 与 CognitiveProfileSnapshot（周/月/手动快照）。
 * 使用原子 JSON 文件写入，与 concept-graph-store.js / training-store.js 保持一致的模式。
 *
 * 快照不可变策略（二选一，本实现选择"跳过"）：同一 userId + snapshotType +
 * periodStart 的快照已存在时不覆盖、不新建版本，直接返回已存在记录；
 * 历史快照永不删除或改写。洞察记录则相反：同一 userId + periodStart +
 * periodEnd 的重算会整体替换该周期旧记录（幂等重算）。
 */
export function createCognitiveProfileStore(filePath) {
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
        cognitiveProfileInsights: Array.isArray(parsed.cognitiveProfileInsights)
          ? parsed.cognitiveProfileInsights
          : [],
        cognitiveProfileSnapshots: Array.isArray(parsed.cognitiveProfileSnapshots)
          ? parsed.cognitiveProfileSnapshots
          : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Cognitive profile store could not be loaded: ${error.message}`);
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

  // ─── CognitiveProfileInsight ───

  /**
   * 幂等重算：整体替换该用户该周期的全部洞察记录。
   * 每条记录的证据字段（evidenceDebtIds / evidenceAttemptIds /
   * evidenceClusterIds）必填，缺失时规范化为空数组。
   */
  async function replaceInsightsForPeriod(userId, periodStart, periodEnd, insights) {
    const uid = clean(userId).slice(0, 100);
    if (!uid) throw new Error("userId is required for insights");
    const start = clean(periodStart);
    const end = clean(periodEnd);
    const list = Array.isArray(insights) ? insights : [];
    state.cognitiveProfileInsights = state.cognitiveProfileInsights.filter(
      item => !(item.userId === uid && item.periodStart === start && item.periodEnd === end)
    );
    const saved = [];
    for (const insight of list) {
      const id = clean(insight?.id).slice(0, 100);
      if (!id) throw new Error("Cognitive profile insight id is required");
      const record = {
        ...insight,
        id,
        userId: uid,
        insightType: clean(insight.insightType).slice(0, 60),
        title: clean(insight.title).slice(0, 200),
        description: clean(insight.description).slice(0, 1000),
        evidenceDebtIds: cleanIdArray(insight.evidenceDebtIds),
        evidenceAttemptIds: cleanIdArray(insight.evidenceAttemptIds),
        evidenceClusterIds: cleanIdArray(insight.evidenceClusterIds),
        confidence: Number.isFinite(Number(insight.confidence)) ? Number(insight.confidence) : 0,
        periodStart: start,
        periodEnd: end,
        calculationVersion: clean(insight.calculationVersion || "").slice(0, 60),
        createdAt: clean(insight.createdAt) || new Date().toISOString()
      };
      state.cognitiveProfileInsights.unshift(record);
      saved.push(record);
    }
    await persist();
    return saved;
  }

  function listInsights(userId, filters = {}) {
    let items = userId !== undefined
      ? state.cognitiveProfileInsights.filter(item => item.userId === userId)
      : [...state.cognitiveProfileInsights];
    if (filters.insightType) {
      items = items.filter(item => item.insightType === filters.insightType);
    }
    return items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  function getInsight(id, userId) {
    const insight = state.cognitiveProfileInsights.find(item => item.id === id);
    if (!insight || (userId !== undefined && insight.userId !== userId)) return null;
    return insight;
  }

  // ─── CognitiveProfileSnapshot（不可变：同周期已存在则跳过） ───

  /**
   * 保存快照。同一 userId + snapshotType + periodStart 已存在时不覆盖，
   * 返回 { snapshot: existing, created: false }；否则新建并返回
   * { snapshot: record, created: true }。历史快照永不删除/改写。
   */
  async function saveSnapshot(snapshot) {
    const uid = clean(snapshot?.userId).slice(0, 100);
    if (!uid) throw new Error("userId is required for snapshot");
    const snapshotType = clean(snapshot?.snapshotType).slice(0, 40);
    const periodStart = clean(snapshot?.periodStart);
    if (!snapshotType || !periodStart) {
      throw new Error("snapshotType and periodStart are required for snapshot");
    }
    const existing = state.cognitiveProfileSnapshots.find(
      item => item.userId === uid && item.snapshotType === snapshotType && item.periodStart === periodStart
    );
    if (existing) return { snapshot: existing, created: false };
    const id = clean(snapshot?.id).slice(0, 100);
    if (!id) throw new Error("Cognitive profile snapshot id is required");
    const record = {
      ...snapshot,
      id,
      userId: uid,
      snapshotType,
      periodStart,
      periodEnd: clean(snapshot.periodEnd),
      calculationVersion: clean(snapshot.calculationVersion || "").slice(0, 60),
      createdAt: clean(snapshot.createdAt) || new Date().toISOString()
    };
    state.cognitiveProfileSnapshots.unshift(record);
    await persist();
    return { snapshot: record, created: true };
  }

  function listSnapshots(userId, filters = {}) {
    let items = userId !== undefined
      ? state.cognitiveProfileSnapshots.filter(item => item.userId === userId)
      : [...state.cognitiveProfileSnapshots];
    if (filters.snapshotType) {
      items = items.filter(item => item.snapshotType === filters.snapshotType);
    }
    return items.sort((a, b) => String(b.periodStart || "").localeCompare(String(a.periodStart || "")));
  }

  function getState() {
    return state;
  }

  return {
    load,
    replaceInsightsForPeriod,
    listInsights,
    getInsight,
    saveSnapshot,
    listSnapshots,
    getState
  };
}
