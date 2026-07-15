// @ts-nocheck
import { describe, expect, it } from "vitest";
import {
  createDemoAnswerFallback,
  createDemoResearchFallback,
  ensureLearnerFacingLanguage
} from "../mvp1-demo-fallback.js";

describe("MVP-1 public demo fallback", () => {
  it("provides a cited scaffold only for the curated server incident", () => {
    const result = createDemoResearchFallback({
      targetDebt: "Why did the server have high I/O wait and D-state processes?",
      originalQuestion: "Explain the incident."
    }, new Error("offline"));

    expect(result.researchMode).toBe("curated_demo_fallback");
    expect(result.rewrittenQuestion).toBe("D 状态和高 I/O wait 说明什么？为什么重启 Nginx 不等于修复根因？");
    expect(result.rewrittenQuestion.length).toBeLessThanOrEqual(48);
    expect(result.sources).toHaveLength(3);
    expect(result.scaffold).toHaveLength(4);
    expect(result.scaffold.every(point => point.sourceIds.length > 0)).toBe(true);
  });

  it("does not fabricate research for unrelated debts", () => {
    expect(() => createDemoResearchFallback({
      targetDebt: "Explain product-market fit.",
      originalQuestion: "What is PMF?"
    }, new Error("offline"))).toThrow("offline");
  });

  it.each([
    ["Linux 内存管理中的 page cache 机制", "Page cache"],
    ["验证修复完整性的工具链", "哪些证据"],
    ["区分根因修复与症状缓解", "根因修复"]
  ])("covers every card in the controlled server demo report: %s", (targetDebt, expected) => {
    const result = createDemoResearchFallback({ targetDebt, originalQuestion: targetDebt }, new Error("offline"));
    expect(result.researchMode).toBe("curated_demo_fallback");
    expect(result.rewrittenQuestion).toContain(expected);
    expect(result.sources.length).toBeGreaterThanOrEqual(3);
    expect(result.scaffold.every(point => point.sourceIds.length > 0)).toBe(true);
  });

  it("never marks a heuristic demo evaluation as cleared", () => {
    const result = createDemoAnswerFallback({
      answer: "D-state is uninterruptible I/O blocking. High I/O wait is a symptom, so restarting Nginx does not prove the root cause is fixed. I would inspect logs, iostat latency, /proc state, and repeat the workload."
    });

    expect(result.status).toBe("needs_verification");
    expect(result.coverage).toBe(1);
    expect(result.recommendation).toBe("continue");
  });

  it("keeps Chinese learner-facing output Chinese when a provider drifts to English", () => {
    const result = ensureLearnerFacingLanguage({
      status: "needs_practice",
      feedback: "Good start, but the answer is incomplete.",
      teaching: "Compare before and after metrics.",
      nextQuestion: "What evidence would falsify the fix?"
    }, { answer: "我会复现负载并检查日志和 I/O 延迟。" });

    expect(result.feedback).toMatch(/[\u3400-\u9fff]/);
    expect(result.teaching).toMatch(/[\u3400-\u9fff]/);
    expect(result.nextQuestion).toMatch(/[\u3400-\u9fff]/);
    expect(result.status).toBe("needs_practice");
  });
});
