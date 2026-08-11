// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { createMindiouTools } from "../mcp/tools.mjs";

function parse(result) {
  return JSON.parse(result.content[0].text);
}

describe("MindIOU MCP demo slice", () => {
  it("gives a concrete checkpoint for a high-risk concurrency task without an existing debt match", async () => {
    const client = { getAgentContext: vi.fn().mockResolvedValue({ project: { name: "demo" }, debts: [] }) };
    const tools = createMindiouTools(client);

    const result = parse(await tools.callTool("recommend_assistance_mode", {
      task: "支付回调避免同一订单重复发放权益",
      riskLevel: "high"
    }));

    expect(result.recommendedMode).toBe("ask_before_decision");
    expect(result.requiredCheckpoints).toHaveLength(1);
    expect(result.requiredCheckpoints[0]).toContain("两个请求同时到达");
  });

  it("returns report-backed repayment gaps and capability profiles without replacing legacy debts", async () => {
    const client = {
      getAgentContext: vi.fn().mockResolvedValue({
        project: { name: "3D 打印演示项目" },
        counts: { debts: 0, repaymentGaps: 1 },
        debts: [],
        repaymentGaps: [{ gapId: "gap-3d", title: "打印件翘曲的热应力控制", status: "identified" }],
        capabilityProfiles: [{ domain: "3D 打印工艺", reportId: "report-3d" }],
        dueReviews: { tasks: [] },
        recentDecisions: [],
        ownership: { summary: {} }
      })
    };
    const tools = createMindiouTools(client);

    const result = parse(await tools.callTool("get_learning_context", { task: "设计 3D 打印件，避免翘曲" }));

    expect(result.relatedDebts).toEqual([]);
    expect(result.relatedRepaymentGaps[0].gapId).toBe("gap-3d");
    expect(result.repaymentGaps[0].status).toBe("identified");
    expect(result.capabilityProfiles[0].domain).toBe("3D 打印工艺");
  });

  it("captures a structured project session and exposes the candidate acceptance next step", async () => {
    const client = {
      postEvents: vi.fn().mockResolvedValue({
        project: { id: "project-demo", name: "demo" },
        session: { session: { id: "session-demo" }, artifacts: [{ id: "artifact-1" }], decisions: [{ id: "decision-1" }] },
        analysis: { cognitiveDebtCandidates: [{ title: "并发竞态", description: "需要解释条件更新" }] }
      })
    };
    const tools = createMindiouTools(client);

    const result = parse(await tools.callTool("capture_project_session", {
      task: "修改激活码兑换逻辑，避免并发重复兑换",
      agentSummary: "Agent 使用事务、条件更新和唯一约束完成实现。",
      changedFiles: ["src/redeem.ts"],
      tests: ["npm test -- redeem"],
      decisions: ["使用条件更新保证 used=false 只被一个请求消费"],
      debtCandidate: { gapText: "尚未掌握并发窗口", reason: "关键方案由 Agent 完成" }
    }));

    expect(client.postEvents).toHaveBeenCalledOnce();
    const [events, extra] = client.postEvents.mock.calls[0];
    expect(extra.externalSessionId).toBe(extra.sessionId);
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
      "user_prompted", "agent_message", "file_changed", "test_executed", "debt_candidate", "session_finished"
    ]));
    expect(result.captured).toBe(true);
    expect(result.sessionId).toBe("session-demo");
    expect(result.candidateCount).toBe(1);
    expect(result.nextStep).toContain("accept_debt_candidate");
  });

  it("accepts a candidate through the project-scoped client", async () => {
    const client = { acceptDebtCandidate: vi.fn().mockResolvedValue({ debt: { id: "debt-1" }, links: [] }) };
    const tools = createMindiouTools(client);

    const result = parse(await tools.callTool("accept_debt_candidate", {
      sessionId: "session-demo",
      candidateIndex: 0
    }));

    expect(client.acceptDebtCandidate).toHaveBeenCalledWith("session-demo", 0);
    expect(result.accepted).toBe(true);
    expect(result.debt.id).toBe("debt-1");
  });

  it("appends the report to the watcher session when file capture already started", async () => {
    const client = {
      appendSessionEvents: vi.fn().mockResolvedValue({
        project: { id: "project-demo", name: "demo" },
        session: { session: { id: "watched-session" }, artifacts: [], decisions: [] },
        analysis: { cognitiveDebtCandidates: [] }
      })
    };
    const tools = createMindiouTools(client, {
      captureState: { getStatus: () => ({ enabled: true, sessionId: "watched-session" }) }
    });

    const result = parse(await tools.callTool("capture_project_session", {
      task: "补齐激活码并发测试",
      agentSummary: "已完成实现并验证并发场景",
      tests: ["npm test -- redeem"]
    }));

    expect(client.appendSessionEvents).toHaveBeenCalledWith("watched-session", expect.any(Array));
    expect(result.sessionId).toBe("watched-session");
    expect(result.captured).toBe(true);
  });
});
