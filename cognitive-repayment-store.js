import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    gaps: [],
    attempts: [],
    reviewQueue: [],
    capabilityProfiles: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * Cognitive Repayment V1 store: gaps, attempts, review queue and capability
 * profiles. Independent from the other stores; atomic JSON persistence.
 */
export function createCognitiveRepaymentStore(filePath) {
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
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
        reviewQueue: Array.isArray(parsed.reviewQueue) ? parsed.reviewQueue : [],
        capabilityProfiles: Array.isArray(parsed.capabilityProfiles) ? parsed.capabilityProfiles : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Cognitive repayment store could not be loaded: ${error.message}`);
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

  async function saveGap(gap) {
    const gapId = clean(gap?.gapId).slice(0, 100);
    if (!gapId) {
      throw new Error("Repayment gap id is required");
    }
    const record = {
      ...gap,
      gapId,
      userId: clean(gap.userId || "").slice(0, 100)
    };
    const existingIndex = state.gaps.findIndex(item => item.gapId === gapId);
    if (existingIndex >= 0) {
      state.gaps[existingIndex] = record;
    } else {
      state.gaps.unshift(record);
    }
    await persist();
    return record;
  }

  function getGap(gapId, userId) {
    const gap = state.gaps.find(item => item.gapId === gapId);
    // A userId mismatch raises the same error as a missing gap so ownership
    // is never revealed.
    if (!gap || (userId !== undefined && gap.userId !== userId)) {
      throw new Error("Repayment gap not found");
    }
    return gap;
  }

  function listGaps(userId, { status } = {}) {
    return state.gaps
      .filter(item =>
        (userId === undefined || item.userId === userId) &&
        (!status || item.status === status))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  async function saveAttempt(attempt) {
    const attemptId = clean(attempt?.attemptId).slice(0, 100);
    if (!attemptId) {
      throw new Error("Repayment attempt id is required");
    }
    const clientAttemptId = clean(attempt.clientAttemptId || "");
    if (clientAttemptId) {
      const existing = state.attempts.find(
        item => item.gapId === attempt.gapId && item.clientAttemptId === clientAttemptId
      );
      if (existing) {
        return { record: existing, deduplicated: true };
      }
    }
    const record = { ...attempt, attemptId };
    state.attempts.push(record);
    await persist();
    return { record, deduplicated: false };
  }

  function listAttemptsForGap(gapId) {
    return state.attempts
      .filter(item => item.gapId === gapId)
      .sort((a, b) => String(a.submittedAt || "").localeCompare(String(b.submittedAt || "")));
  }

  function findAttemptByClientId(gapId, clientAttemptId) {
    const id = clean(clientAttemptId || "");
    if (!id) return null;
    return state.attempts.find(item => item.gapId === gapId && item.clientAttemptId === id) || null;
  }

  async function saveReviewItem(item) {
    const reviewItemId = clean(item?.reviewItemId).slice(0, 100);
    if (!reviewItemId) {
      throw new Error("Review item id is required");
    }
    const record = { ...item, reviewItemId };
    const existingIndex = state.reviewQueue.findIndex(entry => entry.reviewItemId === reviewItemId);
    if (existingIndex >= 0) {
      state.reviewQueue[existingIndex] = record;
    } else {
      state.reviewQueue.push(record);
    }
    await persist();
    return record;
  }

  function listReviewItems(userId, { status } = {}) {
    return state.reviewQueue
      .filter(item =>
        (userId === undefined || item.userId === userId) &&
        (!status || item.status === status))
      .sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
  }

  async function saveCapabilityProfile(profile) {
    const userId = clean(profile?.userId).slice(0, 100);
    const domain = clean(profile?.domain).slice(0, 200);
    if (!userId || !domain) {
      throw new Error("Capability profile userId and domain are required");
    }
    const record = { ...profile, userId, domain };
    const existingIndex = state.capabilityProfiles.findIndex(
      item => item.userId === userId && item.domain === domain
    );
    if (existingIndex >= 0) {
      state.capabilityProfiles[existingIndex] = record;
    } else {
      state.capabilityProfiles.push(record);
    }
    await persist();
    return record;
  }

  function getCapabilityProfile(userId, domain) {
    return state.capabilityProfiles.find(
      item => item.userId === userId && item.domain === domain
    ) || null;
  }

  function listCapabilityProfiles(userId) {
    return state.capabilityProfiles.filter(item => item.userId === userId);
  }

  function getState() {
    return state;
  }

  return {
    load,
    persist,
    saveGap,
    getGap,
    listGaps,
    saveAttempt,
    listAttemptsForGap,
    findAttemptByClientId,
    saveReviewItem,
    listReviewItems,
    saveCapabilityProfile,
    getCapabilityProfile,
    listCapabilityProfiles,
    getState
  };
}
