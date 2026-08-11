import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { traceEvent } from "./ops/observability.mjs";

export function openApplicationDatabase(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  traceEvent("sqlite.open", { dbPath: resolvedPath, journalMode: "wal" });
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_state (
      namespace TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS data_migrations (
      migration_key TEXT PRIMARY KEY,
      source_path TEXT,
      migrated_at TEXT NOT NULL,
      record_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS daily_usage (
      user_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      analysis_count INTEGER NOT NULL DEFAULT 0,
      estimated_ai_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, usage_date)
    );
  `);
  return db;
}

export function createUsageLedger(dbPath) {
  const db = openApplicationDatabase(dbPath);
  const read = db.prepare(`
    SELECT analysis_count, estimated_ai_tokens
    FROM daily_usage WHERE user_id = ? AND usage_date = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO daily_usage (user_id, usage_date, analysis_count, estimated_ai_tokens, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(user_id, usage_date) DO UPDATE SET
      analysis_count = analysis_count + 1,
      estimated_ai_tokens = estimated_ai_tokens + excluded.estimated_ai_tokens,
      updated_at = excluded.updated_at
  `);
  const consume = db.transaction((userId, usageDate, estimatedTokens, limits) => {
    const current = read.get(userId, usageDate) || { analysis_count: 0, estimated_ai_tokens: 0 };
    if (current.analysis_count >= limits.analysisLimit) {
      const error = new Error(`Daily analysis limit reached (${limits.analysisLimit})`);
      error.statusCode = 429;
      error.code = "DAILY_ANALYSIS_LIMIT";
      throw error;
    }
    if (current.estimated_ai_tokens + estimatedTokens > limits.tokenBudget) {
      const error = new Error(`Daily AI token budget reached (${limits.tokenBudget})`);
      error.statusCode = 429;
      error.code = "DAILY_AI_TOKEN_BUDGET";
      throw error;
    }
    upsert.run(userId, usageDate, estimatedTokens, new Date().toISOString());
    return {
      analysisCount: current.analysis_count + 1,
      estimatedAiTokens: current.estimated_ai_tokens + estimatedTokens,
      analysisLimit: limits.analysisLimit,
      tokenBudget: limits.tokenBudget
    };
  });
  return {
    consumeAnalysis(userId, usageDate, estimatedTokens, limits) {
      return consume(String(userId), String(usageDate), Number(estimatedTokens), limits);
    },
    getUsage(userId, usageDate) {
      const row = read.get(String(userId), String(usageDate));
      return {
        analysisCount: Number(row?.analysis_count || 0),
        estimatedAiTokens: Number(row?.estimated_ai_tokens || 0)
      };
    }
  };
}

function countRecords(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((total, item) => total + (Array.isArray(item) ? item.length : 0), 0);
}

export function createSqliteStateNamespace(dbPath, namespace, { version = 1, legacyJsonPath } = {}) {
  const db = openApplicationDatabase(dbPath);
  const readRow = db.prepare("SELECT payload FROM application_state WHERE namespace = ?");
  const upsertRow = db.prepare(`
    INSERT INTO application_state (namespace, version, payload, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(namespace) DO UPDATE SET
      version = excluded.version,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  const readMigration = db.prepare("SELECT migration_key FROM data_migrations WHERE migration_key = ?");
  const writeMigration = db.prepare(`
    INSERT OR IGNORE INTO data_migrations (migration_key, source_path, migrated_at, record_count)
    VALUES (?, ?, ?, ?)
  `);
  const commit = db.transaction((payload, migration) => {
    upsertRow.run(namespace, version, JSON.stringify(payload), new Date().toISOString());
    if (migration) writeMigration.run(migration.key, migration.sourcePath, migration.migratedAt, migration.recordCount);
  });

  async function load(fallback) {
    const existing = readRow.get(namespace);
    const sourcePath = legacyJsonPath ? path.resolve(legacyJsonPath) : null;
    const migrationKey = `json-to-sqlite:${namespace}:v${version}`;
    const existingPayload = existing ? JSON.parse(existing.payload) : null;
    const mayImportLegacy = !existing || countRecords(existingPayload) === 0;
    if (sourcePath && mayImportLegacy && !readMigration.get(migrationKey)) {
      try {
        const imported = JSON.parse(await readFile(sourcePath, "utf8"));
        commit(imported, {
          key: migrationKey,
          sourcePath,
          migratedAt: new Date().toISOString(),
          recordCount: countRecords(imported)
        });
        return imported;
      } catch (error) {
        if (error.code !== "ENOENT") console.warn(`${namespace} legacy JSON could not be migrated: ${error.message}`);
      }
    }
    if (existing) return existingPayload;
    commit(fallback, null);
    return fallback;
  }

  function save(payload) {
    commit(payload, null);
  }

  function journalMode() {
    return String(db.pragma("journal_mode", { simple: true })).toLowerCase();
  }

  return { load, save, journalMode, dbPath: path.resolve(dbPath) };
}
