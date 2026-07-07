import { describe, expect, it, vi } from "vitest";
import { generateClearanceReport, getClearanceReportSystemPrompt } from "../mvp0-report.js";

/**
 * Golden sample test: simulates a real ai_workflow_transcript where
 * the user gives acceptance criteria, Trae audits and fixes issues,
 * tests pass, and a commit is generated.
 *
 * This test verifies that the prompt and report generation correctly:
 * - Attribute AI-completed work to AI, not to the user
 * - Attribute user-contributed criteria to the user, not to AI
 * - Generate understanding debts, not bug lists
 * - Generate Feynman cards about understanding, not about bugs
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

// Mock AI response that follows the new prompt rules
const MOCK_AI_RESPONSE_FOR_WORKFLOW = {
  sections: {
    aiCompleted: [
      { item: "Trae 完成验收审计，逐项检查 15 条验收路径", evidence: "原文中 Trae 输出了 Passed/Failed/Risky 分析，这是 AI 执行的审计工作，不是用户设定的标准。", isInference: false },
      { item: "Trae 识别出 1 项 Failed 和 3 项 Risky", evidence: "原文中 Trae 标注了 'Failed Items (1/15)' 和 'Risky Items (3 项)'，这是 AI 的分析结果。", isInference: false },
      { item: "Trae 提出四项最小修复建议", evidence: "原文中 Trae 列出了 '最小修复建议' 四条，这是 AI 提出的方案。", isInference: false },
      { item: "Trae 执行了四项修复：sessionStorage 恢复、gap/card normalization、Vite proxy", evidence: "原文中 Trae 输出 '四项验收修复全部完成' 并列出具体修改，这是 AI 执行的代码修改。", isInference: false },
      { item: "Trae 增加测试并确认 181 项全绿", evidence: "原文中 Trae 报告 '181 项测试全绿（+4 项新测试）'，这是 AI 运行测试的结果。", isInference: false },
      { item: "Trae 生成 git commit 7e3da11", evidence: "原文末尾 'Git commit: 7e3da11' 是 AI 生成的提交记录。", isInference: false }
    ],
    userContributed: [
      { item: "用户定义了 MindIOU 认知欠条清算的产品定位", evidence: "原文开头用户说明这是验收模式检查，隐含了产品方向由用户设定。", isInference: true },
      { item: "用户要求进入验收模式，禁止新增功能和重构", evidence: "原文 '现在进入验收模式，不要新增功能，不要重构' 是用户的指令，不是 AI 的工作。", isInference: false },
      { item: "用户提供了 15 项验收标准", evidence: "原文列出了 15 条编号验收项，这是用户设定的标准，不是 AI 完成的工作。", isInference: false },
      { item: "用户批准执行修复", evidence: "原文 '执行吧' 是用户的确认指令，授权 AI 进行修改。", isInference: false },
      { item: "用户拥有最终判断权", evidence: "用户设定验收标准并要求验收模式，表明用户保留对输出质量的最终判断。", isInference: true }
    ],
    dangerousGaps: [
      { rank: 1, gap: "用户尚未证明自己理解 sessionStorage + report id 恢复机制的边界（如 sessionStorage 被清除、跨标签页、服务端数据被删）", whyDangerous: "如果用户不理解这个机制的边界，未来遇到恢复失败时无法定位问题", evidence: "Trae 实现了 sessionStorage 恢复但用户未解释其原理和边界" },
      { rank: 2, gap: "用户尚未证明自己理解为什么 normalization 不能只靠 prompt 而需要在代码层强制", whyDangerous: "如果用户认为 prompt 指令就够了，未来会依赖 AI 遵守指令而不是用代码保证 schema", evidence: "Trae 同时修改了 normalizeGapArray 和 prompt，用户未说明为什么两者都需要" },
      { rank: 3, gap: "用户尚未证明自己理解 fallback report 和 real AI report 的语义差异", whyDangerous: "如果用户不理解两者的区别，在 demo 时可能无法向评委解释 fallback 的价值", evidence: "系统有 fallback 路径和 AI 路径，用户未解释它们的差异" },
      { rank: 4, gap: "用户尚未证明自己理解 Vite proxy 只解决开发环境问题而非生产部署问题", whyDangerous: "如果用户混淆了 dev proxy 和生产部署，可能在部署时遗漏同源配置", evidence: "Trae 添加了 Vite proxy 但用户未区分开发环境和生产环境的区别" },
      { rank: 5, gap: "用户尚未证明自己理解测试全绿不等于产品语义正确", whyDangerous: "181 项测试全绿只验证了代码行为，没有验证报告的语义质量——即 AI 是否在做认知债务分析而非文本摘要", evidence: "用户验收时 15 项全通过但实际报告质量有严重语义错误" }
    ],
    cognitiveStructure: {
      facts: [
        { item: "系统有 181 项测试全部通过", evidence: "原文 '181 项测试全绿'" },
        { item: "Git commit hash 是 7e3da11", evidence: "原文 'Git commit: 7e3da11'" }
      ],
      hypotheses: [
        { item: "用户可能认为测试全绿就意味着产品可以 demo", evidence: "用户在验收通过后准备 demo，但未检查语义质量", isInference: true }
      ],
      questions: [
        { item: "用户是否理解 sessionStorage 恢复机制在什么条件下会失败？", evidence: "用户未在验收中说明恢复机制的边界", isInference: true }
      ],
      decisions: [
        { item: "Trae 选择同时修改 prompt 和 normalization 代码", evidence: "原文显示两项修改同时进行" }
      ],
      tradeoffs: [
        { item: "prompt 指令 vs 代码强制：两者都需要，prompt 指导 AI 行为，代码保证 schema", evidence: "Trae 的修复同时包含两类", isInference: true }
      ]
    },
    feynmanCards: [
      { id: "card-1", target: "sessionStorage 恢复机制边界", prompt: "为什么只保存 report id 到 sessionStorage 就能在刷新后恢复报告？这个方案在什么条件下会失败？（提示：sessionStorage 被清除、跨标签页、服务端数据被删）", userAnswer: "", aiFollowUp: "", answeredAt: null },
      { id: "card-2", target: "Normalization 的必要性", prompt: "为什么 normalizeGapArray 需要同时 pad 和 truncate？如果只依赖 prompt 告诉 AI 返回 5 个 gap，会有什么风险？", userAnswer: "", aiFollowUp: "", answeredAt: null },
      { id: "card-3", target: "Fallback 与 AI report 的区别", prompt: "fallback report 和 real AI report 在语义上有什么区别？为什么 demo 时需要区分两者？", userAnswer: "", aiFollowUp: "", answeredAt: null },
      { id: "card-4", target: "Dev proxy 的边界", prompt: "为什么 Vite proxy 修的是开发环境问题，而不是生产部署问题？如果部署到生产环境，还需要做什么？", userAnswer: "", aiFollowUp: "", answeredAt: null },
      { id: "card-5", target: "测试全绿 ≠ 语义正确", prompt: "为什么 181 项测试全绿仍然不能证明 MindIOU 的产品语义正确？测试验证了什么，没有验证什么？", userAnswer: "", aiFollowUp: "", answeredAt: null }
    ],
    nextActions: [
      { item: "验证 sessionStorage 恢复机制在多种边界条件下的行为（清除缓存、跨标签页、服务端数据删除）", route: "verify", reason: "需要确认恢复机制在边界条件下是否仍然有效" },
      { item: "记录 prompt + normalization 双重保障的工程判断到项目记忆", route: "note", reason: "这个'prompt 指导 + 代码强制'的模式有复用价值" },
      { item: "补充 golden sample 测试，验证 AI 报告的语义质量而非仅 schema 合规", route: "task", reason: "当前测试只验证 schema，未验证报告是否在做认知债务分析" },
      { item: "向有经验的工程师请教 AI prompt 工程中如何防止'文本摘要替代语义分析'的问题", route: "ask", reason: "这是一个需要经验判断的 prompt 设计问题" }
    ]
  }
};

describe("Golden sample: ai_workflow_transcript", () => {
  describe("system prompt quality", () => {
    it("contains artifact interpretation protocol", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("ai_workflow_transcript");
      expect(prompt).toContain("ai_coding_log");
      expect(prompt).toContain("unknown");
    });

    it("contains role attribution rules", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("aiCompleted: ONLY include work actually done by AI");
      expect(prompt).toContain("userContributed: ONLY include things genuinely provided by the user");
      expect(prompt).toContain("STRICTLY FORBIDDEN");
      expect(prompt).toContain("acceptance checklist items as 'AI completed'");
    });

    it("contains evidence rules with examples", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("evidence must NOT be a copy of the source sentence");
      expect(prompt).toContain("WRONG");
      expect(prompt).toContain("RIGHT");
      expect(prompt).toContain("attribution reasoning");
    });

    it("contains dangerous gaps rules with resolved risk handling", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("NOT bug lists");
      expect(prompt).toContain("understanding debts");
      expect(prompt).toContain("already identified AND fixed AND tested");
      expect(prompt).toContain("verification debt");
    });

    it("contains feynman card rules with examples", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("test whether the user understands");
      expect(prompt).toContain("WRONG card prompt");
      expect(prompt).toContain("RIGHT card prompt");
    });

    it("contains resolved risk handling section", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("Resolved Risk Handling");
      expect(prompt).toContain("resolved engineering risk");
    });
  });

  describe("report generation with mock AI following new rules", () => {
    it("correctly attributes AI-completed work", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_RESPONSE_FOR_WORKFLOW);
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const aiItems = report.sections.aiCompleted.map(i => i.item);
      // Should include AI audit and fix work
      expect(aiItems.some(i => i.includes("验收审计"))).toBe(true);
      expect(aiItems.some(i => i.includes("识别"))).toBe(true);
      expect(aiItems.some(i => i.includes("修复") || i.includes("执行"))).toBe(true);
      expect(aiItems.some(i => i.includes("测试"))).toBe(true);
      expect(aiItems.some(i => i.includes("commit"))).toBe(true);

      // Should NOT include user's acceptance checklist items as AI work
      expect(aiItems.some(i => i.includes("用户打开 report.html"))).toBe(false);
      expect(aiItems.some(i => i.includes("用户输入 artifactText"))).toBe(false);
      expect(aiItems.some(i => i.includes("dangerousGaps 正好 5 个"))).toBe(false);
    });

    it("correctly attributes user-contributed criteria", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_RESPONSE_FOR_WORKFLOW);
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const userItems = report.sections.userContributed.map(i => i.item);
      // Should include user's acceptance criteria and approval
      expect(userItems.some(i => i.includes("验收"))).toBe(true);
      expect(userItems.some(i => i.includes("15") || i.includes("标准"))).toBe(true);
      expect(userItems.some(i => i.includes("执行") || i.includes("批准"))).toBe(true);
      expect(userItems.some(i => i.includes("禁止") || i.includes("不新增") || i.includes("重构"))).toBe(true);

      // Should NOT include AI's audit results as user contributions
      expect(userItems.some(i => i.includes("Passed") && i.includes("Failed"))).toBe(false);
      expect(userItems.some(i => i.includes("normalizeGapArray"))).toBe(false);
    });

    it("generates understanding debts, not bug lists", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_RESPONSE_FOR_WORKFLOW);
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const gaps = report.sections.dangerousGaps;
      expect(gaps).toHaveLength(5);

      const gapTexts = gaps.map(g => g.gap).join(" ");
      // Should contain understanding debt language
      expect(gapTexts).toContain("理解");
      expect(gapTexts).toContain("尚未证明");

      // Should NOT contain resolved bugs as current bugs
      expect(gapTexts).not.toContain("刷新页面后数据丢失");
      expect(gapTexts).not.toContain("跨端口问题");
    });

    it("generates Feynman cards about understanding, not about bugs", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_RESPONSE_FOR_WORKFLOW);
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const prompts = report.sections.feynmanCards.map(c => c.prompt).join(" ");
      // Should ask about understanding mechanisms, not about why a bug is a problem
      expect(prompts).toContain("为什么");
      expect(prompts).toContain("什么条件");
      expect(prompts).toContain("风险");

      // Should NOT ask "why is X a problem" about resolved bugs
      expect(prompts).not.toContain("为什么刷新页面数据丢失是一个问题");
    });

    it("generates nextActions about verification, not re-fixing", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_RESPONSE_FOR_WORKFLOW);
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      const actions = report.sections.nextActions;
      expect(actions.length).toBeGreaterThan(0);

      for (const action of actions) {
        expect(action.route).toBeTruthy();
        expect(action.reason).toBeTruthy();
        expect(["verify", "note", "task", "ask"]).toContain(action.route);
      }

      // Should NOT have actions about re-fixing resolved issues
      const actionTexts = actions.map(a => a.item).join(" ");
      expect(actionTexts).not.toContain("修复刷新页面数据丢失");
    });

    it("evidence includes attribution reasoning, not just source copy", async () => {
      const mockChatFn = vi.fn().mockResolvedValue(MOCK_AI_RESPONSE_FOR_WORKFLOW);
      const report = await generateClearanceReport(GOLDEN_SAMPLE_WORKFLOW, "codex", mockChatFn);

      for (const item of report.sections.aiCompleted) {
        // Evidence should be longer than the item itself (contains reasoning)
        expect(item.evidence.length).toBeGreaterThan(10);
        // Evidence should not be identical to the item
        expect(item.evidence).not.toBe(item.item);
      }
    });
  });

  describe("anti-pattern detection", () => {
    it("prompt explicitly forbids treating checklist items as AI work", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("acceptance checklist");
      expect(prompt).toContain("as 'AI completed'");
    });

    it("prompt explicitly forbids copying source as evidence", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("NOT be a copy of the source");
    });

    it("prompt handles non-artifact input gracefully", () => {
      const prompt = getClearanceReportSystemPrompt();
      expect(prompt).toContain("not an AI-assisted work artifact");
      expect(prompt).toContain("empty arrays");
    });
  });
});
