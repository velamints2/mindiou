import fs from "node:fs";
import path from "node:path";
import { createAssessmentStore } from "../assessment-store.js";
import { afterEach, beforeEach, expect, it } from "vitest";

const testDir = path.resolve("tmp/assessment-store-tests");
const dbPath = path.join(testDir, "assessment.sqlite");

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* clean slate */ }
  }
});

afterEach(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* already closed/removed */ }
  }
});

it("persists completions and deduplicates a retried completion", () => {
  const store = createAssessmentStore(dbPath);
  expect(store.recordCompletion({
    completionId: "MIOU-ACT-V1.1:developer:2026-08-06T00:00:00.000Z",
    completedAt: "2026-08-06T00:10:00.000Z",
    role: "developer",
    locale: "zh-CN",
    mode: "model_structured"
  }).inserted).toBe(true);
  expect(store.recordCompletion({
    completionId: "MIOU-ACT-V1.1:developer:2026-08-06T00:00:00.000Z",
    completedAt: "2026-08-06T00:11:00.000Z",
    role: "developer",
    locale: "zh-CN",
    mode: "model_structured"
  }).inserted).toBe(false);
  expect(store.stats("2026-08-05T16:00:00.000Z")).toMatchObject({
    total: 1,
    today: 1,
    byRole: { developer: 1 },
    byLocale: { "zh-CN": 1 },
    byMode: { model_structured: 1 }
  });
  store.close();
});
