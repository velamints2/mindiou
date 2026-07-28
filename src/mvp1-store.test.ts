// @ts-nocheck
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createMvp1Store } from "../mvp1-store.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const tmpDir = path.resolve("tmp");
const storePath = path.join(tmpDir, "mvp1-store-test.json");

function makeSession(overrides = {}) {
  const base = {
    id: "session-001",
    reportId: "report-001",
    cardId: "card-001",
    userId: "alice",
    createdAt: "2026-07-26T10:00:00.000Z",
    endedAt: null,
    state: "awaiting_answer",
    originalCard: { id: "card-001", target: "CORS", prompt: "Explain CORS", targetLevel: "L2", difficulty: "intermediate" },
    clearanceQuestion: "Explain CORS in your own words",
    researchSummary: "CORS controls response access.",
    researchMode: "live_ai",
    sources: [{ id: "source-1", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS", title: "CORS", claim: "CORS controls cross-origin reads.", type: "official_doc", credibility: "high" }],
    scaffold: [{ id: "point-1", point: "Reachability comes first.", whyItMatters: "A response can arrive but stay unreadable.", sourceIds: ["source-1"] }],
    attempts: [],
    finalResult: null
  };
  return { ...base, ...overrides };
}

describe("MVP-1 store", () => {
  let store;

  beforeEach(async () => {
    await mkdir(tmpDir, { recursive: true });
    store = createMvp1Store(storePath);
    await store.load();
  });

  afterEach(async () => {
    try {
      await rm(storePath, { force: true });
      await rm(`${storePath}.tmp`, { force: true });
    } catch {
      // ignore
    }
  });

  describe("saveSession", () => {
    it("saves a session and returns it with a cleaned userId", async () => {
      const saved = await store.saveSession(makeSession({ userId: "  alice   wang  " }));
      expect(saved.id).toBe("session-001");
      expect(saved.userId).toBe("alice wang");
      expect(saved.state).toBe("awaiting_answer");
    });

    it("defaults the owner to demo-user when userId is missing", async () => {
      const saved = await store.saveSession(makeSession({ userId: "" }));
      expect(saved.userId).toBe("demo-user");
    });

    it("overwrites an existing session with the same id", async () => {
      await store.saveSession(makeSession({ id: "s1", state: "awaiting_answer" }));
      await store.saveSession(makeSession({ id: "s1", state: "ended", endedAt: "2026-07-26T11:00:00.000Z" }));
      expect(store.listSessions()).toHaveLength(1);
      expect(store.getSession("s1").state).toBe("ended");
    });
  });

  describe("getSession", () => {
    it("returns the session when found", async () => {
      await store.saveSession(makeSession({ id: "session-001" }));
      expect(store.getSession("session-001").cardId).toBe("card-001");
    });

    it("throws a clear error when session not found", () => {
      expect(() => store.getSession("nonexistent-id")).toThrow("Clearance session not found: nonexistent-id");
    });
  });

  describe("listSessions", () => {
    it("returns sessions sorted by createdAt descending", async () => {
      await store.saveSession(makeSession({ id: "old", createdAt: "2026-07-20T00:00:00.000Z" }));
      await store.saveSession(makeSession({ id: "new", createdAt: "2026-07-26T00:00:00.000Z" }));
      await store.saveSession(makeSession({ id: "mid", createdAt: "2026-07-23T00:00:00.000Z" }));
      expect(store.listSessions().map(item => item.id)).toEqual(["new", "mid", "old"]);
    });
  });

  describe("persistence", () => {
    it("recovers sessions with attempts across store instances", async () => {
      await store.saveSession(makeSession({
        id: "restart-session",
        userId: "carol",
        state: "teaching",
        attempts: [{
          id: "attempt-1",
          createdAt: "2026-07-26T10:30:00.000Z",
          answer: "CORS decides whether JavaScript can read the response.",
          analysis: { status: "needs_practice", feedback: "Keep going." }
        }]
      }));
      const store2 = createMvp1Store(storePath);
      await store2.load();
      const found = store2.getSession("restart-session");
      expect(found.userId).toBe("carol");
      expect(found.attempts).toHaveLength(1);
      expect(found.attempts[0].answer).toContain("JavaScript");
      expect(found.scaffold).toHaveLength(1);
      expect(found.sources[0].type).toBe("official_doc");
    });

    it("starts with empty state when file does not exist", async () => {
      const freshPath = path.join(tmpDir, "mvp1-fresh-test.json");
      const freshStore = createMvp1Store(freshPath);
      await freshStore.load();
      expect(freshStore.listSessions()).toEqual([]);
      await rm(freshPath, { force: true });
    });

    it("falls back to empty state when the file contains corrupt JSON", async () => {
      await writeFile(storePath, "{ not valid json");
      const corruptStore = createMvp1Store(storePath);
      await corruptStore.load();
      expect(corruptStore.getState().clearanceSessions).toEqual([]);
      expect(corruptStore.listSessions()).toEqual([]);
    });
  });
});
