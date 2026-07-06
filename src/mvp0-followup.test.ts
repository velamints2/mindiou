import { describe, expect, it, vi } from "vitest";
import { feynmanFollowUp, getFeynmanFollowUpSystemPrompt } from "../mvp0-followup.js";

const SAMPLE_CARD = {
  id: "card-001",
  target: "React virtual DOM",
  prompt: "Explain how the virtual DOM works in your own words",
  userAnswer: "",
  aiFollowUp: "",
  answeredAt: null
};

const GOOD_ANSWER = "The virtual DOM is a lightweight JavaScript representation of the real DOM. When state changes, React creates a new virtual tree, compares it with the previous one using reconciliation, and updates only the changed nodes in the real DOM. This avoids expensive direct DOM manipulations.";

const PARTIAL_ANSWER = "It's like a copy of the DOM that React uses to make updates faster.";

const EMPTY_ANSWER = "";

const MOCK_FOLLOWUP = {
  followUp: "You mentioned reconciliation. Can you explain what happens when two elements have the same key during reconciliation?",
  summary: "",
  shouldFollowUp: true
};

const MOCK_SUFFICIENT = {
  followUp: "",
  summary: "Your answer correctly covers the virtual tree, diffing, and selective DOM updates. Well done.",
  shouldFollowUp: false
};

describe("feynmanFollowUp", () => {
  describe("with mock AI success (follow-up question)", () => {
    it("returns a follow-up question when answer is partial", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_FOLLOWUP);
      const result = await feynmanFollowUp(SAMPLE_CARD, PARTIAL_ANSWER, mockChatFn);

      expect(result.shouldFollowUp).toBe(true);
      expect(result.followUp).toBeTruthy();
      expect(result.followUp).toContain("reconciliation");
      expect(result.summary).toBe("");
    });

    it("calls chatFn with system prompt containing Feynman coaching rules", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_FOLLOWUP);
      await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, mockChatFn);

      expect(mockChatFn).toHaveBeenCalledTimes(1);
      const [messages] = mockChatFn.mock.calls[0];
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("followUp");
      expect(messages[0].content).toContain("summary");
      expect(messages[0].content).toContain("shouldFollowUp");
    });

    it("passes card target and prompt in user message", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_FOLLOWUP);
      await feynmanFollowUp(SAMPLE_CARD, PARTIAL_ANSWER, mockChatFn);

      const userPayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(userPayload.card.target).toBe("React virtual DOM");
      expect(userPayload.card.prompt).toContain("virtual DOM");
      expect(userPayload.userAnswer).toBe(PARTIAL_ANSWER);
    });
  });

  describe("with mock AI success (sufficient summary)", () => {
    it("returns a summary when answer is sufficient", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_SUFFICIENT);
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, mockChatFn);

      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toBeTruthy();
      expect(result.summary).toContain("correctly covers");
      expect(result.followUp).toBe("");
    });
  });

  describe("with mock AI failure (fallback)", () => {
    it("falls back when chatFn throws an error", async () => {
      const mockChatFn = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, mockChatFn);

      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toBeTruthy();
      expect(result.summary).toContain("AI evaluation unavailable");
    });

    it("falls back when chatFn returns __fallback flag", async () => {
      const mockChatFn = vi.fn().mockResolvedValue({
        __fallback: true,
        __fallbackError: "OPENAI_API_KEY is not set"
      });
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, mockChatFn);

      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toContain("AI evaluation unavailable");
    });

    it("falls back when chatFn returns __useFallback marker", async () => {
      const mockChatFn = vi.fn().mockResolvedValue({ __useFallback: true });
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, mockChatFn);

      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toContain("AI evaluation unavailable");
    });

    it("fallback for empty answer returns a follow-up question", async () => {
      const mockChatFn = vi.fn().mockRejectedValue(new Error("AI down"));
      const result = await feynmanFollowUp(SAMPLE_CARD, EMPTY_ANSWER, mockChatFn);

      expect(result.shouldFollowUp).toBe(true);
      expect(result.followUp).toContain("card prompt");
    });
  });

  describe("without chatFn (fallback only)", () => {
    it("generates fallback when chatFn is null", async () => {
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, null);
      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toBeTruthy();
    });

    it("generates fallback when chatFn is undefined", async () => {
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER);
      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toBeTruthy();
    });

    it("fallback for empty answer asks user to try", async () => {
      const result = await feynmanFollowUp(SAMPLE_CARD, EMPTY_ANSWER, null);
      expect(result.shouldFollowUp).toBe(true);
      expect(result.followUp).toContain("Try answering");
    });
  });

  describe("normalization", () => {
    it("enforces mutual exclusivity: shouldFollowUp=true with empty followUp falls back", async () => {
      const badResult = { followUp: "", summary: "some summary", shouldFollowUp: true };
      const mockChatFn = vi.fn().mockResolvedValue(badResult);
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, mockChatFn);

      // shouldFollowUp=true but followUp is empty → fallback
      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toContain("AI evaluation unavailable");
    });

    it("enforces mutual exclusivity: shouldFollowUp=false with empty summary falls back", async () => {
      const badResult = { followUp: "a question", summary: "", shouldFollowUp: false };
      const mockChatFn = vi.fn().mockResolvedValue(badResult);
      const result = await feynmanFollowUp(SAMPLE_CARD, GOOD_ANSWER, mockChatFn);

      // shouldFollowUp=false but summary is empty → fallback
      expect(result.shouldFollowUp).toBe(false);
      expect(result.summary).toBeTruthy();
    });

    it("accepts nextQuestion as alias for followUp", async () => {
      const aliasResult = { nextQuestion: "What about keys in reconciliation?", shouldFollowUp: true };
      const mockChatFn = vi.fn().mockResolvedValue(aliasResult);
      const result = await feynmanFollowUp(SAMPLE_CARD, PARTIAL_ANSWER, mockChatFn);

      expect(result.shouldFollowUp).toBe(true);
      expect(result.followUp).toContain("keys");
    });

    it("truncates overly long follow-up to 200 chars", async () => {
      const longFollowUp = { followUp: "x".repeat(300), shouldFollowUp: true };
      const mockChatFn = vi.fn().mockResolvedValue(longFollowUp);
      const result = await feynmanFollowUp(SAMPLE_CARD, PARTIAL_ANSWER, mockChatFn);

      expect(result.followUp.length).toBeLessThanOrEqual(200);
    });
  });

  describe("input handling", () => {
    it("truncates user answer to 2000 chars", async () => {
      const longAnswer = "x".repeat(3000);
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_FOLLOWUP);
      await feynmanFollowUp(SAMPLE_CARD, longAnswer, mockChatFn);

      const userPayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(userPayload.userAnswer.length).toBe(2000);
    });

    it("handles missing card gracefully", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_FOLLOWUP);
      const result = await feynmanFollowUp(null, GOOD_ANSWER, mockChatFn);
      expect(result).toBeDefined();
      expect(result.shouldFollowUp).toBeDefined();
    });

    it("handles card with missing fields", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_FOLLOWUP);
      const result = await feynmanFollowUp({ id: "x" }, GOOD_ANSWER, mockChatFn);
      expect(result).toBeDefined();
    });
  });

  describe("system prompt", () => {
    it("contains follow-up and summary schema", () => {
      const prompt = getFeynmanFollowUpSystemPrompt();
      expect(prompt).toContain("followUp");
      expect(prompt).toContain("summary");
      expect(prompt).toContain("shouldFollowUp");
    });

    it("mentions Feynman technique", () => {
      const prompt = getFeynmanFollowUpSystemPrompt();
      expect(prompt).toContain("Feynman");
    });

    it("specifies one question or one summary, not both", () => {
      const prompt = getFeynmanFollowUpSystemPrompt();
      expect(prompt).toContain("not both");
    });

    it("instructs not to criticize", () => {
      const prompt = getFeynmanFollowUpSystemPrompt();
      expect(prompt).toContain("Never criticize");
    });
  });
});
