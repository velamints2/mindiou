// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { generateClearanceReport, getReportStepPrompts, buildCapabilitySnapshot } from "../mvp0-report.js";

const SAMPLE_TEXT = `
I'm building a React app with Vite. The AI suggested using TypeScript for type safety.
I agreed because I don't know TypeScript well. The AI set up the entire project structure.
It chose useState for state management and useEffect for data fetching.
I wanted to use Firebase, but the AI said Supabase was better for this use case.
The AI wrote all the database queries and API routes. I'm not sure how the auth flow works.
It configured Tailwind CSS and created all the components. I just followed along.
The deployment is on Vercel, but I don't understand how the build pipeline works.
`;

function rolloutJsonl(entries: unknown[]) {
  return entries.map(entry => JSON.stringify(entry)).join("\n");
}

function rolloutMessage(role: string, text: string) {
  return {
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: "input_text", text }]
    }
  };
}

// ── Per-step mock outputs (pipeline calls chatFn 3 times: A → B → D) ──

const STEP_A = {
  artifactKind: "ai_chat",
  aiCompleted: [
    { item: "AI chose React with Vite as the frontend stack", evidence: "原文 'The AI suggested using TypeScript' 表明技术选型由 AI 提出。", isInference: false },
    { item: "AI recommended Supabase over Firebase", evidence: "原文 'the AI said Supabase was better' 表明替代方案由 AI 提出。", isInference: false },
    { item: "AI wrote all database queries and API routes", evidence: "原文 'The AI wrote all the database queries' 直接陈述。", isInference: false }
  ],
  userContributed: [
    { item: "User wanted to use Firebase initially", evidence: "原文 'I wanted to use Firebase' 是用户自己的偏好。", isInference: false },
    { item: "User agreed to TypeScript without understanding it", evidence: "原文 'I agreed because I don't know TypeScript well' 表明用户在不懂的情况下批准。", isInference: false }
  ],
  cognitiveProcessesOutsourced: [
    { process: "技术选型权衡", surfaceTask: "Supabase vs Firebase 的选择", whyItMatters: "产品负责人需要能判断数据层选型对成本和扩展性的影响", evidence: "用户提出 Firebase 后直接接受了 AI 的替代建议。", isInference: false }
  ],
  userCapability: {
    overall: "L2",
    dimensions: {
      productProblemFraming: { level: "L2", evidenceStatus: "partial", evidence: ["用户能提出要用 Firebase"], confidence: 0.6 },
      aiAgentSteering: { level: "L2", evidenceStatus: "partial", evidence: ["用户跟随 AI 步骤"], confidence: 0.6 },
      systemMentalModel: { level: "L1", evidenceStatus: "partial", evidence: ["不理解 auth flow"], confidence: 0.7 },
      technicalDecisionComprehension: { level: "L1", evidenceStatus: "partial", evidence: ["不懂 TypeScript 却同意"], confidence: 0.7 },
      validationAndQualityJudgment: { level: "L1", evidenceStatus: "unobserved", evidence: [], confidence: 0.3 }
    },
    currentDomain: "React web app with Supabase backend",
    strongestDemonstratedAbility: "跟随 AI 指令完成搭建",
    highestPriorityGrowthArea: "理解数据层与认证的技术决策",
    evidenceSignals: ["User approves AI execution without asking for implementation reasoning."],
    recommendedCardLevel: "foundation"
  }
};

const STEP_B = {
  dangerousGaps: [
    {
      rank: 1,
      title: "认证流程心智模型缺失",
      gap: "用户尚未证明自己理解 Supabase auth flow 的端到端过程",
      underlyingCapability: "系统心智模型",
      surfaceSignals: ["'not sure how the auth flow works'", "所有数据库查询都由 AI 编写"],
      whyDangerous: "无法判断认证是否安全，也无法排查登录故障",
      transferScenarios: ["下一个需要登录的产品", "任何接入第三方认证的项目"],
      confidence: 0.8,
      alternativeExplanations: ["用户可能只是还没看到这部分代码"],
      diagnosticQuestion: "请画出用户点击登录到拿到会话的完整数据流。",
      masteryCriteria: ["能说出 token 的签发与校验位置", "能指出会话存储在哪里"]
    },
    {
      rank: 2,
      title: "类型系统的验证能力缺失",
      gap: "用户尚未证明自己能判断 TypeScript 类型是否正确",
      underlyingCapability: "验证与质量判断",
      surfaceSignals: ["'I don't know TypeScript well' 却同意了选型", "构建管线不理解"],
      whyDangerous: "无法验收 AI 写的类型是否带来真实安全保障",
      transferScenarios: ["任何强类型语言项目"],
      confidence: 0.7,
      alternativeExplanations: ["用户可能计划后续再学"],
      diagnosticQuestion: "给一个函数签名，请说出它在编译期能防止什么错误。",
      masteryCriteria: ["能解释编译期与运行期类型检查的区别"]
    }
  ],
  cognitiveStructure: {
    facts: [
      { item: "Project uses React, Vite, TypeScript, Supabase, Vercel", evidence: "原文多处直接陈述", isInference: false }
    ],
    hypotheses: [
      { item: "Supabase may be over-provisioned for the project's needs", evidence: "inference", isInference: true, confidence: 0.5, alternativeExplanation: "项目可能确实需要 Auth + DB 一体化" }
    ],
    questions: [
      { item: "Is the auth flow using JWT or session cookies?", evidence: "材料未回答", isInference: true }
    ],
    decisions: [
      { item: "Use Supabase instead of Firebase", evidence: "AI 建议后用户接受", isInference: false, decisionOwner: "ai" }
    ],
    tradeoffs: [
      { item: "TypeScript safety vs learning curve", evidence: "inference", isInference: true }
    ]
  },
  confusionResolutions: []
};

const STEP_D = {
  feynmanCards: [
    { id: "card-1", target: "认证流程心智模型缺失", cardType: "system_map", prompt: "画出你的 app 从用户登录到访问数据库的完整数据流，标出 token 在哪里签发和校验。", targetLevel: "L2", difficulty: "foundation", evaluationCriteria: ["标出 token 签发位置", "标出会话存储位置"], userAnswer: "", aiFollowUp: "", answeredAt: null },
    { id: "card-2", target: "类型系统的验证能力缺失", cardType: "analogy", prompt: "用一个生活类比解释 TypeScript 编译期类型检查和运行期报错的区别。", targetLevel: "L2", difficulty: "foundation", evaluationCriteria: ["类比准确"], userAnswer: "", aiFollowUp: "", answeredAt: null },
    { id: "card-3", target: "认证流程心智模型缺失", cardType: "prediction", prompt: "如果 Supabase 的 JWT 密钥泄露，你的 app 会发生什么？攻击者能做什么？", targetLevel: "L2", difficulty: "intermediate", evaluationCriteria: ["指出伪造会话风险"], userAnswer: "", aiFollowUp: "", answeredAt: null }
  ],
  nextActions: [
    { item: "在 Supabase 文档中验证 auth flow 是 JWT 还是 session cookie", route: "verify", reason: "需要确认认证机制的真实实现", relatedCapability: "系统心智模型" },
    { item: "记录 Supabase vs Firebase 的选型判断", route: "note", reason: "可复用的技术决策模式", relatedCapability: "技术决策理解" },
    { item: "在本地跑一次 Vercel 构建", route: "task", reason: "理解构建管线行为", relatedCapability: "验证与质量判断" },
    { item: "向有经验的工程师请教 Supabase 是否适合这个规模", route: "ask", reason: "需要经验判断", relatedCapability: "技术决策理解" }
  ]
};

function mockPipeline(overrides: { stepA?: unknown; stepB?: unknown; stepD?: unknown } = {}) {
  return vi.fn()
    .mockResolvedValueOnce(overrides.stepA ?? STEP_A)
    .mockResolvedValueOnce(overrides.stepB ?? STEP_B)
    .mockResolvedValueOnce(overrides.stepD ?? STEP_D);
}

describe("generateClearanceReport (multi-step pipeline)", () => {
  describe("with mock AI success", () => {
    it("produces a normalized seven-section report from step outputs", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());

      expect(report.sections.aiCompleted.length).toBeGreaterThan(0);
      expect(report.sections.userContributed.length).toBeGreaterThan(0);
      expect(report.sections.cognitiveProcessesOutsourced.length).toBeGreaterThan(0);
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(report.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
      expect(report.sections.cognitiveStructure.facts.length).toBeGreaterThan(0);
      expect(report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
      expect(report.sections.feynmanCards.length).toBeLessThanOrEqual(5);
      expect(report.sections.nextActions.length).toBeGreaterThan(0);
    });

    it("calls chatFn three times — attribution, root gaps, cards", async () => {
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);
      expect(mockChatFn).toHaveBeenCalledTimes(3);
    });

    it("step A prompt covers attribution, outsourced processes, and capability calibration", async () => {
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const stepAMessages = mockChatFn.mock.calls[0][0];
      expect(stepAMessages[0].role).toBe("system");
      expect(stepAMessages[0].content).toContain("aiCompleted");
      expect(stepAMessages[0].content).toContain("userContributed");
      expect(stepAMessages[0].content).toContain("cognitiveProcessesOutsourced");
      expect(stepAMessages[0].content).toContain("userCapability");
    });

    it("step B prompt covers root gaps, cognitive structure, and confusion resolutions", async () => {
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const stepBSystem = mockChatFn.mock.calls[1][0][0].content;
      expect(stepBSystem).toContain("dangerousGaps");
      expect(stepBSystem).toContain("cognitiveStructure");
      expect(stepBSystem).toContain("confusionResolutions");
    });

    it("step D prompt covers feynman cards and next actions", async () => {
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const stepDSystem = mockChatFn.mock.calls[2][0][0].content;
      expect(stepDSystem).toContain("feynmanCards");
      expect(stepDSystem).toContain("nextActions");
    });

    it("passes truncated artifactText and preprocess metadata in the step A user message", async () => {
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const payload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(payload.artifactText).toContain("React app with Vite");
      expect(payload.artifactType).toBe("chatgpt");
      expect(payload.preprocess).toBeDefined();
    });

    it("threads timeline digest and user confusions into step B", async () => {
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn, {
        timeline: {
          steps: [
            { id: "step-1", title: "选型", keyConcepts: ["Supabase"], userConfusion: "为什么换掉 Firebase" }
          ]
        },
        confusions: [{ stepId: "step-1", stepTitle: "选型", text: "为什么换掉 Firebase" }]
      });

      const stepBPayload = JSON.parse(mockChatFn.mock.calls[1][0][1].content);
      expect(stepBPayload.timelineDigest).toHaveLength(1);
      expect(stepBPayload.timelineDigest[0].userConfusion).toBe("为什么换掉 Firebase");
      expect(stepBPayload.userConfusions).toHaveLength(1);
      expect(stepBPayload.confusionNote).toContain("1 条困惑");
    });

    it("tells step B to lower confidence when no user confusions exist", async () => {
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      const stepBPayload = JSON.parse(mockChatFn.mock.calls[1][0][1].content);
      expect(stepBPayload.userConfusions).toEqual([]);
      expect(stepBPayload.confusionNote).toContain("未提供用户困惑");
    });

    it("preserves confusionResolutions from step B", async () => {
      const stepB = {
        ...STEP_B,
        confusionResolutions: [
          { stepId: "step-1", confusion: "为什么换掉 Firebase", resolution: "gap", gapRank: 2, reason: "" },
          { stepId: "step-2", confusion: "页面为什么刷新", resolution: "not_capability_gap", gapRank: 0, reason: "属于操作疑问而非能力缺口" }
        ]
      };
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline({ stepB }));

      expect(report.confusionResolutions).toHaveLength(2);
      expect(report.confusionResolutions[0].resolution).toBe("gap");
      expect(report.confusionResolutions[0].gapRank).toBe(2);
      expect(report.confusionResolutions[1].resolution).toBe("not_capability_gap");
    });

    it("preserves AI-generated gaps with correct ranking", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      const ranks = report.sections.dangerousGaps.map(g => g.rank);
      expect(ranks).toEqual([1, 2]);
    });

    it("preserves root-capability gap fields", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      const gap = report.sections.dangerousGaps[0];
      expect(gap.title).toBe("认证流程心智模型缺失");
      expect(gap.surfaceSignals.length).toBeGreaterThanOrEqual(2);
      expect(gap.transferScenarios.length).toBeGreaterThanOrEqual(1);
      expect(gap.diagnosticQuestion).toContain("数据流");
      expect(gap.masteryCriteria.length).toBeGreaterThan(0);
      expect(gap.confidence).toBeGreaterThan(0);
    });

    it("preserves AI-generated feynman card prompts and cardType", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      expect(report.sections.feynmanCards[0].prompt).toContain("数据流");
      expect(report.sections.feynmanCards[0].cardType).toBe("system_map");
      expect(report.sections.feynmanCards[0].userAnswer).toBe("");
      expect(report.sections.feynmanCards[0].answeredAt).toBeNull();
    });

    it("preserves AI-generated next action routes", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      const routes = report.sections.nextActions.map(a => a.route);
      expect(routes).toContain("verify");
      expect(routes).toContain("note");
      expect(routes).toContain("task");
      expect(routes).toContain("ask");
      for (const action of report.sections.nextActions) {
        expect(action.reason).toBeTruthy();
      }
    });

    it("exposes capability analysis from step A", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      expect(report.analysis.artifactKind).toBe("ai_chat");
      expect(report.analysis.userCapability.overall).toBe("L2");
      expect(report.analysis.userCapability.dimensions.systemMentalModel.level).toBe("L1");
      expect(report.analysis.userCapability.dimensions.systemMentalModel.evidenceStatus).toBe("partial");
    });

    it("overrides input fields with controlled values", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "claude", mockPipeline());
      expect(report.input.artifactType).toBe("claude");
      expect(report.input.artifactText).toContain("React app with Vite");
      expect(report.input.charCount).toBeGreaterThan(0);
    });

    it("sets status to 'generated' and clears generation flags", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      expect(report.status).toBe("generated");
      expect(report.generation).toEqual({ fallback: false, error: "", failedStep: "" });
    });

    it("generates a report id", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      expect(report.id).toBeTruthy();
      expect(report.id.length).toBeGreaterThan(10);
    });

    it("normalizes step output that is missing fields", async () => {
      const stepB = {
        dangerousGaps: [{ gap: "only one gap", whyDangerous: "danger" }],
        cognitiveStructure: { facts: [{ item: "fact1" }] }
      };
      const stepD = {
        feynmanCards: [{ target: "only one gap", prompt: "explain it" }],
        nextActions: [{ item: "do something", route: "invalid-route" }]
      };
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline({ stepB, stepD }));

      // Single gap is padded to the 2-gap minimum
      expect(report.sections.dangerousGaps).toHaveLength(2);
      expect(report.sections.dangerousGaps[0].rank).toBe(1);
      // Missing hypothesis/decision arrays get filled
      expect(report.sections.cognitiveStructure.hypotheses).toEqual([]);
      expect(report.sections.cognitiveStructure.decisions).toEqual([]);
      // Single card is padded to the 3-card minimum
      expect(report.sections.feynmanCards).toHaveLength(3);
      expect(report.sections.feynmanCards[0].id).toBeTruthy();
      // Invalid route is normalized
      expect(report.sections.nextActions[0].route).toBe("task");
    });
  });

  describe("bounded research (step C)", () => {
    it("marks research skipped when no researchFn is provided", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline());
      expect(report.research.status).toBe("skipped");
      expect(report.research.sources).toEqual([]);
    });

    it("runs at most 3 queries derived from the root gaps", async () => {
      const researchFn = vi.fn().mockResolvedValue({
        sources: [{ title: "Supabase Auth docs", url: "https://supabase.com/docs/auth", snippet: "JWT based auth" }]
      });
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline(), { researchFn });

      expect(researchFn).toHaveBeenCalledTimes(2); // one per unique gap query (2 gaps)
      expect(report.research.status).toBe("ok");
      expect(report.research.queries).toHaveLength(2);
      expect(report.research.sources.length).toBeGreaterThan(0);
      expect(report.research.sources[0].url).toContain("supabase.com");
    });

    it("degrades transparently when research fails — the report still succeeds", async () => {
      const researchFn = vi.fn().mockRejectedValue(new Error("research provider down"));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline(), { researchFn });

      expect(report.generation.fallback).toBe(false);
      expect(report.research.status).toBe("unavailable");
      expect(report.research.sources).toEqual([]);
      expect(report.research.queries[0].error).toContain("research provider down");
    });

    it("applies a per-query timeout", async () => {
      const researchFn = vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(resolve, 5000)));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline(), {
        researchFn,
        researchTimeoutMs: 50
      });

      expect(report.research.status).toBe("unavailable");
      expect(report.research.queries[0].error).toContain("timeout");
    });

    it("threads research sources into step D", async () => {
      const researchFn = vi.fn().mockResolvedValue({
        sources: [{ title: "Docs", url: "https://example.com/docs", snippet: "snippet" }]
      });
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn, { researchFn });

      const stepDPayload = JSON.parse(mockChatFn.mock.calls[2][0][1].content);
      expect(stepDPayload.researchDigest.status).toBe("ok");
      expect(stepDPayload.researchDigest.sources[0].url).toContain("example.com");
    });
  });

  describe("with mock AI failure (fallback)", () => {
    it("falls back with failedStep=attribution when step A throws", async () => {
      const mockChatFn = vi.fn().mockRejectedValue(new Error("Network timeout"));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.generation.fallback).toBe(true);
      expect(report.generation.error).toBe("Network timeout");
      expect(report.generation.failedStep).toBe("attribution");
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(report.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
      for (const item of report.sections.aiCompleted) {
        expect(item.isInference).toBe(true);
      }
    });

    it("falls back with failedStep=root_gaps when step B throws", async () => {
      const mockChatFn = vi.fn()
        .mockResolvedValueOnce(STEP_A)
        .mockRejectedValueOnce(new Error("step B exploded"));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.generation.failedStep).toBe("root_gaps");
      expect(report.generation.error).toBe("step B exploded");
    });

    it("falls back with failedStep=cards when step D throws", async () => {
      const mockChatFn = vi.fn()
        .mockResolvedValueOnce(STEP_A)
        .mockResolvedValueOnce(STEP_B)
        .mockRejectedValueOnce(new Error("step D exploded"));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.generation.failedStep).toBe("cards");
      expect(report.generation.error).toBe("step D exploded");
    });

    it("falls back when a step returns a __fallback marker", async () => {
      const mockChatFn = vi.fn().mockResolvedValue({
        __fallback: true,
        __fallbackError: "OPENAI_API_KEY is not set"
      });
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.generation.fallback).toBe(true);
      expect(report.generation.error).toBe("OPENAI_API_KEY is not set");
      expect(report.generation.failedStep).toBe("attribution");
    });

    it("falls back when a step returns malformed output", async () => {
      const mockChatFn = vi.fn().mockResolvedValue("not an object");
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);
      expect(report.generation.fallback).toBe(true);
      expect(report.generation.error).toContain("malformed");
    });

    it("falls back when step B output misses dangerousGaps", async () => {
      const mockChatFn = vi.fn()
        .mockResolvedValueOnce(STEP_A)
        .mockResolvedValueOnce({ cognitiveStructure: {} });
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      expect(report.generation.fallback).toBe(true);
      expect(report.generation.failedStep).toBe("root_gaps");
    });

    it("fallback report has all nextActions with valid routes", async () => {
      const mockChatFn = vi.fn().mockRejectedValue(new Error("AI down"));
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);

      for (const action of report.sections.nextActions) {
        expect(["verify", "note", "task", "ask"]).toContain(action.route);
        expect(action.reason).toBeTruthy();
      }
    });
  });

  describe("without chatFn (fallback only)", () => {
    it("generates fallback report when chatFn is null", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", null);
      expect(report.generation.fallback).toBe(true);
      expect(report.generation.failedStep).toBe("attribution");
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(report.sections.feynmanCards.length).toBeGreaterThanOrEqual(3);
    });

    it("generates fallback report when chatFn is undefined", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt");
      expect(report.generation.fallback).toBe(true);
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("input handling", () => {
    it("truncates artifactText to 30000 characters", async () => {
      const longText = "x".repeat(40000);
      const mockChatFn = mockPipeline();
      await generateClearanceReport(longText, "chatgpt", mockChatFn);

      const payload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(payload.artifactText.length).toBe(30000);
    });

    it("uses structured compression for rollout JSONL before sending the prompt", async () => {
      const raw = rolloutJsonl([
        { type: "session_meta", payload: { id: "session-3", cwd: "/workspace" } },
        rolloutMessage("user", "请先调查 API 24 路线。"),
        rolloutMessage("assistant", "API 24 早期调查。".repeat(4000)),
        rolloutMessage("user", "切到 API 26 VM 做最终验证。"),
        rolloutMessage("assistant", "最终结果：API 26 VM 已通过 HAP 构建、hdc 安装、aa start 启动。仍需区分 VM 验收与真机验收。")
      ]);
      const mockChatFn = mockPipeline();

      const report = await generateClearanceReport(raw, "codex", mockChatFn);

      const payload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(payload.preprocess.strategy).toBe("rollout-jsonl-structured");
      expect(payload.preprocess.didCompress).toBe(true);
      expect(payload.artifactText).toContain("Structured Compression");
      expect(payload.artifactText).toContain("API 26 VM 已通过");
      expect(payload.artifactText.length).toBeLessThanOrEqual(30000);
      expect(report.input.preprocess.strategy).toBe("rollout-jsonl-structured");
    });

    it("defaults invalid artifactType to 'other'", async () => {
      const report = await generateClearanceReport(SAMPLE_TEXT, "invalid-type", mockPipeline());
      expect(report.input.artifactType).toBe("other");
    });

    it("handles empty text gracefully", async () => {
      const report = await generateClearanceReport("", "other", mockPipeline());
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(report.sections.dangerousGaps.length).toBeLessThanOrEqual(4);
    });

    it("handles short text gracefully", async () => {
      const report = await generateClearanceReport("AI wrote a function.", "codex", mockPipeline());
      expect(report.sections.dangerousGaps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("step prompts", () => {
    it("exposes all three step prompts", () => {
      const prompts = getReportStepPrompts();
      expect(prompts.attribution).toBeTruthy();
      expect(prompts.rootGaps).toBeTruthy();
      expect(prompts.cards).toBeTruthy();
    });

    it("attribution prompt defines the five capability dimensions and evidence statuses", () => {
      const { attribution } = getReportStepPrompts();
      expect(attribution).toContain("productProblemFraming");
      expect(attribution).toContain("aiAgentSteering");
      expect(attribution).toContain("systemMentalModel");
      expect(attribution).toContain("technicalDecisionComprehension");
      expect(attribution).toContain("validationAndQualityJudgment");
      expect(attribution).toContain("proven");
      expect(attribution).toContain("partial");
      expect(attribution).toContain("unobserved");
      expect(attribution).toContain("misconception");
    });

    it("attribution prompt forbids treating the user checklist as AI work and copying source as evidence", () => {
      const { attribution } = getReportStepPrompts();
      expect(attribution).toContain("严禁把用户的验收清单条目当作 AI 完成的工作");
      expect(attribution).toContain("evidence 不得照抄原文");
    });

    it("does not assume the user's profession or technical background", () => {
      const prompts = getReportStepPrompts();
      expect(prompts.attribution).toContain("只根据材料中的明确证据判断用户的职业");
      expect(prompts.attribution).toContain("不得补全或默认任何身份");
      expect(prompts.cards).toContain("不得预设写代码或不写代码");
      for (const prompt of Object.values(prompts)) {
        expect(prompt).not.toContain("产品经理");
        expect(prompt).not.toContain("产品负责人");
        expect(prompt).not.toContain("创业者");
      }
    });

    it("root-gaps prompt requires 2-4 root gaps with transfer, verification, and mastery criteria", () => {
      const { rootGaps } = getReportStepPrompts();
      expect(rootGaps).toContain("2-4");
      expect(rootGaps).toContain("surfaceSignals");
      expect(rootGaps).toContain("transferScenarios");
      expect(rootGaps).toContain("diagnosticQuestion");
      expect(rootGaps).toContain("masteryCriteria");
    });

    it("root-gaps prompt makes user confusions first-class input", () => {
      const { rootGaps } = getReportStepPrompts();
      expect(rootGaps).toContain("用户亲手标注的每一条困惑");
      expect(rootGaps).toContain("confusionResolutions");
    });

    it("cards prompt specifies 3-5 cards with cardType and evaluationCriteria", () => {
      const { cards } = getReportStepPrompts();
      expect(cards).toContain("3-5");
      expect(cards).toContain("system_map");
      expect(cards).toContain("analogy");
      expect(cards).toContain("prediction");
      expect(cards).toContain("decision_explanation");
      expect(cards).toContain("comparison");
      expect(cards).toContain("transfer");
      expect(cards).toContain("validation_design");
      expect(cards).toContain("evaluationCriteria");
    });

    it("cards prompt lists all four action routes", () => {
      const { cards } = getReportStepPrompts();
      expect(cards).toContain("verify");
      expect(cards).toContain("note");
      expect(cards).toContain("task");
      expect(cards).toContain("ask");
    });
  });

  // ── Three-layer capability snapshot (priorProfile) ──

  describe("buildCapabilitySnapshot (three-layer aggregation)", () => {
    it("returns an empty snapshot when no history exists (cold start)", () => {
      const snap = buildCapabilitySnapshot({ reports: [], capabilityProfiles: [], userId: "u1" });
      expect(snap.schemaVersion).toBe("capability_snapshot_v1");
      expect(snap.layers.L1_ai_collaboration.available).toBe(false);
      expect(snap.layers.L2_domain.available).toBe(false);
      expect(snap.layers.L3_knowledge_points.available).toBe(false);
      expect(snap.rules.length).toBeGreaterThan(0);
    });

    it("aggregates L1 from historical reports' userCapability dimensions", () => {
      const reports = [
        {
          analysis: {
            userCapability: {
              overall: "L2",
              dimensions: {
                productProblemFraming: { level: "L3", evidenceStatus: "proven", confidence: 0.8 },
                aiAgentSteering: { level: "L2", evidenceStatus: "partial", confidence: 0.6 }
              }
            }
          },
          generation: { fallback: false }
        },
        {
          analysis: {
            userCapability: {
              overall: "L3",
              dimensions: {
                productProblemFraming: { level: "L3", evidenceStatus: "proven", confidence: 0.9 },
                aiAgentSteering: { level: "L1", evidenceStatus: "partial", confidence: 0.5 }
              }
            }
          },
          generation: { fallback: false }
        }
      ];
      const snap = buildCapabilitySnapshot({ reports, capabilityProfiles: [], userId: "u1" });
      expect(snap.layers.L1_ai_collaboration.available).toBe(true);
      expect(snap.layers.L1_ai_collaboration.reportCount).toBe(2);
      const l1 = snap.layers.L1_ai_collaboration.dimensions;
      // productProblemFraming observed L3 twice → inferredLevel L3
      expect(l1.productProblemFraming.inferredLevel).toBe("L3");
      expect(l1.productProblemFraming.observationCount).toBe(2);
      expect(l1.productProblemFraming.commonEvidenceStatus).toBe("proven");
      // aiAgentSteering observed L2 then L1 → mode picks first in tie; both appear once
      expect(["L1", "L2"]).toContain(l1.aiAgentSteering.inferredLevel);
    });

    it("excludes fallback reports from L1 aggregation", () => {
      const reports = [
        {
          analysis: { userCapability: { dimensions: { productProblemFraming: { level: "L4", evidenceStatus: "proven", confidence: 0.9 } } } },
          generation: { fallback: true }
        }
      ];
      const snap = buildCapabilitySnapshot({ reports, capabilityProfiles: [], userId: "u1" });
      expect(snap.layers.L1_ai_collaboration.available).toBe(false);
    });

    it("aggregates L2 (domain overall) and L3 (knowledge-point dimensions) from capabilityProfiles", () => {
      const profiles = [
        {
          userId: "u1",
          domain: "database",
          dimensions: {
            conceptualUnderstanding: { score: 80, level: "L3", stability: "stable", evidence: [{ source: "user_verified" }, { source: "user_verified" }, { source: "model_inferred" }] },
            causalExplanation: { score: 60, level: "L2", stability: "one_shot", evidence: [{ source: "model_inferred" }] }
          },
          updatedAt: "2026-08-01T00:00:00Z"
        },
        {
          userId: "u1",
          domain: "frontend",
          dimensions: {
            conceptualUnderstanding: { score: 40, level: "L2", stability: "one_shot", evidence: [{ source: "model_inferred" }] }
          },
          updatedAt: "2026-08-02T00:00:00Z"
        }
      ];
      const snap = buildCapabilitySnapshot({ reports: [], capabilityProfiles: profiles, userId: "u1" });
      // L2
      expect(snap.layers.L2_domain.available).toBe(true);
      const dbL2 = snap.layers.L2_domain.domains.find(d => d.domain === "database");
      expect(dbL2).toBeDefined();
      expect(dbL2.overallScore).toBe(70); // (80+60)/2
      expect(dbL2.stability).toBe("stable"); // 1 of 2 stable → >= half
      expect(dbL2.userVerifiedEvidenceCount).toBe(2);
      // L3
      expect(snap.layers.L3_knowledge_points.available).toBe(true);
      const dbL3 = snap.layers.L3_knowledge_points.domains.find(d => d.domain === "database");
      expect(dbL3.dimensions.conceptualUnderstanding.score).toBe(80);
      expect(dbL3.dimensions.conceptualUnderstanding.stability).toBe("stable");
      expect(dbL3.dimensions.causalExplanation.stability).toBe("one_shot");
    });

    it("filters capabilityProfiles by userId", () => {
      const profiles = [
        { userId: "u1", domain: "db", dimensions: { conceptualUnderstanding: { score: 50, level: "L2", stability: "one_shot", evidence: [] } } },
        { userId: "u2", domain: "db", dimensions: { conceptualUnderstanding: { score: 90, level: "L4", stability: "stable", evidence: [] } } }
      ];
      const snap = buildCapabilitySnapshot({ reports: [], capabilityProfiles: profiles, userId: "u1" });
      expect(snap.layers.L2_domain.domains.length).toBe(1);
      expect(snap.layers.L2_domain.domains[0].domain).toBe("db");
      expect(snap.layers.L2_domain.domains[0].overallScore).toBe(50);
    });

    it("rules explicitly state material evidence overrides prior", () => {
      const snap = buildCapabilitySnapshot({ reports: [], capabilityProfiles: [], userId: "u1" });
      const rulesText = snap.rules.join(" ");
      expect(rulesText).toContain("overrides");
      expect(rulesText).toContain("L1");
      expect(rulesText).toContain("L2");
      expect(rulesText).toContain("L3");
    });
  });

  describe("generateClearanceReport with priorProfile", () => {
    it("cold start (no priorProfile) does not add priorProfile field and does not inject hint", async () => {
      const mockChatFn = mockPipeline();
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn);
      expect(report.priorProfile).toBeUndefined();
      // Step A hint should not contain the prior profile marker
      const stepApayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(stepApayload.hint).not.toContain("历史能力先验");
    });

    it("injects three-layer prior hint into Step A when priorProfile is provided", async () => {
      const priorProfile = buildCapabilitySnapshot({
        reports: [{
          analysis: { userCapability: { overall: "L2", dimensions: { productProblemFraming: { level: "L3", evidenceStatus: "proven", confidence: 0.8 } } } },
          generation: { fallback: false }
        }],
        capabilityProfiles: [{
          userId: "u1",
          domain: "database",
          dimensions: { conceptualUnderstanding: { score: 70, level: "L3", stability: "stable", evidence: [{ source: "user_verified" }, { source: "user_verified" }] } }
        }],
        userId: "u1"
      });
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn, { priorProfile });
      const stepApayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(stepApayload.hint).toContain("历史能力先验");
      expect(stepApayload.hint).toContain("L1");
      expect(stepApayload.hint).toContain("L2");
      expect(stepApayload.hint).toContain("L3");
      // Rule: material evidence overrides prior
      expect(stepApayload.hint).toContain("本次材料证据优先");
    });

    it("attaches priorProfile snapshot to the generated report", async () => {
      const priorProfile = buildCapabilitySnapshot({
        reports: [],
        capabilityProfiles: [{
          userId: "u1",
          domain: "db",
          dimensions: { conceptualUnderstanding: { score: 60, level: "L2", stability: "one_shot", evidence: [] } }
        }],
        userId: "u1"
      });
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockPipeline(), { priorProfile });
      expect(report.priorProfile).toBeDefined();
      expect(report.priorProfile.schemaVersion).toBe("capability_snapshot_v1");
      expect(report.priorProfile.layers.L2_domain.available).toBe(true);
    });

    it("attaches priorProfile to fallback report when AI is unavailable", async () => {
      const priorProfile = buildCapabilitySnapshot({
        reports: [],
        capabilityProfiles: [{
          userId: "u1",
          domain: "db",
          dimensions: { conceptualUnderstanding: { score: 60, level: "L2", stability: "one_shot", evidence: [] } }
        }],
        userId: "u1"
      });
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", null, { priorProfile });
      expect(report.generation.fallback).toBe(true);
      expect(report.priorProfile).toBeDefined();
      expect(report.priorProfile.layers.L2_domain.available).toBe(true);
    });

    it("ignores invalid priorProfile (wrong schema) and behaves as cold start", async () => {
      const mockChatFn = mockPipeline();
      const report = await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn, {
        priorProfile: { schemaVersion: "wrong", layers: {} }
      });
      expect(report.priorProfile).toBeUndefined();
      const stepApayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(stepApayload.hint).not.toContain("历史能力先验");
    });

    it("does not pass priorProfile to Step B or Step D payloads", async () => {
      const priorProfile = buildCapabilitySnapshot({
        reports: [],
        capabilityProfiles: [{
          userId: "u1",
          domain: "db",
          dimensions: { conceptualUnderstanding: { score: 60, level: "L2", stability: "one_shot", evidence: [] } }
        }],
        userId: "u1"
      });
      const mockChatFn = mockPipeline();
      await generateClearanceReport(SAMPLE_TEXT, "chatgpt", mockChatFn, { priorProfile });
      const stepBpayload = JSON.parse(mockChatFn.mock.calls[1][0][1].content);
      const stepDpayload = JSON.parse(mockChatFn.mock.calls[2][0][1].content);
      expect(JSON.stringify(stepBpayload)).not.toContain("历史能力先验");
      expect(JSON.stringify(stepDpayload)).not.toContain("历史能力先验");
    });
  });
});
