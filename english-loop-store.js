import crypto from "node:crypto";
import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

const MAX_PROFILE_BYTES = 160_000;

function clean(value, limit = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, limit);
}

function isoOrNow(value) {
  const candidate = clean(value, 60);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : new Date().toISOString();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function json(value, fallback = null) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, number(value, min)));
}

function safeArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function safeSignals(value = {}) {
  return {
    wordCount: Math.max(0, Math.min(2000, Math.round(number(value.wordCount)))),
    hasChinese: Boolean(value.hasChinese),
    mentionsProduct: Boolean(value.mentionsProduct),
    describesPast: Boolean(value.describesPast),
    givesOpinion: Boolean(value.givesOpinion),
    explainsCause: Boolean(value.explainsCause),
    givesExample: Boolean(value.givesExample),
    discussesTradeoff: Boolean(value.discussesTradeoff),
    rebuts: Boolean(value.rebuts),
    repeatsSimpleWords: Boolean(value.repeatsSimpleWords),
    expressionCandidates: safeArray(value.expressionCandidates, 8).map(item => clean(item, 100)).filter(Boolean)
  };
}

const LEARNER_STATES = ["in_progress", "completed", "stuck", "off_topic", "unclear_audio"];
const ACTION_TYPES = ["continue", "clarify", "minimal_hint", "recast", "post_turn_feedback", "end_task"];
const SUCCESS_CRITERIA = [
  "relevant_response",
  "gives_opinion",
  "explains_cause",
  "gives_example",
  "discusses_tradeoff",
  "conclusion",
  "target_expression"
];
const MASTERY_STATUSES = ["unknown", "candidate", "emerging", "provisional", "stable", "needs_review"];
const SESSION_DIFFICULTIES = ["calibration", "current", "slightly_above_current", "transfer", "review"];

function safeCriteria(value, limit = 8) {
  return safeArray(value, limit).filter(item => SUCCESS_CRITERIA.includes(item));
}

function safeSessionPlan(value = {}) {
  if (!value || typeof value !== "object") return null;
  const taskTypes = ["conversation", "opinion_structure", "tradeoff", "expression_reuse"];
  return {
    id: clean(value.id, 120),
    version: 1,
    topic: clean(value.topic, 120),
    goal: clean(value.goal, 240),
    taskType: taskTypes.includes(value.taskType) ? value.taskType : "conversation",
    targetSkill: clean(value.targetSkill, 80) || "general",
    ...(value.targetExpression ? { targetExpression: clean(value.targetExpression, 120) } : {}),
    task: clean(value.task, 500),
    successCriteria: safeCriteria(value.successCriteria),
    maxTurns: Math.max(1, Math.min(20, Math.round(number(value.maxTurns, 6)))),
    feedbackPolicy: ["after_turn", "on_request", "minimal"].includes(value.feedbackPolicy)
      ? value.feedbackPolicy
      : "minimal",
    difficulty: SESSION_DIFFICULTIES.includes(value.difficulty) ? value.difficulty : "calibration",
    ...(SUCCESS_CRITERIA.includes(value.reviewCriterion) ? { reviewCriterion: value.reviewCriterion } : {}),
    createdAt: isoOrNow(value.createdAt)
  };
}

function safeTurnEvidence(value = {}) {
  if (!value || typeof value !== "object") return null;
  const state = LEARNER_STATES.includes(value.state) ? value.state : "in_progress";
  const action = ACTION_TYPES.includes(value.action) ? value.action : "continue";
  const evidenceTypes = ["independent_success", "partial", "stuck", "unclear_audio", "not_observed"];
  return {
    id: clean(value.id, 120),
    sessionId: clean(value.sessionId, 120),
    observedAt: isoOrNow(value.observedAt),
    wordCount: Math.max(0, Math.min(2000, Math.round(number(value.wordCount)))),
    signals: safeSignals(value.signals),
    state,
    action,
    criteriaMet: safeCriteria(value.criteriaMet),
    missingCriteria: safeCriteria(value.missingCriteria),
    observations: safeArray(value.observations, 8).map(item => clean(item, 180)).filter(Boolean),
    evidenceType: evidenceTypes.includes(value.evidenceType) ? value.evidenceType : "not_observed",
    confidence: Math.round(clamp(value.confidence, 0, 1) * 100) / 100,
    ...(value.audioConfidence == null ? {} : { audioConfidence: Math.round(clamp(value.audioConfidence, 0, 1) * 100) / 100 }),
    ...(value.topicKey ? { topicKey: clean(value.topicKey, 80) } : {})
  };
}

function safeMasteryRecord(value = {}) {
  if (!value || typeof value !== "object" || !SUCCESS_CRITERIA.includes(value.criterion)) return null;
  const strings = (items, limit = 12) => [...new Set(
    safeArray(items, limit).map(item => clean(item, 120)).filter(Boolean)
  )];
  return {
    criterion: value.criterion,
    status: MASTERY_STATUSES.includes(value.status) ? value.status : "unknown",
    evidenceCount: Math.max(0, Math.min(10000, Math.round(number(value.evidenceCount)))),
    successfulSessionIds: strings(value.successfulSessionIds),
    independentSessionIds: strings(value.independentSessionIds),
    promptedSuccesses: Math.max(0, Math.min(10000, Math.round(number(value.promptedSuccesses)))),
    contradictionCount: Math.max(0, Math.min(10000, Math.round(number(value.contradictionCount)))),
    topicKeys: strings(value.topicKeys),
    dateKeys: strings(value.dateKeys),
    firstObservedAt: clean(value.firstObservedAt, 60),
    lastObservedAt: clean(value.lastObservedAt, 60),
    lastIndependentAt: clean(value.lastIndependentAt, 60),
    nextReviewAt: clean(value.nextReviewAt, 60),
    confidence: Math.round(clamp(value.confidence, 0, 1) * 100) / 100
  };
}

function safeSessionReflection(value = {}) {
  if (!value || typeof value !== "object") return null;
  return {
    sessionId: clean(value.sessionId, 120),
    completed: Boolean(value.completed),
    turnCount: Math.max(0, Math.min(1000, Math.round(number(value.turnCount)))),
    evidenceCount: Math.max(0, Math.min(1000, Math.round(number(value.evidenceCount)))),
    criteriaCompleted: safeCriteria(value.criteriaCompleted),
    recurringGaps: safeCriteria(value.recurringGaps),
    wins: safeArray(value.wins, 8).map(item => clean(item, 180)).filter(Boolean),
    candidateGaps: safeArray(value.candidateGaps, 8).map(item => clean(item, 180)).filter(Boolean),
    nextExperiment: clean(value.nextExperiment, 500),
    profileUpdateAllowed: Boolean(value.profileUpdateAllowed),
    confidence: Math.round(clamp(value.confidence, 0, 1) * 100) / 100,
    completedAt: isoOrNow(value.completedAt)
  };
}

function safeSessionSummary(value = {}) {
  if (!value || typeof value !== "object" || Object.keys(value).length === 0) return null;
  const summary = value && typeof value === "object" ? value : {};
  return {
    turnCount: Math.max(0, Math.min(1000, Math.round(number(summary.turnCount)))),
    evidenceCount: Math.max(0, Math.min(1000, Math.round(number(summary.evidenceCount)))),
    minutes: Math.max(0, Math.min(1000, Math.round(number(summary.minutes) * 10) / 10)),
    decisionType: clean(summary.decisionType, 80),
    decisionTitle: clean(summary.decisionTitle, 240),
    decisionReason: clean(summary.decisionReason, 500),
    nextPracticeType: clean(summary.nextPracticeType, 80),
    nextPracticeTitle: clean(summary.nextPracticeTitle, 240),
    nextPracticeTask: clean(summary.nextPracticeTask, 500),
    completedAt: clean(summary.completedAt, 60),
    ...(summary.reflection && typeof summary.reflection === "object"
      ? { reflection: safeSessionReflection(summary.reflection) }
      : {})
  };
}

/**
 * Only structured learning state is persisted. In particular, the raw
 * transcript, recentTurns, model reply, and the transcript snippet that the
 * WebView keeps inside an expression-debt context are deliberately dropped.
 */
export function sanitizeEnglishLoopProfile(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  const fallbackAbilities = [
    ["product_intro", "介绍产品与项目", 48],
    ["daily_conversation", "日常交流", 56],
    ["facts", "描述事实", 52],
    ["complex_opinion", "表达复杂观点", 38],
    ["causal_explanation", "解释因果", 36],
    ["tradeoff", "讨论取舍", 30],
    ["improvised_rebuttal", "即兴回应与反驳", 28]
  ];
  const incomingAbilities = Array.isArray(value.abilities) ? value.abilities : [];
  const abilities = fallbackAbilities.map(([key, label, initial]) => {
    const item = incomingAbilities.find(candidate => candidate?.key === key);
    const rawSignal = item?.signal == null ? initial : number(item.signal, initial);
    return { key, label, signal: Math.round(clamp(rawSignal, 0, 100)) };
  });
  const patterns = value.patterns && typeof value.patterns === "object" ? value.patterns : {};
  const debts = safeArray(value.expressionDebts, 12).map((item, index) => ({
    id: clean(item?.id || `expression-${index}`, 100),
    phrase: clean(item?.phrase, 120),
    meaning: clean(item?.meaning, 160),
    // Do not persist the WebView's recent transcript snippet.
    context: "来自多次真实口语表达中的结构化信号",
    occurrences: Math.max(0, Math.min(999, Math.round(number(item?.occurrences)))),
    status: ["candidate", "active", "practicing", "stable"].includes(item?.status) ? item.status : "candidate",
    firstSeenAt: isoOrNow(item?.firstSeenAt),
    lastSeenAt: isoOrNow(item?.lastSeenAt)
  })).filter(item => item.phrase);
  const evidenceEvents = safeArray(value.evidenceEvents, 100).map((item, index) => ({
    id: clean(item?.id || `evidence-${index}`, 120),
    sessionId: clean(item?.sessionId, 120),
    at: isoOrNow(item?.at),
    wordCount: Math.max(0, Math.min(2000, Math.round(number(item?.wordCount)))),
    signals: safeSignals(item?.signals),
    confidence: Math.round(clamp(item?.confidence, 0, 1) * 100) / 100,
    ...(LEARNER_STATES.includes(item?.learnerState) ? { learnerState: item.learnerState } : {}),
    ...(ACTION_TYPES.includes(item?.action) ? { action: item.action } : {}),
    ...(Array.isArray(item?.criteriaMet) ? { criteriaMet: safeCriteria(item.criteriaMet) } : {}),
    ...(Array.isArray(item?.missingCriteria) ? { missingCriteria: safeCriteria(item.missingCriteria) } : {}),
    ...(typeof item?.evidenceType === "string" ? { evidenceType: clean(item.evidenceType, 40) } : {})
  }));
  const practice = value.nextPractice && typeof value.nextPractice === "object" ? value.nextPractice : {};
  const decision = value.lastDecision && typeof value.lastDecision === "object" ? value.lastDecision : {};
  const interventions = safeArray(value.interventions, 20).map(item => ({
    id: clean(item?.id, 120),
    type: ["update", "debt", "information", "experiment", "nothing"].includes(item?.type) ? item.type : "nothing",
    title: clean(item?.title, 240),
    hypothesis: clean(item?.hypothesis, 500),
    expectedOutcome: clean(item?.expectedOutcome, 500),
    createdAt: isoOrNow(item?.createdAt),
    status: ["open", "helpful", "not_helpful", "unverified"].includes(item?.status) ? item.status : "open",
    userNote: clean(item?.userNote, 240)
  })).filter(item => item.id);
  const masteryRecords = safeArray(value.masteryRecords, SUCCESS_CRITERIA.length)
    .map(safeMasteryRecord)
    .filter(Boolean);
  const profile = {
    version: 1,
    sessions: Math.max(0, Math.min(10000, Math.round(number(value.sessions)))),
    turns: Math.max(0, Math.min(100000, Math.round(number(value.turns)))),
    minutes: Math.max(0, Math.min(100000, Math.round(number(value.minutes) * 10) / 10)),
    lastSessionAt: clean(value.lastSessionAt, 60),
    abilities,
    patterns: {
      vocabularyRepetition: clamp(patterns.vocabularyRepetition, 0, 100),
      sentenceOrganization: clamp(patterns.sentenceOrganization, 0, 100),
      translationDependence: clamp(patterns.translationDependence, 0, 100),
      abstractPauses: clamp(patterns.abstractPauses, 0, 100),
      tenseControl: clamp(patterns.tenseControl, 0, 100),
      articleControl: clamp(patterns.articleControl, 0, 100),
      businessExpression: clamp(patterns.businessExpression, 0, 100)
    },
    expressionDebts: debts,
    recentTopics: safeArray(value.recentTopics, 6).map(item => clean(item, 80)).filter(Boolean),
    currentFocus: clean(value.currentFocus, 80),
    nextPractice: {
      type: clean(practice.type, 80),
      title: clean(practice.title, 240),
      reason: clean(practice.reason, 500),
      task: clean(practice.task, 500),
      durationMinutes: Math.max(1, Math.min(60, Math.round(number(practice.durationMinutes, 10)))),
      structure: safeArray(practice.structure, 8).map(item => clean(item, 120)).filter(Boolean)
    },
    goal: {
      statement: clean(value.goal?.statement, 400),
      deadline: clean(value.goal?.deadline, 80),
      importance: ["high", "medium", "low"].includes(value.goal?.importance) ? value.goal.importance : "medium"
    },
    evidenceEvents,
    lastDecision: {
      type: ["update", "debt", "information", "experiment", "nothing"].includes(decision.type) ? decision.type : "nothing",
      id: clean(decision.id, 120),
      title: clean(decision.title, 240),
      reason: clean(decision.reason, 500),
      evidenceCount: Math.max(0, Math.min(100000, Math.round(number(decision.evidenceCount)))),
      sessionCount: Math.max(0, Math.min(10000, Math.round(number(decision.sessionCount)))),
      confidence: Math.round(clamp(decision.confidence, 0, 1) * 100) / 100,
      action: clean(decision.action, 500),
      hypothesis: clean(decision.hypothesis, 500),
      expectedOutcome: clean(decision.expectedOutcome, 500)
    },
    interventions,
    masteryRecords,
    ...(safeSessionPlan(value.sessionPlan) ? { sessionPlan: safeSessionPlan(value.sessionPlan) } : {}),
    ...(safeTurnEvidence(value.lastTurnEvidence) ? { lastTurnEvidence: safeTurnEvidence(value.lastTurnEvidence) } : {}),
    ...(safeSessionReflection(value.lastSessionReflection)
      ? { lastSessionReflection: safeSessionReflection(value.lastSessionReflection) }
      : {})
  };
  // A client must not be able to make the profile unbounded even if it sends
  // an otherwise valid-looking object.
  if (Buffer.byteLength(JSON.stringify(profile), "utf8") > MAX_PROFILE_BYTES) {
    profile.evidenceEvents = profile.evidenceEvents.slice(0, 40);
    profile.interventions = profile.interventions.slice(0, 8);
  }
  return profile;
}

function rowProfile(row) {
  return row ? sanitizeEnglishLoopProfile(json(row.profile_json, {})) : null;
}

function rowSession(row) {
  if (!row) return null;
  const summary = safeSessionSummary(json(row.summary_json, {}));
  return {
    id: row.id,
    topic: row.topic || "",
    goal: json(row.goal_json, {}),
    startedAt: row.started_at,
    endedAt: row.ended_at || "",
    ...(summary ? { summary } : {}),
    turnCount: Number(row.turn_count || 0),
    updatedAt: row.updated_at
  };
}

function rowFeedback(row) {
  if (!row) return null;
  return {
    interventionId: row.intervention_id,
    sessionId: row.session_id || "",
    status: row.status,
    note: row.note || "",
    createdAt: row.created_at
  };
}

export function createEnglishLoopStore(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS english_loop_profiles (
      owner_key TEXT PRIMARY KEY,
      user_id TEXT,
      profile_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS english_loop_sessions (
      owner_key TEXT NOT NULL,
      id TEXT NOT NULL,
      user_id TEXT,
      topic TEXT NOT NULL DEFAULT '',
      goal_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary_json TEXT NOT NULL DEFAULT '{}',
      turn_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, id)
    );
    CREATE INDEX IF NOT EXISTS idx_english_loop_sessions_owner ON english_loop_sessions(owner_key, updated_at DESC);
    CREATE TABLE IF NOT EXISTS english_loop_turns (
      owner_key TEXT NOT NULL,
      id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      signals_json TEXT NOT NULL DEFAULT '{}',
      decision_type TEXT NOT NULL DEFAULT 'nothing',
      next_move_type TEXT NOT NULL DEFAULT '',
      learner_state TEXT NOT NULL DEFAULT 'in_progress',
      action TEXT NOT NULL DEFAULT 'continue',
      criteria_met_json TEXT NOT NULL DEFAULT '[]',
      missing_criteria_json TEXT NOT NULL DEFAULT '[]',
      evidence_type TEXT NOT NULL DEFAULT 'not_observed',
      fallback INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, id)
    );
    CREATE TABLE IF NOT EXISTS english_loop_feedback (
      owner_key TEXT NOT NULL,
      intervention_id TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, intervention_id)
    );
  `);
  const sessionColumns = new Set(db.prepare("PRAGMA table_info(english_loop_sessions)").all().map(column => column.name));
  if (!sessionColumns.has("summary_json")) {
    db.exec("ALTER TABLE english_loop_sessions ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}'");
  }
  const turnColumns = new Set(db.prepare("PRAGMA table_info(english_loop_turns)").all().map(column => column.name));
  if (!turnColumns.has("learner_state")) db.exec("ALTER TABLE english_loop_turns ADD COLUMN learner_state TEXT NOT NULL DEFAULT 'in_progress'");
  if (!turnColumns.has("action")) db.exec("ALTER TABLE english_loop_turns ADD COLUMN action TEXT NOT NULL DEFAULT 'continue'");
  if (!turnColumns.has("criteria_met_json")) db.exec("ALTER TABLE english_loop_turns ADD COLUMN criteria_met_json TEXT NOT NULL DEFAULT '[]'");
  if (!turnColumns.has("missing_criteria_json")) db.exec("ALTER TABLE english_loop_turns ADD COLUMN missing_criteria_json TEXT NOT NULL DEFAULT '[]'");
  if (!turnColumns.has("evidence_type")) db.exec("ALTER TABLE english_loop_turns ADD COLUMN evidence_type TEXT NOT NULL DEFAULT 'not_observed'");

  const getProfileRow = db.prepare("SELECT * FROM english_loop_profiles WHERE owner_key = ?");
  const saveProfileRow = db.prepare(`
    INSERT INTO english_loop_profiles (owner_key, user_id, profile_json, updated_at)
    VALUES (@ownerKey, @userId, @profileJson, @updatedAt)
    ON CONFLICT(owner_key) DO UPDATE SET
      user_id = excluded.user_id,
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `);
  const saveSessionRow = db.prepare(`
    INSERT INTO english_loop_sessions (owner_key, id, user_id, topic, goal_json, started_at, ended_at, summary_json, turn_count, updated_at)
    VALUES (@ownerKey, @id, @userId, @topic, @goalJson, @startedAt, @endedAt, @summaryJson, 0, @updatedAt)
    ON CONFLICT(owner_key, id) DO UPDATE SET
      topic = CASE WHEN excluded.topic <> '' THEN excluded.topic ELSE english_loop_sessions.topic END,
      goal_json = CASE WHEN excluded.goal_json <> '{}' THEN excluded.goal_json ELSE english_loop_sessions.goal_json END,
      started_at = CASE WHEN excluded.started_at <> '' THEN excluded.started_at ELSE english_loop_sessions.started_at END,
      ended_at = CASE WHEN excluded.ended_at <> '' THEN excluded.ended_at ELSE english_loop_sessions.ended_at END,
      summary_json = CASE WHEN excluded.summary_json <> '{}' THEN excluded.summary_json ELSE english_loop_sessions.summary_json END,
      user_id = COALESCE(excluded.user_id, english_loop_sessions.user_id),
      updated_at = excluded.updated_at
  `);
  const addTurnRow = db.prepare(`
    INSERT OR IGNORE INTO english_loop_turns
      (owner_key, id, session_id, observed_at, word_count, signals_json, decision_type, next_move_type, learner_state, action, criteria_met_json, missing_criteria_json, evidence_type, fallback, created_at)
    VALUES (@ownerKey, @id, @sessionId, @observedAt, @wordCount, @signalsJson, @decisionType, @nextMoveType, @learnerState, @action, @criteriaMetJson, @missingCriteriaJson, @evidenceType, @fallback, @createdAt)
  `);
  const incrementSession = db.prepare("UPDATE english_loop_sessions SET turn_count = turn_count + 1, updated_at = ? WHERE owner_key = ? AND id = ?");
  const saveFeedbackRow = db.prepare(`
    INSERT INTO english_loop_feedback (owner_key, intervention_id, session_id, status, note, created_at)
    VALUES (@ownerKey, @interventionId, @sessionId, @status, @note, @createdAt)
    ON CONFLICT(owner_key, intervention_id) DO UPDATE SET
      session_id = excluded.session_id,
      status = excluded.status,
      note = excluded.note,
      created_at = excluded.created_at
  `);

  function getProfile(ownerKey) {
    return rowProfile(getProfileRow.get(String(ownerKey)));
  }

  function listSessions(ownerKey, limit = 20) {
    return db.prepare("SELECT * FROM english_loop_sessions WHERE owner_key = ? ORDER BY updated_at DESC LIMIT ?")
      .all(String(ownerKey), Math.max(1, Math.min(100, Number(limit) || 20))).map(rowSession);
  }

  function listFeedback(ownerKey, limit = 20) {
    return db.prepare("SELECT * FROM english_loop_feedback WHERE owner_key = ? ORDER BY created_at DESC LIMIT ?")
      .all(String(ownerKey), Math.max(1, Math.min(100, Number(limit) || 20))).map(rowFeedback);
  }

  function getState(ownerKey) {
    return {
      profile: getProfile(ownerKey),
      sessions: listSessions(ownerKey),
      feedback: listFeedback(ownerKey)
    };
  }

  const sync = db.transaction(input => {
    const ownerKey = clean(input.ownerKey, 160);
    if (!ownerKey) throw new Error("English Loop owner is required");
    const timestamp = isoOrNow(input.now);
    const profile = sanitizeEnglishLoopProfile(input.profile || {});
    saveProfileRow.run({
      ownerKey,
      userId: clean(input.userId, 160) || null,
      profileJson: JSON.stringify(profile),
      updatedAt: timestamp
    });
    const session = input.session && typeof input.session === "object" ? input.session : {};
    const sessionId = clean(session.id || input.sessionId, 160);
    if (sessionId) {
      saveSessionRow.run({
        ownerKey,
        id: sessionId,
        userId: clean(input.userId, 160) || null,
        topic: clean(session.topic, 240),
        goalJson: JSON.stringify(session.goal && typeof session.goal === "object" ? {
          statement: clean(session.goal.statement, 400),
          deadline: clean(session.goal.deadline, 80),
          importance: clean(session.goal.importance, 20)
        } : {}),
        startedAt: isoOrNow(session.startedAt || timestamp),
        endedAt: clean(session.endedAt, 60),
        summaryJson: session.summary && typeof session.summary === "object" && Object.keys(session.summary).length
          ? JSON.stringify(safeSessionSummary(session.summary))
          : "{}",
        updatedAt: timestamp
      });
    }
    const turn = input.turn && typeof input.turn === "object" ? input.turn : null;
    if (turn && sessionId && clean(turn.id, 160)) {
      const result = addTurnRow.run({
        ownerKey,
        id: clean(turn.id, 160),
        sessionId,
        observedAt: isoOrNow(turn.observedAt || timestamp),
        wordCount: Math.max(0, Math.min(2000, Math.round(number(turn.wordCount)))),
        signalsJson: JSON.stringify(safeSignals(turn.signals)),
        decisionType: clean(turn.decisionType, 80) || "nothing",
        nextMoveType: clean(turn.nextMoveType, 80),
        learnerState: LEARNER_STATES.includes(turn.learnerState) ? turn.learnerState : "in_progress",
        action: ACTION_TYPES.includes(turn.action) ? turn.action : "continue",
        criteriaMetJson: JSON.stringify(safeCriteria(turn.criteriaMet)),
        missingCriteriaJson: JSON.stringify(safeCriteria(turn.missingCriteria)),
        evidenceType: clean(turn.evidenceType, 40) || "not_observed",
        fallback: turn.fallback ? 1 : 0,
        createdAt: timestamp
      });
      if (result.changes) incrementSession.run(timestamp, ownerKey, sessionId);
    }
    return getState(ownerKey);
  });

  function recordFeedback(input = {}) {
    const ownerKey = clean(input.ownerKey, 160);
    const interventionId = clean(input.interventionId, 160);
    const status = ["helpful", "not_helpful", "unverified", "open"].includes(input.status) ? input.status : "unverified";
    if (!ownerKey || !interventionId) throw new Error("English Loop feedback identity is required");
    saveFeedbackRow.run({
      ownerKey,
      interventionId,
      sessionId: clean(input.sessionId, 160),
      status,
      note: clean(input.note, 240),
      createdAt: new Date().toISOString()
    });
    return rowFeedback(db.prepare("SELECT * FROM english_loop_feedback WHERE owner_key = ? AND intervention_id = ?").get(ownerKey, interventionId));
  }

  return {
    dbPath: resolvedPath,
    getProfile,
    getState,
    listSessions,
    listFeedback,
    sync,
    recordFeedback,
    sanitizeEnglishLoopProfile
  };
}

export function hashEnglishLoopClientId(clientId) {
  return crypto.createHash("sha256").update(String(clientId)).digest("hex");
}
