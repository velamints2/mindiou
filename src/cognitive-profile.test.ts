import { describe, expect, it } from "vitest";
import { analyzeCognitiveLoop, normalizeActivityEvents } from "../cognitive-loop.js";
import { buildUserCognitiveProfile, analyzeDomainCapabilities } from "../cognitive-profile.js";

const NOW = "2026-08-12T12:00:00.000Z";

describe("unified user cognitive profile", () => {
  it("sends the same normalized activity event IDs to both engines and keeps the capability branches separate", () => {
    const events = normalizeActivityEvents([
      {
        id: "event-1",
        occurredAt: "2026-08-12T10:00:00.000Z",
        content: "我不理解数据库索引为什么有效，请解释原理。然后我会运行测试并验证来源。目标是完成一个可迁移到新项目的方案。"
      }
    ], NOW);
    const loop = analyzeCognitiveLoop({ now: NOW, activityEvents: events, projectContext: "产品研发" });
    const result = buildUserCognitiveProfile({
      userId: "user-1",
      projectId: "project-1",
      domain: "数据库设计",
      projectContext: "产品研发",
      activityEvents: events,
      loopResult: loop,
      now: NOW
    });

    const domainEvidenceIds = result.profile.domainCapabilityProfiles[0].dimensions.conceptualUnderstanding.evidence.map((item: { activityId?: string }) => item.activityId);
    const aiEvidenceIds = result.profile.aiCollaborationProfile.flatMap((item: { evidence: Array<{ activityId?: string }> }) => item.evidence.map((evidence: { activityId?: string }) => evidence.activityId));
    expect(domainEvidenceIds).toContain("event-1");
    expect(aiEvidenceIds).toContain("event-1");
    expect(result.profile.domainCapabilityProfiles[0].domain).toBe("数据库设计");
    expect(result.profile.aiCollaborationProfile).toHaveLength(7);
    expect(result.profile.knowledgeDebts[0].kind).toBe("knowledge_debt");
    expect(result.profile.aiUsageDebts).toHaveLength(7);
    expect(result.profile.priorityInterventions.length).toBeGreaterThan(0);
  });

  it("does not manufacture a domain gap when the domain is not supplied", () => {
    const events = normalizeActivityEvents([{ id: "event-2", content: "我验证了一个结论并保留了来源。" }], NOW);
    const domain = analyzeDomainCapabilities({ userId: "user-1", activityEvents: events, now: NOW });
    expect(domain.domainCapabilityProfiles).toEqual([]);
    expect(domain.knowledgeDebts).toEqual([]);
  });
});
