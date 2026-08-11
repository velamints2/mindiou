import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

function clean(value, limit = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, limit);
}

function json(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

function now() {
  return new Date().toISOString();
}

function rowRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    clientRunId: row.client_run_id,
    activitySessionId: row.activity_session_id || undefined,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    source: row.source,
    result: json(row.result_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowFeedback(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    userId: row.user_id,
    kind: row.kind,
    targetId: row.target_id || undefined,
    payload: json(row.payload_json, {}),
    createdAt: row.created_at
  };
}

export function createCognitiveLoopStore(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS cognitive_loop_runs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL, client_run_id TEXT NOT NULL, activity_session_id TEXT, window_start TEXT NOT NULL, window_end TEXT NOT NULL, source TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, client_run_id)); CREATE INDEX IF NOT EXISTS idx_cognitive_loop_runs_project ON cognitive_loop_runs(user_id, project_id, updated_at); CREATE TABLE IF NOT EXISTS cognitive_loop_feedback (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(run_id) REFERENCES cognitive_loop_runs(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_cognitive_loop_feedback_run ON cognitive_loop_feedback(user_id, run_id, created_at);");

  const getRunRow = db.prepare("SELECT * FROM cognitive_loop_runs WHERE id = ? AND user_id = ?");

  function getRun(runId, userId) {
    return rowRun(getRunRow.get(String(runId), String(userId)));
  }

  function getByClientRunId(clientRunId, userId) {
    return rowRun(db.prepare("SELECT * FROM cognitive_loop_runs WHERE client_run_id = ? AND user_id = ?").get(String(clientRunId), String(userId)));
  }

  function getLatestRun(projectId, userId) {
    return rowRun(db.prepare("SELECT * FROM cognitive_loop_runs WHERE project_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 1").get(String(projectId), String(userId)));
  }

  function saveRun(input = {}) {
    const timestamp = now();
    const run = {
      id: clean(input.id, 120),
      userId: clean(input.userId, 120),
      projectId: clean(input.projectId, 120),
      clientRunId: clean(input.clientRunId || input.id, 160),
      activitySessionId: clean(input.activitySessionId, 120) || null,
      windowStart: clean(input.windowStart, 60),
      windowEnd: clean(input.windowEnd, 60),
      source: clean(input.source || "rule_fallback", 80),
      result: input.result || {},
      createdAt: input.createdAt || timestamp,
      updatedAt: timestamp
    };
    if (!run.id || !run.userId || !run.projectId || !run.clientRunId) throw new Error("Cognitive Loop run identity is required");
    db.prepare("INSERT INTO cognitive_loop_runs (id,user_id,project_id,client_run_id,activity_session_id,window_start,window_end,source,result_json,created_at,updated_at) VALUES (@id,@userId,@projectId,@clientRunId,@activitySessionId,@windowStart,@windowEnd,@source,@result,@createdAt,@updatedAt) ON CONFLICT(id) DO UPDATE SET activity_session_id=excluded.activity_session_id,window_start=excluded.window_start,window_end=excluded.window_end,source=excluded.source,result_json=excluded.result_json,updated_at=excluded.updated_at").run({ ...run, result: JSON.stringify(run.result) });
    return getRun(run.id, run.userId);
  }

  function listFeedback(runId, userId) {
    getRun(runId, userId);
    return db.prepare("SELECT * FROM cognitive_loop_feedback WHERE run_id = ? AND user_id = ? ORDER BY created_at ASC").all(runId, userId).map(rowFeedback);
  }

  function listRecentFeedback(projectId, userId, limit = 30) {
    return db.prepare("SELECT f.* FROM cognitive_loop_feedback f JOIN cognitive_loop_runs r ON r.id = f.run_id WHERE r.project_id = ? AND f.user_id = ? ORDER BY f.created_at DESC LIMIT ?").all(projectId, userId, Math.max(1, Math.min(100, Number(limit) || 30))).map(rowFeedback);
  }

  function recordFeedback(input = {}) {
    const run = getRun(input.runId, input.userId);
    if (!run) throw new Error("Cognitive Loop run not found");
    const kind = ["recommendation", "correction", "experiment"].includes(input.kind) ? input.kind : "recommendation";
    const feedback = {
      id: clean(input.id, 120) || "feedback-" + Date.now() + "-" + Math.random().toString(16).slice(2),
      runId: run.id,
      userId: run.userId,
      kind,
      targetId: clean(input.targetId, 160) || null,
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      createdAt: now()
    };
    db.prepare("INSERT INTO cognitive_loop_feedback (id,run_id,user_id,kind,target_id,payload_json,created_at) VALUES (@id,@runId,@userId,@kind,@targetId,@payload,@createdAt)").run({ ...feedback, payload: JSON.stringify(feedback.payload) });
    return rowFeedback(db.prepare("SELECT * FROM cognitive_loop_feedback WHERE id = ?").get(feedback.id));
  }

  return {
    dbPath: resolvedPath,
    getRun,
    getByClientRunId,
    getLatestRun,
    saveRun,
    listFeedback,
    listRecentFeedback,
    recordFeedback
  };
}

