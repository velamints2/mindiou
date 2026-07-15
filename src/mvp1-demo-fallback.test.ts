// @ts-nocheck
import { describe, expect, it } from "vitest";
import { createDemoAnswerFallback, createDemoResearchFallback } from "../mvp1-demo-fallback.js";

describe("MVP-1 public demo fallback", () => {
  it("provides a cited scaffold only for the curated server incident", () => {
    const result = createDemoResearchFallback({
      targetDebt: "Why did the server have high I/O wait and D-state processes?",
      originalQuestion: "Explain the incident."
    }, new Error("offline"));

    expect(result.researchMode).toBe("curated_demo_fallback");
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

  it("never marks a heuristic demo evaluation as cleared", () => {
    const result = createDemoAnswerFallback({
      answer: "D-state is uninterruptible I/O blocking. High I/O wait is a symptom, so restarting Nginx does not prove the root cause is fixed. I would inspect logs, iostat latency, /proc state, and repeat the workload."
    });

    expect(result.status).toBe("needs_verification");
    expect(result.coverage).toBe(1);
    expect(result.recommendation).toBe("continue");
  });
});
