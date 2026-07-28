import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    clearanceSessions: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * MVP-1 store for source-grounded debt clearance sessions.
 * Completely independent from spiral-store.js and mvp0-store.js.
 * Uses atomic JSON file persistence.
 */
export function createMvp1Store(filePath) {
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
        clearanceSessions: Array.isArray(parsed.clearanceSessions) ? parsed.clearanceSessions : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`MVP-1 store could not be loaded: ${error.message}`);
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

  async function saveSession(session) {
    const id = clean(session?.id).slice(0, 100);
    if (!id) {
      throw new Error("Clearance session id is required");
    }
    const record = {
      ...session,
      id,
      userId: clean(session.userId || "demo-user").slice(0, 100)
    };
    const existingIndex = state.clearanceSessions.findIndex(item => item.id === id);
    if (existingIndex >= 0) {
      state.clearanceSessions[existingIndex] = record;
    } else {
      state.clearanceSessions.unshift(record);
    }
    await persist();
    return record;
  }

  function getSession(id, userId) {
    const session = state.clearanceSessions.find(item => item.id === id);
    // A userId mismatch raises the same error as a missing session so
    // ownership is never revealed. Unscoped calls keep legacy behavior.
    if (!session || (userId !== undefined && session.userId !== userId)) {
      throw new Error(`Clearance session not found: ${id}`);
    }
    return session;
  }

  function listSessions(userId) {
    const sessions = userId === undefined
      ? state.clearanceSessions
      : state.clearanceSessions.filter(item => item.userId === userId);
    return [...sessions]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  function getState() {
    return state;
  }

  return {
    load,
    saveSession,
    getSession,
    listSessions,
    getState
  };
}
