/**
 * MindIOU MCP 工具定义与处理逻辑。
 *
 * MCP 工具对应"自适应代劳协议"的最小闭环：
 * 读上下文 → 风险判断 → 捕捉会话 → 确认欠条 → 生成检查 → 提交证据。
 *
 * 所有 handler 通过注入的 backend client 访问后端，便于单元测试。
 */

import { randomUUID } from "node:crypto";
import { recommendAssistanceMode, normalizeEvidenceLevel, ASSISTANCE_MODES, RISK_LEVELS } from "./assistance-mode.mjs";

const EVIDENCE_RESULTS = ["passed", "partial", "failed", "unverified"];

function checkpointForTask(task, domain, riskLevel) {
  const text = `${task || ""} ${domain || ""}`.toLowerCase();
  if (/并发|concurren|竞态|race|幂等|idempot|支付|payment|激活码|兑换/.test(text)) {
    return "在实现前请先判断：如果两个请求同时到达，只先查询状态再更新，会出现什么竞态？你会用什么条件更新、事务或唯一约束防止重复处理？";
  }
  if (["high", "critical"].includes(String(riskLevel || "").toLowerCase())) {
    return "在实现前请先说明：这项高风险操作最容易在哪个边界条件下失效？你准备如何验证它？";
  }
  return "在实现前请先说明：这项任务的关键判断是什么，以及你准备怎样验证自己理解了它？";
}

function text(payload) {
  return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}

function errorText(message) {
  return { content: [{ type: "text", text: `MindIOU 调用失败：${message}` }], isError: true };
}

function clean(value, max = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** 在上下文欠条/报告缺口中按关键词匹配（拉丁词 + 中文二元组混合匹配） */
function findRelatedDebts(debts, task) {
  const cleaned = clean(task, 200).toLowerCase();
  if (!cleaned) return [];
  const words = cleaned.split(/[\s,，、/;.!?;:：()（）]+/).filter(w => w.length >= 2);
  const bigrams = new Set();
  for (let i = 0; i + 2 <= cleaned.length; i += 1) {
    const gram = cleaned.slice(i, i + 2);
    if (!/[\s\p{P}]/u.test(gram)) bigrams.add(gram);
  }
  return debts
    .map(debt => {
      const haystack = `${debt.gapText || debt.title || debt.whyItMatters || ""}`.toLowerCase();
      const wordHits = words.filter(w => haystack.includes(w)).length;
      let gramHits = 0;
      for (const gram of bigrams) if (haystack.includes(gram)) gramHits += 1;
      return { debt, score: wordHits * 10 + gramHits, matched: wordHits > 0 || gramHits >= 2 };
    })
    .filter(item => item.matched)
    .sort((a, b) => b.score - a.score)
    .map(item => item.debt);
}

const definitions = [
  {
    name: "get_learning_context",
    description: "获取当前项目相关的用户能力档案：传统认知欠条、报告生成的待清偿缺口、能力领域、掌握度、证据等级、到期复习与最近决策。在开始非平凡任务前调用；读取失败不应阻塞代码工作。",
    inputSchema: {
    type: "object",
      properties: {
        task: { type: "string", description: "本次任务的一句话描述，用于匹配相关欠条" }
      }
    }
  },
  {
    name: "recommend_assistance_mode",
    description: "根据任务风险与用户证据等级推荐本次任务的 AI 代劳程度（auto_execute / execute_then_explain / ask_before_decision / scaffold_only / user_first / verify_only）。涉及鉴权、支付、数据迁移、安全等高风险任务时必须先调用。",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "知识领域，如 jwt-refresh-security" },
        task: { type: "string", description: "任务描述，用于匹配相关欠条的证据等级" },
        riskLevel: { type: "string", enum: RISK_LEVELS, description: "任务风险等级" },
        userPreference: { type: "string", enum: ASSISTANCE_MODES, description: "用户主动选择的模式（优先级最高）" }
      },
      required: ["riskLevel"]
    }
  },
  {
    name: "record_ai_decision",
    description: "记录 Agent 代表用户做出的关键技术或产品决策，使决策可追溯、可被后续验证。",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "决策标题" },
        decision: { type: "string", description: "决策内容" },
        rationale: { type: "string", description: "决策理由" },
        importance: { type: "string", enum: ["low", "medium", "high"], description: "重要程度" },
        userParticipation: { type: "string", enum: ["none", "consulted", "confirmed", "decided"], description: "用户参与程度" },
        sessionId: { type: "string", description: "关联的会话 ID（可选）" }
      },
      required: ["title", "decision"]
    }
  },
  {
    name: "create_debt_candidate",
    description: "当发现用户跳过了关键理解（直接接受大段代码、未参与关键判断、反复出现同类困惑）时，提交一条认知欠条候选。",
    inputSchema: {
      type: "object",
      properties: {
        gapText: { type: "string", description: "欠条描述：用户尚未证明掌握的具体能力" },
        reason: { type: "string", description: "判断依据" },
        artifacts: { type: "array", items: { type: "string" }, description: "相关文件路径（只传路径，不传内容）" },
        sessionId: { type: "string", description: "关联的会话 ID（可选）" }
      },
    required: ["gapText"]
  }
},
  {
    name: "capture_project_session",
    description: "把一次真实 Agent 工作整理成项目会话：用户任务、Agent 产出、修改文件、测试结果和关键决策会进入 MindIOU，用于生成可确认的认知欠条候选。代码修改完成后调用一次。",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "用户原始任务" },
        agentSummary: { type: "string", description: "Agent 实际完成的工作与关键实现" },
        changedFiles: { type: "array", items: { type: "string" }, description: "实际修改的仓库相对路径" },
        tests: { type: "array", items: { type: "string" }, description: "实际运行的测试或验证命令及结果" },
        decisions: { type: "array", items: { type: "string" }, description: "用户确认或 Agent 采用的关键方案" },
        debtCandidate: { type: "object", properties: { gapText: { type: "string" }, reason: { type: "string" }, risk: { type: "string" }, requiredEvidence: { type: "array", items: { type: "string" } } } }
      },
      required: ["task", "agentSummary"]
    }
  },
  {
    name: "accept_debt_candidate",
    description: "确认一次项目会话中的认知欠条候选，创建正式欠条并把它绑定到当前项目的产物与会话。先调用 capture_project_session 或 get_learning_context 获取 sessionId 和 candidateIndex。",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "项目会话 ID" },
        candidateIndex: { type: "integer", minimum: 0, description: "候选在该会话 cognitiveDebtCandidates 中的索引，通常为 0" }
      },
      required: ["sessionId", "candidateIndex"]
    }
  },
  {
    name: "get_capture_status",
    description: "查看可选工作区变更捕捉器是否启用、当前捕捉会话和最近一次捕捉状态。",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "generate_micro_check",
    description: "针对一条认知欠条生成 30 秒到 3 分钟的理解检查问题（模板生成，非 AI 推理）。用于轻量确认用户是否真正理解。",
    inputSchema: {
      type: "object",
      properties: {
        debtId: { type: "string", description: "认知欠条 ID（来自 get_learning_context）" }
      },
      required: ["debtId"]
    }
  },
  {
    name: "submit_learning_evidence",
    description: "提交用户的学习证据（解释、代码修改、测试结果或迁移表现），更新该欠条的证据等级。",
    inputSchema: {
      type: "object",
      properties: {
        debtId: { type: "string", description: "认知欠条 ID" },
        evidenceType: { type: "string", description: "证据类型，如 explanation / code_change / test_result / transfer" },
        evidenceLevel: { type: "string", enum: ["E0", "E1", "E2", "E3", "E4", "E5"], description: "证据等级" },
        result: { type: "string", enum: EVIDENCE_RESULTS, description: "证据结果" },
        evidenceSummary: { type: "string", description: "证据摘要" }
      },
      required: ["debtId", "evidenceType", "result"]
    }
  }
];

export function createMindiouTools(client, options = {}) {
  const captureState = options.captureState || { getStatus: () => ({ enabled: false }) };
  async function callTool(name, args = {}) {
    try {
      switch (name) {
        case "get_learning_context": {
          const context = await client.getAgentContext();
          const related = findRelatedDebts(context.debts || [], args.task);
          const relatedRepaymentGaps = findRelatedDebts(context.repaymentGaps || [], args.task);
          return text({
            project: context.project,
            counts: context.counts,
            relatedDebts: args.task ? related.slice(0, 5) : (context.debts || []).slice(0, 10),
            relatedRepaymentGaps: args.task ? relatedRepaymentGaps.slice(0, 5) : (context.repaymentGaps || []).slice(0, 10),
            repaymentGaps: context.repaymentGaps || [],
            capabilityProfiles: context.capabilityProfiles || [],
            dueReviews: context.dueReviews,
            recentDecisions: context.recentDecisions,
            ownershipSummary: context.ownership?.summary
          });
        }
        case "recommend_assistance_mode": {
          const context = await client.getAgentContext();
          const related = findRelatedDebts(context.debts || [], args.domain || args.task);
          const relatedRepaymentGaps = findRelatedDebts(context.repaymentGaps || [], args.domain || args.task);
          const strongest = related[0] || relatedRepaymentGaps[0] || null;
          const recommendation = recommendAssistanceMode({
            evidenceLevel: strongest ? normalizeEvidenceLevel(strongest.evidenceLevel, strongest.understandingLevel) : "E0",
            riskLevel: args.riskLevel,
            userPreference: args.userPreference
          });
          return text({
            domain: clean(args.domain || args.task, 120) || undefined,
            relatedDebts: related.slice(0, 3),
            relatedRepaymentGaps: relatedRepaymentGaps.slice(0, 3),
            recommendedMode: recommendation.mode,
            evidenceLevel: recommendation.evidenceLevel,
            riskLevel: recommendation.riskLevel,
            reason: recommendation.reason,
            requiredCheckpoints: recommendation.mode === "ask_before_decision"
              ? [strongest ? `在实现前请用户判断：${strongest.gapText}` : checkpointForTask(args.task, args.domain, args.riskLevel)]
              : []
          });
        }
        case "record_ai_decision": {
          if (!clean(args.title) || !clean(args.decision)) return errorText("title 和 decision 不能为空");
          const result = await client.createDecision({
            title: clean(args.title, 300),
            decision: clean(args.decision, 3000),
            rationale: clean(args.rationale, 3000) || undefined,
            importance: ["low", "medium", "high"].includes(args.importance) ? args.importance : "medium",
            decisionMaker: "agent",
            userParticipation: clean(args.userParticipation, 40) || "unknown",
            sessionId: clean(args.sessionId, 120) || undefined
          });
          return text({ recorded: true, decision: result.decision });
        }
        case "create_debt_candidate": {
          if (!clean(args.gapText)) return errorText("gapText 不能为空");
          const events = [{
            id: `debt-candidate-${randomUUID()}`,
            type: "debt_candidate",
            occurredAt: new Date().toISOString(),
            payload: {
              gapText: clean(args.gapText, 500),
              reason: clean(args.reason, 1000) || undefined,
              artifacts: (Array.isArray(args.artifacts) ? args.artifacts : []).map(p => clean(p, 300)).filter(Boolean).slice(0, 10)
            }
          }];
          const captureSessionId = clean(args.sessionId, 120) || captureState.getStatus().sessionId;
          const result = captureSessionId
            ? await client.appendSessionEvents(captureSessionId, events)
            : await client.postEvents(events, { sessionId: undefined });
          return text({
            recorded: true,
            eventsAccepted: result.eventsAccepted ?? 1,
            sessionId: result.session?.session?.id || result.session?.id,
            candidateCount: result.analysis?.cognitiveDebtCandidates?.length || 0,
            candidates: result.analysis?.cognitiveDebtCandidates || [],
            note: "欠条候选已记录；确认后调用 accept_debt_candidate 创建正式欠条"
          });
        }
        case "capture_project_session": {
          if (!clean(args.task) || !clean(args.agentSummary)) return errorText("task 和 agentSummary 不能为空");
          const watchedSessionId = clean(captureState.getStatus().sessionId, 120);
          const sessionId = watchedSessionId || `mcp-demo-${randomUUID()}`;
          const events = [
            { id: `${sessionId}-start`, type: "session_started", occurredAt: new Date().toISOString(), payload: { title: clean(args.task, 300) } },
            { id: `${sessionId}-user`, type: "user_prompted", occurredAt: new Date().toISOString(), payload: { content: clean(args.task, 4000) } },
            { id: `${sessionId}-agent`, type: "agent_message", occurredAt: new Date().toISOString(), payload: { content: clean(args.agentSummary, 12000) } },
            ...(Array.isArray(args.changedFiles) ? args.changedFiles : []).map((file, index) => ({
              id: `${sessionId}-file-${index}`,
              type: "file_changed",
              occurredAt: new Date().toISOString(),
              payload: { path: clean(file, 300), repositoryRelativePath: clean(file, 300), relation: "modified" }
            })),
            ...(Array.isArray(args.tests) ? args.tests : []).map((test, index) => ({
              id: `${sessionId}-test-${index}`,
              type: "test_executed",
              occurredAt: new Date().toISOString(),
              payload: { command: clean(test, 500), result: /fail|error|失败/i.test(String(test)) ? "failed" : "passed" }
            })),
            ...(Array.isArray(args.decisions) ? args.decisions : []).map((decision, index) => ({
              id: `${sessionId}-decision-${index}`,
              type: "agent_message",
              occurredAt: new Date().toISOString(),
              payload: { content: `关键决策：${clean(decision, 1200)}` }
            })),
            ...(args.debtCandidate?.gapText ? [{
              id: `${sessionId}-debt-candidate`,
              type: "debt_candidate",
              occurredAt: new Date().toISOString(),
              payload: {
                gapText: clean(args.debtCandidate.gapText, 500),
                reason: clean(args.debtCandidate.reason, 1000),
                risk: clean(args.debtCandidate.risk, 1000),
                requiredEvidence: Array.isArray(args.debtCandidate.requiredEvidence) ? args.debtCandidate.requiredEvidence.slice(0, 8).map(item => clean(item, 300)) : []
              }
            }] : []),
            { id: `${sessionId}-finish`, type: "session_finished", occurredAt: new Date().toISOString(), payload: { outcome: "completed" } }
          ];
          const result = watchedSessionId
            ? await client.appendSessionEvents(sessionId, events)
            : await client.postEvents(events, {
              sessionId,
              externalSessionId: sessionId,
              sourceFingerprint: `mcp-capture:${sessionId}`,
              title: clean(args.task, 300)
            });
          return text({
            captured: true,
            project: result.project,
            sessionId: result.session?.session?.id || result.session?.id,
            workItem: result.workItem,
            artifacts: result.session?.artifacts?.length || 0,
            decisions: result.session?.decisions?.length || 0,
            candidates: result.analysis?.cognitiveDebtCandidates || [],
            candidateCount: result.analysis?.cognitiveDebtCandidates?.length || 0,
            nextStep: result.analysis?.cognitiveDebtCandidates?.length ? "调用 accept_debt_candidate 确认正式欠条" : "当前会话未生成符合门槛的欠条候选"
          });
        }
        case "accept_debt_candidate": {
          if (!clean(args.sessionId) || !Number.isInteger(args.candidateIndex) || args.candidateIndex < 0) return errorText("sessionId 和非负整数 candidateIndex 不能为空");
          const result = await client.acceptDebtCandidate(args.sessionId, args.candidateIndex);
          return text({ accepted: true, debt: result.debt, links: result.links || [] });
        }
        case "get_capture_status": {
          return text(captureState.getStatus());
        }
        case "generate_micro_check": {
          const context = await client.getAgentContext();
          const debt = (context.debts || []).find(item => item.id === args.debtId);
          if (!debt) return errorText(`未找到欠条 ${args.debtId}（请先调用 get_learning_context 获取欠条列表）`);
          return text({
            debtId: debt.id,
            gapText: debt.gapText,
            generatedBy: "template",
            estimatedSeconds: 90,
            questions: [
              `请用自己的话解释：${debt.gapText}`,
              "这个知识点如果理解错误，在当前项目里最可能造成什么具体故障？",
              "如果换一个相似但不同的场景，你会怎么处理？"
            ],
            caution: "模板生成的检查题，未经过 AI 质量评估；回答后请用 submit_learning_evidence 记录结果"
          });
        }
        case "submit_learning_evidence": {
          if (!clean(args.debtId) || !clean(args.evidenceType)) return errorText("debtId 和 evidenceType 不能为空");
          const result = await client.createEvidence(args.debtId, {
            evidenceType: clean(args.evidenceType, 50),
            evidenceLevel: /^E[0-5]$/.test(args.evidenceLevel || "") ? args.evidenceLevel : "E0",
            result: EVIDENCE_RESULTS.includes(args.result) ? args.result : "unverified",
            evidenceSummary: clean(args.evidenceSummary, 2000) || undefined
          });
          return text({ recorded: true, evidence: result.evidence });
        }
        default:
          return errorText(`未知工具 ${name}`);
      }
    } catch (error) {
      return errorText(error.message);
    }
  }

  return { definitions, callTool };
}
