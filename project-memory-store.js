import crypto from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import { redactContent, sanitizeRepositoryPath, fingerprint } from "./project-memory-analysis.js";

const PROJECT_TYPES = new Set(["software", "product", "research", "content", "other"]);
const WORK_ITEM_TYPES = new Set(["feature", "bug", "refactor", "research", "design", "deployment", "decision", "other"]);
const WORK_ITEM_STATUSES = new Set(["detected", "in_progress", "implemented", "verified", "archived"]);
const ARTIFACT_TYPES = new Set(["file", "function", "class", "module", "commit", "pull_request", "database_migration", "api_endpoint", "document", "deployment", "other"]);
const DEBT_RELATIONS = new Set(["caused_by", "implemented_in", "affects", "validated_by", "recurred_in"]);

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clean(value, limit = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function json(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; }
}

function jsonText(value, fallback = []) {
  return JSON.stringify(value ?? fallback);
}

function now() { return new Date().toISOString(); }

function rowProject(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, name: row.name, description: row.description || undefined, projectType: row.project_type, repositoryUrl: row.repository_url || undefined, localWorkspaceFingerprint: row.local_workspace_fingerprint || undefined, defaultBranch: row.default_branch || undefined, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowWorkItem(row) {
  if (!row) return null;
  return { id: row.id, projectId: row.project_id, userId: row.user_id, title: row.title, summary: row.summary || undefined, type: row.type, status: row.status, source: row.source, confidence: row.confidence == null ? undefined : Number(row.confidence), startedAt: row.started_at || undefined, completedAt: row.completed_at || undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowSession(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, projectId: row.project_id || undefined, platform: row.platform, externalSessionId: row.external_session_id || undefined, sourceFingerprint: row.source_fingerprint, title: row.title || undefined, rawTitle: row.raw_title || undefined, startedAt: row.started_at || undefined, endedAt: row.ended_at || undefined, userIntentSummary: row.user_intent_summary || undefined, implementationSummary: row.implementation_summary || undefined, outcomeSummary: row.outcome_summary || undefined, keyTopics: json(row.key_topics, []), technologies: json(row.technologies, []), importMethod: row.import_method, rawContentStorage: row.raw_content_storage, rawContentReference: row.raw_content_reference || undefined, processingStatus: row.processing_status, analysis: json(row.analysis_json, null), createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowArtifact(row) {
  if (!row) return null;
  return { id: row.id, projectId: row.project_id, userId: row.user_id, type: row.type, name: row.name, repositoryRelativePath: row.repository_relative_path || undefined, symbolName: row.symbol_name || undefined, gitCommitHash: row.git_commit_hash || undefined, pullRequestUrl: row.pull_request_url || undefined, contentHash: row.content_hash || undefined, diffSummary: row.diff_summary || undefined, relevantSnippet: row.relevant_snippet || undefined, language: row.language || undefined, sensitivity: row.sensitivity, firstSeenAt: row.first_seen_at || undefined, lastSeenAt: row.last_seen_at || undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowDecision(row) {
  if (!row) return null;
  return { id: row.id, projectId: row.project_id, workItemId: row.work_item_id || undefined, sessionId: row.session_id || undefined, userId: row.user_id, title: row.title, decision: row.decision, rationale: row.rationale || undefined, alternatives: json(row.alternatives, []), tradeoffs: json(row.tradeoffs, []), assumptions: json(row.assumptions, []), risks: json(row.risks, []), decisionType: row.decision_type, decisionMaker: row.decision_maker, userParticipation: row.user_participation, importance: row.importance, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function createProjectMemoryStore(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pm_projects (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT,
      project_type TEXT NOT NULL DEFAULT 'software', repository_url TEXT,
      local_workspace_fingerprint TEXT, default_branch TEXT, status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pm_projects_user ON pm_projects(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS pm_work_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT NOT NULL,
      summary TEXT, type TEXT NOT NULL DEFAULT 'feature', status TEXT NOT NULL DEFAULT 'detected',
      source TEXT NOT NULL DEFAULT 'user_created', confidence REAL, started_at TEXT, completed_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pm_work_items_project ON pm_work_items(project_id, updated_at);
    CREATE TABLE IF NOT EXISTS pm_agent_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, platform TEXT NOT NULL,
      external_session_id TEXT, source_fingerprint TEXT NOT NULL, title TEXT, raw_title TEXT,
      started_at TEXT, ended_at TEXT, user_intent_summary TEXT, implementation_summary TEXT,
      outcome_summary TEXT, key_topics TEXT, technologies TEXT, import_method TEXT NOT NULL,
      raw_content_storage TEXT NOT NULL DEFAULT 'not_stored', raw_content_reference TEXT,
      raw_content TEXT, processing_status TEXT NOT NULL DEFAULT 'pending', analysis_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(user_id, source_fingerprint), FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pm_sessions_project ON pm_agent_sessions(project_id, updated_at);
    CREATE TABLE IF NOT EXISTS pm_artifacts (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL,
      name TEXT NOT NULL, repository_relative_path TEXT, symbol_name TEXT, git_commit_hash TEXT,
      pull_request_url TEXT, content_hash TEXT, diff_summary TEXT, relevant_snippet TEXT,
      language TEXT, sensitivity TEXT NOT NULL DEFAULT 'metadata_only', first_seen_at TEXT,
      last_seen_at TEXT, artifact_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_pm_artifacts_project ON pm_artifacts(project_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_pm_artifacts_commit ON pm_artifacts(git_commit_hash);
    CREATE TABLE IF NOT EXISTS pm_session_artifacts (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, artifact_id TEXT NOT NULL,
      relation TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, artifact_id),
      FOREIGN KEY(session_id) REFERENCES pm_agent_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(artifact_id) REFERENCES pm_artifacts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pm_session_work_items (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, work_item_id TEXT NOT NULL, relation TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'automatic', created_at TEXT NOT NULL,
      UNIQUE(session_id, work_item_id), FOREIGN KEY(session_id) REFERENCES pm_agent_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY(work_item_id) REFERENCES pm_work_items(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pm_work_item_artifacts (
      id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL, artifact_id TEXT NOT NULL, relation TEXT NOT NULL,
      source_session_id TEXT, created_at TEXT NOT NULL, UNIQUE(work_item_id, artifact_id),
      FOREIGN KEY(work_item_id) REFERENCES pm_work_items(id) ON DELETE CASCADE,
      FOREIGN KEY(artifact_id) REFERENCES pm_artifacts(id) ON DELETE CASCADE,
      FOREIGN KEY(source_session_id) REFERENCES pm_agent_sessions(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS pm_decisions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, work_item_id TEXT, session_id TEXT, user_id TEXT NOT NULL,
      title TEXT NOT NULL, decision TEXT NOT NULL, rationale TEXT, alternatives TEXT, tradeoffs TEXT,
      assumptions TEXT, risks TEXT, decision_type TEXT NOT NULL DEFAULT 'other', decision_maker TEXT NOT NULL DEFAULT 'unknown',
      user_participation TEXT NOT NULL DEFAULT 'unknown', importance TEXT NOT NULL DEFAULT 'medium',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE CASCADE,
      FOREIGN KEY(work_item_id) REFERENCES pm_work_items(id) ON DELETE SET NULL,
      FOREIGN KEY(session_id) REFERENCES pm_agent_sessions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pm_decisions_project ON pm_decisions(project_id, updated_at);
    CREATE TABLE IF NOT EXISTS pm_debt_artifact_links (
      id TEXT PRIMARY KEY, debt_id TEXT NOT NULL, artifact_id TEXT NOT NULL, work_item_id TEXT,
      session_id TEXT, decision_id TEXT, relation TEXT NOT NULL, relevance TEXT NOT NULL DEFAULT 'primary', created_at TEXT NOT NULL,
      UNIQUE(debt_id, artifact_id, relation), FOREIGN KEY(artifact_id) REFERENCES pm_artifacts(id) ON DELETE CASCADE,
      FOREIGN KEY(work_item_id) REFERENCES pm_work_items(id) ON DELETE SET NULL,
      FOREIGN KEY(session_id) REFERENCES pm_agent_sessions(id) ON DELETE SET NULL,
      FOREIGN KEY(decision_id) REFERENCES pm_decisions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pm_debt_links_debt ON pm_debt_artifact_links(debt_id, created_at);
    CREATE TABLE IF NOT EXISTS pm_evidence_records (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, debt_id TEXT NOT NULL, project_id TEXT, work_item_id TEXT,
      artifact_id TEXT, training_attempt_id TEXT, evidence_type TEXT NOT NULL, evidence_level TEXT NOT NULL,
      result TEXT NOT NULL, evidence_summary TEXT, external_reference TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE SET NULL,
      FOREIGN KEY(work_item_id) REFERENCES pm_work_items(id) ON DELETE SET NULL,
      FOREIGN KEY(artifact_id) REFERENCES pm_artifacts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS pm_debt_recurrences (
      id TEXT PRIMARY KEY, debt_id TEXT NOT NULL, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
      work_item_id TEXT, session_id TEXT, artifact_id TEXT, reason TEXT NOT NULL, confidence REAL NOT NULL,
      detected_at TEXT NOT NULL, confirmed_by_user INTEGER, UNIQUE(debt_id, session_id, project_id),
      FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE CASCADE,
      FOREIGN KEY(work_item_id) REFERENCES pm_work_items(id) ON DELETE SET NULL,
      FOREIGN KEY(session_id) REFERENCES pm_agent_sessions(id) ON DELETE SET NULL,
      FOREIGN KEY(artifact_id) REFERENCES pm_artifacts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS pm_hook_tokens (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, user_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      name TEXT, created_at TEXT NOT NULL, revoked_at TEXT,
      FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS pm_hook_events (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT, session_id TEXT, event_type TEXT NOT NULL,
      payload TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(user_id, id), FOREIGN KEY(project_id) REFERENCES pm_projects(id) ON DELETE SET NULL
    );
  `);

  const getProjectRow = db.prepare("SELECT * FROM pm_projects WHERE id = ? AND user_id = ?");
  function requireProject(projectId, userId) {
    const row = getProjectRow.get(String(projectId), String(userId));
    if (!row) throw new Error("Project not found");
    return rowProject(row);
  }
  function ensureProject(input, userId) {
    if (input?.id) return requireProject(input.id, userId);
    const workspace = clean(input?.localWorkspaceFingerprint, 200);
    if (workspace) {
      const existing = db.prepare("SELECT * FROM pm_projects WHERE user_id = ? AND local_workspace_fingerprint = ? AND status = 'active' LIMIT 1").get(userId, workspace);
      if (existing) return rowProject(existing);
    }
    return createProject({ ...input, localWorkspaceFingerprint: workspace || undefined }, userId);
  }
  function createProject(input = {}, userId) {
    const projectId = id("project");
    const timestamp = now();
    const project = { id: projectId, userId: clean(userId, 120), name: clean(input.name || "未命名项目", 200) || "未命名项目", description: clean(input.description, 2000) || null, projectType: PROJECT_TYPES.has(input.projectType) ? input.projectType : "software", repositoryUrl: clean(input.repositoryUrl, 1000) || null, localWorkspaceFingerprint: clean(input.localWorkspaceFingerprint, 200) || null, defaultBranch: clean(input.defaultBranch, 120) || null, status: input.status === "archived" ? "archived" : "active", createdAt: timestamp, updatedAt: timestamp };
    db.prepare(`INSERT INTO pm_projects (id,user_id,name,description,project_type,repository_url,local_workspace_fingerprint,default_branch,status,created_at,updated_at) VALUES (@id,@userId,@name,@description,@projectType,@repositoryUrl,@localWorkspaceFingerprint,@defaultBranch,@status,@createdAt,@updatedAt)`).run(project);
    return project;
  }

  function listProjects(userId) {
    return db.prepare("SELECT * FROM pm_projects WHERE user_id = ? ORDER BY updated_at DESC").all(userId).map(rowProject);
  }
  function getProject(projectId, userId) { return requireProject(projectId, userId); }
  function updateProject(projectId, input, userId) {
    const current = requireProject(projectId, userId);
    const updated = { ...current, name: input.name == null ? current.name : clean(input.name, 200), description: input.description == null ? current.description : clean(input.description, 2000) || undefined, projectType: input.projectType && PROJECT_TYPES.has(input.projectType) ? input.projectType : current.projectType, repositoryUrl: input.repositoryUrl == null ? current.repositoryUrl : clean(input.repositoryUrl, 1000) || undefined, localWorkspaceFingerprint: input.localWorkspaceFingerprint == null ? current.localWorkspaceFingerprint : clean(input.localWorkspaceFingerprint, 200) || undefined, defaultBranch: input.defaultBranch == null ? current.defaultBranch : clean(input.defaultBranch, 120) || undefined, status: input.status === "archived" ? "archived" : input.status === "active" ? "active" : current.status, updatedAt: now() };
    db.prepare("UPDATE pm_projects SET name=?,description=?,project_type=?,repository_url=?,local_workspace_fingerprint=?,default_branch=?,status=?,updated_at=? WHERE id=? AND user_id=?").run(updated.name, updated.description || null, updated.projectType, updated.repositoryUrl || null, updated.localWorkspaceFingerprint || null, updated.defaultBranch || null, updated.status, updated.updatedAt, projectId, userId);
    return updated;
  }
  function deleteProject(projectId, userId) {
    requireProject(projectId, userId);
    const result = db.prepare("DELETE FROM pm_projects WHERE id=? AND user_id=?").run(projectId, userId);
    if (!result.changes) throw new Error("Project not found");
    return { id: projectId, deleted: true };
  }

  function createWorkItem(input = {}, userId) {
    const project = requireProject(input.projectId, userId);
    const timestamp = now();
    const record = { id: id("work"), projectId: project.id, userId: clean(userId, 120), title: clean(input.title, 200), summary: clean(input.summary, 3000) || undefined, type: WORK_ITEM_TYPES.has(input.type) ? input.type : "feature", status: WORK_ITEM_STATUSES.has(input.status) ? input.status : "detected", source: clean(input.source || "user_created", 40), confidence: input.confidence == null ? undefined : Math.max(0, Math.min(1, Number(input.confidence))), startedAt: input.startedAt || undefined, completedAt: input.completedAt || undefined, createdAt: timestamp, updatedAt: timestamp };
    if (!record.title) throw new Error("Work item title is required");
    db.prepare(`INSERT INTO pm_work_items (id,project_id,user_id,title,summary,type,status,source,confidence,started_at,completed_at,created_at,updated_at) VALUES (@id,@projectId,@userId,@title,@summary,@type,@status,@source,@confidence,@startedAt,@completedAt,@createdAt,@updatedAt)`).run(record);
    db.prepare("UPDATE pm_projects SET updated_at = ? WHERE id = ?").run(timestamp, project.id);
    return record;
  }
  function listWorkItems(projectId, userId) { requireProject(projectId, userId); return db.prepare("SELECT * FROM pm_work_items WHERE project_id=? AND user_id=? ORDER BY updated_at DESC").all(projectId, userId).map(rowWorkItem); }
  function getWorkItem(workItemId, userId) { const row = db.prepare("SELECT * FROM pm_work_items WHERE id=? AND user_id=?").get(workItemId, userId); if (!row) throw new Error("Work item not found"); return rowWorkItem(row); }
  function updateWorkItem(workItemId, input, userId) {
    const current = getWorkItem(workItemId, userId); const updated = { ...current, title: input.title == null ? current.title : clean(input.title, 200), summary: input.summary == null ? current.summary : clean(input.summary, 3000) || undefined, type: input.type && WORK_ITEM_TYPES.has(input.type) ? input.type : current.type, status: input.status && WORK_ITEM_STATUSES.has(input.status) ? input.status : current.status, confidence: input.confidence == null ? current.confidence : Math.max(0, Math.min(1, Number(input.confidence))), startedAt: input.startedAt === null ? undefined : input.startedAt || current.startedAt, completedAt: input.completedAt === null ? undefined : input.completedAt || current.completedAt, updatedAt: now() };
    db.prepare("UPDATE pm_work_items SET title=?,summary=?,type=?,status=?,confidence=?,started_at=?,completed_at=?,updated_at=? WHERE id=? AND user_id=?").run(updated.title, updated.summary || null, updated.type, updated.status, updated.confidence ?? null, updated.startedAt || null, updated.completedAt || null, updated.updatedAt, workItemId, userId); return updated;
  }
  function linkSessionWorkItem(sessionId, workItemId, input = {}, userId) {
    const session = getAgentSession(sessionId, userId); const work = getWorkItem(workItemId, userId); if (session.projectId && session.projectId !== work.projectId) throw new Error("Session and work item must belong to the same project");
    const record = { id: id("swl"), sessionId, workItemId, relation: clean(input.relation || "continued", 40), confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.8))), source: input.source === "manual" ? "manual" : "automatic", createdAt: now() };
    db.prepare(`INSERT INTO pm_session_work_items (id,session_id,work_item_id,relation,confidence,source,created_at) VALUES (@id,@sessionId,@workItemId,@relation,@confidence,@source,@createdAt) ON CONFLICT(session_id,work_item_id) DO UPDATE SET relation=excluded.relation,confidence=excluded.confidence,source=excluded.source`).run(record); return record;
  }

  function getAgentSession(sessionId, userId) { const row = db.prepare("SELECT * FROM pm_agent_sessions WHERE id=? AND user_id=?").get(sessionId, userId); if (!row) throw new Error("Agent session not found"); return rowSession(row); }
  function getAgentSessionSource(sessionId, userId) {
    const row = db.prepare("SELECT platform,external_session_id,source_fingerprint,raw_content FROM pm_agent_sessions WHERE id=? AND user_id=?").get(sessionId, userId);
    if (!row) throw new Error("Agent session not found");
    return { platform: row.platform, externalSessionId: row.external_session_id || undefined, sourceFingerprint: row.source_fingerprint, rawContent: row.raw_content || "" };
  }
  function findAgentSessionByFingerprint(sourceFingerprint, userId) { const row = db.prepare("SELECT * FROM pm_agent_sessions WHERE source_fingerprint=? AND user_id=?").get(sourceFingerprint, userId); return rowSession(row); }
  function saveAgentSession(input, userId) {
    const timestamp = now(); const existing = findAgentSessionByFingerprint(input.sourceFingerprint, userId); const session = { id: existing?.id || id("session"), userId: clean(userId, 120), projectId: input.projectId || existing?.projectId || null, platform: clean(input.platform || existing?.platform || "manual", 40), externalSessionId: clean(input.externalSessionId || existing?.externalSessionId, 200) || null, sourceFingerprint: input.sourceFingerprint, title: clean(input.title || existing?.title, 300) || null, rawTitle: clean(input.rawTitle || existing?.rawTitle, 300) || null, startedAt: input.startedAt || existing?.startedAt || null, endedAt: input.endedAt || existing?.endedAt || null, userIntentSummary: clean(input.userIntentSummary || existing?.userIntentSummary, 2000) || null, implementationSummary: clean(input.implementationSummary || existing?.implementationSummary, 3000) || null, outcomeSummary: clean(input.outcomeSummary || existing?.outcomeSummary, 2000) || null, keyTopics: input.keyTopics || existing?.keyTopics || [], technologies: input.technologies || existing?.technologies || [], importMethod: clean(input.importMethod || existing?.importMethod || "manual_paste", 40), rawContentStorage: input.rawContentStorage === "redacted" ? "redacted" : "not_stored", rawContentReference: clean(input.rawContentReference || existing?.rawContentReference, 500) || null, rawContent: input.rawContentStorage === "redacted" && input.rawContent ? redactContent(input.rawContent, 12_000) : null, processingStatus: clean(input.processingStatus || existing?.processingStatus || "completed", 30), analysis: input.analysis || existing?.analysis || null, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
    if (!session.projectId) throw new Error("Session project is required");
    if (existing) db.prepare(`UPDATE pm_agent_sessions SET project_id=@projectId,platform=@platform,external_session_id=@externalSessionId,title=@title,raw_title=@rawTitle,started_at=@startedAt,ended_at=@endedAt,user_intent_summary=@userIntentSummary,implementation_summary=@implementationSummary,outcome_summary=@outcomeSummary,key_topics=@keyTopics,technologies=@technologies,import_method=@importMethod,raw_content_storage=@rawContentStorage,raw_content_reference=@rawContentReference,raw_content=@rawContent,processing_status=@processingStatus,analysis_json=@analysis,updated_at=@updatedAt WHERE id=@id AND user_id=@userId`).run({ ...session, keyTopics: jsonText(session.keyTopics), technologies: jsonText(session.technologies), analysis: session.analysis ? jsonText(session.analysis, null) : null });
    else db.prepare(`INSERT INTO pm_agent_sessions (id,user_id,project_id,platform,external_session_id,source_fingerprint,title,raw_title,started_at,ended_at,user_intent_summary,implementation_summary,outcome_summary,key_topics,technologies,import_method,raw_content_storage,raw_content_reference,raw_content,processing_status,analysis_json,created_at,updated_at) VALUES (@id,@userId,@projectId,@platform,@externalSessionId,@sourceFingerprint,@title,@rawTitle,@startedAt,@endedAt,@userIntentSummary,@implementationSummary,@outcomeSummary,@keyTopics,@technologies,@importMethod,@rawContentStorage,@rawContentReference,@rawContent,@processingStatus,@analysis,@createdAt,@updatedAt)`).run({ ...session, keyTopics: jsonText(session.keyTopics), technologies: jsonText(session.technologies), analysis: session.analysis ? jsonText(session.analysis, null) : null });
    db.prepare("UPDATE pm_projects SET updated_at=? WHERE id=?").run(timestamp, session.projectId);
    return getAgentSession(session.id, userId);
  }
  function listAgentSessions(projectId, userId) { requireProject(projectId, userId); return db.prepare("SELECT * FROM pm_agent_sessions WHERE project_id=? AND user_id=? ORDER BY COALESCE(started_at,created_at) DESC").all(projectId, userId).map(rowSession); }
  function updateAgentSession(sessionId, input, userId) { const current = getAgentSession(sessionId, userId); return saveAgentSession({ ...current, ...input, id: sessionId, projectId: current.projectId }, userId); }
  function deleteAgentSession(sessionId, userId, options = {}) {
    getAgentSession(sessionId, userId);
    if (options.rawOnly) {
      db.prepare("UPDATE pm_agent_sessions SET raw_content=NULL,raw_content_storage='not_stored',raw_content_reference=NULL,updated_at=? WHERE id=? AND user_id=?").run(now(), sessionId, userId);
      return { id: sessionId, rawContentDeleted: true, sessionDeleted: false };
    }
    const result = db.prepare("DELETE FROM pm_agent_sessions WHERE id=? AND user_id=?").run(sessionId, userId);
    return { id: sessionId, rawContentDeleted: true, sessionDeleted: Boolean(result.changes), cognitiveDebtPreserved: true };
  }
  function listSessionWorkItems(sessionId, userId) { getAgentSession(sessionId, userId); return db.prepare("SELECT w.*, l.relation, l.confidence AS link_confidence, l.source AS link_source FROM pm_session_work_items l JOIN pm_work_items w ON w.id=l.work_item_id WHERE l.session_id=? AND w.user_id=? ORDER BY w.updated_at DESC").all(sessionId, userId).map(row => ({ ...rowWorkItem(row), relation: row.relation, confidence: Number(row.link_confidence), source: row.link_source })); }

  function artifactKey(input) {
    const identity = [sanitizeRepositoryPath(input.repositoryRelativePath), clean(input.symbolName, 300), clean(input.gitCommitHash, 80)].filter(Boolean).join("|") || clean(input.name, 300);
    return [input.projectId, input.type, identity].join("|").toLowerCase();
  }
  function upsertArtifact(input, userId) {
    const project = requireProject(input.projectId, userId); const timestamp = now(); const normalized = { projectId: project.id, userId: clean(userId, 120), type: ARTIFACT_TYPES.has(input.type) ? input.type : "other", name: clean(input.name || input.symbolName || input.repositoryRelativePath || input.gitCommitHash || "Artifact", 300), repositoryRelativePath: sanitizeRepositoryPath(input.repositoryRelativePath), symbolName: clean(input.symbolName, 300), gitCommitHash: clean(input.gitCommitHash, 80), pullRequestUrl: clean(input.pullRequestUrl, 1000), contentHash: clean(input.contentHash, 200), diffSummary: clean(input.diffSummary, 2000), relevantSnippet: input.sensitivity === "shareable" || input.sensitivity === "redacted" ? redactContent(input.relevantSnippet, 4000) : undefined, language: clean(input.language, 80), sensitivity: ["local_only", "metadata_only", "redacted", "shareable"].includes(input.sensitivity) ? input.sensitivity : "metadata_only", firstSeenAt: input.firstSeenAt || timestamp, lastSeenAt: input.lastSeenAt || timestamp, artifactKey: artifactKey(input), createdAt: timestamp, updatedAt: timestamp };
    const existing = db.prepare("SELECT * FROM pm_artifacts WHERE artifact_key=?").get(normalized.artifactKey);
    if (existing) { db.prepare("UPDATE pm_artifacts SET name=?,content_hash=COALESCE(?,content_hash),diff_summary=COALESCE(?,diff_summary),relevant_snippet=COALESCE(?,relevant_snippet),last_seen_at=?,updated_at=? WHERE id=?").run(normalized.name, normalized.contentHash || null, normalized.diffSummary || null, normalized.relevantSnippet || null, normalized.lastSeenAt, normalized.updatedAt, existing.id); return rowArtifact(db.prepare("SELECT * FROM pm_artifacts WHERE id=?").get(existing.id)); }
    const record = { id: id("artifact"), ...normalized }; db.prepare(`INSERT INTO pm_artifacts (id,project_id,user_id,type,name,repository_relative_path,symbol_name,git_commit_hash,pull_request_url,content_hash,diff_summary,relevant_snippet,language,sensitivity,first_seen_at,last_seen_at,artifact_key,created_at,updated_at) VALUES (@id,@projectId,@userId,@type,@name,@repositoryRelativePath,@symbolName,@gitCommitHash,@pullRequestUrl,@contentHash,@diffSummary,@relevantSnippet,@language,@sensitivity,@firstSeenAt,@lastSeenAt,@artifactKey,@createdAt,@updatedAt)`).run(record); return rowArtifact(db.prepare("SELECT * FROM pm_artifacts WHERE id=?").get(record.id));
  }
  function getArtifact(artifactId, userId) { const row = db.prepare("SELECT * FROM pm_artifacts WHERE id=? AND user_id=?").get(artifactId, userId); if (!row) throw new Error("Artifact not found"); return rowArtifact(row); }
  function listArtifacts(projectId, userId) { requireProject(projectId, userId); return db.prepare("SELECT * FROM pm_artifacts WHERE project_id=? AND user_id=? ORDER BY updated_at DESC").all(projectId, userId).map(rowArtifact); }
  function linkWorkItemArtifact(workItemId, artifactId, input = {}, userId) { const work = getWorkItem(workItemId, userId); const artifact = getArtifact(artifactId, userId); if (work.projectId !== artifact.projectId) throw new Error("Work item and artifact must belong to the same project"); const record = { id: id("wal"), workItemId, artifactId, relation: clean(input.relation || "modified", 40), sourceSessionId: input.sourceSessionId || null, createdAt: now() }; db.prepare(`INSERT INTO pm_work_item_artifacts (id,work_item_id,artifact_id,relation,source_session_id,created_at) VALUES (@id,@workItemId,@artifactId,@relation,@sourceSessionId,@createdAt) ON CONFLICT(work_item_id,artifact_id) DO UPDATE SET relation=excluded.relation,source_session_id=excluded.source_session_id`).run(record); return record; }
  function listWorkItemArtifacts(workItemId, userId) { const work = getWorkItem(workItemId, userId); return db.prepare("SELECT a.*, l.relation, l.source_session_id FROM pm_work_item_artifacts l JOIN pm_artifacts a ON a.id=l.artifact_id WHERE l.work_item_id=? AND a.user_id=? ORDER BY a.updated_at DESC").all(work.id, userId).map(row => ({ ...rowArtifact(row), relation: row.relation, sourceSessionId: row.source_session_id || undefined })); }

  function linkSessionArtifact(sessionId, artifactId, input = {}, userId) {
    const session = getAgentSession(sessionId, userId);
    const artifact = getArtifact(artifactId, userId);
    if (session.projectId !== artifact.projectId) throw new Error("Session and artifact must belong to the same project");
    const record = { id: id("sal"), sessionId, artifactId, relation: clean(input.relation || "modified", 40), createdAt: now() };
    db.prepare("INSERT INTO pm_session_artifacts (id,session_id,artifact_id,relation,created_at) VALUES (@id,@sessionId,@artifactId,@relation,@createdAt) ON CONFLICT(session_id,artifact_id) DO UPDATE SET relation=excluded.relation").run(record);
    return record;
  }
  function listSessionArtifacts(sessionId, userId) {
    getAgentSession(sessionId, userId);
    return db.prepare("SELECT a.*,l.relation FROM pm_session_artifacts l JOIN pm_artifacts a ON a.id=l.artifact_id WHERE l.session_id=? AND a.user_id=? ORDER BY a.updated_at DESC").all(sessionId, userId).map(row => ({ ...rowArtifact(row), relation: row.relation }));
  }

  function createDecision(input, userId) { const project = requireProject(input.projectId, userId); const record = { id: id("decision"), projectId: project.id, workItemId: input.workItemId || null, sessionId: input.sessionId || null, userId: clean(userId, 120), title: clean(input.title, 300), decision: clean(input.decision, 3000), rationale: clean(input.rationale, 3000) || null, alternatives: jsonText(input.alternatives), tradeoffs: jsonText(input.tradeoffs), assumptions: jsonText(input.assumptions), risks: jsonText(input.risks), decisionType: clean(input.decisionType || "other", 40), decisionMaker: clean(input.decisionMaker || "unknown", 40), userParticipation: clean(input.userParticipation || "unknown", 40), importance: clean(input.importance || "medium", 20), createdAt: now(), updatedAt: now() }; if (!record.title || !record.decision) throw new Error("Decision title and decision are required"); db.prepare(`INSERT INTO pm_decisions (id,project_id,work_item_id,session_id,user_id,title,decision,rationale,alternatives,tradeoffs,assumptions,risks,decision_type,decision_maker,user_participation,importance,created_at,updated_at) VALUES (@id,@projectId,@workItemId,@sessionId,@userId,@title,@decision,@rationale,@alternatives,@tradeoffs,@assumptions,@risks,@decisionType,@decisionMaker,@userParticipation,@importance,@createdAt,@updatedAt)`).run(record); return rowDecision(db.prepare("SELECT * FROM pm_decisions WHERE id=?").get(record.id)); }
  function getDecision(decisionId, userId) { const row = db.prepare("SELECT * FROM pm_decisions WHERE id=? AND user_id=?").get(decisionId, userId); if (!row) throw new Error("Decision not found"); return rowDecision(row); }
  function listDecisions(projectId, userId) { requireProject(projectId, userId); return db.prepare("SELECT * FROM pm_decisions WHERE project_id=? AND user_id=? ORDER BY updated_at DESC").all(projectId, userId).map(rowDecision); }
  function updateDecision(decisionId, input, userId) { const current = getDecision(decisionId, userId); const updated = { ...current, ...input, id: decisionId, updatedAt: now() }; const fields = { title: clean(updated.title, 300), decision: clean(updated.decision, 3000), rationale: clean(updated.rationale, 3000) || null, alternatives: jsonText(updated.alternatives), tradeoffs: jsonText(updated.tradeoffs), assumptions: jsonText(updated.assumptions), risks: jsonText(updated.risks), decisionType: clean(updated.decisionType || "other", 40), decisionMaker: clean(updated.decisionMaker || "unknown", 40), userParticipation: clean(updated.userParticipation || "unknown", 40), importance: clean(updated.importance || "medium", 20) }; db.prepare("UPDATE pm_decisions SET title=?,decision=?,rationale=?,alternatives=?,tradeoffs=?,assumptions=?,risks=?,decision_type=?,decision_maker=?,user_participation=?,importance=?,updated_at=? WHERE id=? AND user_id=?").run(fields.title, fields.decision, fields.rationale, fields.alternatives, fields.tradeoffs, fields.assumptions, fields.risks, fields.decisionType, fields.decisionMaker, fields.userParticipation, fields.importance, updated.updatedAt, decisionId, userId); return getDecision(decisionId, userId); }

  function linkDebtArtifact(input, userId) { const artifact = getArtifact(input.artifactId, userId); if (input.workItemId) getWorkItem(input.workItemId, userId); if (input.sessionId) getAgentSession(input.sessionId, userId); if (input.decisionId) getDecision(input.decisionId, userId); const record = { id: id("dal"), debtId: clean(input.debtId, 120), artifactId: artifact.id, workItemId: input.workItemId || null, sessionId: input.sessionId || null, decisionId: input.decisionId || null, relation: DEBT_RELATIONS.has(input.relation) ? input.relation : "implemented_in", relevance: input.relevance === "secondary" ? "secondary" : "primary", createdAt: now() }; db.prepare(`INSERT INTO pm_debt_artifact_links (id,debt_id,artifact_id,work_item_id,session_id,decision_id,relation,relevance,created_at) VALUES (@id,@debtId,@artifactId,@workItemId,@sessionId,@decisionId,@relation,@relevance,@createdAt) ON CONFLICT(debt_id,artifact_id,relation) DO UPDATE SET work_item_id=excluded.work_item_id,session_id=excluded.session_id,decision_id=excluded.decision_id,relevance=excluded.relevance`).run(record); return record; }
  function listDebtLinks(debtId, userId) { const rows = db.prepare("SELECT l.*, a.*, w.title AS work_title, s.title AS session_title, d.title AS decision_title FROM pm_debt_artifact_links l JOIN pm_artifacts a ON a.id=l.artifact_id LEFT JOIN pm_work_items w ON w.id=l.work_item_id LEFT JOIN pm_agent_sessions s ON s.id=l.session_id LEFT JOIN pm_decisions d ON d.id=l.decision_id WHERE l.debt_id=? AND a.user_id=? ORDER BY l.created_at DESC").all(debtId, userId); return rows.map(row => ({ id: row.id, debtId: row.debt_id, artifact: rowArtifact(row), workItemId: row.work_item_id || undefined, workItemTitle: row.work_title || undefined, sessionId: row.session_id || undefined, sessionTitle: row.session_title || undefined, decisionId: row.decision_id || undefined, decisionTitle: row.decision_title || undefined, relation: row.relation, relevance: row.relevance, createdAt: row.created_at })); }
  function deleteDebtLink(debtId, linkId, userId) { const result = db.prepare("DELETE FROM pm_debt_artifact_links WHERE debt_id=? AND id=? AND artifact_id IN (SELECT id FROM pm_artifacts WHERE user_id=?)").run(debtId, linkId, userId); if (!result.changes) throw new Error("Debt link not found"); }
  function listDebtHistory(debtId, userId) { const links = listDebtLinks(debtId, userId); const recurrences = listRecurrences(debtId, userId); const evidence = listEvidenceForDebt(debtId, userId); return { links, recurrences, evidence }; }

  function createEvidence(input, userId) { const record = { id: id("evidence"), userId: clean(userId, 120), debtId: clean(input.debtId, 120), projectId: input.projectId || null, workItemId: input.workItemId || null, artifactId: input.artifactId || null, trainingAttemptId: input.trainingAttemptId || null, evidenceType: clean(input.evidenceType, 50), evidenceLevel: /^E[0-5]$/.test(input.evidenceLevel) ? input.evidenceLevel : "E0", result: ["passed", "partial", "failed", "unverified"].includes(input.result) ? input.result : "unverified", evidenceSummary: clean(input.evidenceSummary, 2000) || null, externalReference: clean(input.externalReference, 1000) || null, occurredAt: input.occurredAt || now(), createdAt: now() }; db.prepare(`INSERT INTO pm_evidence_records (id,user_id,debt_id,project_id,work_item_id,artifact_id,training_attempt_id,evidence_type,evidence_level,result,evidence_summary,external_reference,occurred_at,created_at) VALUES (@id,@userId,@debtId,@projectId,@workItemId,@artifactId,@trainingAttemptId,@evidenceType,@evidenceLevel,@result,@evidenceSummary,@externalReference,@occurredAt,@createdAt)`).run(record); return record; }
  function listEvidenceForDebt(debtId, userId) { return db.prepare("SELECT * FROM pm_evidence_records WHERE debt_id=? AND user_id=? ORDER BY occurred_at DESC").all(debtId, userId).map(row => ({ id: row.id, userId: row.user_id, debtId: row.debt_id, projectId: row.project_id || undefined, workItemId: row.work_item_id || undefined, artifactId: row.artifact_id || undefined, trainingAttemptId: row.training_attempt_id || undefined, evidenceType: row.evidence_type, evidenceLevel: row.evidence_level, result: row.result, evidenceSummary: row.evidence_summary || undefined, externalReference: row.external_reference || undefined, occurredAt: row.occurred_at, createdAt: row.created_at })); }
  function listRecurrences(debtId, userId) { return db.prepare("SELECT r.*, p.name AS project_name FROM pm_debt_recurrences r JOIN pm_projects p ON p.id=r.project_id WHERE r.debt_id=? AND r.user_id=? ORDER BY r.detected_at DESC").all(debtId, userId).map(row => ({ id: row.id, debtId: row.debt_id, projectId: row.project_id, projectName: row.project_name, workItemId: row.work_item_id || undefined, sessionId: row.session_id || undefined, artifactId: row.artifact_id || undefined, reason: row.reason, confidence: Number(row.confidence), detectedAt: row.detected_at, confirmedByUser: row.confirmed_by_user == null ? undefined : Boolean(row.confirmed_by_user) })); }
  function createRecurrence(input, userId) { const project = requireProject(input.projectId, userId); const record = { id: id("recurrence"), debtId: clean(input.debtId, 120), userId: clean(userId, 120), projectId: project.id, workItemId: input.workItemId || null, sessionId: input.sessionId || null, artifactId: input.artifactId || null, reason: clean(input.reason, 2000), confidence: Math.max(0, Math.min(1, Number(input.confidence || 0))), detectedAt: input.detectedAt || now(), confirmedByUser: input.confirmedByUser == null ? null : input.confirmedByUser ? 1 : 0 }; db.prepare(`INSERT INTO pm_debt_recurrences (id,debt_id,user_id,project_id,work_item_id,session_id,artifact_id,reason,confidence,detected_at,confirmed_by_user) VALUES (@id,@debtId,@userId,@projectId,@workItemId,@sessionId,@artifactId,@reason,@confidence,@detectedAt,@confirmedByUser) ON CONFLICT(debt_id,session_id,project_id) DO UPDATE SET reason=excluded.reason,confidence=excluded.confidence,detected_at=excluded.detected_at`).run(record); return listRecurrences(record.debtId, userId).find(item => item.projectId === record.projectId && item.sessionId === record.sessionId) || record; }

  function getOwnership(projectId, userId, debts = []) {
    requireProject(projectId, userId);
    const evidenceRows = db.prepare("SELECT * FROM pm_evidence_records WHERE project_id=? AND user_id=? ORDER BY occurred_at DESC").all(projectId, userId);
    const levelRank = { E0: 0, E1: 1, E2: 2, E3: 3, E4: 4, E5: 5 };
    const ownership = rank => ({ E0: "unverified", E1: "read", E2: "explainable", E3: "risk_aware", E4: "transferable", E5: "owned" })["E" + Math.max(0, Math.min(5, rank))];
    const artifactRows = db.prepare("SELECT a.id,a.name,a.repository_relative_path,a.type,MAX(CASE e.evidence_level WHEN 'E5' THEN 5 WHEN 'E4' THEN 4 WHEN 'E3' THEN 3 WHEN 'E2' THEN 2 WHEN 'E1' THEN 1 ELSE 0 END) AS level FROM pm_artifacts a LEFT JOIN pm_evidence_records e ON e.artifact_id=a.id AND e.user_id=? WHERE a.project_id=? AND a.user_id=? GROUP BY a.id ORDER BY a.updated_at DESC").all(userId, projectId, userId).map(row => ({ id: row.id, name: row.name, repositoryRelativePath: row.repository_relative_path || undefined, type: row.type, evidenceLevel: "E" + Number(row.level || 0), ownershipState: ownership(Number(row.level || 0)) }));
    const workItemRows = db.prepare("SELECT w.id,w.title,MAX(CASE e.evidence_level WHEN 'E5' THEN 5 WHEN 'E4' THEN 4 WHEN 'E3' THEN 3 WHEN 'E2' THEN 2 WHEN 'E1' THEN 1 ELSE 0 END) AS level FROM pm_work_items w LEFT JOIN pm_work_item_artifacts wa ON wa.work_item_id=w.id LEFT JOIN pm_evidence_records e ON e.artifact_id=wa.artifact_id AND e.user_id=? WHERE w.project_id=? AND w.user_id=? GROUP BY w.id ORDER BY w.updated_at DESC").all(userId, projectId, userId).map(row => ({ id: row.id, title: row.title, evidenceLevel: "E" + Number(row.level || 0), ownershipState: ownership(Number(row.level || 0)) }));
    const debtById = new Map(debts.map(item => [item.id, item]));
    const debtRows = db.prepare("SELECT DISTINCT debt_id FROM pm_debt_artifact_links l JOIN pm_artifacts a ON a.id=l.artifact_id WHERE a.project_id=?").all(projectId).map(row => debtById.get(row.debt_id)).filter(Boolean).map(debt => { const rank = Math.max(0, ...evidenceRows.filter(row => row.debt_id === debt.id).map(row => levelRank[row.evidence_level] || 0)); return { debtId: debt.id, title: debt.gapText || debt.title || "Cognitive debt", evidenceLevel: `E${rank}`, ownershipState: ownership(rank) }; });
    return { artifacts: artifactRows, workItems: workItemRows, debts: debtRows, summary: { owned: workItemRows.filter(item => item.ownershipState === "owned").length, explainable: workItemRows.filter(item => item.ownershipState === "explainable").length, transferable: workItemRows.filter(item => item.ownershipState === "transferable").length, unverified: workItemRows.filter(item => item.ownershipState === "unverified").length } };
  }

  function search(query, projectId, userId) {
    const q = `%${clean(query, 200).toLowerCase()}%`; const projectClause = projectId ? " AND project_id = @projectId" : ""; const params = { userId, q, projectId };
    const projects = db.prepare(`SELECT * FROM pm_projects WHERE user_id=@userId AND (lower(name) LIKE @q OR lower(description) LIKE @q)${projectId ? " AND id=@projectId" : ""} ORDER BY updated_at DESC LIMIT 20`).all(params).map(rowProject);
    const workItems = db.prepare(`SELECT * FROM pm_work_items WHERE user_id=@userId AND (lower(title) LIKE @q OR lower(summary) LIKE @q)${projectId ? " AND project_id=@projectId" : ""} ORDER BY updated_at DESC LIMIT 30`).all(params).map(rowWorkItem);
    const sessions = db.prepare(`SELECT * FROM pm_agent_sessions WHERE user_id=@userId AND (lower(title) LIKE @q OR lower(user_intent_summary) LIKE @q OR lower(implementation_summary) LIKE @q OR lower(outcome_summary) LIKE @q OR lower(key_topics) LIKE @q)${projectId ? " AND project_id=@projectId" : ""} ORDER BY updated_at DESC LIMIT 30`).all(params).map(rowSession);
    const artifacts = db.prepare(`SELECT * FROM pm_artifacts WHERE user_id=@userId AND (lower(name) LIKE @q OR lower(repository_relative_path) LIKE @q OR lower(symbol_name) LIKE @q OR lower(git_commit_hash) LIKE @q)${projectId ? " AND project_id=@projectId" : ""} ORDER BY updated_at DESC LIMIT 40`).all(params).map(rowArtifact);
    const decisions = db.prepare(`SELECT * FROM pm_decisions WHERE user_id=@userId AND (lower(title) LIKE @q OR lower(decision) LIKE @q OR lower(rationale) LIKE @q)${projectId ? " AND project_id=@projectId" : ""} ORDER BY updated_at DESC LIMIT 30`).all(params).map(rowDecision);
    const debts = db.prepare(`SELECT DISTINCT debt_id FROM pm_debt_artifact_links l JOIN pm_artifacts a ON a.id=l.artifact_id WHERE a.user_id=@userId AND (lower(l.debt_id) LIKE @q OR lower(a.name) LIKE @q OR lower(a.repository_relative_path) LIKE @q)${projectId ? " AND a.project_id=@projectId" : ""} LIMIT 30`).all(params).map(row => ({ id: row.debt_id }));
    return { query: clean(query, 200), groups: { projects, workItems, sessions, artifacts, decisions, cognitiveDebts: debts }, total: projects.length + workItems.length + sessions.length + artifacts.length + decisions.length + debts.length };
  }

  function timeline(projectId, userId) {
    requireProject(projectId, userId);
    const events = [
      ...db.prepare("SELECT id,created_at AS occurred_at,'session' AS type,title AS label,id AS reference_id FROM pm_agent_sessions WHERE project_id=? AND user_id=?").all(projectId, userId),
      ...db.prepare("SELECT id,created_at AS occurred_at,'work_item' AS type,title AS label,id AS reference_id FROM pm_work_items WHERE project_id=? AND user_id=?").all(projectId, userId),
      ...db.prepare("SELECT id,created_at AS occurred_at,'artifact' AS type,name AS label,id AS reference_id FROM pm_artifacts WHERE project_id=? AND user_id=?").all(projectId, userId),
      ...db.prepare("SELECT id,created_at AS occurred_at,'decision' AS type,title AS label,id AS reference_id FROM pm_decisions WHERE project_id=? AND user_id=?").all(projectId, userId),
      ...db.prepare("SELECT id,detected_at AS occurred_at,'recurrence' AS type,reason AS label,id AS reference_id FROM pm_debt_recurrences WHERE project_id=? AND user_id=?").all(projectId, userId)
    ];
    return events.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, 200).map(item => ({ id: item.id, occurredAt: item.occurred_at, type: item.type, label: item.label, referenceId: item.reference_id }));
  }

  function memory(projectId, userId, debts = []) {
    const project = requireProject(projectId, userId); const workItems = listWorkItems(projectId, userId); const sessions = listAgentSessions(projectId, userId); const artifacts = listArtifacts(projectId, userId); const decisions = listDecisions(projectId, userId); const ownership = getOwnership(projectId, userId, debts); return { project, workItems, sessions, artifacts, decisions, ownership, counts: { sessions: sessions.length, workItems: workItems.length, artifacts: artifacts.length, decisions: decisions.length, debts: debts.filter(debt => listDebtLinks(debt.id, userId).some(link => link.artifact.projectId === projectId)).length, owned: ownership.summary.owned } };
  }

  function getWorkItemDetail(workItemId, userId) { const workItem = getWorkItem(workItemId, userId); return { workItem, sessions: db.prepare("SELECT s.*,l.relation,l.confidence AS link_confidence FROM pm_session_work_items l JOIN pm_agent_sessions s ON s.id=l.session_id WHERE l.work_item_id=? AND s.user_id=? ORDER BY COALESCE(s.started_at,s.created_at) DESC").all(workItemId, userId).map(row => ({ ...rowSession(row), relation: row.relation, confidence: Number(row.link_confidence) })), artifacts: listWorkItemArtifacts(workItemId, userId), decisions: db.prepare("SELECT * FROM pm_decisions WHERE work_item_id=? AND user_id=? ORDER BY updated_at DESC").all(workItemId, userId).map(rowDecision), debtLinks: db.prepare("SELECT * FROM pm_debt_artifact_links WHERE work_item_id=?").all(workItemId).map(row => ({ id: row.id, debtId: row.debt_id, relation: row.relation })) }; }
  function getSessionDetail(sessionId, userId) {
    const session = getAgentSession(sessionId, userId);
    const direct = listSessionArtifacts(sessionId, userId);
    const inferred = db.prepare("SELECT a.*,w.relation,w.id AS work_item_id FROM pm_work_item_artifacts w JOIN pm_artifacts a ON a.id=w.artifact_id WHERE w.source_session_id=? AND a.user_id=?").all(sessionId, userId).map(row => ({ ...rowArtifact(row), relation: row.relation, workItemId: row.work_item_id }));
    const artifacts = [...direct];
    for (const item of inferred) if (!artifacts.some(existing => existing.id === item.id)) artifacts.push(item);
    return { session, workItems: listSessionWorkItems(sessionId, userId), artifacts, decisions: db.prepare("SELECT * FROM pm_decisions WHERE session_id=? AND user_id=? ORDER BY updated_at DESC").all(sessionId, userId).map(rowDecision), recurrences: db.prepare("SELECT * FROM pm_debt_recurrences WHERE session_id=? AND user_id=?").all(sessionId, userId) };
  }

  function createHookToken(projectId, userId, name) { requireProject(projectId, userId); const token = crypto.randomBytes(32).toString("hex"); const tokenId = id("hook"); const tokenName = clean(name, 120) || "Project Memory Hook"; db.prepare("INSERT INTO pm_hook_tokens (id,project_id,user_id,token_hash,name,created_at) VALUES (?,?,?,?,?,?)").run(tokenId, projectId, userId, fingerprint(token), tokenName, now()); return { id: tokenId, token, projectId, name: tokenName }; }
  function validateHookToken(token) { const row = db.prepare("SELECT * FROM pm_hook_tokens WHERE token_hash=? AND revoked_at IS NULL").get(fingerprint(token)); return row ? { userId: row.user_id, projectId: row.project_id, tokenId: row.id } : null; }
  function listHookTokens(projectId, userId) { requireProject(projectId, userId); return db.prepare("SELECT id,project_id AS projectId,name,created_at AS createdAt,revoked_at AS revokedAt FROM pm_hook_tokens WHERE project_id=? AND user_id=? ORDER BY created_at DESC").all(projectId, userId); }
  function revokeHookToken(tokenId, userId) { const result = db.prepare("UPDATE pm_hook_tokens SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL").run(now(), tokenId, userId); if (!result.changes) throw new Error("Hook token not found"); }
  function recordHookEvent(input, userId) { const record = { id: clean(input.id || input.idempotencyKey, 200) || id("event"), userId: clean(userId, 120), projectId: input.projectId || null, sessionId: input.sessionId || null, eventType: clean(input.type || input.eventType, 80), payload: jsonText(input.payload || {}), occurredAt: input.occurredAt || now(), createdAt: now() }; const existing = db.prepare("SELECT * FROM pm_hook_events WHERE id=? AND user_id=?").get(record.id, userId); if (existing) return { id: record.id, duplicate: true }; db.prepare("INSERT INTO pm_hook_events (id,user_id,project_id,session_id,event_type,payload,occurred_at,created_at) VALUES (@id,@userId,@projectId,@sessionId,@eventType,@payload,@occurredAt,@createdAt)").run(record); return { id: record.id, duplicate: false }; }
  function mergeWorkItems(targetId, sourceId, userId) { const target = getWorkItem(targetId, userId); const source = getWorkItem(sourceId, userId); if (target.projectId !== source.projectId) throw new Error("Work items must belong to the same project"); const tx = db.transaction(() => { db.prepare("INSERT OR IGNORE INTO pm_session_work_items (id,session_id,work_item_id,relation,confidence,source,created_at) SELECT ?,session_id,?,relation,confidence,source,created_at FROM pm_session_work_items WHERE work_item_id=?").run(id("merge"), targetId, sourceId); db.prepare("INSERT OR IGNORE INTO pm_work_item_artifacts (id,work_item_id,artifact_id,relation,source_session_id,created_at) SELECT ?,?,artifact_id,relation,source_session_id,created_at FROM pm_work_item_artifacts WHERE work_item_id=?").run(id("merge"), targetId, sourceId); db.prepare("UPDATE pm_decisions SET work_item_id=? WHERE work_item_id=?").run(targetId, sourceId); db.prepare("UPDATE pm_debt_artifact_links SET work_item_id=? WHERE work_item_id=?").run(targetId, sourceId); db.prepare("UPDATE pm_work_items SET status='archived',updated_at=? WHERE id=?").run(now(), sourceId); }); tx(); return { target: getWorkItem(targetId, userId), archived: getWorkItem(sourceId, userId) }; }
  function splitWorkItem(workItemId, input, userId) { const source = getWorkItem(workItemId, userId); const created = createWorkItem({ ...input, projectId: source.projectId, source: "user_created" }, userId); for (const sessionId of input.sessionIds || []) linkSessionWorkItem(sessionId, created.id, { relation: "continued", source: "manual", confidence: 1 }, userId); return created; }

  return { dbPath: resolvedPath, createProject, ensureProject, listProjects, getProject, updateProject, deleteProject, createWorkItem, listWorkItems, getWorkItem, updateWorkItem, mergeWorkItems, splitWorkItem, saveAgentSession, getAgentSession, getAgentSessionSource, findAgentSessionByFingerprint, updateAgentSession, deleteAgentSession, listAgentSessions, getSessionDetail, listSessionWorkItems, upsertArtifact, getArtifact, listArtifacts, linkSessionWorkItem, linkSessionArtifact, listSessionArtifacts, linkWorkItemArtifact, listWorkItemArtifacts, createDecision, getDecision, listDecisions, updateDecision, linkDebtArtifact, listDebtLinks, deleteDebtLink, listDebtHistory, createEvidence, listEvidenceForDebt, createRecurrence, listRecurrences, getOwnership, search, timeline, memory, getWorkItemDetail, createHookToken, validateHookToken, listHookTokens, revokeHookToken, recordHookEvent };
}
