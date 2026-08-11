import path from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createCognitiveLoopStore } from "../cognitive-loop-store.js";

describe("cognitive-loop-store", () => {
  it("persists a run, isolates it by user, and records feedback", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mindiou-cognitive-loop-"));
    const store = createCognitiveLoopStore(path.join(directory, "loop.sqlite"));
    const result = { schemaVersion: "cognitive-loop-mvp-1", aiUsageDebts: [] };
    const saved = store.saveRun({
      id: "run-1",
      userId: "user-1",
      projectId: "project-1",
      clientRunId: "client-1",
      windowStart: "2026-08-05T00:00:00.000Z",
      windowEnd: "2026-08-12T00:00:00.000Z",
      source: "rule_fallback",
      result
    });

    expect(saved.result).toEqual(result);
    expect(store.getLatestRun("project-1", "user-1")?.id).toBe("run-1");
    expect(store.getLatestRun("project-1", "user-2")).toBeNull();

    const feedback = store.recordFeedback({
      runId: "run-1",
      userId: "user-1",
      kind: "correction",
      targetId: "ai-usage-debt-verification",
      payload: { accepted: false, note: "这次判断不适用于当前任务" }
    });
    expect(feedback.kind).toBe("correction");
    expect(store.listFeedback("run-1", "user-1")).toHaveLength(1);
  });

  it("uses a client run id as an idempotent retry key", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mindiou-cognitive-loop-"));
    const store = createCognitiveLoopStore(path.join(directory, "loop.sqlite"));
    const base = {
      userId: "user-1",
      projectId: "project-1",
      clientRunId: "same-client-run",
      windowStart: "2026-08-05T00:00:00.000Z",
      windowEnd: "2026-08-12T00:00:00.000Z",
      source: "rule_fallback"
    };
    store.saveRun({ ...base, id: "run-a", result: { version: 1 } });
    expect(store.getByClientRunId("same-client-run", "user-1")?.id).toBe("run-a");
  });
});

