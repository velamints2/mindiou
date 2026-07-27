// @ts-nocheck
import { describe, expect, it } from "vitest";
import { generateFallbackReport, normalizeReport } from "../mvp0-fallback.js";

const SAMPLE_TEXT = `
I'm building a React app with Vite. The AI suggested using TypeScript for type safety.
I agreed because I don't know TypeScript well. The AI set up the entire project structure.
It chose useState for state management and useEffect for data fetching.
I wanted to use Firebase, but the AI said Supabase was better for this use case.
The AI wrote all the database queries and API routes. I'm not sure how the auth flow works.
It configured Tailwind CSS and created all the components. I just followed along.
The deployment is on Vercel, but I don't understand how the build pipeline works.
`;

const SHORT_TEXT = "The AI wrote a function to sort an array.";

const EMPTY_TEXT = "";

describe("generateFallbackReport", () => {
  describe("schema compliance", () => {
    it("produces a report with all seven sections", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.sections).toBeDefined();
      expect(report.sections.aiCompleted).toBeDefined();
      expect(report.sections.userContributed).toBeDefined();
      expect(report.sections.cognitiveProcessesOutsourced).toBeDefined();
      expect(report.sections.dangerousGaps).toBeDefined();
      expect(report.sections.cognitiveStructure).toBeDefined();
      expect(report.sections.feynmanCards).toBeDefined();
      expect(report.sections.nextActions).toBeDefined();
    });

    it("produces 2-4 dangerousGaps", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "claude");
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(report.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
    });

    it("produces 2-4 dangerousGaps even with short text", () => {
      const report = generateFallbackReport(SHORT_TEXT, "cursor");
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(report.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
    });

    it("produces 2-4 dangerousGaps even with empty text", () => {
      const report = generateFallbackReport(EMPTY_TEXT, "other");
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(report.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
    });

    it("produces 3-5 feynmanCards", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
      expect(report.sections.feynmanCards.length).toBeLessThanOrEqual(5);
    });

    it("produces at least 3 feynmanCards even with empty text", () => {
      const report = generateFallbackReport(EMPTY_TEXT, "other");
      expect(report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
    });

    it("ensures every nextAction has route and reason", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "codex");
      expect(report.sections.nextActions.length).toBeGreaterThan(0);
      for (const action of report.sections.nextActions) {
        expect(action.route).toBeTruthy();
        expect(action.reason).toBeTruthy();
        expect(["verify", "note", "task", "ask"]).toContain(action.route);
      }
    });

    it("marks research as skipped and confusionResolutions as empty", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.research).toEqual({ status: "skipped", queries: [], sources: [] });
      expect(report.confusionResolutions).toEqual([]);
    });
  });

  describe("inference labeling", () => {
    it("marks all aiCompleted items as isInference: true", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.sections.aiCompleted.length).toBeGreaterThan(0);
      for (const item of report.sections.aiCompleted) {
        expect(item.isInference).toBe(true);
      }
    });

    it("marks all userContributed items as isInference: true", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      for (const item of report.sections.userContributed) {
        expect(item.isInference).toBe(true);
      }
    });

    it("marks outsourced processes as inference", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.sections.cognitiveProcessesOutsourced.length).toBeGreaterThan(0);
      for (const item of report.sections.cognitiveProcessesOutsourced) {
        expect(item.isInference).toBe(true);
      }
    });

    it("gives every fallback gap at least one surface signal and zero confidence", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      for (const gap of report.sections.dangerousGaps) {
        expect(gap.surfaceSignals.length).toBeGreaterThan(0);
        expect(gap.confidence).toBe(0);
      }
    });
  });

  describe("input handling", () => {
    it("preserves artifactText (truncated to 30000)", () => {
      const longText = "x".repeat(40000);
      const report = generateFallbackReport(longText, "chatgpt");
      expect(report.input.artifactText.length).toBe(30000);
    });

    it("preserves valid artifactType", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "hackathon");
      expect(report.input.artifactType).toBe("hackathon");
    });

    it("defaults invalid artifactType to 'other'", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "invalid-type");
      expect(report.input.artifactType).toBe("other");
    });

    it("calculates charCount from input text", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.input.charCount).toBeGreaterThan(0);
    });

    it("sets charCount to 0 for empty text", () => {
      const report = generateFallbackReport(EMPTY_TEXT, "other");
      expect(report.input.charCount).toBe(0);
    });
  });

  describe("feynman card structure", () => {
    it("gives each card a unique id", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      const ids = report.sections.feynmanCards.map(c => c.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("initializes cards with empty answers", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      for (const card of report.sections.feynmanCards) {
        expect(card.userAnswer).toBe("");
        expect(card.aiFollowUp).toBe("");
        expect(card.answeredAt).toBeNull();
      }
    });

    it("gives each card a prompt and target", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      for (const card of report.sections.feynmanCards) {
        expect(card.prompt).toBeTruthy();
        expect(card.target).toBeTruthy();
      }
    });
  });

  describe("gap ranking", () => {
    it("assigns sequential ranks starting at 1", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      const ranks = report.sections.dangerousGaps.map(g => g.rank);
      expect(ranks).toEqual(ranks.map((_, idx) => idx + 1));
    });
  });

  describe("status and metadata", () => {
    it("sets status to 'generated'", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.status).toBe("generated");
    });

    it("generates an id", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.id).toBeTruthy();
      expect(report.id.length).toBeGreaterThan(10);
    });

    it("sets createdAt to ISO-8601", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.createdAt).toBeTruthy();
      expect(() => new Date(report.createdAt).toISOString()).not.toThrow();
    });

    it("initializes corrections as empty array", () => {
      const report = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
      expect(report.corrections).toEqual([]);
    });
  });
});

describe("normalizeReport", () => {
  it("fills missing sections with empty arrays (gaps and cards get padded)", () => {
    const raw = { id: "test-1" };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.aiCompleted).toEqual([]);
    expect(normalized.sections.userContributed).toEqual([]);
    expect(normalized.sections.cognitiveProcessesOutsourced).toEqual([]);
    expect(normalized.sections.dangerousGaps).toHaveLength(2);
    expect(normalized.sections.cognitiveStructure.facts).toEqual([]);
    expect(normalized.sections.cognitiveStructure.hypotheses).toEqual([]);
    expect(normalized.sections.cognitiveStructure.questions).toEqual([]);
    expect(normalized.sections.cognitiveStructure.decisions).toEqual([]);
    expect(normalized.sections.cognitiveStructure.tradeoffs).toEqual([]);
    expect(normalized.sections.feynmanCards).toHaveLength(3);
    expect(normalized.sections.nextActions).toEqual([]);
  });

  it("generates an id when missing", () => {
    const raw = { sections: {} };
    const normalized = normalizeReport(raw);
    expect(normalized.id).toBeTruthy();
    expect(normalized.id.length).toBeGreaterThan(10);
  });

  it("preserves existing id", () => {
    const raw = { id: "my-id-123", sections: {} };
    const normalized = normalizeReport(raw);
    expect(normalized.id).toBe("my-id-123");
  });

  it("sets isInference to true when evidence is missing", () => {
    const raw = {
      sections: {
        aiCompleted: [{ item: "AI chose React" }]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.aiCompleted[0].isInference).toBe(true);
  });

  it("sets isInference to false when evidence looks like a direct quote", () => {
    const raw = {
      sections: {
        aiCompleted: [{ item: "AI chose React", evidence: '"I will use React for this project"' }]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.aiCompleted[0].isInference).toBe(false);
  });

  it("preserves explicit isInference flag", () => {
    const raw = {
      sections: {
        aiCompleted: [
          { item: "AI chose React", evidence: "some evidence", isInference: true },
          { item: "User said kids", evidence: '"for kids"', isInference: false }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.aiCompleted[0].isInference).toBe(true);
    expect(normalized.sections.aiCompleted[1].isInference).toBe(false);
  });

  it("maps dangerousGap-N card targets back to the real gap text", () => {
    const normalized = normalizeReport({
      sections: {
        dangerousGaps: [
          { rank: 1, gap: "用户尚未证明自己理解 sessionStorage 恢复边界", whyDangerous: "Cannot verify restore failures", evidence: "inference" },
          { rank: 2, gap: "用户尚未证明自己理解结构契约和语义质量的区别", whyDangerous: "May treat schema compliance as product quality", evidence: "inference" }
        ],
        feynmanCards: [
          { id: "card-1", target: "dangerousGap-2", prompt: "Explain the contract vs semantic quality boundary." }
        ]
      }
    });

    expect(normalized.sections.feynmanCards[0].target).toBe("用户尚未证明自己理解结构契约和语义质量的区别");
  });

  it("sorts dangerousGaps by rank and re-numbers sequentially", () => {
    const raw = {
      sections: {
        dangerousGaps: [
          { rank: 3, gap: "third", whyDangerous: "d3" },
          { rank: 1, gap: "first", whyDangerous: "d1" },
          { rank: 2, gap: "second", whyDangerous: "d2" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.dangerousGaps).toHaveLength(3);
    expect(normalized.sections.dangerousGaps.map(g => g.rank)).toEqual([1, 2, 3]);
    expect(normalized.sections.dangerousGaps[0].gap).toBe("first");
    expect(normalized.sections.dangerousGaps[1].gap).toBe("second");
    expect(normalized.sections.dangerousGaps[2].gap).toBe("third");
  });

  it("assigns sequential ranks when missing", () => {
    const raw = {
      sections: {
        dangerousGaps: [
          { gap: "first", whyDangerous: "d1" },
          { gap: "second", whyDangerous: "d2" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.dangerousGaps[0].rank).toBe(1);
    expect(normalized.sections.dangerousGaps[1].rank).toBe(2);
  });

  it("folds legacy gap.evidence into surfaceSignals", () => {
    const raw = {
      sections: {
        dangerousGaps: [
          { rank: 1, gap: "legacy gap", whyDangerous: "d1", evidence: "legacy single evidence string" },
          { rank: 2, gap: "another legacy gap", whyDangerous: "d2", evidence: "second evidence" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.dangerousGaps[0].surfaceSignals).toContain("legacy single evidence string");
  });

  it("caps gap confidence at 0.5 when fewer than two surface signals", () => {
    const raw = {
      sections: {
        dangerousGaps: [
          { rank: 1, gap: "weakly grounded gap", whyDangerous: "d1", surfaceSignals: ["only one"], confidence: 0.95 },
          { rank: 2, gap: "well grounded gap", whyDangerous: "d2", surfaceSignals: ["s1", "s2"], confidence: 0.9 }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.dangerousGaps[0].confidence).toBeLessThanOrEqual(0.5);
    expect(normalized.sections.dangerousGaps[1].confidence).toBe(0.9);
  });

  it("normalizes invalid route to 'task'", () => {
    const raw = {
      sections: {
        nextActions: [
          { item: "do something", route: "invalid-route", reason: "because" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.nextActions[0].route).toBe("task");
  });

  it("preserves valid routes", () => {
    const raw = {
      sections: {
        nextActions: [
          { item: "check docs", route: "verify", reason: "need confirmation" },
          { item: "write note", route: "note", reason: "reusable" },
          { item: "build feature", route: "task", reason: "needs execution" },
          { item: "ask expert", route: "ask", reason: "need expertise" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    const routes = normalized.sections.nextActions.map(a => a.route);
    expect(routes).toEqual(["verify", "note", "task", "ask"]);
  });

  it("gives feynman cards an id when missing", () => {
    const raw = {
      sections: {
        feynmanCards: [
          { target: "gap1", prompt: "explain gap1" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.feynmanCards[0].id).toBeTruthy();
    expect(normalized.sections.feynmanCards[0].userAnswer).toBe("");
    expect(normalized.sections.feynmanCards[0].answeredAt).toBeNull();
  });

  it("normalizes invalid cardType to system_map and keeps valid ones", () => {
    const raw = {
      sections: {
        feynmanCards: [
          { target: "g1", prompt: "p1", cardType: "not-a-type" },
          { target: "g2", prompt: "p2", cardType: "analogy" },
          { target: "g3", prompt: "p3", cardType: "prediction" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.feynmanCards[0].cardType).toBe("system_map");
    expect(normalized.sections.feynmanCards[1].cardType).toBe("analogy");
    expect(normalized.sections.feynmanCards[2].cardType).toBe("prediction");
  });

  it("defaults invalid status to 'generated'", () => {
    const raw = { status: "invalid-status", sections: {} };
    const normalized = normalizeReport(raw);
    expect(normalized.status).toBe("generated");
  });

  it("defaults invalid artifactType to 'other'", () => {
    const raw = { input: { artifactType: "unknown" }, sections: {} };
    const normalized = normalizeReport(raw);
    expect(normalized.input.artifactType).toBe("other");
  });

  it("truncates overly long fields", () => {
    const longItem = "x".repeat(600);
    const raw = {
      sections: {
        aiCompleted: [{ item: longItem, evidence: longItem }]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.aiCompleted[0].item.length).toBe(500);
    expect(normalized.sections.aiCompleted[0].evidence.length).toBe(300);
  });

  it("normalizes cognitiveStructure with all five sub-arrays", () => {
    const raw = {
      sections: {
        cognitiveStructure: {
          facts: [{ item: "fact1" }],
          hypotheses: [],
          questions: [{ item: "q1" }]
        }
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.cognitiveStructure.facts).toHaveLength(1);
    expect(normalized.sections.cognitiveStructure.hypotheses).toEqual([]);
    expect(normalized.sections.cognitiveStructure.questions).toHaveLength(1);
    expect(normalized.sections.cognitiveStructure.decisions).toEqual([]);
    expect(normalized.sections.cognitiveStructure.tradeoffs).toEqual([]);
  });

  it("normalizes decisionOwner on decisions", () => {
    const raw = {
      sections: {
        cognitiveStructure: {
          decisions: [
            { item: "Use Supabase", decisionOwner: "ai" },
            { item: "Ship on Friday", decisionOwner: "boss" }
          ]
        }
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.cognitiveStructure.decisions[0].decisionOwner).toBe("ai");
    expect(normalized.sections.cognitiveStructure.decisions[1].decisionOwner).toBe("unclear");
  });

  it("handles non-object input gracefully", () => {
    expect(() => normalizeReport(null)).toThrow("requires a report object");
    expect(() => normalizeReport(undefined)).toThrow("requires a report object");
    expect(() => normalizeReport("string")).toThrow("requires a report object");
  });

  it("normalizes corrections array", () => {
    const raw = {
      corrections: [
        { target: "gap", correctedValue: "fixed" }
      ],
      sections: {}
    };
    const normalized = normalizeReport(raw);
    expect(normalized.corrections).toHaveLength(1);
    expect(normalized.corrections[0].id).toBeTruthy();
    expect(normalized.corrections[0].target).toBe("gap");
    expect(normalized.corrections[0].correctedValue).toBe("fixed");
    expect(normalized.corrections[0].correctedAt).toBeTruthy();
  });

  it("handles string items in arrays", () => {
    const raw = {
      sections: {
        aiCompleted: ["AI chose React", "AI set up Vite"]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.aiCompleted).toHaveLength(2);
    expect(normalized.sections.aiCompleted[0].item).toBe("AI chose React");
    expect(normalized.sections.aiCompleted[0].isInference).toBe(true);
  });

  it("passes through a fallback report without breaking", () => {
    const fallback = generateFallbackReport(SAMPLE_TEXT, "chatgpt");
    const renormalized = normalizeReport(fallback);
    expect(renormalized.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
    expect(renormalized.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
    expect(renormalized.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
    expect(renormalized.status).toBe("generated");
  });

  it("enforces the 4-gap maximum when AI returns more", () => {
    const raw = {
      sections: {
        dangerousGaps: [
          { rank: 1, gap: "g1", whyDangerous: "d1" },
          { rank: 2, gap: "g2", whyDangerous: "d2" },
          { rank: 3, gap: "g3", whyDangerous: "d3" },
          { rank: 4, gap: "g4", whyDangerous: "d4" },
          { rank: 5, gap: "g5", whyDangerous: "d5" },
          { rank: 6, gap: "g6", whyDangerous: "d6" },
          { rank: 7, gap: "g7", whyDangerous: "d7" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.dangerousGaps).toHaveLength(4);
    expect(normalized.sections.dangerousGaps.map(g => g.gap)).toEqual(["g1", "g2", "g3", "g4"]);
  });

  it("enforces the 2-gap minimum when AI returns fewer", () => {
    const raw = {
      sections: {
        dangerousGaps: [
          { rank: 1, gap: "only one", whyDangerous: "d1" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.dangerousGaps).toHaveLength(2);
    expect(normalized.sections.dangerousGaps[0].gap).toBe("only one");
    expect(normalized.sections.dangerousGaps[1].gap).toBe("Manual review required");
  });

  it("enforces 3-5 feynman cards when AI returns fewer", () => {
    const raw = {
      sections: {
        feynmanCards: [
          { target: "gap1", prompt: "explain gap1" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.feynmanCards).toHaveLength(3);
    expect(normalized.sections.feynmanCards[0].target).toBe("gap1");
    expect(normalized.sections.feynmanCards[1].id).toBeTruthy();
  });

  it("enforces 3-5 feynman cards when AI returns more", () => {
    const raw = {
      sections: {
        feynmanCards: Array.from({ length: 8 }, (_, i) => ({
          target: `gap${i + 1}`,
          prompt: `explain gap${i + 1}`
        }))
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.sections.feynmanCards).toHaveLength(5);
  });

  it("normalizes research digests and drops sourceless entries", () => {
    const raw = {
      sections: {},
      research: {
        status: "ok",
        queries: [{ query: "q1", status: "ok" }, { query: "q2", status: "bogus-status" }],
        sources: [
          { title: "Docs", url: "https://example.com", snippet: "s" },
          { title: "", url: "" }
        ]
      }
    };
    const normalized = normalizeReport(raw);
    expect(normalized.research.status).toBe("ok");
    expect(normalized.research.queries[1].status).toBe("unavailable");
    expect(normalized.research.sources).toHaveLength(1);
  });

  it("defaults missing research to skipped", () => {
    const normalized = normalizeReport({ sections: {} });
    expect(normalized.research).toEqual({ status: "skipped", queries: [], sources: [] });
  });

  it("normalizes confusionResolutions with resolution coercion", () => {
    const raw = {
      sections: {},
      confusionResolutions: [
        { stepId: "step-1", confusion: "为什么这样选", resolution: "gap", gapRank: 2 },
        { stepId: "step-2", confusion: "页面怎么刷新", resolution: "other-value", reason: "操作疑问" }
      ]
    };
    const normalized = normalizeReport(raw);
    expect(normalized.confusionResolutions).toHaveLength(2);
    expect(normalized.confusionResolutions[0].resolution).toBe("gap");
    expect(normalized.confusionResolutions[0].gapRank).toBe(2);
    expect(normalized.confusionResolutions[1].resolution).toBe("not_capability_gap");
  });

  it("maps legacy string capability dimensions onto the new dimension objects", () => {
    const raw = {
      sections: {},
      analysis: {
        artifactKind: "ai_workflow_transcript",
        userCapability: {
          overall: "mixed",
          dimensions: {
            domainProductUnderstanding: "L3",
            aiAgentSteering: "L4",
            technicalDomainImplementation: "L1",
            validationDebugging: "L1"
          },
          currentDomain: "MindIOU MVP-0",
          recommendedCardLevel: "foundation"
        }
      }
    };
    const normalized = normalizeReport(raw);
    const dims = normalized.analysis.userCapability.dimensions;
    expect(dims.productProblemFraming.level).toBe("L3");
    expect(dims.productProblemFraming.evidenceStatus).toBe("partial");
    expect(dims.aiAgentSteering.level).toBe("L4");
    expect(dims.technicalDecisionComprehension.level).toBe("L1");
    expect(dims.validationAndQualityJudgment.level).toBe("L1");
    expect(dims.systemMentalModel.evidenceStatus).toBe("unobserved");
  });

  it("fills a default analysis when missing", () => {
    const normalized = normalizeReport({ sections: {} });
    expect(normalized.analysis.artifactKind).toBe("unknown");
    expect(normalized.analysis.userCapability.overall).toBe("mixed");
    expect(normalized.analysis.userCapability.recommendedCardLevel).toBe("foundation");
    for (const dim of Object.values(normalized.analysis.userCapability.dimensions)) {
      expect(dim.evidenceStatus).toBe("unobserved");
    }
  });
});
