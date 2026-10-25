# 开题报告：面向 AI 辅助工作流的认知债务识别与清偿系统研究

> 材料包主文档。合成自：白皮书（调研增强版）、RESEARCH_PROGRAM.md、
> AI_LEARNING_LOOP_FRONTIER_RESEARCH、AI_COLLABORATION_EVALUATION_EVIDENCE。
> 引用键对应 docs/research/REFERENCES.bib。学校模板字段名可按需替换。
> 版本：v0.1 · 2026-10-13

---

## 一、选题背景与意义

### 1.1 背景

生成式 AI 已从尝鲜工具进入工作流基础设施。Stanford HAI《2026 AI Index》显示生成式
AI 三年内达到约 53% 人口层面采用率 [stanford_ai_index_2026]；Microsoft 与 LinkedIn
调查表明 75% 全球知识工作者已在使用 AI [msft_linkedin_wti_2024]。与此同时，World
Economic Forum 预计 2025-2030 年间 39% 的现有技能将转化或过时 [wef_future_jobs_2025]。

产出提速的另一面是理解过程的系统性跳过。用户让 AI 修复故障、生成代码、撰写文档，
通常只验收"能用了"，而不知道 AI 做了哪些关键判断、边界在哪、下次能否独立复现。
Gerlich 对 666 名参与者的研究发现 AI 使用与认知外包、批判性思维之间的显著关系
[gerlich_2025_cognitive_offloading]；MIT Media Lab 的 EEG 预印本提出 LLM 辅助任务
可能积累"cognitive debt" [kosmyna_2025_cognitive_debt]（该研究的方法学边界亦被
后续评论审慎质疑 [stankovic_2026_comment]）。METR 的随机对照试验甚至发现资深
开发者使用 AI 后任务耗时平均增加 19%，且主观预期与实际结果存在系统性偏差
[metr_2025_dev_productivity]。

**核心矛盾**：AI 带来的产出增长是即时的、可观察的；理解缺失是滞后的、不可观察的。
现有工具（对话历史、代码 diff、任务看板）都不回答"用户在这次协作里没理解什么"。

### 1.2 问题定义

本项目把上述矛盾形式化为**认知债务（Cognitive Debt）**构念：用户借助 AI 完成结果 R
时，R 所依赖的关键判断、边界条件、验证方法与取舍逻辑中，用户尚未证明自己能复述、
验证或迁移的部分。操作性公式：

```
认知债务 = AI 代劳成果 − 用户已证明可理解/复述/验证/迁移的部分
```

它与"知识缺口"（课程体系视角的还没学）不同：认知债务有明确产生时点、产生场景与
证据链；它也与"认知外包"（一种行为倾向）不同：认知债务是该次行为留下的可清算存量。

### 1.3 意义

- **理论**：把"AI 影响学习"的群体级相关性研究，推进到个体级、逐条可累积可清偿的
  账目模型，并与测试效应、间隔效应、必要难度等成熟学习科学机制对接
  [roediger_2006_testing][cepeda_2006_spacing][bjork_1994_desirable]。
- **工程**：给出一套已在真实开发工作流（三源 AI 编码工具 + 智能眼镜）运行的
  识别-清偿-验证闭环系统，为"可持续的 AI 辅助工作"提供可复用架构。
- **应用**：WEF 与 UNESCO 均把 AI 素养、判断与验证能力列为核心技能方向
  [wef_future_jobs_2025][unesco_genai_2023]；本系统能力证据包可直接服务
  技能重构与远程工作场景 [worldbank_digital_jobs_2018]。

## 二、国内外研究现状

### 2.1 AI 对工作与学习的影响

现场实验证据呈现分化：Brynjolfsson 等对 5179 名客服的研究发现 AI 平均提升 14%
生产率且新手收益更大 [brynjolfsson_2023_genai_work]；NBER 对 776 名专业人士的
预注册实验显示单人 AI 使用可达到无 AI 团队水平 [neddam_2025_cybernetic]；
Microsoft Research 对 319 名知识工作者的调查发现对 AI 信心越高、自我感知的批判性
投入越少 [lee_2025_critical_thinking]。2026 Work Trend Index 进一步把组织方向
描述为"Learning System"——工作持续产生学习信号、信号反哺工作流
[msft_wti_2026]，恰是本项目在个人层面对齐的机制。企业 RCT [paradis_2024_rct]
与 METR [metr_2025_dev_productivity] 提醒：主观感受不等于客观收益。这些工作测
**人群平均效应**；本项目测**个体账目与清偿路径**。

### 2.2 学习科学机制

提取练习优于重读 [roediger_2006_testing][karpicke_2008_retrieval]；间隔分布优于
集中 [cepeda_2006_spacing]（317 实验元分析）；Dunlosky 等对十种学习技术的效用
分级把练习测试、分布式练习、解释性提问列为高效，重读、划线为低效
[dunlosky_2013_techniques]；Bjork 的必要难度理论说明降低即时表现的练习可能提升
长期保持 [bjork_1994_desirable]；Sweller 的认知负荷理论约束了信息呈现密度
[sweller_1988_cognitive_load]；VanLehn 综述显示智能导师系统效果接近人类导师
（d≈0.76 vs 0.79）[vanlehn_2011_tutoring]，呼应 Bloom 的 2σ 问题
[bloom_1984_two_sigma]。本项目把这些机制工程化到"真实工作产生的债务"上，
而非课程内容上。

### 2.3 相关产品与差距

间隔重复产品（Anki/Duolingo）卡片来自课程或自建；内容消化产品（NotebookLM 一类）
止步于摘要；AI 编码工具的会话记录不做理解审计。据本项目 2026-08 前沿扫描
（AI_LEARNING_LOOP_FRONTIER_RESEARCH）：没有产品同时具备（a）从真实 AI 工作痕迹
自动生成学习对象、（b）证据等级阶梯、（c）碎片化清偿入口（智能眼镜）。

## 三、研究目标与内容

**总目标**：建立认知债务的可测量构念、自动识别方法与因果可验的清偿机制。

| # | 研究内容 | 关键问题 |
|---|---------|---------|
| RQ1 | 构念操作化 | 认知债务能否用 E0-E5 证据等级单调刻度化？构念效度如何？ |
| RQ2 | 自动识别 | AI 会话痕迹生成的债务候选，准确率与接受率多少？模板化与内容特定候选是否分层差异显著？ |
| RQ3 | 清偿机制 | 眼镜端主动提取（quiz）与 web 端被动阅读相比，14 天 E2 保持率是否显著更高？ |
| RQ4 | 输入泛化 | 视频/文章等被动输入能否自动转化为可清偿债务对象？消化产物质量如何？ |

## 四、研究方法与技术路线

1. **构念与测量（RQ1）**：定义 E0（无证据）到 E5（真实工作验证）阶梯，映射到系统
   的六维掌握画像（概念理解/独立回忆/提示独立性/误概念抵抗/迁移/保持）。效度威胁
   预先声明：自证循环（系统出题判分）→ E3 以上引入外部锚点；候选假阳性 → 人工
   accept 拒绝率作为测量对象；单被试外推 → 定位为纵向设计不做人群宣称。
2. **识别研究（RQ2 / EXP-1）**：回放历史欠条语料（69 用户 208 条，去重 25 个 gap
   类型；已发现 15/22 中文 gap 为模板化句式，分析须分层）与三源 MCP 捕获候选，
   人工标注 real_debt/not_debt，报告 precision/recall 与接受延迟。
3. **因果实验（RQ3 / EXP-2）**：预注册（docs/research/EXP-2-PREREG.md，先于采集）
   的被试内欠条级随机对照：SHA-1(gapText) 分组，眼镜 quiz vs web 阅读（最短暴露
   对齐），14 天盲测（评分器不知分组），McNemar 主检验 + 贝叶斯因子。
4. **输入泛化（RQ4 / EXP-3）**：B 站视频消化管道（真实 CC 字幕/降级元数据两种模式）
   产物盲评（知识点值得学/时间轴对准/债务成立，5 点量表，n≥10 视频）。

**技术路线**：MCP 捕获（dsh/Claude/Codex 三源）→ 候选生成 → 人工 accept →
E0-E5 清偿（眼镜 quiz/语音/web）→ 证据回流更新画像 → 下一轮优先级。系统已
在真实开发工作流运行（SQLite 持久化，774+87 自动化测试）。

## 五、创新点

1. **构念创新**：认知债务从 EEG 组间差异 [kosmyna_2025_cognitive_debt] 或行为倾向
   [gerlich_2025_cognitive_offloading]，工程化为逐条、可累积、可清偿、带证据等级
   的个体账目。
2. **数据源创新**：学习对象不来自课程，而来自用户自己的真实 AI 工作痕迹
   （编码会话、视频消化），实现"学你刚做过的东西"。
3. **方法创新**：预注册的单被试欠条级随机对照 + 证据强度阶梯，把行为科学的
   因果工具用在个人学习系统评估上。
4. **入口创新**：智能眼镜作为碎片化清偿通道（主动提取发生在等电梯的两分钟里），
   对接低打扰交互形态 [idc_smart_glasses][counterpoint_glasses]。

## 六、已有工作基础（可行性）

- 系统已运行：后端（~4000 行，SQLite）、MCP 接入三源 AI 工具、G2 眼镜客户端
  （发布包 113KB，语音/手势 quiz）、web 前端（B 站消化、EXP-2 实验台）。
- 数据已积累：208 条历史欠条语料、agent-session 候选管道、盲测装置就绪。
- 文献基础：31 条核实参考文献（产业 19 / 协作证据 5 / 学习科学 7）。
- 研究治理：预注册制度（EXP-2-PREREG）、标注协议（EXP-1 底稿）、
  效度威胁预先声明。

## 七、计划进度

| 阶段 | 时间 | 里程碑 |
|-----|------|-------|
| P1 | 第 1-2 月 | EXP-1 标注完成，RQ2 描述+准确率结果；欠条池积累至启动线（≥40） |
| P2 | 第 3-5 月 | EXP-2 三轮运行与盲测，RQ3 因果结果 |
| P3 | 第 4-6 月 | 字幕模式解锁，EXP-3 消化质量评审（RQ4） |
| P4 | 第 6-8 月 | 跨被试复制（2-3 名用户）；论文撰写与投稿 |

## 八、参考文献

见 docs/research/REFERENCES.bib（31 条，本报告引用以下 24 条）：
stanford_ai_index_2026 · msft_linkedin_wti_2024 · wef_future_jobs_2025 ·
unesco_genai_2023 · gerlich_2025_cognitive_offloading · kosmyna_2025_cognitive_debt ·
stankovic_2026_comment · metr_2025_dev_productivity · brynjolfsson_2023_genai_work ·
neddam_2025_cybernetic · lee_2025_critical_thinking · paradis_2024_rct ·
worldbank_digital_jobs_2018 · roediger_2006_testing · karpicke_2008_retrieval ·
cepeda_2006_spacing · bjork_1994_desirable · sweller_1988_cognitive_load ·
dunlosky_2013_techniques · vanlehn_2011_tutoring · bloom_1984_two_sigma ·
idc_smart_glasses · counterpoint_glasses · msft_wti_2026

---

### 附：学校模板映射提示

- 「文献综述」← 第二节展开 + frontier research 文档
- 「研究方案」← 第三、四节
- 「预期成果」← 论文（P4）+ 可复用开源系统 + 预注册数据集
- 「经费/设备」← 无特殊需求（已有开发机、眼镜样机、云服务器）
