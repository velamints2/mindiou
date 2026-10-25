import { createSqliteStateNamespace } from "./sqlite-state-store.js";

function emptyState() {
  return { version: 1, profiles: [] };
}

function clean(value, limit = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/** Persistent user-level join point for domain capability and AI collaboration. */
export function createUserCognitiveProfileStore(dbPath, options = {}) {
  const persistence = createSqliteStateNamespace(dbPath, "user-cognitive-profile", options);
  let state = emptyState();
  let writeQueue = Promise.resolve();

  async function load() {
    const parsed = await persistence.load(emptyState());
    state = {
      ...emptyState(),
      ...parsed,
      version: 1,
      profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : []
    };
    return state;
  }

  function persist() {
    const snapshot = structuredClone(state);
    writeQueue = writeQueue.then(() => persistence.save(snapshot));
    return writeQueue;
  }

  async function saveProfile(profile = {}) {
    const userId = clean(profile.userId, 160);
    if (!userId) throw new Error("User cognitive profile userId is required");
    const record = {
      schemaVersion: "user-cognitive-profile-v1",
      ...profile,
      userId,
      updatedAt: profile.updatedAt || new Date().toISOString()
    };
    const index = state.profiles.findIndex(item => item.userId === userId);
    if (index >= 0) state.profiles[index] = record;
    else state.profiles.push(record);
    await persist();
    return record;
  }

  function getProfile(userId) {
    return state.profiles.find(item => item.userId === clean(userId, 160)) || null;
  }

  function listProfiles() {
    return state.profiles.slice();
  }

  return { load, persist, saveProfile, getProfile, listProfiles, dbPath: persistence.dbPath };
}
