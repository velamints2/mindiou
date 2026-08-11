import Database from "better-sqlite3";

function clean(value, fallback = "unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeTimestamp(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function createAssessmentStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessment_completions (
      completion_id TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL,
      role TEXT NOT NULL,
      locale TEXT NOT NULL,
      mode TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'assessment_review',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assessment_completions_completed_at
      ON assessment_completions (completed_at);
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO assessment_completions
      (completion_id, completed_at, role, locale, mode, source, created_at)
    VALUES (@completionId, @completedAt, @role, @locale, @mode, @source, @createdAt)
  `);
  const getRange = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN completed_at >= @startOfDay THEN 1 ELSE 0 END) AS today
    FROM assessment_completions
  `);
  const getDistributions = db.prepare(`
    SELECT role, locale, mode, COUNT(*) AS count
    FROM assessment_completions
    GROUP BY role, locale, mode
  `);

  return {
    recordCompletion(input = {}) {
      const completedAt = normalizeTimestamp(input.completedAt);
      const completionId = clean(input.completionId, `legacy-${completedAt}-${clean(input.role)}`);
      const result = insert.run({
        completionId,
        completedAt,
        role: clean(input.role),
        locale: clean(input.locale),
        mode: clean(input.mode),
        source: clean(input.source, "assessment_review"),
        createdAt: new Date().toISOString()
      });
      return { inserted: result.changes === 1, completionId };
    },
    stats(startOfDay) {
      const row = getRange.get({ startOfDay: normalizeTimestamp(startOfDay) });
      const byRole = {}, byLocale = {}, byMode = {};
      for (const item of getDistributions.all()) {
        byRole[item.role] = (byRole[item.role] || 0) + Number(item.count || 0);
        byLocale[item.locale] = (byLocale[item.locale] || 0) + Number(item.count || 0);
        byMode[item.mode] = (byMode[item.mode] || 0) + Number(item.count || 0);
      }
      return { total: Number(row.total || 0), today: Number(row.today || 0), byRole, byLocale, byMode };
    },
    count() {
      return Number(db.prepare("SELECT COUNT(*) AS count FROM assessment_completions").get().count || 0);
    },
    close() { db.close(); }
  };
}
