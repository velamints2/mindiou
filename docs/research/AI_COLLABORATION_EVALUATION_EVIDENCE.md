# AI 协作能力评估：外部研究依据

更新日期：2026-08-12

这份材料用于说明 MindIOU 为什么观察“人如何与 AI 一起工作”，而不是把 AI 协作能力做成一次性的 AI 知识考试。它不是对用户能力的科学认证，也不意味着下面任何一项研究可以直接推出 MindIOU 的个人分数。

## 研究摘要

| 研究 | 关键发现 | 对 MindIOU 评估的支持 | 证据边界 |
| --- | --- | --- | --- |
| [The Cybernetic Teammate: A Field Experiment on Generative AI Reshaping Teamwork and Expertise](https://www.nber.org/papers/w33641)（NBER，2025） | 对 776 名专业人士的预注册现场实验观察了 AI 对表现、专业经验分享和社会互动的影响；单人使用 AI 的表现可以达到无 AI 团队的水平。 | AI 协作不是简单的“有没有使用 AI”，应观察委派、协作结构、专业经验如何被调用，以及最终结果。 | 研究场景是产品创新任务，不能直接外推到所有职业。 |
| [The Impact of Generative AI on Critical Thinking](https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/)（CHI / Microsoft Research，2025） | 对 319 名知识工作者的调查显示，对 AI 完成任务越有信心，与较少的自我感知批判性思考投入相关。 | 支持观察验证行为、证据要求、事实与推断区分、以及是否过早接受第一版答案。 | 这是自我报告调查，不应单独用来判定“批判性思考下降”或给用户贴标签；产品需要优先采集真实行为。 |
| [Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity](https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/)（METR，2025） | 对 16 名资深开源开发者的 246 个真实任务进行随机对照试验，允许使用当时的 AI 工具后，任务完成时间平均增加 19%；开发者的主观预期与实际结果存在偏差。 | 支持同时观察真实完成时间、返工、监督成本、任务结果和主观判断，不能只看用户“感觉 AI 很快”。 | 样本集中在资深开源开发者和特定时期的工具，不能外推到所有职业、所有用户或今天的模型。 |
| [Human Delegation Behavior in Human-AI Collaboration: The Effect of Contextual Information](https://arxiv.org/abs/2401.04729)（2024） | 行为实验显示，关于任务和 AI 能力的上下文信息会改变人的委派选择，并改善人机团队表现。 | 支持把上下文完整度、任务—AI 适配度、委派时机和人类保留的判断纳入画像。 | 这是受控行为研究，不等于真实长期工作中的能力证明。 |
| [Generative AI at Work](https://www.nber.org/papers/w31161)（NBER，2023） | 对 5,179 名客服人员的现场研究发现，AI 平均提升生产率 14%，新手和低技能员工收益更大，而资深员工收益很小。 | 支持将“领域能力”和“AI 协作能力”并行建模，并按任务类型、经验和工作阶段解释 AI 使用效果。 | 研究针对客服工作，不能把平均生产率提升当成所有人的普遍结果。 |

## 研究如何映射到 MindIOU

这些研究共同支持以下评估原则：

1. 评估单位应该是“真实任务中的协作行为”，而不是一次 Prompt 或一份 AI 常识问卷。
2. 画像应该是多维诊断，而不是一个脱离上下文的总分。
3. 至少要同时记录：问题建模、上下文构造、任务拆解与委派、结果判断与验证、迭代协作、工作流设计、AI 能力边界判断。
4. 个人的专业能力与 AI 协作能力需要并行保存。AI 带来的收益可能因经验、任务类型和已有专业能力而不同。
5. 主观满意度只能作为一个信号，不能替代真实结果、独立证据和后续验证。
6. 当证据不足时，系统应该输出“缺少行为证据”，而不是把沉默、一次失败或一次成功包装成稳定能力结论。

## 当前产品实现边界

- PRD 已把 `Domain Capability` 与 `AI Collaboration Capability` 定义为两个并行分支；领域分支回答“用户会不会做这件事”，AI 协作分支回答“用户是否能够有效、可靠、可持续地驾驭 AI”。
- 当前 Cognitive Loop MVP 的规则分析已经保存有限证据摘录，并将 AI 协作画像拆成 7 个可观察维度：问题建模、任务拆解与委派、上下文构造、判断与验证、多轮协作与反馈、工作流与委派、AI 能力边界认知。
- 当前第一版已完成七维数据结构、同一 Activity Event 双引擎输入和 `UserCognitiveProfile` 持久化；这仍是可审计规则版，不应宣称完成跨职业量表信度、长期趋势或永久能力认证。
- 领域分支已与 AI 协作分支分开保存，并通过 Priority Engine 在领域知识缺口、AI 使用缺口和前沿信息之间选择最多三项干预。
- Fluency Loop 预告页里的数字、研究卡片和能力分数是产品概念演示，不是用户真实的长期能力认证。真实认证仍需连接真实活动、任务结果、用户反馈和下一周验证。

## 评分与实验建议

研究可以为“观察什么”提供依据，但不能替我们决定固定阈值。例如，`39` 不应被解释成跨职业通用的“低于 40 就不合格”。更稳妥的路径是：

- 用可复核行为证据形成维度分数，并展示证据摘录；
- 把分数变化与任务结果、返工、验证次数、人工介入次数和用户反馈一起看；
- 先把分数作为训练排序和实验选择信号，而不是招聘、绩效或责任归因结论；
- 通过低风险行为实验检验画像是否预测了下一周的行为变化；
- 持续区分 `observed`、`missing_evidence`、规则降级结果和真实模型分析结果。

因此，MindIOU 的研究背书应被理解为：已有研究支持“行为化、情境化、长期化、证据化”的评估方向；它们不替代 MindIOU 自己对量表信度、跨职业公平性、预测效度和隐私边界的验证。
