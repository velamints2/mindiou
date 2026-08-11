import { describe, expect, it } from "vitest";
import { analyzeCognitiveLoop, defaultContentCandidates } from "../cognitive-loop.js";

const NOW = "2026-08-12T12:00:00.000Z";

describe("cognitive-loop analyzer", () => {
  it("turns recent AI activity into four collaboration dimensions and an auditable usage debt", () => {
    const result = analyzeCognitiveLoop({
      now: NOW,
      projectContext: "MindIOU web product; goal is a stable user flow; constraints include existing auth and SQLite.",
      activities: [
        {
          id: "a-1",
          occurredAt: "2026-08-10T10:00:00.000Z",
          title: "需求澄清",
          content: "目标是把用户导入 AI 对话变成可验证的训练闭环。约束是复用现有账户和项目 Context，成功标准是测试、刷新和异常状态都能通过。"
        },
        {
          id: "a-2",
          occurredAt: "2026-08-11T10:00:00.000Z",
          title: "实现建议",
          content: "AI 给了一个方案，我直接采用第一版，没有独立来源。虽然看起来对，但没有保留验证证据。"
        }
      ]
    });

    expect(result.schemaVersion).toBe("cognitive-loop-mvp-1");
    expect(result.aiCollaborationProfile).toHaveLength(4);
    expect(result.aiCollaborationProfile.map(item => item.dimension)).toEqual([
      "problem_modeling",
      "context",
      "verification",
      "workflow"
    ]);
    expect(result.aiUsageDebts).toHaveLength(1);
    expect(result.aiUsageDebts[0].dimension).toBe("workflow");
    expect(result.aiUsageDebts[0].evidence.length).toBe(0);
    expect(result.experiment.type).toBe("workflow_experiment");
    expect(result.verification.status).toBe("pending");
  });

  it("keeps the attention budget small and deduplicates content candidates", () => {
    const candidate = defaultContentCandidates()[0];
    const result = analyzeCognitiveLoop({
      now: NOW,
      activities: [{ content: "请直接给我答案，不用测试。" }],
      contentCandidates: [candidate, { ...candidate, id: "duplicate" }, {
        id: "third",
        title: "Unrelated celebrity news",
        summary: "A completely unrelated story.",
        sourceName: "fixed source"
      }]
    });

    expect(result.briefing.attentionBudget).toBe(1);
    expect(result.briefing.items.length).toBeLessThanOrEqual(1);
    expect(result.briefing.informationDiet.duplicateCount).toBe(1);
    expect(result.briefing.items[0].contentRecord).toBeTruthy();
  });

  it("marks absent behavior as missing evidence instead of claiming a low-confidence fact", () => {
    const result = analyzeCognitiveLoop({
      now: NOW,
      activities: [{ content: "这是一段没有具体协作行为的简短记录。" }]
    });

    expect(result.aiCollaborationProfile.some(item => item.evidenceStatus === "missing_evidence")).toBe(true);
    expect(result.evidencePolicy).toContain("没有证据");
  });

  it("uses prior user feedback to adjust the next debt and content ranking", () => {
    const candidate = defaultContentCandidates()[0];
    const base = analyzeCognitiveLoop({
      now: NOW,
      activities: [{ content: "这是一段没有具体协作行为的简短记录。" }],
      contentCandidates: [candidate]
    });
    const corrected = analyzeCognitiveLoop({
      now: NOW,
      activities: [{ content: "这是一段没有具体协作行为的简短记录。" }],
      contentCandidates: [candidate],
      previousFeedback: [
        { kind: "correction", targetId: "ai-usage-debt-problem_modeling", payload: { accepted: false } },
        { kind: "recommendation", targetId: candidate.id, payload: { accepted: false } }
      ]
    });

    expect(corrected.aiUsageDebts[0].dimension).not.toBe("problem_modeling");
    expect(corrected.briefing.items[0].score).toBeLessThan(base.briefing.items[0].score);
    expect(corrected.inputSummary.previousFeedbackCount).toBe(2);
  });
});
