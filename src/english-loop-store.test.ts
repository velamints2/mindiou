// @ts-nocheck
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  attachEnglishTurnEvidence,
  createInitialSpeakingProfile,
  createEnglishLoopSessionPlan,
  extractEnglishTurnEvidence,
  observeEnglishTurn,
  reflectEnglishLoopSession,
  updateEnglishMasteryFromSession
} from "./english-loop";
import { createEnglishLoopStore } from "../english-loop-store.js";

const temporaryDirectories: string[] = [];

function createStore() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "english-loop-store-"));
  temporaryDirectories.push(directory);
  return createEnglishLoopStore(path.join(directory, "loop.sqlite"));
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("English Loop persistence", () => {
  it("persists a profile and idempotently records structured turns", () => {
    const store = createStore();
    const ownerKey = "client:alice";
    let profile = createInitialSpeakingProfile();
    profile = observeEnglishTurn(
      profile,
      "I think this product matters because it helps the team make better decisions.",
      { now: 1_700_000_000_000, sessionId: "session-1" }
    ).profile;
    const sessionPlan = createEnglishLoopSessionPlan(profile, "AI products", 1_700_000_000_000);
    const turnEvidence = extractEnglishTurnEvidence({
      profile,
      plan: sessionPlan,
      transcript: "I think this product matters because it helps the team make better decisions.",
      sessionId: "session-1",
      now: 1_700_000_000_000
    });
    profile = attachEnglishTurnEvidence(profile, turnEvidence);
    profile.sessionPlan = sessionPlan;
    const reflection = reflectEnglishLoopSession(profile, sessionPlan, [turnEvidence], 1_700_000_001_000);
    profile.lastSessionReflection = reflection;
    profile = updateEnglishMasteryFromSession(
      profile,
      sessionPlan,
      [turnEvidence],
      reflection,
      1_700_000_001_000
    );

    const first = store.sync({
      ownerKey,
      profile,
      sessionId: "session-1",
      session: {
        id: "session-1",
        topic: "AI products",
        goal: profile.goal,
        startedAt: "2023-11-14T22:13:20.000Z",
        summary: {
          turnCount: 1,
          evidenceCount: 1,
          minutes: 0.5,
          decisionType: "nothing",
          decisionTitle: "继续观察",
          decisionReason: "证据还不够",
          nextPracticeType: "conversation",
          nextPracticeTitle: "Natural conversation",
          nextPracticeTask: "Talk about your work.",
          completedAt: "2023-11-14T22:14:20.000Z"
        }
      },
      turn: {
        id: profile.evidenceEvents[0].id,
        sessionId: "session-1",
        observedAt: profile.evidenceEvents[0].at,
        wordCount: profile.evidenceEvents[0].wordCount,
        signals: profile.evidenceEvents[0].signals,
        decisionType: profile.lastDecision.type
      }
    });
    const second = store.sync({
      ownerKey,
      profile,
      sessionId: "session-1",
      session: { id: "session-1", topic: "AI products", goal: profile.goal },
      turn: {
        id: profile.evidenceEvents[0].id,
        sessionId: "session-1",
        observedAt: profile.evidenceEvents[0].at,
        wordCount: profile.evidenceEvents[0].wordCount,
        signals: profile.evidenceEvents[0].signals,
        decisionType: profile.lastDecision.type
      }
    });

    expect(first.profile?.turns).toBe(1);
    expect(second.profile?.turns).toBe(1);
    expect(second.sessions).toHaveLength(1);
    expect(second.sessions[0].turnCount).toBe(1);
    expect(second.sessions[0].summary.nextPracticeTitle).toBe("Natural conversation");
    expect(second.profile?.sessionPlan?.taskType).toBe("conversation");
    expect(second.profile?.lastTurnEvidence?.action).toBe("post_turn_feedback");
    expect(second.profile?.masteryRecords.find(item => item.criterion === "gives_opinion")?.status).toBe("candidate");
    expect(second.profile?.sessionPlan?.difficulty).toBe("calibration");
  });

  it("keeps owners isolated and strips transcript snippets before storage", () => {
    const store = createStore();
    const profile = createInitialSpeakingProfile();
    profile.expressionDebts.push({
      id: "debt-1",
      phrase: "strategic value",
      meaning: "战略价值",
      context: "THIS IS A RAW TRANSCRIPT THAT MUST NOT BE STORED",
      occurrences: 2,
      status: "active",
      firstSeenAt: "2023-11-14T22:13:20.000Z",
      lastSeenAt: "2023-11-14T22:13:20.000Z"
    });
    store.sync({ ownerKey: "client:alice", profile });
    store.recordFeedback({
      ownerKey: "client:alice",
      interventionId: "experiment-1",
      status: "helpful",
      note: "It helped me structure an answer."
    });

    const alice = store.getState("client:alice");
    const bob = store.getState("client:bob");
    expect(alice.profile?.expressionDebts[0].context).not.toContain("RAW TRANSCRIPT");
    expect(alice.feedback[0].status).toBe("helpful");
    expect(bob.profile).toBeNull();
    expect(bob.feedback).toEqual([]);
  });

  it("migrates an existing session table without erasing a later summary", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "english-loop-legacy-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "loop.sqlite");
    const legacyDb = new Database(databasePath);
    legacyDb.exec(`
      CREATE TABLE english_loop_sessions (
        owner_key TEXT NOT NULL,
        id TEXT NOT NULL,
        user_id TEXT,
        topic TEXT NOT NULL DEFAULT '',
        goal_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT NOT NULL,
        ended_at TEXT,
        turn_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_key, id)
      );
    `);
    legacyDb.close();

    const store = createEnglishLoopStore(databasePath);
    const profile = createInitialSpeakingProfile();
    store.sync({
      ownerKey: "client:legacy",
      profile,
      session: {
        id: "session-legacy",
        topic: "AI",
        goal: profile.goal,
        startedAt: "2026-08-13T00:00:00.000Z",
        summary: {
          turnCount: 2,
          evidenceCount: 2,
          minutes: 1,
          decisionType: "experiment",
          decisionTitle: "本周做一次实验",
          nextPracticeType: "opinion_structure",
          nextPracticeTitle: "30-second opinion",
          nextPracticeTask: "Point, reason, example, conclusion.",
          completedAt: "2026-08-13T00:02:00.000Z"
        }
      }
    });
    store.sync({
      ownerKey: "client:legacy",
      profile,
      session: { id: "session-legacy", topic: "AI", goal: profile.goal }
    });

    expect(store.getState("client:legacy").sessions[0].summary.nextPracticeTitle).toBe("30-second opinion");
  });
});
