import { describe, expect, it } from "vitest";
import {
  attachEnglishTurnEvidence,
  createEnglishLoopSessionPlan,
  createInitialSpeakingProfile,
  extractEnglishTurnEvidence,
  isUsefulEnglishLoopResponse,
  localEnglishLoopReply,
  markEnglishLoopSessionStarted,
  observeEnglishTurn,
  recordInterventionFeedback,
  refreshEnglishMasteryReviewStates,
  reflectEnglishLoopSession,
  updateEnglishMasteryFromSession
} from "./english-loop";

describe("English speaking loop", () => {
  it("builds a personal profile from real conversation signals", () => {
    let profile = markEnglishLoopSessionStarted(createInitialSpeakingProfile(), 1_700_000_000_000);
    profile = observeEnglishTurn(
      profile,
      "I think this product matters because it helps the team make better decisions. For example, we can compare the upside and the downside.",
      { durationMs: 30_000, now: 1_700_000_030_000 }
    ).profile;

    expect(profile.sessions).toBe(1);
    expect(profile.turns).toBe(1);
    expect(profile.minutes).toBe(0.5);
    expect(profile.abilities.find(item => item.key === "causal_explanation")?.signal).toBeGreaterThan(36);
    expect(profile.abilities.find(item => item.key === "tradeoff")?.signal).toBeGreaterThan(30);
    expect(profile.recentTopics).toEqual(["产品"]);
  });

  it("turns repeated high-value expression needs into a practice debt", () => {
    let profile = createInitialSpeakingProfile();
    const turn = "The short-term payoff is limited, but the strategic value is important in the long run.";
    for (let index = 0; index < 5; index += 1) {
      profile = observeEnglishTurn(profile, turn, {
        now: 1_700_000_000_000 + index * 60_000,
        sessionId: `session-${index % 3}`
      }).profile;
    }

    expect(profile.expressionDebts.map(item => item.phrase)).toEqual([
      "in the long run",
      "strategic value",
      "short-term payoff"
    ]);
    expect(profile.nextPractice.type).toBe("expression_reuse");
    expect(profile.nextPractice.task).toContain("in the long run");
    expect(profile.lastDecision.type).toBe("debt");
  });

  it("does not turn one isolated phrase into a confirmed decision", () => {
    const profile = observeEnglishTurn(
      createInitialSpeakingProfile(),
      "The short-term payoff is limited, but the strategic value is important in the long run.",
      { now: 1_700_000_000_000, sessionId: "session-1" }
    ).profile;

    expect(profile.lastDecision.type).toBe("nothing");
    expect(profile.lastDecision.confidence).toBeLessThan(0.75);
    expect(profile.expressionDebts.every(item => item.status === "candidate")).toBe(true);
  });

  it("rejects generic model replies that do not anchor to the learner's topic", () => {
    expect(isUsefulEnglishLoopResponse(
      { reply: "That's interesting. Keep going.", nextPrompt: "Tell me more." },
      "I am building a circular procurement product",
      ""
    )).toBe(false);
    expect(isUsefulEnglishLoopResponse(
      { reply: "You are building a circular procurement product, which matters for your meeting.", nextPrompt: "Why does the procurement model matter for your customers?" },
      "I am building a circular procurement product",
      "",
      "cause"
    )).toBe(true);
    expect(isUsefulEnglishLoopResponse(
      { reply: "You are building a circular procurement product.", nextPrompt: "Tell me more about it." },
      "I am building a circular procurement product",
      "",
      "cause"
    )).toBe(false);
  });

  it("moves from general conversation to a 30-second opinion experiment", () => {
    let profile = createInitialSpeakingProfile();
    for (let index = 0; index < 3; index += 1) {
      profile = observeEnglishTurn(
        profile,
        "I think this project is useful and I want to explain the main idea clearly.",
        { now: 1_700_000_000_000 + index * 60_000 }
      ).profile;
    }

    expect(profile.nextPractice.type).toBe("opinion_structure");
    expect(profile.nextPractice.title).toBe("30-second opinion");
    expect(localEnglishLoopReply(profile, "I want to improve my speaking").nextPrompt).toContain("30-second");
  });

  it("keeps an intervention open until the learner verifies its usefulness", () => {
    let profile = createInitialSpeakingProfile();
    const turn = "I think the product is valuable because it helps customers, for example in our current project.";
    for (let index = 0; index < 5; index += 1) {
      profile = observeEnglishTurn(profile, turn, {
        now: 1_700_000_000_000 + index * 60_000,
        sessionId: `session-${index % 2}`
      }).profile;
    }
    const intervention = profile.interventions[0];
    expect(intervention).toBeTruthy();
    expect(intervention.status).toBe("open");
    profile = recordInterventionFeedback(profile, intervention.id, "helpful", "It made my answers more structured.");
    expect(profile.interventions[0].status).toBe("helpful");
    expect(profile.interventions[0].userNote).toContain("structured");
  });

  it("creates a bounded session plan and gates a completed turn", () => {
    const profile = createInitialSpeakingProfile();
    const plan = createEnglishLoopSessionPlan(profile, "AI products", 1_700_000_000_000);
    const evidence = extractEnglishTurnEvidence({
      profile,
      plan,
      transcript: "I think this product matters for our team.",
      sessionId: "session-1",
      now: 1_700_000_001_000
    });

    expect(plan.successCriteria).toEqual(["relevant_response", "gives_opinion"]);
    expect(evidence.state).toBe("completed");
    expect(evidence.action).toBe("post_turn_feedback");
    expect(evidence.criteriaMet).toEqual(["relevant_response", "gives_opinion"]);
  });

  it("uses a minimal hint for an explicit stuck turn and does not update long-term evidence", () => {
    const profile = createInitialSpeakingProfile();
    const plan = createEnglishLoopSessionPlan(profile, "产品", 1_700_000_000_000);
    const evidence = extractEnglishTurnEvidence({
      profile,
      plan,
      transcript: "I am not sure how to say this.",
      sessionId: "session-1",
      now: 1_700_000_001_000
    });
    const local = localEnglishLoopReply(
      attachEnglishTurnEvidence(profile, evidence),
      "I am not sure how to say this.",
      {
        state: evidence.state,
        action: evidence.action,
        reasonEvidence: evidence.observations,
        nextUserAction: "Start with one simple sentence.",
        shouldUpdateLongTermProfile: false
      }
    );

    expect(evidence.state).toBe("stuck");
    expect(evidence.action).toBe("minimal_hint");
    expect(local.nextPrompt).toContain("simple");
    expect(local.reply).not.toMatch(/the correct answer is/i);
  });

  it("keeps stuck turns out of long-term signals and does not overwrite prior evidence", () => {
    let profile = observeEnglishTurn(
      createInitialSpeakingProfile(),
      "I think this product matters because it helps the team.",
      { now: 1_700_000_000_000, sessionId: "session-1" }
    ).profile;
    const priorEvidence = structuredClone(profile.evidenceEvents[0]);
    const priorAbilitySignals = profile.abilities.map(item => item.signal);
    const plan = createEnglishLoopSessionPlan(profile, "产品", 1_700_000_001_000);
    const observed = observeEnglishTurn(profile, "I am not sure how to say this.", {
      now: 1_700_000_002_000,
      sessionId: "session-1",
      plan
    });
    const evidence = extractEnglishTurnEvidence({
      profile: observed.profile,
      plan,
      transcript: "I am not sure how to say this.",
      sessionId: "session-1",
      now: 1_700_000_002_000,
      signals: observed.signals
    });
    profile = attachEnglishTurnEvidence(observed.profile, evidence);

    expect(profile.turns).toBe(2);
    expect(profile.evidenceEvents).toHaveLength(1);
    expect(profile.evidenceEvents[0]).toEqual(priorEvidence);
    expect(profile.abilities.map(item => item.signal)).toEqual(priorAbilitySignals);
    expect(profile.lastTurnEvidence?.state).toBe("stuck");
  });

  it("reflects a session from evidence and keeps recurring gaps visible", () => {
    const profile = createInitialSpeakingProfile();
    profile.nextPractice = {
      type: "opinion_structure",
      title: "30-second opinion",
      reason: "练习观点结构",
      task: "Give a 30-second answer: point, reason, example, conclusion.",
      durationMinutes: 5,
      structure: ["Point", "Reason", "Example", "Conclusion"]
    };
    const plan = createEnglishLoopSessionPlan(profile, "产品", 1_700_000_000_000);
    const evidence = [
      extractEnglishTurnEvidence({
        profile,
        plan,
        transcript: "I think the product is useful.",
        sessionId: "session-1",
        now: 1_700_000_001_000
      }),
      extractEnglishTurnEvidence({
        profile,
        plan,
        transcript: "I think the product matters for the team.",
        sessionId: "session-1",
        now: 1_700_000_061_000
      })
    ];
    const reflection = reflectEnglishLoopSession(profile, plan, evidence, 1_700_000_120_000);

    expect(reflection.turnCount).toBe(2);
    expect(reflection.criteriaCompleted).toContain("gives_opinion");
    expect(reflection.nextExperiment).toContain("下一次围绕");
    expect(reflection.profileUpdateAllowed).toBe(true);
  });

  it("rejects a model response that changes the selected pedagogical action", () => {
    expect(isUsefulEnglishLoopResponse(
      {
        action: "continue",
        reply: "You mentioned the product and that is connected to your work.",
        nextPrompt: "Please repeat that in one clear sentence."
      },
      "I am not sure how to say this",
      "",
      "free",
      "minimal_hint"
    )).toBe(false);
  });

  it("keeps a first independent success at candidate instead of claiming mastery", () => {
    const profile = createInitialSpeakingProfile();
    const plan = createEnglishLoopSessionPlan(profile, "AI", 1_700_000_000_000);
    const evidence = [extractEnglishTurnEvidence({
      profile,
      plan,
      transcript: "I think AI matters for my work.",
      sessionId: "session-1",
      now: 1_700_000_001_000
    })];
    const reflection = reflectEnglishLoopSession(profile, plan, evidence, 1_700_000_002_000);
    const updated = updateEnglishMasteryFromSession(profile, plan, evidence, reflection, 1_700_000_002_000);

    expect(updated.masteryRecords.find(item => item.criterion === "gives_opinion")?.status).toBe("candidate");
    expect(updated.masteryRecords.find(item => item.criterion === "gives_opinion")?.independentSessionIds).toEqual(["session-1"]);
  });

  it("does not treat success after hints as independent mastery", () => {
    let profile = createInitialSpeakingProfile();
    for (let index = 0; index < 2; index += 1) {
      const now = 1_700_000_000_000 + index * 86_400_000;
      const plan = createEnglishLoopSessionPlan(profile, index ? "产品" : "AI", now);
      const evidence = [
        extractEnglishTurnEvidence({
          profile,
          plan,
          transcript: "I am not sure how to say this.",
          sessionId: `session-${index + 1}`,
          now: now + 1_000
        }),
        extractEnglishTurnEvidence({
          profile,
          plan,
          transcript: "I think this product matters for my work.",
          sessionId: `session-${index + 1}`,
          now: now + 2_000
        })
      ];
      const reflection = reflectEnglishLoopSession(profile, plan, evidence, now + 3_000);
      profile = updateEnglishMasteryFromSession(profile, plan, evidence, reflection, now + 3_000);
    }

    const mastery = profile.masteryRecords.find(item => item.criterion === "gives_opinion");
    expect(mastery?.promptedSuccesses).toBe(2);
    expect(mastery?.independentSessionIds).toEqual([]);
    expect(mastery?.status).not.toBe("provisional");
    expect(mastery?.status).not.toBe("stable");
  });

  it("requires cross-date and cross-topic independent reuse before stable", () => {
    let profile = createInitialSpeakingProfile();
    const topics = ["AI", "产品", "工作"];
    for (let index = 0; index < topics.length; index += 1) {
      const now = 1_700_000_000_000 + index * 86_400_000;
      profile.nextPractice = {
        type: "conversation",
        title: "Natural conversation",
        reason: "验证迁移",
        task: "Give your opinion.",
        durationMinutes: 5,
        structure: ["Opinion"]
      };
      const plan = createEnglishLoopSessionPlan(profile, topics[index], now);
      const subject = index === 0 ? "AI" : index === 1 ? "this product" : "this work plan";
      const evidence = [extractEnglishTurnEvidence({
        profile,
        plan,
        transcript: `I think ${subject} matters for our team.`,
        sessionId: `session-${index + 1}`,
        now: now + 1_000
      })];
      const reflection = reflectEnglishLoopSession(profile, plan, evidence, now + 2_000);
      profile = updateEnglishMasteryFromSession(profile, plan, evidence, reflection, now + 2_000);
    }

    const mastery = profile.masteryRecords.find(item => item.criterion === "gives_opinion");
    expect(mastery?.status).toBe("stable");
    expect(mastery?.independentSessionIds).toHaveLength(3);
    expect(mastery?.dateKeys).toHaveLength(3);
    expect(mastery?.topicKeys.length).toBeGreaterThanOrEqual(2);
  });

  it("marks conflicting evidence for review and plans a review session", () => {
    const base = createInitialSpeakingProfile();
    base.masteryRecords = [{
      criterion: "gives_opinion",
      status: "stable",
      evidenceCount: 3,
      successfulSessionIds: ["session-1", "session-2", "session-3"],
      independentSessionIds: ["session-1", "session-2", "session-3"],
      promptedSuccesses: 0,
      contradictionCount: 0,
      topicKeys: ["AI", "产品"],
      dateKeys: ["2026-08-10", "2026-08-12"],
      firstObservedAt: "2026-08-10T00:00:00.000Z",
      lastObservedAt: "2026-08-12T00:00:00.000Z",
      lastIndependentAt: "2026-08-12T00:00:00.000Z",
      nextReviewAt: "2026-08-26T00:00:00.000Z",
      confidence: 0.9
    }];
    const plan = createEnglishLoopSessionPlan(base, "产品", 1_700_000_000_000);
    const evidence = [
      extractEnglishTurnEvidence({
        profile: base,
        plan,
        transcript: "This product has many features for teams.",
        sessionId: "session-4",
        now: 1_700_000_001_000
      }),
      extractEnglishTurnEvidence({
        profile: base,
        plan,
        transcript: "The team uses the product every day.",
        sessionId: "session-4",
        now: 1_700_000_002_000
      })
    ];
    const reflection = reflectEnglishLoopSession(base, plan, evidence, 1_700_000_003_000);
    const updated = updateEnglishMasteryFromSession(base, plan, evidence, reflection, 1_700_000_003_000);
    const nextPlan = createEnglishLoopSessionPlan(updated, "AI", 1_700_086_400_000);

    expect(updated.masteryRecords.find(item => item.criterion === "gives_opinion")?.status).toBe("needs_review");
    expect(updated.masteryRecords.find(item => item.criterion === "gives_opinion")?.contradictionCount).toBe(1);
    expect(nextPlan.difficulty).toBe("review");
    expect(nextPlan.reviewCriterion).toBe("gives_opinion");
  });

  it("turns overdue provisional evidence into a review task without claiming forgetting", () => {
    const profile = createInitialSpeakingProfile();
    profile.masteryRecords = [{
      criterion: "explains_cause",
      status: "provisional",
      evidenceCount: 2,
      successfulSessionIds: ["session-1", "session-2"],
      independentSessionIds: ["session-2"],
      promptedSuccesses: 1,
      contradictionCount: 0,
      topicKeys: ["AI", "产品"],
      dateKeys: ["2026-08-01", "2026-08-03"],
      firstObservedAt: "2026-08-01T00:00:00.000Z",
      lastObservedAt: "2026-08-03T00:00:00.000Z",
      lastIndependentAt: "2026-08-03T00:00:00.000Z",
      nextReviewAt: "2026-08-10T00:00:00.000Z",
      confidence: 0.68
    }];

    const refreshed = refreshEnglishMasteryReviewStates(profile, Date.parse("2026-08-13T00:00:00.000Z"));
    const plan = createEnglishLoopSessionPlan(refreshed, "工作", Date.parse("2026-08-13T00:01:00.000Z"));

    expect(refreshed.masteryRecords[0].status).toBe("needs_review");
    expect(refreshed.nextPractice.reason).toContain("需要复核");
    expect(plan.difficulty).toBe("review");
    expect(plan.reviewCriterion).toBe("explains_cause");
  });
});
