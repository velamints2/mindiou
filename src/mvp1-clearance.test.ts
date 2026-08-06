// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import {
  endClearanceSession,
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
});
