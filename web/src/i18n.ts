export type Locale = 'zh-CN' | 'en'

const STORAGE_KEY = 'mindiou_locale'

const translations: Record<string, string> = {
  '创始档案': 'Genesis archive',
  '首页': 'Home', '原理': 'How it works', '进入工作区': 'Open dashboard', '开始体验': 'Get started',
  'AI 完成任务，不等于你获得能力': 'AI finishing the task does not mean you gained the ability',
  '看见 AI 替你跳过的那段理解': 'See the understanding AI skipped for you',
  '识别被代劳的推理，生成一笔可解释、可验证、可清偿的认知欠条。': 'Identify delegated reasoning and turn it into cognitive debt you can explain, verify, and repay.',
  '生成我的认知欠条': 'Generate my cognitive debt', '看看它如何工作': 'See how it works',
  '一个正在发生的问题': 'A problem unfolding now', '产出越来越好，能力却未必同步增长': 'Better output does not always mean stronger ability',
  'AI 可以显著提高当下表现，但一旦代劳的推理没有被重新取回，结果就可能留在工具这一侧。': 'AI can improve immediate performance, but when delegated reasoning is never reclaimed, the result may remain on the tool’s side.',
  '有 AI 辅助时，练习表现更好': 'Practice performance improved with AI', '撤去 AI 后，独立表现反而下降': 'Independent performance fell after AI was removed',
  '研究边界': 'Research boundary', '你以为你会了，其实只是 AI 会': 'You may have finished it without learning to do it',
  '先看清债务是什么': 'First, see what the debt is', '认知债务，不是普通的知识盲区': 'Cognitive debt is not an ordinary knowledge gap',
  '知识盲区': 'Knowledge gap', '我没有学过，也知道自己不会': 'I have not learned it, and I know I cannot do it yet',
  '认知债务': 'Cognitive debt', '我借助 AI 做完了，因此误以为自己掌握': 'I finished with AI and mistook completion for mastery',
  'MindIOU 不是让你少用 AI': 'MindIOU is not asking you to use less AI', '三步，把债务变成能力': 'Three steps from debt to ability',
  '粘贴 AI 辅助材料': 'Paste AI-assisted work', '生成认知债务报告': 'Generate a cognitive debt report', '费曼式清偿': 'Repay through explanation',
  '一份报告，不是一份总结': 'A report, not a summary', '它要回答的，是你究竟欠下了什么': 'It shows exactly what understanding you owe',
  '工作时拿到结果，碎片时间把能力拿回来': 'Get the result at work; reclaim the ability in spare moments',
  '别让理解停留在 AI 那一侧': 'Do not leave your understanding on the AI side', '生成我的第一笔认知欠条': 'Generate my first cognitive debt',
  '中文': 'Chinese', '英文': 'English', '登录 MindIOU': 'Sign in to MindIOU', '账户登录': 'Sign in',
  '用邮箱和密码登录你的账户': 'Use your email and password to continue', '邮箱': 'Email', '密码': 'Password',
  '登录': 'Sign in', '登录中…': 'Signing in…', '还没有账户？注册': 'New to MindIOU? Create an account',
  '创建 MindIOU 账户': 'Create your MindIOU account', '创建账户': 'Create account',
  '填写邮箱和密码创建你的 MindIOU 账户': 'Create an account with your email and password',
  '密码（至少 8 位）': 'Password (at least 8 characters)', '确认密码': 'Confirm password',
  '昵称（可选）': 'Name (optional)', '已有账户？登录': 'Already have an account? Sign in',
  '我的账户': 'My account', '今日复训': "Today's review", '认知清偿': 'Repayment', '设备Token': 'Device tokens',
  '退出登录': 'Sign out', '识别你跳过的认知债务': 'Find the cognitive work AI skipped for you',
  '粘贴一段你用 AI 辅助完成的工作材料。MindIOU 会分析哪些理解过程被 AI 代劳了，并生成一份认知债务报告。': 'Paste work you completed with AI. MindIOU identifies the reasoning you delegated and turns it into a cognitive debt report.',
  '开始新的分析': 'Start a new analysis', '我的认知仪表盘': 'My cognitive dashboard',
  '已生成报告': 'Reports created', '尚未清偿': 'Outstanding debts', '最近一份报告': 'Latest report',
  '最近一次会话': 'Latest session', '可以继续': 'Continue where you left off', '继续清偿': 'Continue repayment',
  '暂无报告': 'No reports yet', '暂无清偿会话': 'No clearance sessions yet', '暂无待清偿欠条': 'No outstanding debts',
  '正在加载你的认知账户…': 'Loading your cognitive account…', '加载失败，请重试': 'Could not load your dashboard. Try again.',
  '重试': 'Try again', '查看报告': 'View report', '进行中': 'In progress', '已结束': 'Completed',
  '接下来会经历什么': 'What happens next', '使用演示样本（服务器事故排查）': 'Use the demo sample (server incident investigation)',
  '公开体验环境：请勿粘贴密码、密钥或客户隐私。': 'Public demo: do not paste passwords, secrets, or customer data.',
  '看看 AI 帮你做了什么': 'Review what AI did for you',
  '正在加载时间线…': 'Loading timeline…', '一、AI 完成了什么': '1. What AI completed',
  '二、你真正贡献了什么': '2. What you actually contributed', '三、最危险的理解缺口': '3. Highest-risk understanding gaps',
  '四、事实与推断': '4. Facts and inferences', '六、下一步行动': '6. Next actions',
  '你的回答': 'Your answer', '提交回答': 'Submit answer', '结束清偿': 'End session', '正在加载会话…': 'Loading session…',
  '服务暂时不可用，请稍后重试': 'The service is temporarily unavailable. Please try again.',
  '登录状态已失效，请重新登录': 'Your session has expired. Please sign in again.',
  '服务处理失败，请稍后重试': 'The service could not process this request. Please try again.',
  '请求过于频繁，请稍后重试': 'Too many requests. Please wait and try again.',
  '网络连接失败，请检查网络或后端服务是否可用': 'Network connection failed. Check your connection and try again.'
  , 'AI 把你的材料拆成协作步骤': 'AI breaks your material into collaboration steps'
  , '你在每一步上标注「我哪里没看懂」': 'Mark what you did not understand at each step'
  , '基于你的困惑生成认知债务报告': 'Generate a cognitive debt report from your questions'
  , '粘贴 AI 协作对话、AI 生成的方案、黑客松记录、会议纪要…': 'Paste an AI-assisted conversation, AI-generated plan, hackathon log, meeting notes…'
  , 'AI 正在拆解你的协作步骤，通常需要 15-30 秒…': 'AI is mapping your collaboration steps. This usually takes 15–30 seconds…'
  , '拆解失败，请重试': 'Could not analyze the material. Try again.'
  , '时间线与困惑': 'Timeline and questions'
  , 'AI 把你的材料拆成了下面的协作步骤。请在每一步下方标注你的困惑——哪里没看懂、哪里不确定。这些困惑会成为生成报告的关键输入。': 'AI mapped your material into the collaboration steps below. Mark anything you did not understand or feel unsure about. Your notes become key evidence for the report.'
  , 'AI 不可用，已用结构化切分兜底。你仍可标注困惑并生成报告。': 'AI is unavailable, so MindIOU used a structural fallback. You can still mark questions and generate a report.'
  , '我在这步的困惑（可选）': 'What confused me in this step (optional)'
  , '哪里没看懂、哪里不确定…': 'What did you not understand or feel unsure about?'
  , '正在基于你的困惑生成报告，通常需要 30-60 秒…': 'Generating your report from your questions. This usually takes 30–60 seconds…'
  , '生成失败，请重试': 'Could not generate the report. Try again.'
  , '认知债务报告': 'Cognitive debt report'
  , '正在加载报告…': 'Loading report…'
  , '当前为降级模式生成的报告，部分内容可能不完整。': 'This report was generated in fallback mode and may be incomplete.'
  , '你的困惑如何被处理': 'How your questions were addressed'
  , '你在时间线上标注的困惑，报告是这样回应的。': 'Here is how the report addressed the questions you marked on the timeline.'
  , '原文证据 · 来自输入材料': 'Original evidence · from your input'
  , '系统判断依据': 'Why MindIOU reached this conclusion'
  , '为什么重要': 'Why it matters'
  , '事实': 'Fact', '推断': 'Inference', '假设': 'Hypothesis', '决定': 'Decision', '取舍': 'Trade-off'
  , '参考来源': 'Sources', '参考要点': 'Key reference points'
  , '每张卡片对应一个被 AI 代劳的理解过程。用自己的话解释它，清偿这笔欠条。': 'Each card represents understanding delegated to AI. Explain it in your own words to repay the debt.'
  , '开始清偿': 'Start repayment', '正在创建会话…': 'Creating session…', '创建会话失败': 'Could not create the session'
  , '清偿会话': 'Repayment session', '清偿问题': 'Repayment question', '你的解释': 'Your explanation'
  , '写下你的解释…': 'Write your explanation…', '提交解释': 'Submit explanation'
  , 'AI 正在分析你的回答…': 'AI is analyzing your answer…', '正在评估…': 'Evaluating…'
  , '做得好的地方': 'What you did well', '仍需补足': 'What still needs work', '教学补充': 'Teaching note', '下一问': 'Next question'
  , '作答历史': 'Answer history', '结束会话': 'End session', '正在生成最终结果…': 'Generating final result…'
  , '结束会话失败': 'Could not end the session', '会话加载失败': 'Could not load the session'
  , '会话已不存在，可能服务已重启。请返回报告重新开始。': 'This session is no longer available. Return to the report and start again.'
  , 'AI 评价暂不可用，本次为本地评价结果，可稍后重试。': 'AI evaluation is temporarily unavailable. This result was produced locally; you can retry later.'
  , '今天没有复训任务': 'No review tasks today', '开始复训': 'Start review'
  , '认知欠条': 'Cognitive debts', '暂无认知欠条': 'No cognitive debts yet', '待清偿': 'Outstanding', '已清偿': 'Repaid'
  , '认知欠条详情': 'Cognitive debt details', '来源证据': 'Source evidence', '练习历史': 'Practice history'
  , '设备 Token 管理': 'Device token management', '已有设备 Token': 'Existing device tokens', '暂无设备 Token': 'No device tokens'
  , '设备名称（如：我的 Rokid）': 'Device name (for example: My Rokid)', '生成 Token': 'Generate token'
  , 'Token 已生成，请立即复制保存（关闭后不可再查看）': 'Token generated. Copy and save it now; it will not be shown again.'
  , '复制': 'Copy', '撤销': 'Revoke', '加载中…': 'Loading…', '正在连接': 'Connecting', 'AI 服务已连接': 'AI service connected', '服务未连接': 'Service unavailable'
  , '提交失败，请重试': 'Could not submit. Try again.', '加载失败': 'Could not load', '返回输入': 'Back to input'
  , '一段 AI 推理路径中，被跳过的理解生成了一笔认知欠条': 'A skipped step in an AI reasoning path becomes cognitive debt'
  , '拆解问题': 'Break down the problem', '识别所需能力与边界': 'Identify the required capabilities and boundaries'
  , '被跳过的推理': 'Skipped reasoning', 'AI 已为你跨越': 'AI crossed this step for you', '形成方案': 'Build the solution'
  , '整合策略与取舍': 'Combine strategy and trade-offs', '认知欠条 01': 'Cognitive debt 01', '待解释': 'Needs explanation'
  , '为什么这个方案在高并发下仍然安全？': 'Why is this solution still safe under high concurrency?'
  , '欠条生成于 10:42': 'Debt created at 10:42', '打开欠条': 'Open debt'
  , '在一项高中数学随机对照研究中，定制 AI 辅导显著提高了练习阶段的成绩。': 'In a randomized high-school mathematics study, customized AI tutoring substantially improved practice performance.'
  , '同一研究提示：即时完成得更好，不等于已经形成可以独立调用的能力。': 'The same study suggests that stronger immediate performance does not necessarily create independently usable ability.'
  , '这不意味着所有 AI 使用都会伤害学习。它说明的是一种风险：如果认知工作被持续代劳，产出提升与能力增长可能彼此分离。': 'This does not mean all AI use harms learning. It identifies a risk: when cognitive work is continually delegated, output gains and capability growth can diverge.'
  , '数据来源：Bastani 等，PNAS，2025。': 'Source: Bastani et al., PNAS, 2025.'
  , '你交付了方案，但能复述出推理过程吗？': 'You delivered the solution—but can you reconstruct the reasoning?'
  , 'AI 帮你跳过了拆解、判断、权衡——这些被跳过的理解，会在你需要独立决策时暴露。': 'AI helped you skip decomposition, judgment, and trade-offs. Those missing steps surface when you must decide independently.'
  , '你跳过的每个理解，都是一笔会到期的欠条': 'Every skipped piece of understanding is a debt that eventually comes due'
  , '认知债务不像知识盲区，它是你已经「透支」过的能力：你以为你会，其实只是 AI 会。': 'Cognitive debt is capability you have already borrowed against: you think you can do it, but only the AI can.'
  , 'AI 给了答案，但你没法验证它对不对': 'AI gave you an answer, but you cannot verify it'
  , '没有验证能力的答案，在关键场合等于没有答案。': 'An answer you cannot verify is no answer when the stakes matter.'
  , '真正危险的不是“我不会”，而是借助 AI 完成交付后，把一份可用的结果误认为自己的能力。': 'The real danger is not knowing that you cannot do something; it is mistaking an AI-assisted result for your own ability.'
  , '边界清楚，因此更容易主动学习、询问或补足。': 'The boundary is clear, making it easier to learn, ask, and close the gap deliberately.'
  , '它会在需要解释、判断、验证或独立决策的时刻暴露。': 'It surfaces when you need to explain, judge, verify, or decide independently.'
  , '“知识盲区是我不知道；认知债务是我不知道自己不知道。”': '“A knowledge gap is what I know I do not know; cognitive debt is what I do not know I do not know.”'
  , '真实工作研究已经证明 AI 可以提升生产率。问题不在于代劳本身，而在于你是否知道交出了什么、哪些能力必须拿回来。': 'Research in real work settings shows that AI can improve productivity. The issue is whether you can see what you delegated and which abilities you need to reclaim.'
  , 'AI 协作对话、AI 生成的方案、黑客松记录……任何一段 AI 帮你完成的工作。': 'An AI-assisted conversation, AI-generated plan, hackathon log, or any work AI helped you complete.'
  , '七部分报告揭示：AI 完成了什么、你真正贡献了什么、最危险的缺口在哪里。': 'A seven-part report reveals what AI completed, what you contributed, and where the highest-risk gaps are.'
  , '选一笔欠条，用自己的话解释清楚。AI 基于来源给出反馈，告诉你漏了什么、该怎么补。': 'Choose one debt and explain it in your own words. AI gives source-grounded feedback on what you missed and how to improve.'
  , '深入了解每个环节 →': 'Explore every step →'
  , 'MindIOU 把真实协作拆成七个视角，让“我好像会了”变成一组可以验证和行动的具体问题。': 'MindIOU examines real collaboration from seven angles, turning “I think I understand” into concrete questions you can verify and act on.'
  , 'AI 完成了什么': 'What AI completed', '哪些拆解、推理、判断与权衡被代劳': 'Which decomposition, reasoning, judgments, and trade-offs were delegated'
  , '你真正贡献了什么': 'What you contributed', '保留你已经做出的理解与决定': 'Preserve the understanding and decisions that were genuinely yours'
  , '最危险的理解缺口': 'Highest-risk gaps', '优先识别高风险、可复用的根能力': 'Prioritize high-risk, reusable foundational abilities'
  , '事实与推断': 'Facts and inferences', '区分证据、假设、待验证问题与取舍': 'Separate evidence, hypotheses, open questions, and trade-offs'
  , '费曼补偿卡': 'Feynman repayment cards', '把缺口变成需要你亲自解释的任务': 'Turn gaps into tasks you must explain yourself'
  , '下一步行动': 'Next actions', '验证、记录、请教或安排再次练习': 'Verify, record, ask for help, or schedule another practice'
  , '困惑处理回执': 'Question resolution receipt', '看见你提出的问题如何进入报告': 'See how your questions shaped the report'
  , '大块工作产生欠条，小块时间完成清偿': 'Create debt during deep work; repay it in small pockets of time'
  , '无需重新学习整份材料。MindIOU 把最值得清偿的一笔债务，变成几分钟内可以完成的解释、反馈与再回答。': 'You do not need to relearn everything. MindIOU turns the most valuable debt into a short loop of explanation, feedback, and another answer.'
  , '工作时': 'While working', '借助 AI 完成真实任务': 'Complete real work with AI', '留下认知欠条': 'Leave a cognitive debt record'
  , '碎片时间': 'In spare moments', '选一张卡，用自己的话解释': 'Choose a card and explain it yourself', '收到基于来源的反馈': 'Receive source-grounded feedback'
  , '之后复盘': 'Review later', '再次回答同一笔债务': 'Answer the same debt again', '谨慎更新清偿状态': 'Update repayment status conservatively'
  , '目标不是减少 AI 代劳，而是让代劳变得可见、可控、可清偿。': 'The goal is not less AI delegation, but delegation that is visible, controlled, and repayable.'
  , '粘贴一段真实的 AI 协作材料，生成你的第一笔认知欠条。': 'Paste real AI-assisted work and generate your first cognitive debt.'
  , '无需配置 · 固定样本可直接体验 · 先看见，再决定清偿什么': 'No setup required · Try a fixed sample · See the debt before deciding what to repay'
  , '把 AI 代劳转化为真实能力成长': 'Turn AI delegation into real capability growth'
  , '输入材料': 'Input material', '隐私提示': 'Privacy notice', '隐私提示 ·': 'Privacy notice ·'
  , '归入项目记忆': 'Attach to project memory'
  , '选择项目后，当前报告会和会话摘要、功能任务、产出物及认知欠条建立关联。': 'Choose a project to link this report with its session summary, work items, artifacts, and cognitive debts.'
  , '选择项目后，生成报告会自动把本次材料归入项目记忆。': 'Choose a project and the generated report will be added to its project memory automatically.'
  , '生成后不关联项目': 'Do not attach to a project', '新项目名称（可选）': 'New project name (optional)'
  , '选择后自动归入': 'Attach automatically after selection', '新建项目': 'New project', '项目名称': 'Project name'
  , '还没有项目；可在右侧输入项目名称后新建。': 'No projects yet. Enter a project name on the right to create one.'
  , '项目列表暂时不可用，报告仍可正常生成。': 'The project list is temporarily unavailable. You can still generate the report.'
  , '正在同步到项目记忆…': 'Syncing with project memory…', '正在建立项目关联…': 'Creating the project link…'
  , '项目关联失败，请稍后重试': 'Could not link the project. Try again later.', '请先输入项目名称。': 'Enter a project name first.'
  , '项目已创建，点击“归入项目记忆”完成关联。': 'Project created. Click “Attach to project memory” to finish linking it.'
  , '项目已创建，生成报告后会自动归入。': 'Project created. The report will be attached automatically after it is generated.'
  , '项目创建失败': 'Could not create the project'
  , '首期导入限制': 'Launch limits'
  , '文本超过 30,000 字符，请分段导入或先摘要后再分析。': 'Text exceeds 30,000 characters. Split it into sections or summarize it first.'
  , '时间线草稿加载失败': 'Could not load the timeline draft', '新报告': 'New report', '返回首页': 'Back to home'
  , '五、选择一笔认知欠条来清偿': '5. Choose a cognitive debt to repay', '归入缺口 #': 'Mapped to gap #'
  , '暂无': 'None yet', '已尝试': 'Attempted', '返回报告': 'Back to report'
  , '请写得更完整一些再提交。': 'Please add a little more detail before submitting.', '正在分析…': 'Analyzing…'
  , '项目记忆': 'Project memory', '暂无项目 Token': 'No project tokens yet'
  , '项目 Token 已生成，请立即复制保存；关闭或刷新后不可再查看。': 'Project token generated. Copy and save it now; it cannot be shown again after closing or refreshing.'
  , '项目 Token 已撤销。': 'Project token revoked.', '选择项目': 'Select a project', '项目 Token': 'Project token'
  , 'Token 名称': 'Token name', '请输入 Token 名称。': 'Enter a token name.', '生成中…': 'Generating…'
  , '无法加载项目 Token 列表': 'Could not load project token list', '撤销失败': 'Could not revoke', '请选择项目': 'Select a project'
  , '用户画像': 'User profile', '去做认知清偿': 'Start repayment', '返回工作区': 'Back to workspace'
  , '正在加载用户画像…': 'Loading your profile…', '已建立的能力领域': 'Capability domains', '已记录的能力维度': 'Capability dimensions'
  , '持续更新': 'Updating', '待开始': 'Not started', '画像状态': 'Profile status', '还没有形成能力画像': 'No capability profile yet'
  , '查看待清偿欠条': 'View outstanding debts', '能力维度': 'Capability dimensions', '能力领域': 'Capability domain', '通用': 'General'
  , '稳定性：': 'Stability: ', '最近更新：': 'Last updated: ', '更新于 ': 'Updated '
  , '这个领域还没有足够的分维度证据。': 'This domain does not have enough dimension-level evidence yet.'
  , '概念理解': 'Conceptual understanding', '因果解释': 'Causal explanation', '实践复现': 'Practical reproduction'
  , '边界与风险': 'Boundaries and risks', '迁移能力': 'Transfer ability'
  , 'PROJECT MEMORY': 'PROJECT MEMORY', '项目列表': 'Project list', '搜索项目记忆': 'Search project memory'
  , '功能、文件、函数、Commit 或认知欠条…': 'Feature, file, function, commit, or cognitive debt…', '搜索': 'Search', '正在搜索…': 'Searching…'
  , '没有找到匹配的项目记忆。': 'No matching project memory found.', '搜索暂时不可用，当前项目页面仍可继续查看。': 'Search is temporarily unavailable. You can still view the current project page.'
  , '项目认知账本': 'Project cognitive ledger', '我的项目': 'My projects', '正在加载项目…': 'Loading projects…'
  , '正在加载项目记忆…': 'Loading project memory…', '导入 Agent 对话': 'Import Agent conversation'
  , '粘贴 AI 协作对话，或输入 JSON / JSONL / Markdown 文本…': 'Paste an AI collaboration transcript, or enter JSON / JSONL / Markdown…'
  , '不保存原始内容（推荐）': 'Do not store raw content (recommended)', '仅保存脱敏摘要片段': 'Store redacted summary excerpts only'
  , '导入并归纳': 'Import and summarize', '正在归纳会话…': 'Summarizing the session…'
  , '已导入，WorkItem 等待确认。': 'Imported. The work item is waiting for confirmation.', '已导入并建立项目关联。': 'Imported and linked to the project.'
  , '导入暂时不可用，当前项目示范内容仍可查看。': 'Import is temporarily unavailable. You can still view the project demo content.'
  , '最近事件': 'Recent events', '最近实现': 'Recent implementations', '功能任务': 'Work items', '关键决策': 'Key decisions', '项目所有权': 'Project ownership'
  , '相关 Agent 对话': 'Related Agent conversations', '文件、函数和 Commit': 'Files, functions, and commits', '用户想完成什么': 'What the user wanted to accomplish'
  , 'Agent 实际做了什么': 'What the Agent actually did', '产出物': 'Artifacts', '认知欠条候选': 'Cognitive debt candidates', '确认生成欠条': 'Confirm cognitive debt'
  , '已关联现有训练系统': 'Linked to the existing training system', '示范内容 · 不写入真实数据': 'Demo content · not written to real data'
  , '未标注': 'Unlabeled', '软件项目': 'Software project', '产品项目': 'Product project', '研究项目': 'Research project', '内容项目': 'Content project', '其他项目': 'Other project'
  , '已归档': 'Archived', '已识别': 'Identified', '已实现': 'Implemented', '已验证': 'Verified', 'Agent 会话': 'Agent sessions'
  , '关联产出物': 'Related artifacts', '已具备人类所有权': 'Human ownership established', '参与度：': 'Participation: ', '用户参与：': 'User participation: '
  , '优先级：': 'Priority: ', '置信度：': 'Confidence: ', '这条欠条当时在哪里出现？': 'Where did this debt appear?'
  , '打开项目认知账本查看完整链路': 'Open the project ledger to view the full trace', '当前最高证据：': 'Highest current evidence: '
  , '测试通过不自动等于项目所有权。': 'Passing tests does not automatically establish project ownership.', '复发记录': 'Relapse history'
  , '掌握度信息': 'Mastery information', '总体掌握度：': 'Overall mastery: ', '当前阶段：': 'Current stage: ', '练习次数：': 'Practice attempts: ', '下次复习：': 'Next review: '
  , '请输入邮箱和密码': 'Enter your email and password'
  , '邮箱或密码不正确': 'The email or password is incorrect', '登录失败，请稍后重试': 'Could not sign in. Try again later.'
  , '请输入邮箱': 'Enter your email', '密码至少需要 8 位': 'Your password must be at least 8 characters', '两次输入的密码不一致': 'The passwords do not match'
  , '创建中…': 'Creating…', '该邮箱已注册': 'This email is already registered', '注册失败，请稍后重试': 'Could not create the account. Try again later.'
  , '加载失败，请稍后重试': 'Could not load. Try again later.'
  , '今天可以轻松一点': 'You can take it easy today', '今天有 ': 'There are ', ' 个复训任务': ' review tasks today'
  , '每次复训都只记录你实际能解释、识别边界和迁移的证据。': 'Each review records only evidence that you can actually explain, detect boundaries, and transfer.'
  , '查看认知清偿': 'View repayment', '到期：': 'Due: ', '正在启动…': 'Starting…', '启动失败，请稍后重试。': 'Could not start. Try again later.'
  , '今日复训 · 人类回答': "Today's review · Human answer", '把这条认知欠条讲清楚': 'Explain this cognitive debt clearly'
  , '先独立回答，再看 AI 反馈。你的回答会成为后续掌握度和项目所有权的证据。': 'Answer independently before viewing AI feedback. Your answer becomes evidence for future mastery and project ownership.'
  , '返回今日复训': "Back to today's review", '这次复训的来源': 'Source of this review', 'AI 的问题': "AI's question"
  , '请用自己的话解释，不要只复述结论；如果还不确定，也可以明确说出你的疑问。': 'Explain it in your own words rather than repeating the conclusion. If you are unsure, say what you are unsure about.'
  , '用你自己的话解释这个概念…': 'Explain this concept in your own words…', '请先输入你的回答，再提交评估。': 'Enter your answer before submitting it for evaluation.'
  , '提交答案': 'Submit answer', '已通过这一阶段': 'Passed this stage', '还需要再验证一次': 'Needs one more verification', '掌握度：': 'Mastery: '
  , '这次回答的反馈': 'Feedback on this answer', '需要补充的点': 'What needs more work', '接下来': 'Next'
  , '继续今日复训': "Continue today's review", '查看这条认知欠条': 'View this cognitive debt', '正在补偿': 'Repayment in progress'
  , '所有被识别但尚未稳定掌握的认知欠条。完成清偿后会自动加入。': 'All cognitive debts identified but not yet stable. New debts are added automatically after analysis.'
  , '下面的项目、功能任务、Agent 会话、文件和决策来自同一条项目记忆链路。': 'The project, work item, Agent session, files, and decisions below come from the same project-memory trace.'
  , '这条欠条目前还没有绑定项目产出物；后续导入会话或手动关联后会显示来源。': 'This debt is not linked to a project artifact yet. Its source will appear after a session is imported or linked manually.'
  , '复训任务': 'Review tasks', '返回列表': 'Back to list', '正在加载…': 'Loading…'
  , '这里记录你对认知欠条的真实能力证据，不把“测试通过”直接等同于掌握。': 'This records real evidence of your cognitive-debt capabilities. Passing a test is not treated as mastery.'
  , '能力领域按认知报告中的主题归档；没有明确领域的记录会进入“通用”。每个领域最多记录 5 个固定维度，不是只能记录 5 种能力：新的技术主题会形成新的领域记录。分数由作答证据持续更新，测试通过不会直接变成真实项目所有权。': 'Capability domains are grouped by report topic. Records without a clear domain go into “General”. Each domain has five fixed dimensions; new technical topics create new domains. Scores update from answer evidence, and passing a test does not automatically establish ownership.'
  , '等级在能力路径中的位置': 'Where levels sit on the capability path', '每一项都显示当前分数、证据等级和最近更新时间。': 'Each item shows its current score, evidence level, and last update.'
  , '完成一笔认知清偿作答后，系统会从实际证据开始建立你的能力变化记录。': 'Complete a repayment answer and the system will start tracking capability change from real evidence.'
  , '尚未分级': 'Not yet leveled', '请求暂时受到保护，请稍后再试。系统保留了限流保护，避免重复点击造成更多失败。': 'This request is temporarily protected. Try again later; rate limiting prevents repeated clicks from causing more failures.'
  , '用户画像加载失败，请稍后重试。': 'Could not load your profile. Try again later.'
  , 'L1 · 起步：能够识别主题，但还不能稳定解释': 'L1 · Starting: can identify the topic but cannot explain it consistently'
  , 'L2 · 基础：能够独立解释核心概念和因果': 'L2 · Basic: can independently explain core concepts and causality'
  , 'L3 · 进阶：能够识别错误、边界和风险': 'L3 · Advanced: can identify errors, boundaries, and risks'
  , 'L4 · 迁移：能够把理解迁移到相近的新场景': 'L4 · Transfer: can apply the understanding to a nearby new scenario'
  , 'L5 · 负责：能够在真实项目中独立修改、验证并负责': 'L5 · Ownership: can modify, verify, and own the result in a real project'
  , 'E0 · 只有 AI 产出': 'E0 · AI output only', 'E1 · 阅读或接受': 'E1 · Read or accepted', 'E2 · 能够解释': 'E2 · Can explain'
  , 'E3 · 能够识别边界': 'E3 · Can identify boundaries', 'E4 · 能够迁移': 'E4 · Can transfer', 'E5 · 能够独立负责': 'E5 · Can own the work independently'
  , '知道这个主题存在，但需要提示才能说明它为什么成立。': 'Knows the topic exists but needs prompts to explain why it works.'
  , '能够用自己的话解释主要概念和因果关系。': 'Can explain the main concepts and causal relationships in their own words.'
  , '能够指出错误实现、边界条件和潜在风险。': 'Can identify incorrect implementations, boundary conditions, and risks.'
  , '能够把原来的理解迁移到新的问题或场景。': 'Can transfer the original understanding to a new problem or scenario.'
  , '能够在真实项目中独立修改、验证并承担结果；需要 E5 真实工作证据，不能由分数或自评直接生成。': 'Can modify, verify, and own results in a real project. E5 requires real-work evidence; scores and self-reports are not enough.'
  , '把 Agent 会话、真实任务、产出物、决策和认知证据放回同一条可追溯链路。': 'Bring Agent sessions, real tasks, artifacts, decisions, and cognitive evidence into one traceable chain.'
  , '项目历史记录正在同步。': 'Project history is syncing.', '长期追踪这个项目的 AI 协作和人类能力证据。': 'Track this project’s AI collaboration and human capability evidence over time.'
  , '项目列表暂时无法同步。': 'The project list is temporarily unavailable.', '项目记录暂时无法同步。': 'Project records are temporarily unavailable.'
  , '项目内容示范视图': 'Project content demo view', '功能任务示范': 'Demo work item', 'Agent 会话示范': 'Demo Agent session'
  , '本次会话未创建正式欠条；示范内容仅展示分析结果的呈现方式。': 'No formal debt was created in this session. Demo content only shows how analysis results are presented.'
  , '示范会话未创建正式欠条；真实分析结果会在会话归档后显示。': 'The demo session did not create a formal debt. Real analysis results appear after the session is archived.'
  , '已完成一次项目协作记录。': 'A project collaboration record was completed.'
  , '请求失败，请稍后重试': 'Request failed. Try again later.', '请稍后再试': 'Try again later', '失败，再试': 'Failed. Try again'
  , '认知清偿 V1 未启用。该能力正在逐步开放，请先从工作区生成认知债务报告。': 'Cognitive repayment V1 is not enabled yet. This capability is being rolled out; generate a cognitive debt report from the workspace first.'
  , '把报告里的认知缺口变成可作答、可复习、可验证的清偿路径。': 'Turn report gaps into a repayment path you can answer, review, and verify.'
  , '复习队列': 'Review queue', '清偿记录': 'Repayment history'
  , '已生成报告中的危险缺口会自动进入这里，不需要再次手动导入。': 'High-risk gaps from generated reports appear here automatically; no manual import is needed.'
  , '生成报告后，危险缺口会自动出现在这里。': 'High-risk gaps appear here automatically after a report is generated.'
  , '完成第一次清偿作答后，系统会根据结果安排间隔复习。': 'After the first repayment answer, the system schedules spaced review based on the result.'
  , '暂时没有到期复习': 'No reviews are due right now', '先从“待清偿”选择一条作答，系统会在需要复习时自动放入这里。': 'Choose an item from “Outstanding” first. It will appear here automatically when review is due.'
  , '达到系统清偿条件的欠条会在这里保留记录。': 'Debts that meet the repayment conditions remain recorded here.'
  , '还没有已清偿的欠条': 'No repaid debts yet', '两次独立通过评估后，欠条才会被标记为已清偿。': 'A debt is marked repaid only after two independent passing evaluations.'
  , '还没有认知债务报告': 'No cognitive-debt reports yet', '先回到工作区粘贴一段 AI 协作材料，生成报告后再来导入欠条。': 'Return to the workspace, paste AI-assisted material, and generate a report before importing a debt.'
  , '展开': 'Expand', '导入清偿': 'Import for repayment', '导入中…': 'Importing…', '这份报告没有可导入的危险缺口。': 'This report has no importable high-risk gaps.'
  , '欠条详情': 'Debt details', '该欠条没有附带证据记录。': 'This debt has no attached evidence record.'
  , '未能定位到输入材料原文，置信度已下调': 'The original input could not be located, so confidence was reduced'
  , '验证方式': 'Verification method', '最近一次评估': 'Latest evaluation'
  , '该欠条已归档，不能再提交作答。': 'This debt is archived and cannot accept another answer.', '通过': 'Passed', '未通过': 'Not passed'
  , '回答未通过，需要针对遗漏点重新解释': 'The answer did not pass; explain the missed points again', '优先级': 'Priority', '到期': 'Due'
  , '反馈': 'Feedback', '原因': 'Reason', '本次通过': 'Passed this time', '本次未通过': 'Not passed this time'
  , '置信度 ': 'Confidence ', '最近评估 ': 'Latest evaluation '
  , '能力基线：': 'Capability baseline: ', '综合得分：': 'Overall score: ', '分 · ': ' points · '
  , '高风险无人负责': 'High-risk and unowned', '缺少初步理解': 'Initial understanding missing', '缺少错误与边界验证': 'Error and boundary validation missing'
  , '返回': 'Back', '为智能眼镜（G2/Rokid）生成专用访问 Token。每个 Token 只显示一次明文，请妥善保存。': 'Generate a dedicated access token for smart glasses (G2/Rokid). The plaintext is shown only once, so save it securely.'
  , '请输入设备名称': 'Enter a device name', '生成失败': 'Could not generate the token', '项目 MCP / Hook Token': 'Project MCP / Hook tokens'
  , '给 TRAE、远程 MCP 或代码 Hook 使用。每个 Token 只绑定一个项目，明文只在生成成功后显示一次。': 'For TRAE, remote MCP, or code hooks. Each token is bound to one project, and plaintext is shown only after successful creation.'
  , '选择项目…': 'Select a project…', 'Token 名称（如：评委演示）': 'Token name (for example: Reviewer demo)', '生成项目 Token': 'Generate project token'
  , '已有项目 Token': 'Existing project tokens', '设备：': 'Device: ', '项目：': 'Project: ', '名称：': 'Name: ', '未使用': 'Unused', '可用': 'Available'
  , '创建于 ': 'Created ', '最近使用 ': 'Last used ', '已于 ': 'Revoked ', '无法加载设备 Token 列表': 'Could not load device token list'
  , '缺少迁移验证': 'Transfer validation missing', '缺少独立修改证据': 'Independent modification evidence missing'
  , '低风险': 'Low risk', '中风险': 'Medium risk', '高风险': 'High risk', '关键风险': 'Critical risk'
  , '初始补偿训练': 'Initial compensation', '延迟回忆': 'Delayed recall', '误区识别': 'Misconception check', '场景迁移': 'Scenario transfer', '错误检测': 'Error detection', '真实工作验证': 'Real-work validation'
  , '架构': 'Architecture', '安全': 'Security', '数据库': 'Database', '依赖': 'Dependency', 'API': 'API', '部署': 'Deployment', '产品': 'Product'
  , '用户': 'User', '协作': 'Collaborative', '未知': 'Unknown', '未参与': 'Not involved', '接受': 'Accepted', '选择': 'Selected', '修改': 'Modified', '发起': 'Initiated'
  , '阅读/接受': 'Read/accepted', '独立解释': 'Independent explanation', '误区检查': 'Misconception check', '真实修改': 'Real modification', '测试通过': 'Test passed', '人工评审': 'Manual review'
  , '安全风险': 'Security risk', '隐私风险': 'Privacy risk', '财务风险': 'Financial risk', '合规风险': 'Compliance risk', '可靠性风险': 'Reliability risk'
  , '未处理': 'Open', '练习中': 'Practicing', '临时清偿': 'Provisionally cleared', '已掌握': 'Mastered', '已复发': 'Relapsed', '已忽略': 'Ignored'
  , '← 返回项目列表': '← Back to project list', '← 返回所有权地图': '← Back to ownership map', '← 返回工作区': '← Back to workspace'
  , '项目所有权地图': 'Project ownership map', '所有权地图': 'Ownership map', '重新计算': 'Recalculate', '模块': 'Module', '下一步': 'Next step'
  , '计算中…': 'Calculating…', '重新计算暂时不可用。': 'Recalculation is temporarily unavailable.'
  , '协作测试': 'Collaborative test', 'Collaborative测试': 'Collaborative test', '用户测试': 'User test', 'Agent 测试': 'Agent test'
}

export function getLocale(): Locale {
  const explicit = new URLSearchParams(location.search).get('lang')
  if (explicit === 'en' || explicit === 'zh-CN') {
    localStorage.setItem(STORAGE_KEY, explicit)
    return explicit
  }
  return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh-CN'
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale)
}

export function isEnglish(): boolean { return getLocale() === 'en' }
export function t(zh: string, en?: string): string { return isEnglish() ? (en || translations[zh] || zh) : zh }

/** Translate UI text that includes a dynamic value such as a count, name, or date. */
export function translateText(value: string): string {
  if (!isEnglish() || !value) return value
  let translated = value
  for (const [zh, en] of Object.entries(translations).sort(([a], [b]) => b.length - a.length)) {
    if (zh && translated.includes(zh)) translated = translated.split(zh).join(en)
  }
  return translated
}

function translateElement(element: Element): void {
  if (!isEnglish() || element.closest('.page-admin')) return
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.placeholder) element.placeholder = translateText(element.placeholder)
  }
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const raw = node.textContent
      const trimmed = raw.trim()
      const translated = translateText(trimmed)
      if (translated !== trimmed) node.textContent = raw.replace(trimmed, translated)
    }
  }
}

export function translateTree(root: ParentNode): void {
  if (!isEnglish()) return
  if (root instanceof Element) translateElement(root)
  root.querySelectorAll('*').forEach(translateElement)
  document.documentElement.lang = 'en'
}

export function observeTranslations(root: HTMLElement): MutationObserver {
  translateTree(root)
  const observer = new MutationObserver(records => records.forEach(record => {
    record.addedNodes.forEach(node => {
      if (node instanceof Element) translateTree(node)
      else if (node.parentElement) translateElement(node.parentElement)
    })
  }))
  observer.observe(root, { childList: true, subtree: true })
  return observer
}
