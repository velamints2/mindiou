// @ts-nocheck
import { describe, expect, it } from "vitest";
import { buildReviewRequest, generateRuleBasedReviewTask } from "../review-generator.js";

describe("review task scope binding", () => {
  const debt = {
    id: "debt-1",
    reportId: "report-1",
    sourceGapId: "gap-1",
    gapText: "理解 CSI 雷达中的相位偏移及其对无线感知的影响",
    gapEvidence: "用户依赖 AI 解释相位偏移，尚未独立解释该物理量。"
  };
  const card = {
    id: "card-1",
    target: debt.gapText,
    prompt: "请用自己的话解释相位偏移如何影响 CSI 无线感知。"
  };

  it("does not carry an unrelated previous omission into a review request", () => {
    const request = buildReviewRequest({
      debt,
      card,
      firstAttempt: { finalAnswer: "相位会变化。", evaluation: { missingPoints: ["没有解释快速坐下和跌倒的加速度差异", "没有说明相位偏移的因果机制"] } },
      hintEvents: [],
      previousReviews: [],
      mastery: null,
      trainingStage: "delayed_recall"
    });
    expect(request.lastMissingPoints).toEqual(["没有说明相位偏移的因果机制"]);
    expect(request.cognitiveDebt.sourceGapId).toBe("gap-1");
  });

  it("keeps rule-based delayed recall inside the bound debt", () => {
    const task = generateRuleBasedReviewTask({
      debt,
      card,
      firstAttempt: { evaluation: { missingPoints: ["没有解释快速坐下和跌倒的加速度差异"] } },
      mastery: null,
      trainingStage: "delayed_recall",
      dueAt: "2026-08-13T00:00:00.000Z",
      userId: "user-1"
    });
    expect(task.cognitiveDebtId).toBe("debt-1");
    expect(task.prompt).toContain("相位");
    expect(task.prompt).not.toContain("快速坐下");
  });
});
