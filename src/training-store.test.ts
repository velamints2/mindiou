// @ts-nocheck
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createTrainingStore } from "../training-store.js";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const tmpDir = path.join(os.tmpdir(), `mindiou-training-test-${Date.now()}`);
const storePath = path.join(tmpDir, "training-store.json");

async function freshStore() {
  await mkdir(tmpDir, { recursive: true });
  const store = createTrainingStore(storePath);
  await store.load();
  return store;
}

async function cleanup() {
  await rm(tmpDir, { recursive: true, force: true });
}

describe("training-store — persistence", () => {
  let store;

  beforeEach(async () => {
    store = await freshStore();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("starts with empty state", () => {
    const state = store.getState();
    expect(state.trainingAttempts).toEqual([]);
    expect(state.masteryProfiles).toEqual([]);
    expect(state.reviewTasks).toEqual([]);
    expect(state.cognitiveDebts).toEqual([]);
    expect(state.capabilities).toEqual([]);
  });

  it("persists and recovers a training attempt", async () => {
    const attempt = {
      id: "attempt-1",
      userId: "user-1",
      cardId: "card-1",
      cognitiveDebtId: "debt-1",
      trainingStage: "initial_compensation",
      taskType: "feynman_explanation",
      originalPrompt: "Explain X",
      initialAnswer: "initial",
      finalAnswer: "final answer",
      hintEvents: [],
      evaluation: { passed: true, overallScore: 70 },
      startedAt: "2026-07-28T10:00:00Z",
      completedAt: "2026-07-28T10:05:00Z"
    };
    await store.saveAttempt(attempt);

    // Create new store instance from same file
    const store2 = createTrainingStore(storePath);
    await store2.load();
    const recovered = store2.getAttempt("attempt-1");
    expect(recovered.finalAnswer).toBe("final answer");
    expect(recovered.evaluation.passed).toBe(true);
  });

  it("persists and recovers a mastery profile", async () => {
    const profile = {
      cognitiveDebtId: "debt-1",
      conceptualUnderstanding: 50,
      independentRecall: 30,
      hintIndependence: 70,
      misconceptionResistance: 20,
      transferAbility: 0,
      retentionStrength: 10,
      overallMastery: 35,
      currentStage: 1,
      successfulAttempts: 1,
      failedAttempts: 0,
      relapseCount: 0
    };
    await store.saveMasteryProfile(profile);

    const store2 = createTrainingStore(storePath);
    await store2.load();
    const recovered = store2.getMasteryProfile("debt-1");
    expect(recovered.conceptualUnderstanding).toBe(50);
    expect(recovered.overallMastery).toBe(35);
  });

  it("persists and recovers a cognitive debt", async () => {
    const debt = {
      id: "debt-1",
      userId: "user-1",
      gapText: "不理解 Git",
      status: "new",
      recurrenceCount: 0,
      sourceReports: ["report-1"],
      createdAt: "2026-07-28T10:00:00Z",
      updatedAt: "2026-07-28T10:00:00Z"
    };
    await store.saveCognitiveDebt(debt);

    const store2 = createTrainingStore(storePath);
    await store2.load();
    const recovered = store2.getCognitiveDebt("debt-1");
    expect(recovered.gapText).toBe("不理解 Git");
    expect(recovered.status).toBe("new");
  });

  it("persists and recovers a review task", async () => {
    const task = {
      id: "task-1",
      userId: "user-1",
      cognitiveDebtId: "debt-1",
      cardId: "card-1",
      trainingStage: "delayed_recall",
      taskType: "short_recall",
      prompt: "Explain X without hints",
      hintsAllowed: false,
      maxHints: 0,
      createdAt: "2026-07-28T10:00:00Z",
      dueAt: "2026-07-29T10:00:00Z",
      status: "pending"
    };
    await store.saveReviewTask(task);

    const store2 = createTrainingStore(storePath);
    await store2.load();
    const recovered = store2.getReviewTask("task-1");
    expect(recovered.prompt).toBe("Explain X without hints");
    expect(recovered.status).toBe("pending");
  });
});

describe("training-store — userId isolation", () => {
  let store;

  beforeEach(async () => {
    store = await freshStore();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("isolates attempts by userId", async () => {
    await store.saveAttempt({ id: "a1", userId: "alice", cardId: "c1", cognitiveDebtId: "d1" });
    await store.saveAttempt({ id: "a2", userId: "bob", cardId: "c2", cognitiveDebtId: "d2" });

    expect(store.listAttempts("alice")).toHaveLength(1);
    expect(store.listAttempts("bob")).toHaveLength(1);
    expect(store.listAttempts("alice")[0].id).toBe("a1");
  });

  it("isolates cognitive debts by userId", async () => {
    await store.saveCognitiveDebt({ id: "d1", userId: "alice", gapText: "gap A", status: "new" });
    await store.saveCognitiveDebt({ id: "d2", userId: "bob", gapText: "gap B", status: "new" });

    expect(store.listCognitiveDebts("alice")).toHaveLength(1);
    expect(store.listCognitiveDebts("bob")).toHaveLength(1);
  });

  it("isolates review tasks by userId", async () => {
    await store.saveReviewTask({ id: "t1", userId: "alice", cognitiveDebtId: "d1", status: "pending", dueAt: "2026-07-29T00:00:00Z" });
    await store.saveReviewTask({ id: "t2", userId: "bob", cognitiveDebtId: "d2", status: "pending", dueAt: "2026-07-29T00:00:00Z" });

    expect(store.listReviewTasks("alice")).toHaveLength(1);
    expect(store.listReviewTasks("bob")).toHaveLength(1);
  });

  it("throws on cross-user getAttempt", async () => {
    await store.saveAttempt({ id: "a1", userId: "alice", cardId: "c1", cognitiveDebtId: "d1" });
    expect(() => store.getAttempt("a1", "bob")).toThrow(/not found/i);
  });

  it("throws on cross-user getCognitiveDebt", async () => {
    await store.saveCognitiveDebt({ id: "d1", userId: "alice", gapText: "gap", status: "new" });
    expect(() => store.getCognitiveDebt("d1", "bob")).toThrow(/not found/i);
  });

  it("defaults to demo-user when userId not provided", async () => {
    await store.saveAttempt({ id: "a1", cardId: "c1", cognitiveDebtId: "d1" });
    const attempt = store.getAttempt("a1");
    expect(attempt.userId).toBe("demo-user");
  });
});

describe("training-store — query filters", () => {
  let store;

  beforeEach(async () => {
    store = await freshStore();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("filters attempts by cognitiveDebtId", async () => {
    await store.saveAttempt({ id: "a1", userId: "u1", cardId: "c1", cognitiveDebtId: "d1" });
    await store.saveAttempt({ id: "a2", userId: "u1", cardId: "c2", cognitiveDebtId: "d2" });
    await store.saveAttempt({ id: "a3", userId: "u1", cardId: "c3", cognitiveDebtId: "d1" });

    const result = store.listAttempts("u1", { cognitiveDebtId: "d1" });
    expect(result).toHaveLength(2);
    expect(result.every(a => a.cognitiveDebtId === "d1")).toBe(true);
  });

  it("filters review tasks by status", async () => {
    await store.saveReviewTask({ id: "t1", userId: "u1", cognitiveDebtId: "d1", status: "pending", dueAt: "2026-07-29T00:00:00Z" });
    await store.saveReviewTask({ id: "t2", userId: "u1", cognitiveDebtId: "d1", status: "completed", dueAt: "2026-07-29T00:00:00Z" });
    await store.saveReviewTask({ id: "t3", userId: "u1", cognitiveDebtId: "d1", status: "pending", dueAt: "2026-07-29T00:00:00Z" });

    const pending = store.listReviewTasks("u1", { status: "pending" });
    expect(pending).toHaveLength(2);
  });

  it("listDueReviews returns only pending tasks past dueAt", async () => {
    const past = "2026-07-01T00:00:00Z";
    const future = "2026-12-01T00:00:00Z";
    await store.saveReviewTask({ id: "t1", userId: "u1", cognitiveDebtId: "d1", status: "pending", dueAt: past });
    await store.saveReviewTask({ id: "t2", userId: "u1", cognitiveDebtId: "d1", status: "pending", dueAt: future });
    await store.saveReviewTask({ id: "t3", userId: "u1", cognitiveDebtId: "d1", status: "completed", dueAt: past });

    const due = store.listDueReviews("u1", "2026-07-28T00:00:00Z");
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("t1");
  });
});

describe("training-store — findCognitiveDebtByGap", () => {
  let store;

  beforeEach(async () => {
    store = await freshStore();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("finds existing debt by gap text (case-insensitive)", async () => {
    await store.saveCognitiveDebt({
      id: "d1", userId: "u1", gapText: "Git 工作区", status: "new"
    });
    const found = store.findCognitiveDebtByGap("u1", "git 工作区");
    expect(found).toBeTruthy();
    expect(found.id).toBe("d1");
  });

  it("returns null for non-existent gap", async () => {
    const found = store.findCognitiveDebtByGap("u1", "nonexistent");
    expect(found).toBeNull();
  });

  it("does not match across users", async () => {
    await store.saveCognitiveDebt({
      id: "d1", userId: "alice", gapText: "Git", status: "new"
    });
    const found = store.findCognitiveDebtByGap("bob", "Git");
    expect(found).toBeNull();
  });
});

describe("training-store — capability nodes", () => {
  let store;

  beforeEach(async () => {
    store = await freshStore();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("creates and retrieves capability", async () => {
    await store.saveCapability({
      id: "cap-1", name: "Git 版本管理", cognitiveDebtIds: [], overallMastery: 0,
      createdAt: "2026-07-28T00:00:00Z"
    });
    const cap = store.getCapability("cap-1");
    expect(cap.name).toBe("Git 版本管理");
  });

  it("finds capability by name (case-insensitive)", async () => {
    await store.saveCapability({
      id: "cap-1", name: "Git 版本管理", cognitiveDebtIds: [], overallMastery: 0,
      createdAt: "2026-07-28T00:00:00Z"
    });
    const found = store.findCapabilityByName("git 版本管理");
    expect(found).toBeTruthy();
    expect(found.id).toBe("cap-1");
  });
});
