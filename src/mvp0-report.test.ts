// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { generateClearanceReport, getClearanceReportSystemPrompt } from "../mvp0-report.js";

const SAMPLE_TEXT = `
I'm building a React app with Vite. The AI suggested using TypeScript for type safety.
I agreed because I don't know TypeScript well. The AI set up the entire project structure.
It chose useState for state management and useEffect for data fetching.
I wanted to use Firebase, but the AI said Supabase was better for this use case.
The AI wrote all the database queries and API routes. I'm not sure how the auth flow works.
It configured Tailwind CSS and created all the components. I just followed along.
The deployment is on Vercel, but I don't understand how the build pipeline works.
`;

function rolloutJsonl(entries: unknown[]) {
  return entries.map(entry => JSON.stringify(entry)).join("\n");
}

function rolloutMessage(role: string, text: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: "input_text", text }]
    }
  };
}

// A realistic AI response that matches the schema
const MOCK_AI_SUCCESS = {
  sections: {
    aiCompleted: [
      { item: "AI chose React with Vite as the frontend stack", evidence: '"The AI suggested using TypeScript"', isInference: false },
      { item: "AI selected useState and useEffect for state and data fetching", evidence: "AI set up the project structure", isInference: false },
      { item: "AI recommended Supabase over Firebase", evidence: '"the AI said Supabase was better"', isInference: false },
      { item: "AI wrote all database queries and API routes", evidence: "stated in artifact", isInference: false }
    ],
    userContributed: [
      { item: "User wanted to use Firebase initially", evidence: '"I wanted to use Firebase"', isInference: false },
      { item: "User agreed to TypeScript without understanding it", evidence: '"I agreed because I don\'t know TypeScript well"', isInference: false }
    ],
    dangerousGaps: [
      { rank: 1, gap: "TypeScript type system", whyDangerous: "Cannot judge whether types are correct or safe", evidence: '"I don\'t know TypeScript well"' },
      { rank: 2, gap: "Supabase auth flow", whyDangerous: "Cannot verify if authentication is secure", evidence: '"not sure how the auth flow works"' },
      { rank: 3, gap: "Build pipeline", whyDangerous: "Cannot debug deployment failures", evidence: '"don\'t understand how the build pipeline works"' },
      { rank: 4, gap: "useState vs useReducer trade-off", whyDangerous: "Cannot assess if state management choice is appropriate", evidence: "inference" },
      { rank: 5, gap: "Supabase vs Firebase decision criteria", whyDangerous: "Cannot evaluate if the recommendation was justified", evidence: "inference" }
    ],
    cognitiveStructure: {
      facts: [
        { item: "Project uses React, Vite, TypeScript, Tailwind, Supabase, Vercel", evidence: "stated in artifact" }
      ],
      hypotheses: [
        { item: "Supabase may be over-provisioned for the project's needs", evidence: "inference" }
      ],
      questions: [
        { item: "Is the auth flow using JWT or session cookies?", evidence: "unresolved" }
      ],
      decisions: [
        { item: "Use Supabase instead of Firebase", evidence: '"AI said Supabase was better"' }
      ],
      tradeoffs: [
        { item: "TypeScript safety vs learning curve", evidence: "inference" }
      ]
    },
    feynmanCards: [
      { id: "card-1", target: "TypeScript type system", prompt: "Explain how TypeScript types protect your code at compile time vs runtime.", userAnswer: "", aiFollowUp: "", answeredAt: null },
      { id: "card-2", target: "Supabase auth flow", prompt: "Describe the authentication flow in your app step by step.", userAnswer: "", aiFollowUp: "", answeredAt: null },
      { id: "card-3", target: "Build pipeline", prompt: "Explain what happens when you run 'vercel deploy' from code to production.", userAnswer: "", aiFollowUp: "", answeredAt: null },
      { id: "card-4", target: "State management choice", prompt: "Why would you choose useReducer over useState? Give a concrete example.", userAnswer: "", aiFollowUp: "", answeredAt: null }
    ],
    nextActions: [
      { item: "Read TypeScript handbook on type annotations", route: "verify", reason: "Need to verify type safety claims" },
      { item: "Document the Supabase auth flow", route: "note", reason: "Reusable knowledge for future projects" },
      { item: "Test the Vercel build locally", route: "task", reason: "Need to understand build pipeline behavior" },
      { item: "Ask a senior dev about Supabase vs Firebase for this use case", route: "ask", reason: "Needs expert judgment on database choice" }
    ]
  }
};

describe("generateClearanceReport", () => {
  describe("with mock AI success", () => {
    it("produces a normalized six-section report from AI output", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.sections.aiCompleted).toBeDefined();
      expect(report.sections.aiCompleted.length).toBeGreaterThan(0);
      expect(report.sections.userContributed).toBeDefined();
      expect(report.sections.dangerousGaps).toHaveLength(5);
      expect(report.sections.cognitiveStructure).toBeDefined();
      expect(report.sections.cognitiveStructure.facts).toBeDefined();
      expect(report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
      expect(report.sections.feynmanCards.length).toBeLessThanOrEqual(5);
      expect(report.sections.nextActions.length).toBeGreaterThan(0);
    });

    it("calls chatFn with system prompt containing six-section schema", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(mockChatFn).toHaveBeenCalledTimes(1);
      const [messages] = mockChatFn.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("aiCompleted");
      expect(messages[0].content).toContain("userContributed");
      expect(messages[0].content).toContain("dangerousGaps");
      expect(messages[0].content).toContain("cognitiveStructure");
      expect(messages[0].content).toContain("feynmanCards");
      expect(messages[0].content).toContain("nextActions");
    });

    it("passes truncated artifactText in user message", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const [, userMessage] = mockChatFn.mock.calls[0][0];
      expect(userMessage.role).toBe("user");
      const payload = JSON.parse(userMessage.content);
      expect(payload.artifactText).toContain("React app with Vite");
      expect(payload.artifactType).toBe("chatgpt");
    });

    it("preserves AI-generated gaps with correct ranking", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const ranks = report.sections.dangerousGaps.map(g => g.rank);
      expect(ranks).toEqual([1, 2, 3, 4, 5]);
    });

    it("preserves AI-generated feynman card prompts", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.sections.feynmanCards[0].prompt).toContain("TypeScript");
      expect(report.sections.feynmanCards[0].userAnswer).toBe("");
      expect(report.sections.feynmanCards[0].answeredAt).toBeNull();
    });

    it("preserves AI-generated next action routes", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const routes = report.sections.nextActions.map(a => a.route);
      expect(routes).toContain("verify");
      expect(routes).toContain("note");
      expect(routes).toContain("task");
      expect(routes).toContain("ask");
      for (const action of report.sections.nextActions) {
        expect(action.reason).toBeTruthy();
      }
    });

    it("overrides input fields with controlled values", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "claude", mockChatFn);

      expect(report.input.artifactType).toBe("claude");
      expect(report.input.artifactText).toContain("React app with Vite");
      expect(report.input.charCount).toBeGreaterThan(0);
    });

    it("sets status to 'generated'", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);
      expect(report.status).toBe("generated");
    });

    it("generates a report id", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);
      expect(report.id).toBeTruthy();
      expect(report.id.length).toBeGreaterThan(10);
    });

    it("normalizes AI output that is missing fields", async () => {
      const partialAI = {
        sections: {
          aiCompleted: [{ item: "AI did something" }],
          dangerousGaps: [
            { gap: "gap1", whyDangerous: "danger1" },
            { gap: "gap2", whyDangerous: "danger2" }
          ],
          feynmanCards: [{ target: "gap1", prompt: "explain gap1" }],
          nextActions: [{ item: "do something", route: "task" }]
        }
      };
      const mockChatFn = vi.fn().mockResolvedValue(partialAI);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      // Missing arrays should be filled
      expect(report.sections.userContributed).toEqual([]);
      expect(report.sections.cognitiveStructure.facts).toEqual([]);
      // Missing evidence should set isInference to true
      expect(report.sections.aiCompleted[0].isInference).toBe(true);
      // Missing rank should be assigned sequentially
      expect(report.sections.dangerousGaps[0].rank).toBe(1);
      expect(report.sections.dangerousGaps[1].rank).toBe(2);
      // Missing reason should still have a route
      expect(report.sections.nextActions[0].route).toBe("task");
      // Card should get an id
      expect(report.sections.feynmanCards[0].id).toBeTruthy();
    });

    it("normalizes AI output with invalid routes", async () => {
      const badRoutes = {
        sections: {
          nextActions: [
            { item: "check", route: "invalid", reason: "because" },
            { item: "write", route: "TODO", reason: "because" }
          ]
        }
      };
      const mockChatFn = vi.fn().mockResolvedValue(badRoutes);
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.sections.nextActions[0].route).toBe("task");
      expect(report.sections.nextActions[1].route).toBe("task");
    });
  });

  describe("with mock AI failure (fallback)", () => {
    it("falls back when chatFn throws an error", async () => {
      const mockChatFn = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.sections.dangerousGaps).toHaveLength(5);
      expect(report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
      expect(report.sections.nextActions.length).toBeGreaterThan(0);
      // All items should be marked as inference
      for (const item of report.sections.aiCompleted) {
        expect(item.isInference).toBe(true);
      }
    });

    it("falls back when chatFn returns __fallback flag", async () => {
      const mockChatFn = vi.fn().mockResolvedValue({
        __fallback: true,
        __fallbackError: "OPENAI_API_KEY is not set"
      });
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.sections.dangerousGaps).toHaveLength(5);
      expect(report.sections.aiCompleted.length).toBeGreaterThan(0);
      expect(report.sections.aiCompleted[0].isInference).toBe(true);
    });

    it("falls back when chatFn returns __useFallback marker", async () => {
      const mockChatFn = vi.fn().mockResolvedValue({ __useFallback: true });
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.sections.dangerousGaps).toHaveLength(5);
    });

    it("fallback report has all nextActions with valid routes", async () => {
      const mockChatFn = vi.fn().mockRejectedValue(new Error("AI down"));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      for (const action of report.sections.nextActions) {
        expect(["verify", "note", "task", "ask"]).toContain(action.route);
        expect(action.reason).toBeTruthy();
      }
    });
  });

  describe("without chatFn (fallback only)", () => {
    it("generates fallback report when chatFn is null", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", null);
      expect(report.sections.dangerousGaps).toHaveLength(5);
      expect(report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
    });

    it("generates fallback report when chatFn is undefined", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt");
      expect(report.sections.dangerousGaps).toHaveLength(5);
    });
  });

  describe("input handling", () => {
    it("truncates artifactText to 30000 characters", async () => {
      const longText = "x".repeat(40000);
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      await generateClearanceReport(longText, "chatgpt", mockChatFn);

      const userPayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(userPayload.artifactText.length).toBe(30000);
    });

    it("uses structured compression for rollout JSONL before sending the prompt", async () => {
      const raw = rolloutJsonl([
        { type: "session_meta", payload: { id: "session-3", cwd: "/workspace" } },
        rolloutMessage("user", "请先调查 API 24 路线。"),
        rolloutMessage("assistant", "API 24 早期调查。".repeat(4000)),
        rolloutMessage("user", "切到 API 26 VM 做最终验证。"),
        rolloutMessage("assistant", "最终结果：API 26 VM 已通过 HAP 构建、hdc 安装、aa start 启动。仍需区分 VM 验收与真机验收。")
      ]);
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);

      const report = await generateClearanceReport(raw, "codex", mockChatFn);

      const userPayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(userPayload.preprocess.strategy).toBe("rollout-jsonl-structured");
      expect(userPayload.preprocess.didCompress).toBe(true);
      expect(userPayload.artifactText).toContain("Structured Compression");
      expect(userPayload.artifactText).toContain("API 26 VM 已通过");
      expect(userPayload.artifactText).toContain("VM 验收与真机验收");
      expect(userPayload.artifactText.length).toBeLessThanOrEqual(30000);
      expect(report.input.preprocess.strategy).toBe("rollout-jsonl-structured");
    });

    it("defaults invalid artifactType to 'other'", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport(SAMPLE_TEXT, "invalid-type", mockChatFn);
      expect(report.input.artifactType).toBe("other");
    });

    it("handles empty text gracefully", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport("", "other", mockChatFn);
      expect(report.sections.dangerousGaps).toHaveLength(5);
    });

    it("handles short text gracefully", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_SUCCESS);
      const report = await generateClearanceReport("AI wrote a function.", "codex", mockChatFn);
      expect(report.sections.dangerousGaps).toHaveLength(5);
    });
  });

  describe("system prompt", () => {
    it("contains all six section names", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("aiCompleted");
      expect(prompt).toContain("userContributed");
      expect(prompt).toContain("dangerousGaps");
      expect(prompt).toContain("cognitiveStructure");
      expect(prompt).toContain("feynmanCards");
      expect(prompt).toContain("nextActions");
    });

    it("specifies exactly 5 dangerous gaps", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("Exactly 5");
    });

    it("specifies 3-5 feynman cards", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("3-5");
    });

    it("lists all four action routes", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("verify");
      expect(prompt).toContain("note");
      expect(prompt).toContain("task");
      expect(prompt).toContain("ask");
    });
  });
});
