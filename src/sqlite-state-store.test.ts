// @ts-nocheck
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { createSqliteStateNamespace, createUsageLedger } from "../sqlite-state-store.js";

const testDir = path.resolve("tmp/sqlite-state-tests");
const dbPath = path.join(testDir, "mindiou.sqlite");
const legacyPath = path.join(testDir, "mvp0-store.json");

async function cleanup() {
  for (const suffix of ["", "-wal", "-shm"]) await rm(`${dbPath}${suffix}`, { force: true });
  await rm(legacyPath, { force: true });
}

afterEach(cleanup);

describe("SQLite application state", () => {
  it("enables WAL and persists isolated namespaces", async () => {
    await mkdir(testDir, { recursive: true });
    const reports = createSqliteStateNamespace(dbPath, "mvp0");
    const training = createSqliteStateNamespace(dbPath, "training");
    expect(reports.journalMode()).toBe("wal");
    await reports.load({ clearanceReports: [] });
    await training.load({ trainingAttempts: [] });
    reports.save({ clearanceReports: [{ id: "r1" }] });
    training.save({ trainingAttempts: [{ id: "a1" }] });

    const reopenedReports = createSqliteStateNamespace(dbPath, "mvp0");
    const reopenedTraining = createSqliteStateNamespace(dbPath, "training");
    expect(await reopenedReports.load({})).toEqual({ clearanceReports: [{ id: "r1" }] });
    expect(await reopenedTraining.load({})).toEqual({ trainingAttempts: [{ id: "a1" }] });
  });

  it("migrates legacy JSON once and never reads later JSON changes", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ clearanceReports: [{ id: "legacy" }] }));
    const first = createSqliteStateNamespace(dbPath, "mvp0", { legacyJsonPath: legacyPath });
    expect(await first.load({ clearanceReports: [] })).toEqual({ clearanceReports: [{ id: "legacy" }] });
    await writeFile(legacyPath, JSON.stringify({ clearanceReports: [{ id: "changed-after-migration" }] }));
    const second = createSqliteStateNamespace(dbPath, "mvp0", { legacyJsonPath: legacyPath });
    expect(await second.load({ clearanceReports: [] })).toEqual({ clearanceReports: [{ id: "legacy" }] });
  });

  it("records migration evidence and passes integrity check", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ clearanceReports: [{ id: "r1" }], drafts: [{ id: "d1" }] }));
    await createSqliteStateNamespace(dbPath, "mvp0", { legacyJsonPath: legacyPath }).load({});
    const db = new Database(dbPath, { readonly: true });
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.prepare("SELECT record_count FROM data_migrations WHERE migration_key = ?")
      .get("json-to-sqlite:mvp0:v1").record_count).toBe(2);
    db.close();
  });

  it("atomically enforces daily analysis and estimated token budgets", async () => {
    await mkdir(testDir, { recursive: true });
    const ledger = createUsageLedger(dbPath);
    const limits = { analysisLimit: 3, tokenBudget: 1_000 };
    expect(ledger.consumeAnalysis("user-1", "2026-08-03", 200, limits)).toMatchObject({
      analysisCount: 1,
      estimatedAiTokens: 200
    });
    ledger.consumeAnalysis("user-1", "2026-08-03", 200, limits);
    ledger.consumeAnalysis("user-1", "2026-08-03", 200, limits);
    expect(() => ledger.consumeAnalysis("user-1", "2026-08-03", 1, limits)).toThrow(/Daily analysis limit/);
    expect(ledger.getUsage("user-1", "2026-08-03")).toEqual({
      analysisCount: 3,
      estimatedAiTokens: 600
    });

    expect(() => ledger.consumeAnalysis("user-2", "2026-08-03", 1_001, limits)).toThrow(/token budget/);
    expect(ledger.getUsage("user-2", "2026-08-03")).toEqual({
      analysisCount: 0,
      estimatedAiTokens: 0
    });
  });
});
