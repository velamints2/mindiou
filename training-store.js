import { createSqliteStateNamespace } from "./sqlite-state-store.js";

function emptyState() {
  return {
    version: 1,
    trainingAttempts: [],
    masteryProfiles: [],
    reviewTasks: [],
    cognitiveDebts: [],
    capabilities: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 训练记录持久化 store
 *
 * 保存 TrainingAttempt、MasteryProfile、ReviewTask、CognitiveDebt 和 CapabilityNode
 * 使用共享 SQLite WAL 数据库；旧 JSON 仅作为一次性迁移源
 */
export function createTrainingStore(dbPath, options = {}) {
  const persistence = createSqliteStateNamespace(dbPath, "training", options);
  let state = emptyState();
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const parsed = await persistence.load(emptyState());
      state = {
        ...emptyState(),
        ...parsed,
        version: 1,
        trainingAttempts: Array.isArray(parsed.trainingAttempts) ? parsed.trainingAttempts : [],
        masteryProfiles: Array.isArray(parsed.masteryProfiles) ? parsed.masteryProfiles : [],
        reviewTasks: Array.isArray(parsed.reviewTasks) ? parsed.reviewTasks : [],
        cognitiveDebts: Array.isArray(parsed.cognitiveDebts) ? parsed.cognitiveDebts : [],
        capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : []
      };
    } catch (error) {
      console.warn(`Training store could not be loaded: ${error.message}`);
    }
    return state;
  }

  function persist() {
    const snapshot = structuredClone(state);
    writeQueue = writeQueue.then(async () => {
      persistence.save(snapshot);
    });
    return writeQueue;
  }

  // ─── TrainingAttempt ───

  async function saveAttempt(attempt) {
    const id = clean(attempt?.id).slice(0, 100);
    if (!id) throw new Error("Training attempt id is required");
    const record = {
      ...attempt,
      id,
      userId: clean(attempt.userId || "demo-user").slice(0, 100)
    };
    const idx = state.trainingAttempts.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.trainingAttempts[idx] = record;
    } else {
      state.trainingAttempts.unshift(record);
    }
    await persist();
    return record;
  }

  function getAttempt(id, userId) {
    const attempt = state.trainingAttempts.find(item => item.id === id);
    if (!attempt || (userId !== undefined && attempt.userId !== userId)) {
      throw new Error(`Training attempt not found: ${id}`);
    }
    return attempt;
  }

  function listAttempts(userId, filters = {}) {
    let items = userId !== undefined
      ? state.trainingAttempts.filter(item => item.userId === userId)
      : state.trainingAttempts;
    if (filters.cognitiveDebtId) {
      items = items.filter(item => item.cognitiveDebtId === filters.cognitiveDebtId);
    }
    if (filters.cardId) {
      items = items.filter(item => item.cardId === filters.cardId);
    }
    if (filters.trainingStage) {
      items = items.filter(item => item.trainingStage === filters.trainingStage);
    }
    return [...items].sort((a, b) =>
      String(b.completedAt || "").localeCompare(String(a.completedAt || ""))
    );
  }

  // ─── MasteryProfile ───

  async function saveMasteryProfile(profile) {
    const debtId = clean(profile?.cognitiveDebtId).slice(0, 100);
    if (!debtId) throw new Error("cognitiveDebtId is required for mastery profile");
    const record = { ...profile, cognitiveDebtId: debtId };
    const idx = state.masteryProfiles.findIndex(item => item.cognitiveDebtId === debtId);
    if (idx >= 0) {
      state.masteryProfiles[idx] = record;
    } else {
      state.masteryProfiles.unshift(record);
    }
    await persist();
    return record;
  }

  function getMasteryProfile(debtId) {
    return state.masteryProfiles.find(item => item.cognitiveDebtId === debtId) || null;
  }

  function listMasteryProfiles(userId) {
    if (userId === undefined) return [...state.masteryProfiles];
    const debtIds = new Set(
      state.cognitiveDebts.filter(d => d.userId === userId).map(d => d.id)
    );
    return state.masteryProfiles.filter(p => debtIds.has(p.cognitiveDebtId));
  }

  // ─── ReviewTask ───

  async function saveReviewTask(task) {
    const id = clean(task?.id).slice(0, 100);
    if (!id) throw new Error("Review task id is required");
    const record = {
      ...task,
      id,
      userId: clean(task.userId || "demo-user").slice(0, 100)
    };
    const idx = state.reviewTasks.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.reviewTasks[idx] = record;
    } else {
      state.reviewTasks.unshift(record);
    }
    await persist();
    return record;
  }

  function getReviewTask(id, userId) {
    const task = state.reviewTasks.find(item => item.id === id);
    if (!task || (userId !== undefined && task.userId !== userId)) {
      throw new Error(`Review task not found: ${id}`);
    }
    return task;
  }

  function listReviewTasks(userId, filters = {}) {
    let items = userId !== undefined
      ? state.reviewTasks.filter(item => item.userId === userId)
      : state.reviewTasks;
    if (filters.status) {
      items = items.filter(item => item.status === filters.status);
    }
    if (filters.cognitiveDebtId) {
      items = items.filter(item => item.cognitiveDebtId === filters.cognitiveDebtId);
    }
    return [...items].sort((a, b) =>
      String(a.dueAt || "").localeCompare(String(b.dueAt || ""))
    );
  }

  function listDueReviews(userId, now = new Date().toISOString()) {
    return listReviewTasks(userId, { status: "pending" })
      .filter(task => String(task.dueAt || "").localeCompare(now) <= 0);
  }

  // ─── CognitiveDebt (长期状态) ───

  async function saveCognitiveDebt(debt) {
    const id = clean(debt?.id).slice(0, 100);
    if (!id) throw new Error("Cognitive debt id is required");
    const record = {
      ...debt,
      id,
      userId: clean(debt.userId || "demo-user").slice(0, 100)
    };
    const idx = state.cognitiveDebts.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.cognitiveDebts[idx] = record;
    } else {
      state.cognitiveDebts.unshift(record);
    }
    await persist();
    return record;
  }

  function getCognitiveDebt(id, userId) {
    const debt = state.cognitiveDebts.find(item => item.id === id);
    if (!debt || (userId !== undefined && debt.userId !== userId)) {
      throw new Error(`Cognitive debt not found: ${id}`);
    }
    return debt;
  }

  function listCognitiveDebts(userId) {
    return userId !== undefined
      ? state.cognitiveDebts.filter(item => item.userId === userId)
      : [...state.cognitiveDebts];
  }

  /**
   * 通过 gap 文本查找已有的认知欠条（用于重复缺口归并）
   */
  function findCognitiveDebtByGap(userId, gapText) {
    const normalized = clean(gapText).toLowerCase();
    return state.cognitiveDebts.find(debt =>
      debt.userId === userId &&
      clean(debt.gapText || "").toLowerCase() === normalized
    ) || null;
  }

  // ─── CapabilityNode ───

  async function saveCapability(capability) {
    const id = clean(capability?.id).slice(0, 100);
    if (!id) throw new Error("Capability id is required");
    const record = { ...capability, id };
    const idx = state.capabilities.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.capabilities[idx] = record;
    } else {
      state.capabilities.unshift(record);
    }
    await persist();
    return record;
  }

  function getCapability(id) {
    return state.capabilities.find(item => item.id === id) || null;
  }

  function listCapabilities() {
    return [...state.capabilities];
  }

  function findCapabilityByName(name) {
    const normalized = clean(name).toLowerCase();
    return state.capabilities.find(cap =>
      clean(cap.name).toLowerCase() === normalized
    ) || null;
  }

  function getState() {
    return state;
  }

  return {
    load,
    saveAttempt,
    getAttempt,
    listAttempts,
    saveMasteryProfile,
    getMasteryProfile,
    listMasteryProfiles,
    saveReviewTask,
    getReviewTask,
    listReviewTasks,
    listDueReviews,
    saveCognitiveDebt,
    getCognitiveDebt,
    listCognitiveDebts,
    findCognitiveDebtByGap,
    saveCapability,
    getCapability,
    listCapabilities,
    findCapabilityByName,
    getState
  };
}
