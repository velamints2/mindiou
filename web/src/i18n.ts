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
  '服务处理失败，请稍后重试': 'The service could not process this request. Please try again.',
  '请求过于频繁，请稍后重试': 'Too many requests. Please wait and try again.',
  '网络连接失败，请检查网络或后端服务是否可用': 'Network connection failed. Check your connection and try again.'
  , 'AI 把你的材料拆成协作步骤': 'AI breaks your material into collaboration steps'
  , '你在每一步上标注「我哪里没看懂」': 'Mark what you did not understand at each step'
  , '基于你的困惑生成认知债务报告': 'Generate a cognitive debt report from your questions'
  , '粘贴 ChatGPT/Claude 对话、AI 生成的方案、黑客松记录、会议纪要…': 'Paste a ChatGPT/Claude conversation, AI-generated plan, hackathon log, meeting notes…'
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
  , '当前为策展备用模式，研究来源为预设材料': 'Curated fallback mode is active; research uses a predefined source set.'
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
  , 'ChatGPT 对话、AI 生成的方案、黑客松记录……任何一段 AI 帮你完成的工作。': 'A ChatGPT conversation, AI-generated plan, hackathon log, or any work AI helped you complete.'
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

function translateElement(element: Element): void {
  if (!isEnglish() || element.closest('.page-admin')) return
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.placeholder) element.placeholder = translations[element.placeholder] || element.placeholder
  }
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const raw = node.textContent
      const trimmed = raw.trim()
      const translated = translations[trimmed]
      if (translated) node.textContent = raw.replace(trimmed, translated)
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
