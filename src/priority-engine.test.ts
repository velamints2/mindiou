import { describe, expect, it } from "vitest";
import { selectPriorityInterventions } from "../priority-engine.js";

describe("priority engine", () => {
  it("chooses one shared queue across domain, AI collaboration, and frontier candidates", () => {
    const interventions = selectPriorityInterventions({
      knowledgeDebts: [{ id: "knowledge-1", title: "数据库原理缺口", score: 20, priority: "now", nextAction: "完成解释和迁移", evidence: [] }],
      aiUsageDebts: [{ id: "ai-1", title: "验证缺口", dimension: "verification", score: 35, priority: "now", nextAction: "保留独立证据", evidence: [] }],
      contentItems: [{ id: "frontier-1", title: "Agent capability shift", score: 92, decision: "read_summary", summary: "Capability shift", sourceName: "research", contentRecord: { evidenceStrength: 0.9 } }],
      max: 3,
      now: "2026-08-12T12:00:00.000Z"
    });

    expect(interventions).toHaveLength(3);
    expect(interventions.map(item => item.category)).toEqual(expect.arrayContaining([
      "domain_capability",
      "ai_collaboration",
      "frontier_information"
    ]));
    expect(interventions.find(item => item.category === "domain_capability")?.interventionPath).toEqual([
      "知识", "训练", "解释", "迁移", "真实工作验证"
    ]);
    expect(interventions.find(item => item.category === "ai_collaboration")?.interventionType).toBe("verification");
  });

  it("does not put skipped frontier information into the queue", () => {
    expect(selectPriorityInterventions({
      contentItems: [{ id: "skip", title: "Noise", score: 99, decision: "skip" }]
    })).toEqual([]);
  });
});
