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

  it("returns a generic fallback for unrelated debts (not hardcoded server-diagnostics)", () => {
    const result = createDemoResearchFallback({
      targetDebt: "Explain product-market fit.",
      originalQuestion: "What is PMF?"
    }, new Error("offline"));

    expect(result.researchMode).toBe("curated_demo_fallback");
    // 通用 fallback 使用实际卡片 prompt 作为问题，而非硬编码服务器诊断问题
    expect(result.rewrittenQuestion).toBe("What is PMF?");
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
    expect(result.scaffold.length).toBeGreaterThanOrEqual(2);
    expect(result.scaffold.every(point => point.sourceIds.length > 0)).toBe(true);
  });

  it("uses generic fallback for non-server debts that mention '验证' in passing", () => {
    // 艾宾浩斯复训调度器欠条：evidence 含"我没验证"但主题与服务器诊断无关
    const result = createDemoResearchFallback({
      targetDebt: "顺延逻辑与 next_review_at 的交互",
      originalQuestion: "顺延逻辑和 next_review_at 相互作用会不会让欠条永远排不上",
      practiceEvidence: {
        userContributed: ["用户事后反思'顺延逻辑和 next_review_at 相互作用会不会让欠条永远排不上，我没验证'"]
      }
    }, new Error("offline"));

    expect(result.researchMode).toBe("curated_demo_fallback");
    // 不应使用服务器诊断的硬编码问题
    expect(result.rewrittenQuestion).not.toContain("哪些证据");
    expect(result.rewrittenQuestion).not.toContain("D 状态");
    // 应使用实际卡片 prompt
    expect(result.rewrittenQuestion).toContain("顺延逻辑");
  });

  it.each([
    ["Linux 内存管理中的 page cache 机制", "Page cache", { aiCompleted: ["page cache 与 Linux 内存管理"] }],
    ["验证修复完整性的工具链", "哪些证据", { decisions: ["重启 nginx 后验证修复是否完整"] }],
    ["区分根因修复与症状缓解", "根因修复", { tradeoffs: ["nginx 重启只是症状缓解，需要区分根因修复"] }]
  ])("covers every card in the controlled server demo report: %s", (targetDebt, expected, evidence) => {
    const result = createDemoResearchFallback({ targetDebt, originalQuestion: targetDebt, practiceEvidence: evidence }, new Error("offline"));
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
