// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import {
  endClearanceSession,
  getClearanceResearchPrompt,
  getResearchStructuringPrompt,
  normalizeResearchSources,
  publicSession,
  startClearanceSession,
  submitClearanceAnswer
} from "../mvp1-clearance.js";

const report = {
  id: "report-1",
  analysis: { userCapability: { currentDomain: "G2 WebView networking" } },
  sections: {
    aiCompleted: [{ item: "AI changed the API URL", evidence: "diff" }],
    userContributed: [{ item: "User reported failed to fetch", evidence: "test" }],
    dangerousGaps: [{
      rank: 1,
      gap: "The user has not explained the boundary between network reachability and CORS.",
      whyDangerous: "A partial fix can look complete.",
      evidence: "The AI made the network decision."
    }],
    cognitiveStructure: { facts: [], decisions: [], tradeoffs: [] },
    feynmanCards: [{
      id: "card-1",
      target: "network reachability and CORS",
      prompt: "Explain why a reachable API can still fail in a WebView.",
      targetLevel: "L2",
      difficulty: "intermediate"
    }]
  }
};

const research = {
  rewrittenQuestion: "How do reachability, CORS, and a WebView network policy fail at different stages?",
  summary: "These mechanisms act at different boundaries.",
  sources: [
    { id: "source-official", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS", title: "CORS", claim: "CORS controls script access to cross-origin responses." },
    { id: "source-blog", url: "https://example.com/webview-networking", title: "WebView note", claim: "A device WebView may have a separate network policy." }
  ],
  scaffold: [
    { id: "point-1", point: "Reachability determines whether a request reaches the server.", whyItMatters: "No response exists before this boundary.", sourceIds: ["source-official"] },
    { id: "point-2", point: "CORS determines whether browser code may read a cross-origin response.", whyItMatters: "The request can succeed while JavaScript sees a failure.", sourceIds: ["source-official"] },
    { id: "point-3", point: "WebView policy can block transport independently.", whyItMatters: "Desktop success does not prove device success.", sourceIds: ["source-blog"] }
  ]
};

describe("MVP-1 clearance session", () => {
  it("classifies sources from URL evidence, not model labels", () => {
    const sources = normalizeResearchSources([
      { url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS", type: "ordinary_web" },
      { url: "https://example.com/post", type: "official_doc" },
      { url: "https://hub.evenrealities.com/docs", type: "ordinary_web" }
    ]);
    expect(sources[0].type).toBe("official_doc");
    expect(sources[0].credibility).toBe("high");
    expect(sources[1].type).toBe("ordinary_web");
    expect(sources[2].type).toBe("official_doc");
    expect(sources[2].credibility).toBe("high");
  });

  it("keeps the scaffold hidden before the first answer", async () => {
    const session = await startClearanceSession({
      report,
      cardId: "card-1",
      researchFn: vi.fn().mockResolvedValue(research)
    });
    expect(session.scaffold).toHaveLength(3);
    expect(publicSession(session).scaffold).toBeUndefined();
    expect(publicSession(session).clearanceQuestion).toContain("reachability");
  });

  it("reveals the scaffold and teaches after an insufficient answer", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    const attempt = await submitClearanceAnswer({
      session,
      answer: "It fails because the network is bad.",
      analyzeFn: async () => ({
        status: "needs_practice",
        coverage: 0.2,
        demonstrated: ["Recognizes a network boundary"],
        missing: ["Does not distinguish transport from CORS"],
        misconceptions: ["Treats all failures as network failure"],
        evidence: ["The answer only mentions the network"],
        materialSourceIds: ["source-official"],
        feedback: "You identified reachability but merged three boundaries.",
        teaching: "A request can reach the server and still be unreadable to browser JavaScript.",
        nextQuestion: "At which step does CORS act?",
        recommendation: "continue"
      })
    });
    expect(attempt.analysis.status).toBe("needs_practice");
    expect(attempt.analysis.teaching).toContain("server");
    expect(publicSession(session, { revealScaffold: true }).scaffold).toHaveLength(3);
  });

  it("requires review when provisional clearance depends on ordinary web evidence", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    await submitClearanceAnswer({
      session,
      answer: "Reachability is transport, CORS controls whether JS can read the response, and WebView policy is another device boundary.",
      analyzeFn: async () => ({
        status: "provisionally_cleared",
        coverage: 0.9,
        demonstrated: ["Separates all three boundaries"],
        missing: [],
        misconceptions: [],
        evidence: ["The answer explains the sequence"],
        materialSourceIds: ["source-blog"],
        feedback: "Core model demonstrated.",
        teaching: "",
        nextQuestion: "",
        recommendation: "end"
      })
    });
    const result = endClearanceSession(session);
    expect(result.status).toBe("needs_verification");
    expect(result.sourceReviewRequired).toBe(true);
  });

  it("allows the user to end without a valid attempt", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    const result = endClearanceSession(session);
    expect(result.status).toBe("no_valid_attempt");
    expect(result.remainingGaps.length).toBeGreaterThan(0);
  });

  // ── Three-layer prior profile: difficulty adjustment ──

  function makePrior({ l3Domains = [], l1Available = false } = {}) {
    return {
      schemaVersion: "capability_snapshot_v1",
      collectedAt: "2026-08-06T00:00:00Z",
      userId: "u1",
      source: "capability_profile_v1+report_history",
      rules: ["Material evidence in the current artifact always overrides this prior."],
      layers: {
        L1_ai_collaboration: { available: l1Available, dimensions: {}, note: "" },
        L2_domain: { available: l3Domains.length > 0, domains: [] },
        L3_knowledge_points: {
          available: l3Domains.length > 0,
          domains: l3Domains.map(d => ({
            domain: d.domain,
            dimensions: d.dimensions,
            updatedAt: "2026-08-01T00:00:00Z"
          }))
        }
      }
    };
  }

  it("cold start (no priorProfile) leaves adjustedDifficulty null and does not modify the question", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    expect(session.adjustedDifficulty).toBeNull();
    expect(session.priorProfileUsed).toBe(false);
    expect(session.clearanceQuestion).not.toContain("提示");
  });

  it("ignores invalid priorProfile schema and behaves as cold start", async () => {
    const session = await startClearanceSession({
      report,
      cardId: "card-1",
      researchFn: async () => research,
      priorProfile: { schemaVersion: "wrong" }
    });
    expect(session.priorProfileUsed).toBe(false);
    expect(session.adjustedDifficulty).toBeNull();
  });

  it("upgrades difficulty when L3 has stable-high scores in a matching domain", async () => {
    const prior = makePrior({
      l3Domains: [{
        domain: "G2 WebView networking",
        dimensions: {
          conceptualUnderstanding: { score: 90, level: "L4", stability: "stable", evidenceCount: 3 },
          causalExplanation: { score: 88, level: "L4", stability: "stable", evidenceCount: 3 }
        }
      }],
      l1Available: true
    });
    const session = await startClearanceSession({
      report,
      cardId: "card-1",
      researchFn: async () => research,
      priorProfile: prior
    });
    expect(session.priorProfileUsed).toBe(true);
    expect(session.adjustedDifficulty).toBe("advanced"); // intermediate -> advanced
    expect(session.clearanceQuestion).toContain("架构或迁移角度");
  });

  it("does not upgrade when L3 scores are only one_shot (weak prior)", async () => {
    const prior = makePrior({
      l3Domains: [{
        domain: "G2 WebView networking",
        dimensions: {
          conceptualUnderstanding: { score: 90, level: "L4", stability: "one_shot", evidenceCount: 1 }
        }
      }]
    });
    const session = await startClearanceSession({
      report,
      cardId: "card-1",
      researchFn: async () => research,
      priorProfile: prior
    });
    expect(session.priorProfileUsed).toBe(true);
    expect(session.adjustedDifficulty).toBeNull(); // no adjustment
    expect(session.clearanceQuestion).not.toContain("架构或迁移角度");
  });

  it("attaches a gentle note (no label change) when L3 has one_shot low score in matching domain", async () => {
    const prior = makePrior({
      l3Domains: [{
        domain: "G2 WebView networking",
        dimensions: {
          conceptualUnderstanding: { score: 25, level: "L1", stability: "one_shot", evidenceCount: 1 }
        }
      }]
    });
    const session = await startClearanceSession({
      report,
      cardId: "card-1",
      researchFn: async () => research,
      priorProfile: prior
    });
    expect(session.priorProfileUsed).toBe(true);
    expect(session.adjustedDifficulty).toBe("intermediate"); // unchanged baseline
    expect(session.clearanceQuestion).toContain("基础概念");
  });

  it("does not adjust when no domain matches (cannot infer across domains)", async () => {
    const prior = makePrior({
      l3Domains: [{
        domain: "database migration",
        dimensions: {
          conceptualUnderstanding: { score: 95, level: "L5", stability: "stable", evidenceCount: 5 }
        }
      }]
    });
    const session = await startClearanceSession({
      report,
      cardId: "card-1",
      researchFn: async () => research,
      priorProfile: prior
    });
    expect(session.priorProfileUsed).toBe(true);
    expect(session.adjustedDifficulty).toBeNull();
    expect(session.clearanceQuestion).not.toContain("提示");
  });

  it("passes priorProfile availability to the research request", async () => {
    const researchSpy = vi.fn().mockResolvedValue(research);
    const prior = makePrior({
      l3Domains: [{
        domain: "G2 WebView networking",
        dimensions: { conceptualUnderstanding: { score: 90, level: "L4", stability: "stable", evidenceCount: 3 } }
      }],
      l1Available: true
    });
    await startClearanceSession({
      report,
      cardId: "card-1",
      researchFn: researchSpy,
      priorProfile: prior
    });
    const request = researchSpy.mock.calls[0][0];
    expect(request.priorProfile).toBeDefined();
    expect(request.priorProfile.available.L1).toBe(true);
    expect(request.priorProfile.available.L3).toBe(true);
    expect(request.priorProfile.rules.length).toBeGreaterThan(0);
  });

  it("evaluates the follow-up question the learner is actually answering", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    expect(session.currentQuestion).toBe(session.clearanceQuestion);
    const followUp = "At which step does CORS act?";
    await submitClearanceAnswer({
      session,
      answer: "It fails because the network is bad.",
      analyzeFn: async () => ({
        status: "needs_practice",
        coverage: 0.2,
        demonstrated: [],
        missing: ["Does not distinguish transport from CORS"],
        misconceptions: [],
        evidence: [],
        materialSourceIds: [],
        feedback: "You merged three boundaries.",
        teaching: "A request can reach the server and still be unreadable to browser JavaScript.",
        nextQuestion: followUp,
        recommendation: "continue"
      })
    });
    expect(session.currentQuestion).toBe(followUp);

    const seenInputs = [];
    await submitClearanceAnswer({
      session,
      answer: "CORS acts when browser code reads the response.",
      analyzeFn: async input => {
        seenInputs.push(input);
        return {
          status: "needs_practice",
          coverage: 0.5,
          demonstrated: ["Places CORS at response read time"],
          missing: ["WebView policy boundary"],
          misconceptions: [],
          evidence: [],
          materialSourceIds: [],
          feedback: "One boundary placed, one still missing.",
          teaching: "WebView policy can block transport before CORS is consulted.",
          nextQuestion: "Which boundary blocks transport before CORS?",
          recommendation: "continue"
        };
      }
    });
    expect(seenInputs).toHaveLength(1);
    expect(seenInputs[0].question).toBe(followUp);
    expect(seenInputs[0].originalQuestion).toBe(session.clearanceQuestion);
    expect(publicSession(session).currentQuestion).toBe("Which boundary blocks transport before CORS?");
  });

  it("switches to direct teaching on the first weak answer", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    const weakAnalysis = teaching => ({
      status: "needs_practice",
      coverage: 0.2,
      demonstrated: [],
      missing: ["Does not distinguish transport from CORS"],
      misconceptions: [],
      evidence: [],
      materialSourceIds: [],
      feedback: "Still merging boundaries.",
      teaching,
      nextQuestion: "At which step does CORS act?",
      recommendation: "continue"
    });
    const seenInputs = [];
    const analyzeFn = async input => {
      seenInputs.push(input);
      return weakAnalysis(`Teaching for call ${seenInputs.length}.`);
    };

    // 第1次答错：先用 coach 评估，发现弱回答后立即用 direct 重评，本轮反馈就是直接教学。
    await submitClearanceAnswer({ session, answer: "The network is bad.", analyzeFn });
    expect(seenInputs[0].teachingMode).toBe("coach");
    expect(seenInputs[0].consecutiveFailures).toBe(0);
    expect(seenInputs[1].teachingMode).toBe("direct");
    expect(seenInputs[1].consecutiveFailures).toBe(0);
    expect(seenInputs[1].previousTeachings).toEqual(["Teaching for call 1."]);
    expect(session.consecutiveFailures).toBe(1);
    expect(session.teachingMode).toBe("direct");

    // 第2次答错：已连续失败过，直接用 direct 评估（单次调用）。
    await submitClearanceAnswer({ session, answer: "The network is still bad.", analyzeFn });
    expect(seenInputs[2].teachingMode).toBe("direct");
    expect(seenInputs[2].consecutiveFailures).toBe(1);
    expect(seenInputs[2].previousTeachings).toEqual(["Teaching for call 2."]);
    expect(session.consecutiveFailures).toBe(2);
    expect(session.teachingMode).toBe("direct");

    // 第3次答对：direct 模式下通过，连续失败计数归零。
    await submitClearanceAnswer({
      session,
      answer: "Reachability is transport, CORS gates script reads, WebView policy is separate.",
      analyzeFn: async input => {
        seenInputs.push(input);
        return {
          status: "provisionally_cleared",
          coverage: 0.9,
          demonstrated: ["Separates all three boundaries"],
          missing: [],
          misconceptions: [],
          evidence: [],
          materialSourceIds: [],
          feedback: "Core model demonstrated.",
          teaching: "",
          nextQuestion: "",
          recommendation: "end"
        };
      }
    });
    expect(seenInputs[3].teachingMode).toBe("direct");
    expect(session.consecutiveFailures).toBe(0);
  });

  it("replaces verbatim-repeated teaching with a labeled scaffold-based explanation", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    const repeatedTeaching = "A request can reach the server and still be unreadable to browser JavaScript.";
    const analyze = teaching => async () => ({
      status: "needs_practice",
      coverage: 0.2,
      demonstrated: [],
      missing: ["Does not distinguish transport from CORS"],
      misconceptions: [],
      evidence: [],
      materialSourceIds: [],
      feedback: "Still merging boundaries.",
      teaching,
      nextQuestion: "At which step does CORS act?",
      recommendation: "continue"
    });

    await submitClearanceAnswer({ session, answer: "The network is bad.", analyzeFn: analyze(repeatedTeaching) });
    // Same text with different casing and whitespace must still count as a repeat.
    const second = await submitClearanceAnswer({
      session,
      answer: "The network is still bad.",
      analyzeFn: analyze(`  ${repeatedTeaching.toUpperCase()}\n`)
    });
    expect(second.analysis.teaching).not.toBe(repeatedTeaching);
    expect(second.analysis.teaching).toContain("（系统直接讲解，基于来源要点）");
    expect(second.analysis.teaching).toContain("Reachability determines whether a request reaches the server.");
    expect(second.analysis.teaching).toContain("CORS determines whether browser code may read a cross-origin response.");

    const third = await submitClearanceAnswer({
      session,
      answer: "Transport works, CORS blocks the read.",
      analyzeFn: analyze("Fresh teaching that references this attempt specifically.")
    });
    expect(third.analysis.teaching).toBe("Fresh teaching that references this attempt specifically.");
  });

  it("keeps old sessions without tracking fields working with derived defaults", async () => {
    const session = await startClearanceSession({ report, cardId: "card-1", researchFn: async () => research });
    delete session.currentQuestion;
    delete session.consecutiveFailures;
    delete session.teachingMode;

    const seenInputs = [];
    await submitClearanceAnswer({
      session,
      answer: "The network is bad.",
      analyzeFn: async input => {
        seenInputs.push(input);
        return {
          status: "needs_practice",
          coverage: 0.2,
          demonstrated: [],
          missing: ["Does not distinguish transport from CORS"],
          misconceptions: [],
          evidence: [],
          materialSourceIds: [],
          feedback: "You merged three boundaries.",
          teaching: "A request can reach the server and still be unreadable to browser JavaScript.",
          nextQuestion: "At which step does CORS act?",
          recommendation: "continue"
        };
      }
    });
    expect(seenInputs[0].question).toBe(session.clearanceQuestion);
    expect(seenInputs[0].teachingMode).toBe("coach");
    expect(seenInputs[0].previousTeachings).toEqual([]);
    // 首次弱回答触发 direct 重评
    expect(seenInputs[1].teachingMode).toBe("direct");
    expect(seenInputs[1].consecutiveFailures).toBe(0);
    expect(session.consecutiveFailures).toBe(1);
    expect(session.currentQuestion).toBe("At which step does CORS act?");

    // An old session whose stored attempts already failed once derives
    // direct mode even though consecutiveFailures was never persisted.
    delete session.consecutiveFailures;
    delete session.teachingMode;
    await submitClearanceAnswer({
      session,
      answer: "The network is still bad.",
      analyzeFn: async input => {
        seenInputs.push(input);
        return {
          status: "needs_practice",
          coverage: 0.2,
          demonstrated: [],
          missing: ["WebView policy boundary"],
          misconceptions: [],
          evidence: [],
          materialSourceIds: [],
          feedback: "Still merging boundaries.",
          teaching: "WebView policy can block transport independently of CORS.",
          nextQuestion: "Does a blocked WebView request reach the CORS check?",
          recommendation: "continue"
        };
      }
    });
    expect(seenInputs[2].teachingMode).toBe("direct");
    expect(seenInputs[2].consecutiveFailures).toBe(1);
    expect(session.consecutiveFailures).toBe(2);
  });

  it("requires both research prompts to reject same-word different-mechanism sources", () => {
    const researchPrompt = getClearanceResearchPrompt({
      originalQuestion: "Explain the CLI wrapper launcher script.",
      targetDebt: "wrapper launcher scripts"
    });
    const structuringPrompt = getResearchStructuringPrompt();
    for (const prompt of [researchPrompt, structuringPrompt]) {
      expect(prompt).toContain("different mechanism");
      expect(prompt).toContain("--wrap");
      expect(prompt).toContain("wrapper launcher");
    }
    expect(structuringPrompt).toContain("do not put their source IDs in the scaffold");
  });
});
