import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    learningRecommendations: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanIdArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => clean(item).slice(0, 100)).filter(Boolean);
}

function cleanTimestamp(value) {
  const text = clean(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

/**
 * 学习编排持久化 store（Phase 4：下一步学习编排）
 *
 * 保存 LearningRecommendation 记录。推荐的去重与状态联动由
 * learning-orchestrator.js 负责；本 store 只做原子 JSON 读写与字段清洗，
 * 与 concept-graph-store.js / cognitive-profile-store.js 保持一致的模式。
 */
export function createLearningOrchestratorStore(filePath) {
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
        learningRecommendations: Array.isArray(parsed.learningRecommendations)
          ? parsed.learningRecommendations
          : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Learning orchestrator store could not be loaded: ${error.message}`);
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

  // ─── LearningRecommendation ───

  async function saveRecommendation(recommendation) {
    const id = clean(recommendation?.id).slice(0, 100);
    if (!id) throw new Error("Learning recommendation id is required");
    const recommendationType = clean(recommendation?.recommendationType).slice(0, 60);
    if (!recommendationType) throw new Error("recommendationType is required");
    const record = {
      ...recommendation,
      id,
      userId: clean(recommendation.userId || "demo-user").slice(0, 100),
      recommendationType,
      primaryDebtId: clean(recommendation.primaryDebtId || "") || null,
      relatedDebtIds: cleanIdArray(recommendation.relatedDebtIds),
      clusterId: clean(recommendation.clusterId || "") || null,
      skillNodeId: clean(recommendation.skillNodeId || "") || null,
      recommendedTrainingStage: clean(recommendation.recommendedTrainingStage || "") || null,
      existingReviewTaskId: clean(recommendation.existingReviewTaskId || "") || null,
      title: clean(recommendation.title || "").slice(0, 200),
      reason: clean(recommendation.reason || "").slice(0, 1000),
      priorityScore: Number.isFinite(Number(recommendation.priorityScore))
        ? Number(recommendation.priorityScore)
        : 0,
      scoreFactorsJson: recommendation.scoreFactorsJson && typeof recommendation.scoreFactorsJson === "object"
        ? recommendation.scoreFactorsJson
        : {},
      estimatedMinutes: Math.max(0, Math.round(Number(recommendation.estimatedMinutes) || 0)),
      status: clean(recommendation.status || "generated").slice(0, 40),
      scoringVersion: clean(recommendation.scoringVersion || "").slice(0, 60),
      generatedAt: clean(recommendation.generatedAt) || new Date().toISOString(),
      expiresAt: cleanTimestamp(recommendation.expiresAt),
      viewedAt: cleanTimestamp(recommendation.viewedAt),
      acceptedAt: cleanTimestamp(recommendation.acceptedAt),
      completedAt: cleanTimestamp(recommendation.completedAt),
      skippedAt: cleanTimestamp(recommendation.skippedAt),
      skipReason: clean(recommendation.skipReason || "").slice(0, 200) || null
    };
    const idx = state.learningRecommendations.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.learningRecommendations[idx] = record;
    } else {
      state.learningRecommendations.unshift(record);
    }
    await persist();
    return record;
  }

  function getRecommendation(id, userId) {
    const recommendation = state.learningRecommendations.find(item => item.id === id);
    if (!recommendation || (userId !== undefined && recommendation.userId !== userId)) return null;
    return recommendation;
  }

  function listRecommendations(userId, filters = {}) {
    let items = userId !== undefined
      ? state.learningRecommendations.filter(item => item.userId === userId)
      : [...state.learningRecommendations];
    if (filters.status) {
      const allowed = new Set(Array.isArray(filters.status) ? filters.status : [filters.status]);
      items = items.filter(item => allowed.has(item.status));
    }
    if (filters.recommendationType) {
      const allowed = new Set(
        Array.isArray(filters.recommendationType) ? filters.recommendationType : [filters.recommendationType]
      );
      items = items.filter(item => allowed.has(item.recommendationType));
    }
    if (filters.primaryDebtId) {
      items = items.filter(item => item.primaryDebtId === filters.primaryDebtId);
    }
    return items.sort((a, b) => String(b.generatedAt || "").localeCompare(String(a.generatedAt || "")));
  }

  /** 活跃期（generated/viewed/accepted）同 debt+type 查重，用于幂等生成。 */
  function findActiveRecommendation(userId, { primaryDebtId = null, recommendationType, activeStatuses }) {
    const statuses = new Set(Array.isArray(activeStatuses) && activeStatuses.length > 0
      ? activeStatuses
      : ["generated", "viewed", "accepted"]);
    return state.learningRecommendations.find(item =>
      item.userId === userId
      && item.recommendationType === recommendationType
      && (item.primaryDebtId || null) === primaryDebtId
      && statuses.has(item.status)
    ) || null;
  }

  function getState() {
    return state;
  }

  return {
    load,
    saveRecommendation,
    getRecommendation,
    listRecommendations,
    findActiveRecommendation,
    getState
  };
}
