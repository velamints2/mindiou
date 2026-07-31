// @ts-nocheck
import { describe, expect, it, vi } from "vitest";
import { generateClearanceReport, getReportStepPrompts } from "../mvp0-report.js";

/**
 * Golden sample test (multi-step pipeline): simulates a real
 * ai_workflow_transcript where the user gives acceptance criteria,
 * Trae audits and fixes issues, tests pass, and a commit is generated.
 *
 * This test verifies that the pipeline prompts and report generation:
 * - Attribute AI-completed work to AI, not to the user
 * - Attribute user-contributed criteria to the user, not to AI
 * - Generate root-capability understanding debts, not bug lists
 * - Generate Feynman cards about understanding, not about bugs
 * - Calibrate user capability in step A before gaps/cards
 */

const GOLDEN_SAMPLE_WORKFLOW = `
用户：现在进入验收模式，不要新增功能，不要重构。

请检查当前 MVP-0 是否满足以下完整路径：
1. 用户打开 report.html
2. 用户输入 artifactText
3. 用户选择 artifactType
4. 点击 Generate Report
5. 后端生成 six-section cognitive-debt clearance report
6. 页面展示六个 sections
7. dangerousGaps 正好 5 个
8. feynmanCards 为 3-5 个
9. 用户回答一张 Feynman card
10. 系统返回 AI follow-up
11. nextActions 每项都有 route 和 reason
12. report 被持久化
13. 刷新页面后不会导致核心数据丢失
14. AI API 不可用时 fallback report 仍可演示
15. existing vertical-slice flow 没有被破坏

Trae：验收分析完成。

Passed Items (11/15):
1. 用户打开 report.html — report.html 存在，加载 reportApp.ts
2. 用户输入 artifactText — textarea 带 placeholder
3. 点击 Generate Report — 按钮带 loading 状态
4. 后端生成 six-section report — server.js 调用 generateClearanceReport
5. 页面展示六个 sections — 调用六个 render 函数
9. 用户回答 Feynman card — textarea + Submit 按钮
10. 系统返回 AI follow-up — 调用 feynmanFollowUp
12. report 被持久化 — mvp0Store.saveReport 原子写入
14. AI 不可用时 fallback 仍可演示 — chatFn=null 时走 fallback
15. existing vertical-slice 未被破坏 — 177 项测试全绿

Failed Items (1/15):
13. 刷新页面后数据丢失 — state 纯内存，无 localStorage，无 onload 回调

Risky Items (3 项):
1. AI 模式下 dangerousGaps 不保证恰好 5 个
2. AI 模式下 feynmanCards 不保证 3-5 个
3. API_BASE 为空字符串，dev 模式跨端口

最小修复建议：
1. sessionStorage 存 report id，页面加载时调用 GET /api/mvp0/reports/:id 恢复
2. normalizeGapArray pad 到 5、truncate 到 5
3. normalizeCardArray pad 到 3、truncate 到 5
4. Vite proxy /api 到 localhost:8793

用户：执行吧

Trae：四项验收修复全部完成。
- sessionStorage 存 report id，restoreReport() 调用 GET /api/mvp0/reports/:id
- normalizeGapArray 强制 5 个 gaps
- normalizeCardArray 强制 3-5 张 cards
- Vite dev proxy /api 和 /health 到 localhost:8793

测试结果：181 项测试全绿（+4 项新测试）
Git commit: 7e3da11
`;

// ── Per-step mock outputs following the diagnostic-teacher rules ──

const GOLDEN_STEP_A = {
  artifactKind: "ai_workflow_transcript",
  aiCompleted: [
    { item: "Trae 完成验收审计，逐项检查 15 条验收路径", evidence: "原文中 Trae 输出了 Passed/Failed/Risky 分析，这是 AI 执行的审计工作，不是用户设定的标准。", isInference: false },
    { item: "Trae 识别出 1 项 Failed 和 3 项 Risky", evidence: "原文中 Trae 标注了 'Failed Items (1/15)' 和 'Risky Items (3 项)'，这是 AI 的分析结果。", isInference: false },
    { item: "Trae 提出四项最小修复建议", evidence: "原文中 Trae 列出了 '最小修复建议' 四条，这是 AI 提出的方案。", isInference: false },
    { item: "Trae 执行了四项修复：sessionStorage 恢复、gap/card normalization、Vite proxy", evidence: "原文中 Trae 输出 '四项验收修复全部完成' 并列出具体修改，这是 AI 执行的代码修改。", isInference: false },
    { item: "Trae 增加测试并确认 181 项全绿", evidence: "原文中 Trae 报告 '181 项测试全绿（+4 项新测试）'，这是 AI 运行测试的结果。", isInference: false },
    { item: "Trae 生成 git commit 7e3da11", evidence: "原文末尾 'Git commit: 7e3da11' 是 AI 生成的提交记录。", isInference: false }
  ],
  userContributed: [
    { item: "用户要求进入验收模式，禁止新增功能和重构", evidence: "原文 '现在进入验收模式，不要新增功能，不要重构' 是用户的指令，不是 AI 的工作。", isInference: false },
    { item: "用户提供了 15 项验收标准", evidence: "原文列出了 15 条编号验收项，这是用户设定的标准，不是 AI 完成的工作。", isInference: false },
    { item: "用户批准执行修复", evidence: "原文 '执行吧' 是用户的确认指令，授权 AI 进行修改。", isInference: false },
    { item: "用户拥有最终判断权", evidence: "用户设定验收标准并要求验收模式，表明用户保留对输出质量的最终判断。", isInference: true }
  ],
  cognitiveProcessesOutsourced: [
    { process: "验收判断", surfaceTask: "检查 MVP-0 是否满足 15 条路径", whyItMatters: "产品负责人需要能独立判断产出是否达标，而不是依赖 AI 自评", evidence: "用户把验收审计整个交给 Trae 执行并直接接受结果。", isInference: false },
    { process: "边界条件推理", surfaceTask: "sessionStorage 恢复机制的失败条件", whyItMatters: "不理解恢复边界就无法在 demo 翻车现场定位问题", evidence: "Trae 实现了恢复机制，但用户没有追问它在什么条件下会失败。", isInference: true },
    { process: "质量语义判断", surfaceTask: "把 181 项测试全绿当作验收通过", whyItMatters: "测试全绿只证明代码行为符合断言，不证明产品语义正确", evidence: "用户验收时 15 项全通过但报告的语义质量未被独立检查。", isInference: true }
  ],
  userCapability: {
    overall: "mixed",
    dimensions: {
      productProblemFraming: { level: "L3", evidenceStatus: "proven", evidence: ["用户能定义 15 条验收标准"], confidence: 0.85 },
      aiAgentSteering: { level: "L4", evidenceStatus: "proven", evidence: ["用户设定验收模式约束并批准执行"], confidence: 0.85 },
      systemMentalModel: { level: "L1", evidenceStatus: "partial", evidence: ["未解释 sessionStorage 恢复边界"], confidence: 0.6 },
      technicalDecisionComprehension: { level: "L1", evidenceStatus: "partial", evidence: ["未区分 dev proxy 与生产部署"], confidence: 0.6 },
      validationAndQualityJudgment: { level: "L1", evidenceStatus: "partial", evidence: ["把测试全绿等同于验收通过"], confidence: 0.65 }
    },
    currentDomain: "MindIOU MVP-0 development / Node.js web app",
    strongestDemonstratedAbility: "定义验收标准并有效指挥 AI 执行",
    highestPriorityGrowthArea: "独立验证与边界条件判断",
    evidenceSignals: [
      "User defined acceptance criteria but did not mention implementation files, commands, or APIs.",
      "User approved execution without asking for implementation reasoning ('执行吧')."
    ],
    recommendedCardLevel: "foundation"
  }
};

const GOLDEN_STEP_B = {
  dangerousGaps: [
    {
      rank: 1,
      title: "验证边界心智模型缺失",
      gap: "用户尚未证明自己理解恢复/代理等机制在什么边界条件下会失效",
      underlyingCapability: "系统心智模型",
      surfaceSignals: ["sessionStorage 恢复机制由 AI 实现且用户未追问边界", "Vite proxy 被当作问题修复而未区分 dev/prod"],
      whyDangerous: "产品负责人在 demo 或部署现场遇到恢复失败时无法定位问题，也无法向评委解释方案边界",
      transferScenarios: ["任何依赖浏览器存储的 demo 产品", "任何需要区分开发与生产环境的部署"],
      confidence: 0.8,
      alternativeExplanations: ["用户可能只是还没走到需要解释边界的演示环节"],
      diagnosticQuestion: "请说出 sessionStorage 恢复方案会失效的三种具体条件。",
      masteryCriteria: ["能列举 sessionStorage 被清除、跨标签页、服务端数据删除三种失败条件", "能说明 dev proxy 为什么不解决生产同源问题"]
    },
    {
      rank: 2,
      title: "测试语义判断能力缺失",
      gap: "用户尚未证明自己理解测试全绿与产品语义正确之间的区别",
      underlyingCapability: "验证与质量判断",
      surfaceSignals: ["把 181 项测试全绿当作验收通过的证据", "验收清单只检查行为存在性，未检查报告语义质量"],
      whyDangerous: "产品负责人会把'代码按断言运行'误当作'产品做了正确的事'，在评审时暴露",
      transferScenarios: ["任何 AI 生成内容的验收", "任何需要区分行为测试与语义验收的产品评审"],
      confidence: 0.75,
      alternativeExplanations: ["用户可能计划在 demo 前另行人工检查语义"],
      diagnosticQuestion: "181 项测试全绿证明了什么？没有证明什么？",
      masteryCriteria: ["能说清行为断言与语义质量的差别", "能设计一个验证报告语义质量的检查"]
    },
    {
      rank: 3,
      title: "Schema 保障的工程判断缺失",
      gap: "用户尚未证明自己理解为什么 schema 保障需要 prompt 与代码双重机制",
      underlyingCapability: "技术决策理解",
      surfaceSignals: ["normalizeGapArray 的 pad/truncate 由 AI 实现", "用户未说明为什么只改 prompt 不够"],
      whyDangerous: "产品负责人会过度依赖 prompt 指令，在 AI 不遵守指令时没有防线",
      transferScenarios: ["任何依赖 LLM 结构化输出的产品"],
      confidence: 0.7,
      alternativeExplanations: ["用户可能默认工程实现都该如此，只是没有显式表达"],
      diagnosticQuestion: "如果只依赖 prompt 告诉 AI 返回 5 个 gap，会有什么风险？",
      masteryCriteria: ["能说出 prompt 是指导、代码是兜底的分工", "能指出一个 prompt 失效的真实场景"]
    }
  ],
  cognitiveStructure: {
    facts: [
      { item: "系统有 181 项测试全部通过", evidence: "原文 '181 项测试全绿'", isInference: false },
      { item: "Git commit hash 是 7e3da11", evidence: "原文 'Git commit: 7e3da11'", isInference: false }
    ],
    hypotheses: [
      { item: "用户可能认为测试全绿就意味着产品可以 demo", evidence: "用户在验收通过后准备 demo，但未检查语义质量", isInference: true, confidence: 0.6, alternativeExplanation: "用户可能只是把语义检查放在 demo 排练环节" }
    ],
    questions: [
      { item: "用户是否理解 sessionStorage 恢复机制在什么条件下会失败？", evidence: "用户未在验收中说明恢复机制的边界", isInference: true }
    ],
    decisions: [
      { item: "进入验收模式并禁止新增功能", evidence: "原文用户指令", isInference: false, decisionOwner: "user" },
      { item: "同时修改 prompt 和 normalization 代码", evidence: "Trae 的修复同时包含两类", isInference: false, decisionOwner: "ai" }
    ],
    tradeoffs: [
      { item: "prompt 指令 vs 代码强制：prompt 指导 AI 行为，代码保证 schema，放弃任何一边都会增加失控面", evidence: "Trae 的修复同时包含两类", isInference: true }
    ]
  },
  confusionResolutions: []
};

const GOLDEN_STEP_D = {
  feynmanCards: [
    { id: "card-1", target: "验证边界心智模型缺失", cardType: "prediction", prompt: "为什么只保存 report id 到 sessionStorage 就能在刷新后恢复报告？这个方案在什么条件下会失败？", targetLevel: "L2", difficulty: "intermediate", evaluationCriteria: ["说出 report id + 服务端存储的配合关系", "列举至少两种失败条件"], userAnswer: "", aiFollowUp: "", answeredAt: null },
    { id: "card-2", target: "Schema 保障的工程判断缺失", cardType: "comparison", prompt: "为什么 normalizeGapArray 需要同时 pad 和 truncate？如果只依赖 prompt 告诉 AI 返回 5 个 gap，会有什么风险？", targetLevel: "L2", difficulty: "intermediate", evaluationCriteria: ["区分 prompt 指导与代码兜底", "举出一个 prompt 失效场景"], userAnswer: "", aiFollowUp: "", answeredAt: null },
    { id: "card-3", target: "测试语义判断能力缺失", cardType: "decision_explanation", prompt: "181 项测试全绿验证了什么，没有验证什么？为什么它不能证明报告在做认知债务分析？", targetLevel: "L2", difficulty: "foundation", evaluationCriteria: ["区分行为断言与语义质量"], userAnswer: "", aiFollowUp: "", answeredAt: null },
    { id: "card-4", target: "验证边界心智模型缺失", cardType: "transfer", prompt: "为什么 Vite proxy 修的是开发环境问题，而不是生产部署问题？如果部署到生产环境，还需要做什么？", targetLevel: "L2", difficulty: "intermediate", evaluationCriteria: ["说出 dev proxy 只在开发服务器生效", "指出生产需要同源或反向代理配置"], userAnswer: "", aiFollowUp: "", answeredAt: null }
  ],
  nextActions: [
    { item: "验证 sessionStorage 恢复机制在多种边界条件下的行为（清除缓存、跨标签页、服务端数据删除）", route: "verify", reason: "需要确认恢复机制在边界条件下是否仍然有效", relatedCapability: "系统心智模型" },
    { item: "记录 prompt + normalization 双重保障的工程判断到项目记忆", route: "note", reason: "这个'prompt 指导 + 代码强制'的模式有复用价值", relatedCapability: "技术决策理解" },
    { item: "补充 golden sample 测试，验证 AI 报告的语义质量而非仅 schema 合规", route: "task", reason: "当前测试只验证 schema，未验证报告是否在做认知债务分析", relatedCapability: "验证与质量判断" },
    { item: "向有经验的工程师请教 AI prompt 工程中如何防止'文本摘要替代语义分析'的问题", route: "ask", reason: "这是一个需要经验判断的 prompt 设计问题", relatedCapability: "验证与质量判断" }
  ]
};

function mockGoldenPipeline() {
  return vi.fn()
    .mockResolvedValueOnce(GOLDEN_STEP_A)
    .mockResolvedValueOnce(GOLDEN_STEP_B)
    .mockResolvedValueOnce(GOLDEN_STEP_D);
}

describe("Golden sample: ai_workflow_transcript (multi-step pipeline)", () => {
  describe("step prompt quality", () => {
    it("attribution prompt contains artifact interpretation and role attribution rules", () => {
      const { attribution } = getReportStepPrompts();
      expect(attribution).toContain("ai_workflow_transcript");
      expect(attribution).toContain("ai_coding_log");
      expect(attribution).toContain("unknown");
      expect(attribution).toContain("aiCompleted 只列 AI/助手实际完成的工作");
      expect(attribution).toContain("userContributed 只列用户真实提供的东西");
    });

    it("attribution prompt forbids checklist-as-AI-work and source-copy evidence", () => {
      const { attribution } = getReportStepPrompts();
      expect(attribution).toContain("严禁把用户的验收清单条目当作 AI 完成的工作");
      expect(attribution).toContain("evidence 不得照抄原文");
      expect(attribution).toContain("isInference: true");
    });

    it("attribution prompt requires capability calibration before later steps", () => {
      const { attribution } = getReportStepPrompts();
      expect(attribution).toContain("productProblemFraming");
      expect(attribution).toContain("aiAgentSteering");
      expect(attribution).toContain("systemMentalModel");
      expect(attribution).toContain("technicalDecisionComprehension");
      expect(attribution).toContain("validationAndQualityJudgment");
      expect(attribution).toContain("先判断维度等级，再生成后续内容");
    });

    it("root-gaps prompt requires understanding debts, not bug lists", () => {
      const { rootGaps } = getReportStepPrompts();
      expect(rootGaps).toContain("缺口不是 Bug 列表");
      expect(rootGaps).toContain("已识别+已修复+已测试");
      expect(rootGaps).toContain("验证债务");
    });

    it("root-gaps prompt requires evidence-status discipline", () => {
      const { attribution } = getReportStepPrompts();
      expect(attribution).toContain("proven");
      expect(attribution).toContain("partial");
      expect(attribution).toContain("unobserved");
      expect(attribution).toContain("misconception");
      expect(attribution).toContain("不得把“没有提到”等同于“不会”");
    });

    it("cards prompt requires understanding tests mapped to gaps", () => {
      const { cards } = getReportStepPrompts();
      expect(cards).toContain("每张卡必须映射到一个根能力缺口");
      expect(cards).toContain("卡片测的是心智模型，不是术语记忆");
      expect(cards).toContain("按用户当前水平 +1 出题");
    });

    it("shared preamble defines the diagnostic-teacher stance", () => {
      const prompts = getReportStepPrompts();
      const { attribution } = prompts;
      expect(attribution).toContain("诊断型教师");
      expect(attribution).toContain("只根据材料中的明确证据判断用户的职业");
      expect(attribution).toContain("证据不足时统一称为“用户”");
      expect(attribution).toContain("已解决的具体问题");
      expect(attribution).toContain("不羞辱用户");
      for (const prompt of Object.values(prompts)) {
        expect(prompt).not.toContain("产品经理");
        expect(prompt).not.toContain("产品负责人");
        expect(prompt).not.toContain("创业者");
      }
    });
  });

  describe("report generation with mock AI following new rules", () => {
    it("correctly attributes AI-completed work", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const aiItems = report.sections.aiCompleted.map(i => i.item);
      expect(aiItems.some(i => i.includes("验收审计"))).toBe(true);
      expect(aiItems.some(i => i.includes("识别"))).toBe(true);
      expect(aiItems.some(i => i.includes("修复") || i.includes("执行"))).toBe(true);
      expect(aiItems.some(i => i.includes("测试"))).toBe(true);
      expect(aiItems.some(i => i.includes("commit"))).toBe(true);

      // Must NOT include user's acceptance checklist items as AI work
      expect(aiItems.some(i => i.includes("用户打开 report.html"))).toBe(false);
      expect(aiItems.some(i => i.includes("用户输入 artifactText"))).toBe(false);
      expect(aiItems.some(i => i.includes("dangerousGaps 正好 5 个"))).toBe(false);
    });

    it("correctly attributes user-contributed criteria", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const userItems = report.sections.userContributed.map(i => i.item);
      expect(userItems.some(i => i.includes("验收"))).toBe(true);
      expect(userItems.some(i => i.includes("15") || i.includes("标准"))).toBe(true);
      expect(userItems.some(i => i.includes("执行") || i.includes("批准"))).toBe(true);
      expect(userItems.some(i => i.includes("禁止") || i.includes("不新增") || i.includes("重构"))).toBe(true);

      // Must NOT include AI's audit results as user contributions
      expect(userItems.some(i => i.includes("Passed") && i.includes("Failed"))).toBe(false);
      expect(userItems.some(i => i.includes("normalizeGapArray"))).toBe(false);
    });

    it("surfaces outsourced cognitive processes", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const processes = report.sections.cognitiveProcessesOutsourced.map(p => p.process);
      expect(processes.some(p => p.includes("验收"))).toBe(true);
      for (const entry of report.sections.cognitiveProcessesOutsourced) {
        expect(entry.surfaceTask).toBeTruthy();
        expect(entry.whyItMatters).toBeTruthy();
      }
    });

    it("generates 2-4 root-capability understanding debts, not bug lists", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const gaps = report.sections.dangerousGaps;
      expect(gaps.length).toBeGreaterThanOrEqual(2);
      expect(gaps.length).toBeLessThanOrEqual(4);

      const gapTexts = gaps.map(g => g.gap).join(" ");
      expect(gapTexts).toContain("理解");
      expect(gapTexts).toContain("尚未证明");

      // Must NOT contain resolved bugs as current bugs
      expect(gapTexts).not.toContain("刷新页面后数据丢失");
      expect(gapTexts).not.toContain("跨端口问题");

      // Every root gap must explain >=2 surface signals and be transferable/verifiable
      for (const gap of gaps) {
        expect(gap.surfaceSignals.length).toBeGreaterThanOrEqual(2);
        expect(gap.transferScenarios.length).toBeGreaterThanOrEqual(1);
        expect(gap.diagnosticQuestion).toBeTruthy();
        expect(gap.masteryCriteria.length).toBeGreaterThan(0);
      }
    });

    it("generates Feynman cards about understanding, not about bugs", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const cards = report.sections.feynmanCards;
      expect(cards.length).toBeGreaterThanOrEqual(3);
      expect(cards.length).toBeLessThanOrEqual(5);

      const prompts = cards.map(c => c.prompt).join(" ");
      expect(prompts).toContain("为什么");
      expect(prompts).toContain("什么条件");
      expect(prompts).toContain("风险");
      expect(prompts).not.toContain("为什么刷新页面数据丢失是一个问题");

      // Every card maps to a root gap and carries a valid cardType + criteria
      const gapTitles = report.sections.dangerousGaps.map(g => g.title);
      for (const card of cards) {
        expect(gapTitles).toContain(card.target);
        expect([
          "system_map", "analogy", "prediction", "decision_explanation",
          "comparison", "transfer", "validation_design"
        ]).toContain(card.cardType);
        expect(card.evaluationCriteria.length).toBeGreaterThan(0);
      }
    });

    it("generates nextActions about capability building, not re-fixing", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const actions = report.sections.nextActions;
      expect(actions.length).toBeGreaterThan(0);
      for (const action of actions) {
        expect(["verify", "note", "task", "ask"]).toContain(action.route);
        expect(action.reason).toBeTruthy();
      }

      const actionTexts = actions.map(a => a.item).join(" ");
      expect(actionTexts).not.toContain("修复刷新页面数据丢失");
    });

    it("evidence includes attribution reasoning, not just source copy", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      for (const item of report.sections.aiCompleted) {
        expect(item.evidence.length).toBeGreaterThan(10);
        expect(item.evidence).not.toBe(item.item);
      }
    });
  });

  describe("capability calibration (step A)", () => {
    it("normalizes the analysis field from step A output", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      expect(report.analysis.artifactKind).toBe("ai_workflow_transcript");
      expect(report.analysis.userCapability.overall).toBe("mixed");
      const dims = report.analysis.userCapability.dimensions;
      expect(dims.productProblemFraming.level).toBe("L3");
      expect(dims.aiAgentSteering.level).toBe("L4");
      expect(dims.systemMentalModel.level).toBe("L1");
      expect(dims.validationAndQualityJudgment.evidenceStatus).toBe("partial");
      expect(report.analysis.userCapability.currentDomain).toContain("MindIOU");
      expect(report.analysis.userCapability.recommendedCardLevel).toBe("foundation");
    });

    it("threads capability assessment into the step B payload", async () => {
      const mockChatFn = mockGoldenPipeline();
      await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const stepBPayload = JSON.parse(mockChatFn.mock.calls[1][0][1].content);
      expect(stepBPayload.userCapability.overall).toBe("mixed");
      expect(stepBPayload.userCapability.dimensions.aiAgentSteering.level).toBe("L4");
    });

    it("threads gaps and capability into the step D payload", async () => {
      const mockChatFn = mockGoldenPipeline();
      await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const stepDPayload = JSON.parse(mockChatFn.mock.calls[2][0][1].content);
      expect(stepDPayload.dangerousGaps.length).toBeGreaterThanOrEqual(2);
      expect(stepDPayload.userCapability.recommendedCardLevel).toBe("foundation");
    });

    it("preserves card targetLevel and difficulty from AI output", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      for (const card of report.sections.feynmanCards) {
        expect(["L0", "L1", "L2", "L3", "L4", "L5"]).toContain(card.targetLevel);
        expect(["foundation", "intermediate", "advanced"]).toContain(card.difficulty);
      }
    });

    it("L1-calibrated user does not get architecture-level gaps", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const gaps = report.sections.dangerousGaps.map(g => g.gap).join(" ");
      expect(gaps).not.toContain("架构取舍");
      expect(gaps).not.toContain("distributed system");
    });

    it("cards match recommendedCardLevel from capability assessment", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockGoldenPipeline());

      const foundationCards = report.sections.feynmanCards.filter(c => c.difficulty === "foundation");
      expect(foundationCards.length).toBeGreaterThanOrEqual(1);
    });

    it("fallback report has default analysis with unknown artifactKind", async () => {
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", null);
      expect(report.analysis.artifactKind).toBe("unknown");
      expect(report.analysis.userCapability.overall).toBe("mixed");
      expect(report.analysis.userCapability.recommendedCardLevel).toBe("foundation");
      expect(report.generation.fallback).toBe(true);
      expect(report.generation.failedStep).toBe("attribution");
    });

    it("step A user payload carries capability-signal hints", async () => {
      const mockChatFn = mockGoldenPipeline();
      await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const userPayload = JSON.parse(mockChatFn.mock.calls[0][0][1].content);
      expect(userPayload.hint).toContain("Capability signals");
    });
  });
});
