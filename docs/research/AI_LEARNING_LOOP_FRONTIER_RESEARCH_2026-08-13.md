# AI Learning Loop 前沿实践研究与提示词记录

更新日期：2026-08-13  
研究对象：Even G2 英语口语 Loop，以及可以迁移到 MindIOU Cognitive Loop 的长期学习、记忆、内容筛选和 Agent 评估实践。

## 0. 研究目的与证据分级

这份记录回答四个工程问题：

1. 现在真正有代表性的 AI 口语和学习产品，怎样把“聊天”变成练习；
2. 它们怎样维护用户的长期状态，而不是每次从零开始；
3. 它们怎样把一次对话变成下一次更合适的训练，而不是泛泛地说“继续加油”；
4. 我们需要什么提示词、结构化输出、规则校验和评估集，才能减少 G2 Loop 的傻乎乎回复。

研究结论不直接等于 MindIOU 的产品需求。本文把材料分成四类：

- **事实**：来源明确公开描述的产品、论文或技术做法；
- **推断**：根据事实对机制的解释；
- **灵感**：可能迁移到 MindIOU 的做法，尚未被用户或实验确认；
- **缺口**：现有产品或研究尚未解决、或者公开证据不足的问题。

尤其注意：产品官网的功能描述不等于学习效果证据；短期实验结果不等于长期能力增长；模型评分不等于真实口语能力认证。

## 1. 先给结论：前沿方案不是“更会聊天”，而是多层学习闭环

目前最值得借鉴的共同结构不是一个万能提示词，而是至少分成四层：

```text
实时对话层
  负责：自然轮流、理解当前话、维持目标任务、控制长度
        ↓
本轮观察层
  负责：提取可复核的表达证据、错误、停顿、任务完成情况
        ↓
长期学习层
  负责：更新 Speaking Profile、表达债务、已验证能力和不确定假设
        ↓
下一步规划层
  负责：选择下一次的主题、难度、反馈强度、练习动作和复习间隔
```

这与当前 G2 实现的差别是：当前客户端已经有规则版的观察、能力更新和下一步动作选择；服务端模型主要负责把选定动作渲染成对话回复。下一阶段要把“本轮对话”“本轮观察”“会话总结”“下一次规划”明确拆成可测试的工作流，而不是继续把更多指令塞进一个聊天提示词。

### 最重要的六条设计结论

1. **口语训练必须有任务，不只是闲聊。** Duolingo 的 Video Call 为每次通话设定 CEFR 难度、对话目的、开场问题、自由交流和结束条件；Google 的语言学习实验也把真实场景拆成短小的 Tiny Lesson、Slang Hang 等任务。 
2. **开场问题、当前回复、会话总结最好分开生成。** Duolingo 公开描述了把第一问题单独准备，再交给主会话；他们还加入了中途评估来判断学习者是否想换方向、是否困惑、是否需要改述。
3. **长期画像不是把所有历史对话塞进上下文。** Praktika 公开描述了 Lesson Agent、Student Progress Agent 和 Learning Planning Agent，并在学习者说完之后才检索相关记忆；Anthropic 将这种做法概括为 context engineering 和结构化 agentic memory。
4. **反馈要短、具体、可再次使用。** 2026 年一项对 16,851 次连续学习互动的研究预印本发现，具体展开与下一次理解更相关，而更长的反馈与更低的理解相关；这直接反对“每轮生成一大段语法讲解”。
5. **评分必须有证据、结构和人工校准。** BEA 2025 AI Tutor 评测把错误识别、错误定位、指导和反馈可行动性拆开评估，最好的自动结果仍有明显提升空间；OpenAI 的 evals 文档也强调用数据集、grader 和 traces 做可重复比较，而不是凭感觉改提示词。
6. **学习效果要看跨会话迁移，而不只是当前轮回答。** 口语研究显示 AI 对话对口语表现可能有帮助，但效果依赖任务结构；间隔与检索练习研究则支持把同一能力在不同时间、不同主题下重新调用。

## 2. 同类产品与前沿实践扫描

### 2.1 AI 口语产品

| 产品 / 来源 | 事实 | 对 MindIOU 的推断 | 证据边界 |
| --- | --- | --- | --- |
| [Duolingo Video Call with Lily](https://blog.duolingo.com/video-call/) | 让学习者进行目标语言的自由对话，可要求重复或放慢；公开介绍称通话会根据学习者舒适度调整，早期约 1 分钟，进阶后可到 3 分钟。 | G2 不需要每轮都纠错；可以让学习者先完成交流，再在关键处提供一个最值得复用的改写。 | 产品方公开的是体验设计，不是独立长期学习效果研究。 |
| [Duolingo 的 AI speaking 设计](https://blog.duolingo.com/ai-and-video-call/) | 公开描述了 CEFR 难度、对话目的、角色人格、开场问题、自由交流、结束条件；第一问题与主对话分开准备；中途评估判断是否困惑或想换方向；通话后从 transcript 提取用户事实作为后续记忆。 | “会说什么”与“这轮该教什么”应分离；开场问题需要专门的规划器；中途要有一个小型控制器，而不是让主模型自己兼顾全部任务。 | 披露了方法思路，没有披露完整生产提示词、数据集或每个控制器的准确率。 |
| [ELSA Speak](https://elsaspeak.com/en/faqs/how-does-elsas-pronunciation-feedback-work) | 以语音识别分析发音、重音和语调；其产品页还描述语音、流利度、语法、词汇反馈和个性化学习路径。 | 如果 G2 以后取得可用音频特征，可以把“表达内容”和“发音/韵律”分成不同证据通道，不让一个 LLM 凭 transcript 猜发音。 | 官网的 93.88% 评分一致性是厂商自述，需要独立复核；当前 G2 尚无真实麦克风/音素级证据。 |
| [Loora](https://www.loora.com/support/getting-started/what-is-loora) | 首次对话用于设定水平；用户每天选择 Daily Conversation、Role-play 或 Read and Talk；每次 5–20 分钟；结束时给一个最重要的改进点。 | “每轮只给一个最重要的改进点”比一次输出十个错误更适合眼镜端；初始对话应承担校准职责，不应马上给稳定分数。 | 产品公开描述没有给出画像更新公式、错误确认机制或长期迁移数据。 |
| [Praktika 产品页](https://praktika.ai/) | 提供实时反馈、软/平衡/严格的反馈强度；支持口语、阅读、听力、语法和词汇；强调在不打断对话的方式下纠错。 | 反馈强度应是用户可控状态；默认先保持交流，再根据瓶颈选择隐式改写、短提示或显式解释。 | 产品页包含用户评价和营销表达，不能当作严格效果证据。 |
| [Praktika 的 Agent 架构介绍](https://openai.com/index/praktika/) | 公开描述 Lesson Agent、Student Progress Agent、Learning Planning Agent；进度 Agent 跟踪流利度、准确度、词汇和重复错误；规划 Agent 决定下一步技能、顺序和活动；记忆在学习者说完之后检索。 | 这是目前最接近 MindIOU Loop 的公开产品架构：实时陪练、后台观察和长期规划不应由同一次调用混合承担。记忆检索时机要放在“用户说完以后”。 | 这是 OpenAI 的客户案例，产品方只公开了高层架构和结果，不足以证明每个 Agent 都独立运行或因果导致留存提升。 |
| [Talkpal Call Mode](https://talkpal.ai/support/which-learning-modes-are-available-on-talkpal/) | 提供实时 AI 对话、角色扮演、课程和可调语速。 | 可以把 G2 练习模式显式拆成自由交流、场景模拟和内容讨论，而不是只有一个“英语聊天”入口。 | 主要是帮助文档，学习效果证据有限。 |
| [SpeakPal](https://www.speakpal.ai/) | 公开描述真实场景角色扮演、语法纠正、发音教练和自适应导师。 | 角色、场景、目标和难度应成为输入状态，不能只把一句 topic 传给模型。 | 官网内容属于产品自述。 |
| [Google Translate language learning](https://blog.google/products-and-platforms/products/translate/language-learning-live-translate/) | 使用 Gemini 创建按学习目标和水平定制的听说练习。 | 练习内容可以根据学习目标动态生成，但必须保留“本次练习为什么适合你”的解释。 | 功能发布不等于长期能力改善证明。 |

### 2.2 学习型 AI 与持续画像

| 产品 / 来源 | 事实 | 对 MindIOU 的推断 | 证据边界 |
| --- | --- | --- | --- |
| [ChatGPT Study Mode](https://openai.com/index/chatgpt-study-mode/) | 以主动参与、认知负荷、元认知、好奇心和可行动反馈为设计原则；通过问题、提示、分步解释、开放式检查和个性化支持推进学习。官方同时说明早期版本使用自定义系统指令，行为可能不一致。 | 我们应把“学习模式原则”转成可测试状态机：先校准、再练习、再检查、再迁移；不能只把“苏格拉底式”写进人格提示词。 | OpenAI 明确把它称为长期研究起点，不能把早期体验当作成熟学习效果。 |
| [Google LearnLM](https://blog.google/products-and-platforms/products/education/google-learnlm-gemini-generative-ai/) | 以主动学习、认知负荷管理、适应学习者、激发好奇心、深化元认知为模型和产品原则；Guided Learning 进一步强调开放问题、分步解决和按需求调整。 | G2 的“下一步练习”需要解释它是在改变什么能力，而不是只显示一个任务标题；会话末应要求用户反思“什么变容易了、什么仍然困难”。 | 这是模型/产品原则声明，不直接证明每个应用都实现了这些原则。 |
| [Google Little Language Lessons](https://blog.google/products-and-platforms/products/education/little-language-lessons/) | Tiny Lesson 在特定场景给词汇、短语和语法提示；Slang Hang 生成更真实的对话，帮助学习非教科书表达。 | 可以从用户近期项目或真实场景中生成短练习，避免人工编 Lesson 17；内容应围绕下一步真实使用而不是随机词汇。 | 实验性工具，公开资料没有长期追踪。 |
| [Microsoft Reading Coach](https://support.microsoft.com/en-us/education/learning-accelerators/getting-started-with-reading-coach) | 读者朗读时分析准确率、每分钟词数、时间和困难词；下一章节自动加入前一章困难词；内容有安全审核；声学数据只在设备上处理后不保存。 | “本轮困难点 → 下一次材料中再次出现”是一个清晰的闭环。MindIOU 可以把表达债务放回下一次真实话题，而不是单独背卡。音频隐私应采用最小留存。 | Reading Coach 是朗读训练，不等于自由口语；其设备端处理能力不能直接外推到 G2。 |
| [NotebookLM](https://edu.google.com/ai-notebooklm/) | 以用户提供的来源为基础回答，生成学习内容和 Audio Overviews，并提供指向原始来源的引用；另有 [Discover Sources](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-discover-sources/) 进行来源发现。 | MindIOU 的信息 Agent 不应只返回“推荐一篇文章”，而应保存来源、关键片段、为什么与你有关、适合哪项英语练习。 | 源内问答能减少无依据回答，但不能自动保证来源本身正确或用户真正学会。 |
| [Readwise Reader / Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/overview) | 对阅读内容提供总结、查词、解释、翻译等默认操作；Readwise 公开强调间隔重复、每日复习和基于高亮的回顾。 | 信息流与口语 Loop 可以共享“高亮/困难表达/待回顾”数据，但不应把阅读总结当作口语能力证据。 | 产品功能说明，不是对口语迁移效果的研究。 |
| [Perplexity Pro Search](https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search) | 实时搜索、给出来源链接、支持连续追问和上下文保持；Deep Research 公开描述会搜索更多来源并交叉核对。 | 信息 Agent 需要来源透明、交叉核验、用户关联解释和下一步行动四个字段，不能只有一个 relevance score。 | 服务商公开描述不等于所有回答都可靠；仍需我们自己的来源质量与重复过滤测试。 |

### 2.3 Agent、Context 和评估实践

| 来源 | 事实 | 对 MindIOU 的推断 | 证据边界 |
| --- | --- | --- | --- |
| [Anthropic: Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents) | 区分固定流程 workflow 与模型动态决定步骤的 agent；强调工具定义和工具说明与整体 prompt 同等重要；自主性会带来成本和错误累积，需沙箱和大量测试。 | 英语 Loop 当前应先做固定、可测试的 workflow，不急着引入本地 Agent 或 MCP；只有当动作空间和安全边界明确后才增加自主规划。 | 这是工程经验文章，不是口语学习实验证据。 |
| [Anthropic: Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | 把 context engineering 视为对系统指令、工具、MCP、外部数据和消息历史的整体整理；建议渐进披露、结构化记忆和压缩，避免把全部历史塞进上下文。 | G2 每次请求只传当前话、当前动作、短 profile、相关表达债务和必要历史；长期状态必须先压缩成结构化信号再回填。 | 适合 Agent 工程，不直接说明哪种记忆格式最适合语言学习。 |
| [Anthropic: Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) | 介绍在切块前为内容补充上下文，并结合语义检索与 BM25，以降低传统 RAG 丢失局部上下文的问题。 | 如果未来 Loop 检索文章、表达和项目资料，不能只依靠向量相似度；应同时保留主题、时间、来源、学习目标和精确词汇匹配。 | 这是检索工程方案，不等于信息推荐质量自动提高。 |
| [OpenAI: Voice Agents](https://developers.openai.com/api/docs/guides/voice-agents) | 区分实时语音到语音与链式语音管线；前者适合低延迟自然交流，后者适合可控流程和已有文本 Agent；语音系统需考虑打断、轮流、工具和会话。 | G2 的实时对话可以保持低延迟，但“学习分析”和“会话总结”应走链式、可审计管线，不能在实时语音调用里完成全部判断。 | 文档描述的是 API 架构选择，不是 Even G2 的硬件证据。 |
| [OpenAI: Realtime Models Prompting](https://developers.openai.com/api/docs/guides/realtime-models-prompting) | 建议用短的有标签章节；明确触发条件、动作、例外和优先级；定义不清晰音频、上下文、工具、升级和长度；先从最小 prompt 开始，再通过评估补失败规则；直接回答 1–2 句、澄清一次只问一个问题。 | G2 提示词必须按 Role、Goal、Current Move、Feedback Policy、Unclear Audio、Length、Safety、Output Schema 分块；不要叠加互相冲突的 always/never/only/must。 | 这是实时语音模型指南，不保证第三方模型完全遵循。 |
| [OpenAI: Evaluate Agent Workflows](https://developers.openai.com/api/docs/guides/agent-evals) | 调试阶段先看 traces；稳定后转成数据集和 eval runs；可以用 graders 比较工具选择、交接、指令违反和端到端行为。 | 我们要记录“输入→观察→选择的动作→模型回复→用户下一轮是否完成”的轨迹，用于比较提示词，而不是只保存最终回复。 | 当前项目已有针对性测试，但还没有完整的长期口语 eval 数据集。 |
| [OpenAI: Graders](https://developers.openai.com/api/docs/guides/graders) | 支持字符串、相似度、模型评分和 Python grader；官方强调用人类专家答案和不同质量样本迭代 grader，并警惕 grader hacking。 | 口语反馈必须同时有规则 grader、模型 grader 和人工抽检；不能因为 LLM judge 分数高就认为用户真的进步。 | 模型 grader 的质量依赖参考答案和 rubric。 |
| [OpenAI: Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) | 使用 JSON Schema 可以强制模型匹配结构；官方 API 文档推荐对支持的模型使用严格 schema。 | 每个 Loop 子任务应有独立 schema，并在服务端做二次校验；解析失败时保留当前状态并走明确 fallback。 | Schema 只能约束形状，不能保证事实、教学质量或学习效果。 |

## 3. 研究论文与学习科学依据

### 3.1 口语对话不是“聊天越多越好”

[The impacts of AI conversational agents on EFL learners' oral proficiency and foreign language speaking anxiety](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2026.1799269/full) 对 83 名中国大学生进行了混合方法准实验。研究报告实验组口语表现优于对照组，但总体外语焦虑没有显著差异；任务拆分后，AI 在 pair work 和 presentation 中降低了情境性焦虑，在 debate 和 storytelling 中没有同样结果。作者指出效果依赖任务结构、难度、个性化支持和反馈设计。

对 MindIOU 的直接含义：

- 不把“用户和 AI 聊了 20 分钟”当成学习完成；
- 记录本次任务类型和结构；
- 分别观察流利度、连贯性、适切性、词汇和语法；
- 对开放辩论、讲故事等高负荷任务降低即时纠错，先保证表达完成；
- 通过下一次类似任务验证是否迁移，而非当场给高分。

研究本身仍有短期、课堂和特定任务边界，不能据此宣称 MindIOU 能证明长期口语能力提升。

### 3.2 反馈不是越详细越好

[Micro-level AI Feedback Features and Student Responses in Consecutive LLM Tutoring Interactions](https://arxiv.org/abs/2607.08952) 分析 StudyChat 数据集中 16,851 次互动，关注具体展开、情感语言和回复长度。其报告显示，具体的类比、比较或例子与下一次理解更相关；情感语言没有显示出同样的显著关联；较长回复与较低理解相关。该文是 2026 年预印本，不能当作定论，但与当前产品直觉高度一致。

因此 G2 的默认反馈应是：

```text
先指出一件具体做对的事
→ 只选择一个最值得改进的点
→ 给一个更自然的替代表达或微型例子
→ 立刻要求用户在新语境中再次使用
```

而不是：

```text
列出 12 个语法错误
→ 解释每个语法规则
→ 给 20 个新词
→ 最后说“继续努力”
```

### 3.3 纠错需要考虑交流连续性

[The Effectiveness of Corrective Feedback in SLA: A Meta-Analysis](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9922.2010.00561.x) 和 [The type and linguistic foci of oral corrective feedback in the L2 classroom](https://journals.sagepub.com/doi/10.1177/1362168814563200) 都说明口语纠错是一个有争议且受情境影响的研究领域，不存在“每个错误都立刻显式纠正”的简单规则。

对产品的取舍：

- 自由交流时优先隐式改写或短 recast，避免打断；
- 用户明确要求纠错、关键错误重复出现或影响理解时，再显式解释；
- 任务结束后再从本轮选择一个可复用表达；
- 不把模型的语言偏好误判成错误；
- 记录用户是否在后续语境中重新使用，而不是只记录模型指出过。

### 3.4 学习闭环需要主动回忆、间隔和迁移

[The science of effective learning with spacing and retrieval practice](https://doi.org/10.1038/s44159-022-00089-1) 综述了间隔学习和检索练习的研究。它支持把“用户今天听过一句表达”与“用户在不同日期、不同语境中能否自己调用”分开。

对英语 Loop 的落地规则：

- 当天：从用户真实表达中产生一个短表达债务；
- 下一轮：不直接展示答案，先要求用户回忆或改写；
- 两三天后：换一个新主题测试同一表达或结构；
- 一周后：在自由对话或工作场景中观察迁移；
- 只有多次独立使用后，才把状态从 active 调成 stable。

### 3.5 Tutor 质量应看“是否让下一次回答变好”

[Training LLM-based Tutors to Improve Student Learning Outcomes in Dialogues](https://arxiv.org/abs/2503.06424) 的核心做法不是只让模型模仿好看的教师话术，而是生成多个候选 tutor utterance，用学生模型预测下一轮正确回答概率，再用教学 rubric 评价，最后进行偏好优化。论文也明确承认使用了模拟学生模型，仍需要真实学生闭环。

[TUTORING: Instruction-Grounded Conversational Agent for Language Learners](https://arxiv.org/abs/2302.12623) 则把教学指令和当前对话绑定，并要求系统同时判断当前 instruction 是否应继续或切换，而不只是生成下一句。

对 MindIOU 的关键启发：

```text
回复质量 = 当前回复听起来像不像人
         + 下一轮用户是否完成目标动作
         + 这项动作是否与当前瓶颈有关
         + 是否避免增加不必要的认知负荷
```

## 4. 当前 G2 Loop 的事实审计

### 已有能力

当前代码已经具备以下基础：

- `src/english-loop.ts` 定义 Speaking Profile、七类表达能力、表达债务、模式信号、下一步练习和 intervention；
- `observeEnglishTurn` 基于每轮 transcript 产生结构化行为信号；
- `chooseNextSpeakingMove` 把练习拆成 goal、cause、example、tradeoff、conclusion 等动作；
- `localEnglishLoopReply` 在模型不可用时提供确定性 fallback；
- `server.js` 的 `/api/learn/english-loop` 会将当前 transcript、topic、goal、nextMove、有限 profile 和最近几轮传给模型；
- `isUsefulEnglishLoopResponse` 会拒绝过短、无主题锚点、重复问题和不符合预期动作的回复；
- `english-loop-store.js` 只持久化结构化 profile、会话、反馈和总结，不持久化原始 transcript；
- `0.9.0` 已有本地 outbox、重试和会话总结。

### 当前主要缺口

1. **模型调用仍然是单阶段渲染。** 客户端先选择 move，模型再生成 reply/feedback/nextPrompt；没有独立的“当前学习判断”调用。
2. **观察信号主要来自 transcript 规则。** 可以判断是否有观点、原因、例子、取舍和中文混入，但还不能可靠判断发音、停顿、语法严重度、语用自然度或是否真正完成任务。
3. **会话总结不是模型分析结果。** 当前总结主要由客户端已有 profile 差值和规则 decision 组装，适合稳定 fallback，但还不够解释一段复杂的真实会话。
4. **表达债务候选集是有限规则。** 当前示例表达很有用，但不能覆盖用户真实项目中新出现的表达，也没有“候选→用户确认→重复使用验证”的完整状态。
5. **还没有轨迹级评估集。** 有响应校验和单元测试，但还没有一组匿名真实 transcript，能比较“旧 prompt 与新 prompt 是否让下一轮更好”。
6. **没有独立的内容信息 Loop。** 当前英语 Loop 可以根据 topic 练习，但还没有把文章/视频的来源、难度、关键表达、相关性和下一步口语任务连成闭环。
7. **真机证据仍缺失。** 当前浏览器和 Even Simulator 证明 host contract 和页面行为，不证明真实麦克风、STT、延迟、噪声和网络切换。

## 5. 推荐的下一版工作流

不建议下一步直接把当前 system prompt 写得更长。建议按以下顺序拆成可验证模块：

```text
A. Session Planner（会话开始前）
   输入：目标、主题、当前 focus、最近一次建议、时间
   输出：本轮任务、难度、开场问题、成功条件、反馈策略

B. Conversation Controller（每轮实时）
   输入：当前话、当前任务、上一个动作、极短相关上下文
   输出：一句自然回应、一个反馈点、一个下一动作、G2 短文本

C. Turn Evidence Extractor（每轮后台）
   输入：当前 transcript、任务、可选音频特征
   输出：证据、信号、置信度、是否需要人工/再次观察

D. Session Reflector（会话结束后）
   输入：结构化 turn evidence、任务完成情况、用户反馈
   输出：本轮发现、仍不确定的假设、一个表达债务、下一项练习

E. Learning Planner（跨会话）
   输入：多个会话总结、债务状态、目标、间隔计划
   输出：下一周最多一个主瓶颈和一个实验

F. Content Curator（信息 Loop）
   输入：用户目标、当前项目、英语水平、当前瓶颈
   输出：最多三条来源、相关性解释、难度、关键表达、练习任务
```

### 5.1 任务状态建议

每轮不再只用 `nextPrompt`，而使用显式任务状态：

```json
{
  "task": {
    "type": "opinion_structure",
    "goal": "在30秒内表达一个有原因和例子的观点",
    "successCriteria": [
      "有明确观点",
      "至少一个原因",
      "至少一个具体例子",
      "没有明显偏离主题"
    ],
    "difficulty": "slightly_above_current",
    "feedbackPolicy": "conversation_first",
    "maxTurns": 4,
    "expiresAfterSession": true
  }
}
```

### 5.2 证据与假设必须分开

```json
{
  "evidence": [
    {
      "kind": "task_behavior",
      "claim": "用户给出了观点和原因，但没有具体例子",
      "source": "turn_03",
      "confidence": 0.86
    }
  ],
  "hypotheses": [
    {
      "claim": "用户在抽象话题中组织句子的速度可能下降",
      "needsVerification": true,
      "nextTest": "在不同主题下完成一次30秒观点表达"
    }
  ]
}
```

只允许 `evidence` 改变稳定画像；`hypotheses` 只能改变下一轮实验，不能直接降低能力分数。

## 6. 可直接用于 G2 的高质量提示词模板

以下模板不是建议原样全部塞入一个请求。它们是按工作流拆分的候选模板，后续应使用匿名会话集进行 A/B 评估。

### 6.1 Session Planner：开始一次练习

```text
# Role
你是 MindIOU 的英语口语练习规划器。你不负责和用户闲聊，也不负责生成长篇教学内容。

# Objective
为接下来 5–20 分钟的真实英语对话选择一个可观察、可完成、略高于用户当前水平的练习任务。

# Learner state
<goal>{{goal}}</goal>
<topic>{{topic}}</topic>
<recent_profile>{{structured_profile}}</recent_profile>
<last_session>{{last_session_summary}}</last_session>
<active_debts>{{active_expression_debts}}</active_debts>

# Planning rules
- 只选择一个主能力瓶颈；不要同时训练五项能力。
- 练习必须与用户给出的主题或真实工作有关。
- 如果上一轮已经练过同一动作，除非有新的证据，否则换一个主题或提高一个小难度。
- 任务要能在 2–4 个用户回答内完成。
- 先设计用户要完成的行为，再设计 AI 要说的话。
- 不要把“继续聊天”“说得很好”“多练习”当作成功标准。
- 如果证据不足，选择低风险的校准任务，不要伪造用户水平。

# Output
只输出符合 schema 的 JSON，不输出解释：
{
  "taskType": "conversation|opinion_structure|tradeoff|expression_reuse|clarification",
  "taskGoal": "",
  "openingQuestion": "",
  "successCriteria": [""],
  "difficulty": "calibration|current|slightly_above_current",
  "feedbackPolicy": "conversation_first|explicit_after_turn|recast_only",
  "maxTurns": 4,
  "reason": "基于哪些结构化证据选择这项任务",
  "uncertainty": "如果判断仍不确定，写出需要下一轮验证的地方"
}
```

### 6.2 Conversation Controller：实时回应当前一句话

```text
# Role
你是 MindIOU 的英语口语对话控制器。你要帮助用户完成当前练习任务，同时保持自然交流。

# Priority order
1. 先回应用户刚刚说的具体内容；
2. 维持当前 task，不擅自换课题；
3. 只反馈一个最值得改变的点；
4. 给一个用户下一轮可以马上完成的动作；
5. 控制语音长度，避免解释抢走用户表达时间。

# Current task
<task>{{task_json}}</task>
<learner_turn>{{transcript}}</learner_turn>
<previous_prompt>{{previous_prompt}}</previous_prompt>
<relevant_context>{{only_relevant_context}}</relevant_context>

# Response rules
- reply 必须具体提到用户刚才的一个主张、例子或选择；不能只说 good job / interesting / tell me more。
- 如果用户表达清楚，先推进任务，不要为了显示智能而纠错。
- 如果需要纠错，只选一个会影响当前目标或反复出现的点。
- 优先给自然改写或一个短例子；不要给完整语法课。
- nextPrompt 必须是一个问题或动作，并且能检验 task 的 successCriteria。
- 不要假设 transcript 之外的事实、职业、意图或情绪。
- 音频不清楚时，只请求用户重复；不要根据不完整音频诊断语法。
- 不要输出隐藏推理，也不要解释你如何评分。

# Length
- reply：1–2 个短句，最多 300 字符；
- feedback：一句话，最多 120 字符；
- nextPrompt：一个问题，最多 160 字符；
- g2Text：最多 42 个字符，不使用 markdown。

# Output schema
{
  "reply": "",
  "feedback": "",
  "nextPrompt": "",
  "g2Text": "",
  "moveType": "goal_link|cause|example|tradeoff|conclusion|clarification|free",
  "shouldContinue": true,
  "evidenceAnchor": "回复所依据的用户原话中的短片段或关键词"
}
```

### 6.3 Turn Evidence Extractor：后台观察，不对用户说话

```text
# Role
你是英语口语学习的证据提取器。你的输出会更新学习状态，不会直接展示给用户。

# Important boundary
只记录当前输入中能观察到的证据。没有证据就返回 false 或 unknown。
不要从一次表达推断稳定能力、人格、智力、职业、CEFR 或长期掌握。
不要把模型自己的改写当成用户已经掌握。

# Input
<task>{{task_json}}</task>
<learner_turn>{{transcript}}</learner_turn>
<prior_known_patterns>{{structured_patterns}}</prior_known_patterns>

# Evidence dimensions
- taskCompletion：是否完成了当前任务要求；
- ideaStructure：是否有观点、原因、例子、结论；
- interaction：是否回应问题、澄清、反驳或推进话题；
- expressionCandidate：是否出现真实需要但不稳定的表达；
- uncertainty：当前判断是否需要下一次独立任务验证。

# Rules
- 每一条 evidence 必须指向当前 turn 的词、短语或结构。
- 只输出最多 4 条最重要证据。
- 如果 transcript 太短、ASR 可疑或话题不清，降低 confidence，并设置 needsVerification=true。
- 不评价音质、发音、重音或停顿，除非输入明确包含经过验证的音频特征。

# Output schema
{
  "evidence": [
    {
      "kind": "task_completion|structure|interaction|expression|uncertainty",
      "claim": "",
      "anchor": "",
      "confidence": 0.0,
      "needsVerification": false
    }
  ],
  "sessionSignals": {
    "gaveOpinion": false,
    "explainedCause": false,
    "gaveExample": false,
    "discussedTradeoff": false,
    "rebutted": false,
    "usedTargetExpression": false
  }
}
```

### 6.4 Session Reflector：结束本轮练习

```text
# Role
你是 MindIOU 的会话复盘器。你只根据结构化证据判断这一轮发生了什么，并选择下一步训练。

# Inputs
<session_task>{{task_json}}</session_task>
<turn_evidence>{{turn_evidence_only}}</turn_evidence>
<user_feedback>{{helpful_or_not_helpful}}</user_feedback>
<previous_profile>{{previous_profile_summary}}</previous_profile>

# Rules
- 不复述整段 transcript；不制造用户没有说过的错误。
- 把“这轮观察到的证据”和“对长期能力的假设”分开。
- 最多选择一个主瓶颈和一个辅助表达。
- 下一步练习必须是一个用户能在 10–20 分钟内完成的具体动作。
- 如果证据不足，输出 needs_more_evidence，不要强行给低分。
- 不能因为用户完成了任务就宣布长期掌握；稳定掌握需要跨会话、跨主题的独立复现。

# Output schema
{
  "observed": [
    {"claim":"", "evidenceIds":[""], "confidence":0.0}
  ],
  "hypotheses": [
    {"claim":"", "why":"", "verificationTask":""}
  ],
  "expressionDebt": {
    "phrase":"",
    "meaning":"",
    "context":"",
    "reason":"",
    "status":"candidate"
  },
  "nextExperiment": {
    "title":"",
    "task":"",
    "durationMinutes":10,
    "successCriteria":[""],
    "whyNow":""
  },
  "confidence":"low|medium|high"
}
```

### 6.5 Content Curator：给用户筛选真正相关的英语输入

```text
# Role
你是 MindIOU 的学习内容筛选器，不是新闻摘要器。

# Objective
从候选文章、帖子、视频和研究资料中，最多选 3 条同时满足以下条件的内容：
1. 与用户当前目标或项目有关；
2. 能帮助用户理解一个真实问题；
3. 难度略高于用户当前英语水平，但可以在本次训练时间内处理；
4. 能转化成一个口语任务；
5. 来源可追溯。

# User context
<goal>{{goal}}</goal>
<current_project>{{project_context}}</current_project>
<speaking_profile>{{profile}}</speaking_profile>
<active_debts>{{debts}}</active_debts>
<candidate_sources>{{sources_with_url_and_metadata}}</candidate_sources>

# Filtering rules
- 不因为热门、标题吸引人或发布了新模型就推荐。
- 如果内容只是发布新闻、重复用户已知信息或没有可提取的能力变化，过滤掉。
- 视频必须基于字幕、转写或关键画面证据；只有标题不能作为已读证明。
- 每条推荐都要写“外面发生了什么”“为什么和用户有关”“用户今天做什么”。
- 不输出未经来源支持的事实，不伪造作者、日期、数字或引用。

# Output schema
{
  "selected": [
    {
      "title":"",
      "url":"",
      "sourceType":"article|video|research|post",
      "relevance":0,
      "difficulty":"below|current|slightly_above|too_hard",
      "whatChanged":"",
      "whyForUser":"",
      "keyExpressions":[""],
      "speakingTask":"",
      "evidence":""
    }
  ],
  "filtered": {
    "duplicate":0,
    "unrelated":0,
    "announcement_only":0,
    "low_density":0
  }
}
```

### 6.6 Prompt / Trace Grader：判断回复是否真的有用

```text
# Role
你是 MindIOU 英语口语 Loop 的质量评估器。你评估系统回复，不评估用户人格或英语总分。

# Inputs
<task>{{task_json}}</task>
<learner_turn>{{learner_turn}}</learner_turn>
<assistant_response>{{assistant_response}}</assistant_response>
<next_learter_turn>{{next_turn_if_available}}</next_learter_turn>

# Score each dimension from 0 to 2
1. anchored: 是否回应了当前用户的具体内容；
2. task_alignment: 是否推进当前任务而不是擅自换题；
3. feedback_actionability: 是否只指出一个可行动改进点；
4. next_action: 下一问题是否可执行、可观察；
5. learner_uptake: 下一轮是否完成了被要求的动作；
6. brevity: 是否适合语音和 G2；
7. epistemic_safety: 是否没有虚构错误、水平、情绪或长期结论。

# Failure labels
- generic_praise
- generic_follow_up
- task_switch
- too_many_corrections
- unsupported_diagnosis
- repeated_prompt
- too_long_for_voice
- no_next_action

# Output
只输出 JSON：
{
  "scores": {"anchored":0,"task_alignment":0,"feedback_actionability":0,"next_action":0,"learner_uptake":0,"brevity":0,"epistemic_safety":0},
  "failureLabels": [""],
  "oneFix": "下一版提示词或控制器只改一个地方",
  "pass": false
}
```

## 7. 防止“傻乎乎回复”的规则清单

### 7.1 运行时硬规则

继续保留并扩展当前 `isUsefulEnglishLoopResponse` 的确定性校验：

- `reply`、`feedback`、`nextPrompt` 都有长度上限；
- `reply` 或 `nextPrompt` 必须和当前 transcript 有关键词或主题锚点；
- 不接受 `tell me more`、`keep going`、`good job` 这类无信息回复作为唯一内容；
- 不接受和上一问题完全相同的问题；
- `nextPrompt` 必须匹配当前 move 的动作类型；
- JSON Schema 不通过时走当前本地 fallback；
- 模型不得改变 `task.type`、用户画像或长期债务状态；
- 实时请求不允许直接写入长期 profile，先写入候选 evidence，再由 session reflector 汇总；
- ASR 置信度低时禁止语法诊断，只请求重复或确认。

### 7.2 产品行为规则

- 每轮只选一个主要学习目标；
- 每次反馈只给一个主要改进点；
- 让用户多说，AI 少说；
- 任何“你经常……”都必须来自多个会话的证据；
- 任何“你已经掌握……”都必须来自跨主题复现；
- 任何“你的发音……”都必须来自音频/发音引擎，而不是 transcript 推断；
- 结束时输出一个可在下一轮验证的实验，不输出十条建议；
- 用户明确说不喜欢某项建议时，记录为 intervention feedback，不要继续强推。

### 7.3 不要把这些词当质量标准

以下表达本身不证明回复有用：

- natural；
- engaging；
- personalized；
- human-like；
- intelligent；
- encouraging；
- adaptive。

它们必须被翻译成可观察行为，例如“用户下一轮是否完成了一个带例子的观点表达”。

## 8. 评估计划：从单轮好看转向连续轨迹有效

### 8.1 评估数据集

第一批建议准备 40–60 条脱敏样本：

- 10 条日常交流；
- 10 条产品/项目介绍；
- 10 条复杂观点和因果解释；
- 10 条 trade-off 与反驳；
- 10 条 ASR 不清、中文夹杂、用户跑题或沉默；
- 可选 10 条跨会话复现样本，用于迁移评估。

每条样本至少包含：

```json
{
  "task": {},
  "learnerTurn": "脱敏文本",
  "expectedMove": "example",
  "acceptableAnchors": ["具体主题词"],
  "goldFeedback": "一个可行动改进点",
  "goldNextAction": "用户下一轮应完成什么",
  "humanNotes": "边界或争议说明"
}
```

### 8.2 三层评估

| 层 | 目的 | 方法 | 不能替代的东西 |
| --- | --- | --- | --- |
| 确定性门禁 | 防止明显坏回复 | JSON schema、长度、锚点、重复、move 类型、敏感字段 | 教学质量 |
| 模型 grader | 批量比较 prompt 版本 | anchored、task alignment、actionability、brevity、epistemic safety、learner uptake | 真实学习效果 |
| 人工复核 | 校准 rubric 和发现 grader hacking | 每周抽检旧/新 prompt、标注争议、修订 gold | 大规模自动回归 |

### 8.3 应该追踪的产品指标

先不做一个综合分数，追踪这些轨迹指标：

1. **下一动作完成率**：用户是否完成了 AI 要求的原因、例子、取舍或结论；
2. **具体反馈复用率**：用户是否在后续语境再次使用目标表达或结构；
3. **跨主题迁移率**：同一结构在新主题中是否仍然出现；
4. **重复泛问率**：模型输出 `tell me more`、`keep going` 或无锚点追问的比例；
5. **反馈负担**：用户跳过、打断或标记“不 helpful”的比例；
6. **会话完成率**：用户是否完成一个完整任务而不是只闲聊；
7. **规划命中率**：下一轮建议是否与人工复核的主要瓶颈一致；
8. **不确定性诚实度**：证据不足时是否输出 needsVerification，而不是伪造结论。

### 8.4 最小 A/B 测试

比较：

- A：当前单阶段 prompt + 规则版 next move；
- B：Session Planner + Conversation Controller + Session Reflector；

保持以下条件一致：模型、主题、最大输出长度、用户目标和设备。主要观察下一动作完成率、反馈负担、重复泛问率和人工质量分，而不是只看模型回答文本是否更漂亮。

## 9. 推荐的开发顺序

### P0：先把当前对话变成任务控制器

- 为每轮增加 `task`、`successCriteria`、`feedbackPolicy`；
- 将当前 `nextMove` 从散落字段升级为结构化对象；
- 把“模型不能换任务”写入 schema 和服务端校验；
- 为当前 7 种 move 建 40–60 条离线评估样本；
- 记录 model response rejected 的具体失败标签，而不只记录 generic。

### P1：增加会话复盘器和候选表达债务

- 会话结束时先由规则聚合 turn evidence；
- 模型只负责解释结构化证据、提出一个假设和一个下一步实验；
- 表达债务先进入 `candidate`，用户再次使用或确认后才进入 `active`；
- 用户反馈会改变 intervention 的可信度，但不直接改变能力分数。

### P2：增加间隔复习和跨主题迁移

- 给表达债务保存 `lastObservedAt`、`lastReusedAt`、`nextReviewAt`；
- 新会话优先从一个到期表达和一个当前目标中选择；
- 复习不直接展示答案，先要求独立回忆；
- 至少两次跨主题复现后再标记 stable。

### P3：接入内容信息 Loop

- 为候选来源保存 URL、来源类型、时间、难度、主题、关键表达；
- 先做来源去重和相关性判断，再做摘要；
- 每条推荐必须落到一次 speaking task；
- 视频只有在字幕/转写/关键画面可验证时才进入推荐池；
- 先做手机/Web 端验证，再考虑 G2 上的极简呈现。

### P4：真实 G2 纵向测试

- 先验证 MIC、STT、延迟、断网、重启和噪声；
- 再做 7 天、每次 10–20 分钟的单用户内部试验；
- 每天收集“建议有用/没用”和“我本来想练什么”；
- 把真实用户标注作为 prompt/eval 数据，不能只用模型自评。

## 10. 安全与隐私边界

这次研究没有改变当前实现的安全边界：

- 不接入本地 Agent；
- 不读取 MCP；
- 不执行工作区工具；
- 不把 API Key 放到 G2 前端；
- 不把完整 transcript 作为长期 profile 存储；
- 未来如果接入网页检索，只允许读取候选来源，不允许让网页内容改变系统指令或触发本地副作用；
- 任何写入项目、发送信息、修改外部数据的 Agent 行为必须单独审批，不能因为“学习 Loop”而默认获得权限。

Anthropic 的 Agent 文章明确指出自主性会增加错误累积，需要沙箱和 guardrails；OpenAI 的 Agent 文档也将自动 guardrail 与高影响动作前的人类审批分开。对 MindIOU 来说，英语口语 Loop 的第一阶段应保持纯学习状态更新和只读内容筛选，不应该把它扩展成可操作本地环境的 Agent。

## 11. 当前研究缺口与待验证问题

- 前沿口语产品大多公开功能，不公开完整学习模型和数据；
- 很多效果结论来自短期、特定任务或小样本，无法直接外推到长期真实工作型口语；
- LLM grader 容易奖励“像反馈的语言”，不一定奖励真实学习；
- transcript 不能替代音频层面的发音、停顿和韵律证据；
- “记住用户”不等于记住正确内容，长期记忆需要可纠正、可过期和可追踪来源；
- 信息推荐的相关性不等于用户应该花时间阅读，必须结合当前目标、已知内容和下一步练习；
- 目前没有足够证据证明某个单一 Agent 架构一定优于可测试的固定 workflow；
- 真实 G2 的设备、噪声、延迟和网络条件可能改变所有 prompt 效果。

## 12. 来源索引

### 产品与官方工程资料

1. [Duolingo Video Call](https://blog.duolingo.com/video-call/)
2. [How Duolingo uses AI to Create the Perfect Speaking Practice](https://blog.duolingo.com/ai-and-video-call/)
3. [ELSA pronunciation feedback](https://elsaspeak.com/en/faqs/how-does-elsas-pronunciation-feedback-work)
4. [Loora speaking practice](https://www.loora.com/support/getting-started/what-is-loora)
5. [Praktika](https://praktika.ai/)
6. [Inside Praktika's conversational approach](https://openai.com/index/praktika/)
7. [Talkpal learning modes](https://talkpal.ai/support/which-learning-modes-are-available-on-talkpal/)
8. [SpeakPal](https://www.speakpal.ai/)
9. [Google Translate language learning](https://blog.google/products-and-platforms/products/translate/language-learning-live-translate/)
10. [Google LearnLM](https://blog.google/products-and-platforms/products/education/google-learnlm-gemini-generative-ai/)
11. [Google Little Language Lessons](https://blog.google/products-and-platforms/products/education/little-language-lessons/)
12. [Microsoft Reading Coach](https://support.microsoft.com/en-us/education/learning-accelerators/getting-started-with-reading-coach)
13. [ChatGPT Study Mode](https://openai.com/index/chatgpt-study-mode/)
14. [NotebookLM for Education](https://edu.google.com/ai-notebooklm/)
15. [NotebookLM Discover Sources](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-discover-sources/)
16. [Readwise Ghostreader](https://docs.readwise.io/reader/guides/ghostreader/overview)
17. [Perplexity Pro Search](https://www.perplexity.ai/help-center/en/articles/10352903-what-is-pro-search)
18. [Anthropic Building Effective AI Agents](https://www.anthropic.com/engineering/building-effective-agents)
19. [Anthropic Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
20. [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
21. [OpenAI Voice Agents](https://developers.openai.com/api/docs/guides/voice-agents)
22. [OpenAI Realtime Models Prompting](https://developers.openai.com/api/docs/guides/realtime-models-prompting)
23. [OpenAI Evaluate Agent Workflows](https://developers.openai.com/api/docs/guides/agent-evals)
24. [OpenAI Graders](https://developers.openai.com/api/docs/guides/graders)
25. [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

### 研究与论文

26. [The impacts of AI conversational agents on EFL learners' oral proficiency and foreign language speaking anxiety](https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2026.1799269/full)
27. [Micro-level AI Feedback Features and Student Responses in Consecutive LLM Tutoring Interactions](https://arxiv.org/abs/2607.08952)
28. [Training LLM-based Tutors to Improve Student Learning Outcomes in Dialogues](https://arxiv.org/abs/2503.06424)
29. [TUTORING: Instruction-Grounded Conversational Agent for Language Learners](https://arxiv.org/abs/2302.12623)
30. [Findings of the BEA 2025 Shared Task on Pedagogical Ability Assessment of AI-powered Tutors](https://arxiv.org/abs/2507.10579)
31. [AI Twin: Enhancing ESL Speaking Practice through AI Self-Clones of a Better Me](https://arxiv.org/abs/2601.11103)
32. [Effects of different AI-driven Chatbot feedback on learning outcomes and brain activity](https://www.nature.com/articles/s41539-025-00311-8)
33. [The Effectiveness of Corrective Feedback in SLA: A Meta-Analysis](https://onlinelibrary.wiley.com/doi/10.1111/j.1467-9922.2010.00561.x)
34. [The type and linguistic foci of oral corrective feedback in the L2 classroom](https://journals.sagepub.com/doi/10.1177/1362168814563200)
35. [The science of effective learning with spacing and retrieval practice](https://doi.org/10.1038/s44159-022-00089-1)
36. [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)
37. [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366)

## 13. 研究记录状态

- 研究类型：公开资料和原始论文的桌面研究；
- 检索日期：2026-08-13；
- 已记录来源：37 项；
- 已记录可直接实验的提示词模板：6 组；
- 已形成的工程建议：任务控制器、证据提取器、会话复盘器、跨会话规划器、内容筛选器和轨迹评估器；
- 尚未完成：真实 G2 纵向试验、音频级评估、人工标注集、线上 A/B 测试和独立学习效果研究。

## 14. 二次检索增补：更多同类产品、用户模型与 Tutor 评估

本节是 2026-08-13 的第二轮检索结果。它不把新增产品功能直接转成需求，而是继续按“事实 / 推断 / 灵感 / 缺口”分开记录。

### 14.1 同类产品正在从“AI 陪聊”转向“个性化练习生成”

| 来源 | 公开事实 | 可迁移的灵感 | 需要警惕的地方 |
| --- | --- | --- | --- |
| [Speak Tutor](https://help.speak.com/en/articles/11396739-what-is-speak-tutor) | Speak Tutor 会根据学习活动调整水平；用户可以询问语法、词汇和发音，创建个性化口语课，并重新访问已经创建的课。 | 个人化不能只表现为“模型记得你”；还要能把当前问题变成一节可重复进入的练习，并允许用户回看、删除或重做。 | 公开页面没有说明它如何确认“这是稳定错误”而不是一次偶然失误。 |
| [Speak 的 Solo para ti / Made for You](https://help.speak.com/es/articles/11565779-como-son-las-clases-personalizadas-solo-para-ti) | 个性化内容来自课程错误、自由对话错误、用户兴趣、当前水平词汇和词汇误用模式。 | 下一轮内容至少应有两个来源：用户真实兴趣 + 已观察到的具体问题；只根据错误生成会让学习内容脱离用户真实目的。 | 产品页没有公开错误聚合、遗忘模型和跨主题迁移的算法。 |
| [Babbel Speak](https://support.babbel.com/hc/en-us/articles/25875402999826-Babbel-Speak) | 每个场景先告诉用户需要完成的任务；用户轮流发言；可以重复、放慢、翻译或请求提示；对话中不打断纠错，结束后再反馈任务完成和词汇。 | 这与 G2 的低打扰体验高度匹配：对话中保持流畅，结束后只选择最值得复用的一项反馈。 | 官方明确这是 beta 功能；同类产品的自然对话能力并不意味着其长期学习效果已经得到验证。 |
| [Busuu Conversations](https://help.busuu.com/hc/en-us/articles/21862192336402-What-are-Busuu-Conversations-and-how-can-they-help-me-learn-a-language) | 每个场景有具体目标；用户选择是否获得针对性词汇和语法反馈；对话结束后再分析；官方同时提醒 AI 偶尔可能给出错误答案。 | G2 必须在反馈中保留证据、置信度和“需要用户确认”的状态，不能把模型分析展示成确定的老师结论。 | 这是官方帮助文档，不是第三方评测；它提醒了错误可能性，却没有给出错误率。 |
| [Memrise](https://www.memrise.com/en-us/learn-french) | 内容根据用户兴趣和水平个性化；使用母语者视频；视频内容与已学词汇匹配；MemBot 提供角色、对话、游戏和任务式口语练习。 | Input Loop 可以采用“真实内容 + 已学表达 + 一个当前任务”的组合，而不是只从词库随机抽取话题。 | “匹配已学词汇”不等于这些词能在自由表达中被主动调用，需要额外的检索和迁移任务。 |

这轮产品扫描补充了一个重要判断：

> 用户感受到的“个性化”，不是画像页上有更多字段，而是下一次练习真的因为上一轮发生过的事情而改变。

因此，G2 每次会话结束至少应该产出一个可观察的变化：

```text
下一次话题改变
或下一次目标改变
或下一次提示时机改变
或下一次材料难度改变
或下一次反馈只聚焦一个已经出现过的问题
```

如果这些都没有改变，系统即使更新了 Speaking Profile，也还没有形成真正的 Loop。

### 14.2 用户模型研究支持“有证据的状态更新”，不支持早期精确打分

#### 知识追踪：先解决冷启动和不确定性

[CLST: Cold-Start Mitigation in Knowledge Tracing](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/854) 把知识追踪描述为根据学习历史估计当前知识状态，并研究使用生成式模型缓解少量学习数据下的冷启动问题。论文报告在少于 100 名学生的数据场景中，模型在预测、可靠性和跨领域泛化方面有提升，但这仍是知识追踪研究，不是 G2 口语能力评分的直接证据。

对 G2 的直接启发是：

- 新用户的第一次对话只能形成 `candidate` 状态，不能生成看似精确的 Speaking Score；
- 每个能力都应保存 `evidenceCount`、`confidence`、`lastObservedAt` 和 `lastReusedAt`；
- 用户在提示后说对，不能直接等同于用户独立掌握；
- “未观察到”不能写成“不会”；
- 分数应该是展示层的压缩结果，后台首先保存证据和不确定性。

建议的状态变化：

```text
unknown
  → candidate（有一次相关证据）
  → emerging（至少两次不同语境的相关证据）
  → provisional（独立完成过一次目标任务）
  → stable（跨日期、跨主题复现）
  → needs_review（长期未复现或新证据相冲突）
```

#### ScaffoldLM：规划、评估记忆和动作选择必须在循环中分工

[Planning-Guided Tutoring with Assessment-Driven Memory](https://aclanthology.org/2026.acl-long.325/) 提出 ScaffoldLM：先生成分步教学计划，再用 assessment-driven control loop 识别学习者状态、判断当前步骤目标是否完成并选择下一种教学动作；计划、步骤进度、学习者状态和对话历史共同进入记忆。

这比“一个 Prompt 里同时写老师人格、长期记忆、下一步任务和当前回复”更接近我们需要的结构。对英语口语可以迁移为：

```text
Session Plan
  → 当前目标和成功标准
Turn Assessment
  → 这一句是否完成当前目标
Learning State
  → 能力、表达、置信度和证据
Action Selection
  → continue / clarify / hint / recast / feedback / end
```

关键区别是：模型不应该直接凭自然语言总结决定长期状态，而应该先判断“当前任务目标是否完成”，再由状态更新器决定是否允许影响长期画像。

#### 自适应学习研究：下一步规划可能比聊天风格更重要

一项 2026 年针对 414 名研究生英语学习者的准实验研究比较了个性化学习路径、对话式 AI Tutor、AI 协作平台和传统计算机辅助语言学习；论文报告个性化学习路径在流利度、准确度、句法复杂度、元认知监测和口语焦虑方面有较大变化。[研究页面](https://journals.sagepub.com/doi/10.1177/07356331261425496)

这项研究的可迁移点不是具体数字，而是它把“自适应路径”作为独立干预进行比较。对 MindIOU 来说，需要单独测量：

- 用户是否完成了系统选择的下一步；
- 下一步是否与上一轮观察到的瓶颈一致；
- 同一能力是否在新主题中出现迁移；
- 用户能否解释为什么本轮要练这个，而不是另一个。

不能把这项研究直接解释为“任何自适应 AI 都有效”。它是特定人群、特定课程和特定实验设计的结果，仍需要 Even G2 内部验证。

### 14.3 口语评估应该拆成 ASR、语言表现和教学反馈三个层次

[Speak & Improve Challenge 2025](https://arxiv.org/abs/2412.11985) 将 L2 英语语音研究拆成四个任务：ASR、Spoken Language Assessment、Spoken Grammatical Error Correction 和 Spoken Grammatical Error Correction Feedback，并提供带有转写、停顿、语法错误和能力评分的学习者语音数据集。

这给 G2 一个非常明确的工程边界：

```text
Audio / MIC 层
  → 我到底听到了什么？

Language Evidence 层
  → 用户在语法、词汇、流利度、组织和发音上表现出什么？

Pedagogical Action 层
  → 现在该继续、追问、重述、提示，还是结束？
```

现在如果只把 STT transcript 交给大模型，模型很容易把识别错误误判为语言错误，也无法可靠判断重音、语调、音素和真实停顿。未来必须把 `asrConfidence`、`audioEvidenceAvailable` 和 `textOnlyLimitations` 放入 Turn Evidence。

### 14.4 Tutor 质量必须测“学生下一步是否变好”，而不仅是回答是否像老师

[BEA 2025 Shared Task](https://aclanthology.org/2025.bea-1.77/) 将 AI Tutor 评估拆成错误识别、错误定位、指导和反馈可行动性，并以人工标注作为基准。其报告显示，最好的结果在这些教学能力轨道上仍有明显提升空间。

[SHAPE](https://aclanthology.org/2026.acl-long.529/) 进一步关注“教学越狱”：学生用要求答案的方式诱使系统直接给解法，而不是提供脚手架。它使用知识掌握图、明确的 instructing / problem-solving gate 和 9,087 个学生问题对 Tutor 行为进行评估。

[“Keep up the good work!”](https://aclanthology.org/2024.sigdial-1.11/) 的约束提示词实验也说明，把教学约束完整写入 Prompt 可以提高流畅度和帮助性，但“遵守约束”与“用户真正觉得有帮助”不是同一个指标。

因此，G2 的评估器不能只问：

> 这句回复听起来像不像一个耐心的老师？

至少要分开评估：

| 维度 | 评估问题 |
| --- | --- |
| State understanding | 是否正确理解用户当前是在完成、卡住、偏题还是音频不清？ |
| Task alignment | 是否仍然服务当前 Speaking Task，而不是擅自换课？ |
| Scaffolding | 是否给了最小必要帮助，而不是直接替用户说完？ |
| Question quality | 追问是否要求用户继续组织、解释、举例或验证？ |
| Feedback actionability | 用户下一轮是否知道具体要尝试什么？ |
| Topic recovery | 用户偏题后是否自然拉回，而不是强行打断？ |
| Epistemic honesty | 是否把猜测当成了长期能力事实？ |
| Learner uptake | 用户下一轮是否真的复用了反馈？ |

### 14.5 二次检索后新增的高质量 Prompt 模式

下面这些是从新增研究中提炼的 Prompt 片段，不建议直接替换现有系统提示词；它们应分别放到 Planner、Controller、Evidence Extractor 和 Grader 中。

#### 模式 A：教学动作门控

```text
你是 English Loop 的动作门控器，不是回复生成器。

输入：
- currentTask
- successCriteria
- learnerUtterance
- conversationState
- lastTurnEvidence

先把学习者状态分类为且只能为一个：
- in_progress：回答尚未完成，但仍在尝试
- completed：已经完成当前任务
- stuck：明确表示不会、停顿后放弃或重复同一词
- off_topic：内容偏离当前任务
- unclear_audio：无法确认实际说了什么

再选择且只能选择一个动作：
- continue
- clarify
- minimal_hint
- recast
- post_turn_feedback
- end_task

规则：
1. in_progress 不允许输出完整答案；
2. unclear_audio 不允许把 ASR 结果当成语言错误；
3. completed 默认 continue 或 end_task，不自动制造问题；
4. stuck 只给一个最小提示，不给整句标准答案；
5. off_topic 先用一句话承接，再问一个回到 currentTask 的问题；
6. 如果没有足够证据，返回 needs_more_evidence，不猜测能力状态。

只输出 JSON：
{
  "state": "...",
  "action": "...",
  "reasonEvidence": ["..."],
  "nextUserAction": "...",
  "shouldUpdateLongTermProfile": false
}
```

#### 模式 B：只产生一个可复用反馈

```text
你是英语口语反馈器。

当前目标：{currentTask}
用户原话：{learnerUtterance}
已确认的证据：{evidence}
本轮允许关注的问题：{focusIssue}

输出规则：
- 只反馈一个最重要、最可能在下一轮复用的问题；
- 先指出用户已经完成的部分，再指出一个改进点；
- 给一个短的自然改写，但不要替用户写完整答案；
- 最后给一个必须由用户自己完成的重试动作；
- 不要列出其他语法、发音或词汇问题；
- 不要使用“非常棒、继续努力、你进步很大”等没有证据的泛泛表扬；
- 最多 2 句给用户看的反馈，最多 1 个重试问题。

只输出：
{
  "observed": "基于原话的事实",
  "oneImprovement": "一个可行动改进点",
  "recast": "不超过 12 个词的自然表达",
  "retryPrompt": "要求用户重新表达的问题",
  "confidence": 0.0
}
```

#### 模式 C：评估记忆而不是“写一篇总结”

```text
你是 Speaking Profile 的证据更新器。

不要从整段 transcript 直接生成学习总结。
只处理已经由规则层提取的 turnEvidence。

对每个候选能力或表达：
1. 找出本轮支持它的具体证据；
2. 区分 independent_success、prompted_success、failure、not_observed；
3. 如果只有一次证据，最多更新为 candidate；
4. 只有跨日期或跨主题的独立成功，才允许提高到 stable；
5. 如果新证据和旧状态冲突，标记 needs_review，不要覆盖旧证据；
6. 不得因为用户听懂了模型改写，就判定用户已经掌握。

输出每一项：
{
  "skill": "...",
  "evidenceType": "...",
  "evidence": "...",
  "previousState": "...",
  "proposedState": "...",
  "confidence": 0.0,
  "whyNotCertain": "...",
  "nextVerificationTask": "..."
}
```

#### 模式 D：把外部内容变成练习，而不是变成摘要

```text
你是 MindIOU 的英语输入筛选器。

用户状态：{speakingProfile}
当前真实目标：{currentGoal}
最近需要复用的表达或能力：{targetItems}
候选来源：{sources}

只有同时满足以下条件才推荐：
1. 内容与用户当前目标有明确关系；
2. 难度略高于用户当前水平，但不是明显不可理解；
3. 内容中存在至少一个 targetItem 可用于口语任务；
4. 来源可验证，且不是重复或只有新闻标题；
5. 能设计一个 5–10 分钟的听后/读后说任务。

输出：
{
  "decision": "recommend | reject | needs_review",
  "source": {"title":"...","url":"...","sourceType":"..."},
  "whyForThisUser": "基于用户状态的具体理由",
  "targetExpression": "...",
  "speakingTask": "用户必须自己完成的口语任务",
  "difficultyReason": "...",
  "evidenceLimit": "来源或难度判断的不确定性"
}
```

#### 模式 E：用“下一轮用户行为”验证反馈

```text
你是 Tutor Trace Grader。

不要评价回复是否漂亮，也不要根据语气判断教学质量。
比较当前回复和用户下一轮真实行为。

评分 0–2：
- state_understanding：状态理解
- task_alignment：任务保持
- minimal_intervention：干预是否最小
- evidence_grounding：是否引用了真实证据
- learner_uptake：用户是否复用了反馈
- transfer_signal：新主题中是否出现迁移

硬失败：
- 用户没说完时直接给完整答案；
- 把一次 ASR 不确定结果当成语言错误；
- 无证据地改变长期能力状态；
- 一次反馈列出三个以上主要问题；
- 没有回应用户原话或当前目标。

输出：
{
  "scores": {},
  "hardFailures": [],
  "evidence": [],
  "onePromptFix": "只提出一个下一版修改建议"
}
```

### 14.6 这轮检索带来的新增工程决策建议

以下不是已经确认的产品需求，而是建议进入下一次实现评审的候选决策：

1. **把“学习状态”从“分数”改成“状态 + 证据 + 置信度”。** 分数只在有足够证据时展示；新用户默认展示“正在了解中”。
2. **把会话动作做成显式 gate。** Planner 决定练什么，Controller 决定现在做什么，Response Renderer 只负责把动作说出来。
3. **默认不在用户说话中途纠错。** 只有用户明确求助、长时间卡住或当前任务无法继续时，才允许最小提示。
4. **把“表达欠条”分成 candidate / active / stable。** 一次卡顿只能产生 candidate；再次独立复用后才进入 active；跨日期和跨主题复现后才可以 stable。
5. **把语音证据和文本证据分开。** 当前只有 transcript 时，不得给出强发音结论。
6. **把内容推荐的成功标准改为“看完之后完成了一个口语动作”。** 阅读量、点击率和摘要满意度只能作为辅助指标。
7. **评估器必须看到轨迹。** 至少包含当前任务、用户原话、系统动作、系统反馈、用户下一轮行为和状态变化。
8. **模型自评不能作为唯一验收。** 研究和产品资料都支持使用人工样本、结构化 grader 和真实用户 uptake 共同验证。

### 14.7 新增来源索引

本轮新增来源：

38. [Speak Tutor](https://help.speak.com/en/articles/11396739-what-is-speak-tutor)
39. [Speak: Personalized Lessons / Made for You](https://help.speak.com/es/articles/11565779-como-son-las-clases-personalizadas-solo-para-ti)
40. [Babbel Speak](https://support.babbel.com/hc/en-us/articles/25875402999826-Babbel-Speak)
41. [Busuu Conversations](https://help.busuu.com/hc/en-us/articles/21862192336402-What-are-Busuu-Conversations-and-how-can-they-help-me-learn-a-language)
42. [Memrise AI tutor and MemBot](https://www.memrise.com/en-us/learn-french)
43. [CLST: Cold-Start Mitigation in Knowledge Tracing](https://jedm.educationaldatamining.org/index.php/JEDM/article/view/854)
44. [Speak & Improve Challenge 2025](https://arxiv.org/abs/2412.11985)
45. [Adaptive and Collaborative AI Tools for Academic Speaking](https://journals.sagepub.com/doi/10.1177/07356331261425496)
46. [SHAPE: Unifying Safety, Helpfulness and Pedagogy](https://aclanthology.org/2026.acl-long.529/)
47. [Planning-Guided Tutoring with Assessment-Driven Memory](https://aclanthology.org/2026.acl-long.325/)
48. [BEA 2025 Shared Task on AI Tutor Evaluation](https://aclanthology.org/2025.bea-1.77/)
49. [Keep up the good work: Constraints in Zero-Shot Teacher Responses](https://aclanthology.org/2024.sigdial-1.11/)
50. [Customizing ChatGPT for Second Language Speaking Practice](https://arxiv.org/abs/2603.14884)

## 15. 二次检索后的研究状态

- 已记录来源：50 项；
- 已记录同类口语产品和相关功能：至少 11 类；
- 已记录可直接实验的提示词模板：11 组；
- 新增的核心机制：教学动作门控、评估驱动记忆、冷启动状态、音频/文本证据分离、反馈后的用户行为验证；
- 新增的核心评估维度：状态理解、任务保持、最小干预、证据支撑、学习者采纳、跨主题迁移；
- 仍未完成：把新增 Prompt 接入实际 G2 运行时、用真实录音建立标注集、完成 7 天纵向试验和独立评估。
