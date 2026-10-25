import {
  fetchLatestCognitiveLoop,
  listProjects,
  projectMemoryRequest,
  runCognitiveLoop,
  submitCognitiveLoopFeedback
} from './api'
import type {
  CognitiveLoopActivityInput,
  CognitiveLoopContentCandidateInput,
  CognitiveLoopProfile,
  CognitiveLoopResult,
  CognitiveLoopRun,
  DomainCapabilityProfile,
  PriorityIntervention,
  UserCognitiveProfile
} from './types'
import { t } from './i18n'
import { el, navigate } from './router'

const PROJECT_KEY = 'mindiou_cognitive_loop_project'
type LocalizedText = { zh: string; en: string }

const copy = (text: LocalizedText): string => t(text.zh, text.en)

const DEMO_ACTIVITY = [
  '用户：我想把最近的 AI 协作记录整理成一个每周训练闭环。目标是让用户能看到自己哪里依赖 AI，约束是复用现有账户和项目记忆，成功标准是能测试、刷新并在下一周验证。',
  '',
  'AI：可以先做一个工作看板，列出所有建议。',
  '',
  '用户：我直接采用了第一版建议，暂时没有独立来源，也没有保留测试证据。这个任务还是一问一答，我每次都重新解释项目背景。'
].join('\n')

export const FLUENCY_LOOP_PREVIEW = {
  metrics: [
    { value: '42', label: '次 AI 对话', labelEn: 'AI conversations' },
    { value: '7', label: '个真实工作任务', labelEn: 'real work tasks' },
    { value: '126', label: '条行业信息', labelEn: 'industry signals' },
    { value: '18', label: '个视频', labelEn: 'videos' },
    { value: '9', label: '次高影响 AI 决策', labelEn: 'high-impact AI decisions' }
  ],
  updates: [
    { zh: '发现 2 个明显的 AI 协作缺口', en: 'Detected 2 clear AI collaboration gaps' },
    { zh: '发现 1 个工作流已经适合交给智能代理', en: 'Found 1 workflow ready for agent delegation' },
    { zh: '过滤 47 条与你当前阶段无关的信息', en: 'Filtered 47 signals unrelated to your current stage' },
    { zh: '生成 1 个本周行为实验', en: 'Generated 1 behavior experiment for this week' }
  ],
  dimensions: [
    {
      title: '委派',
      titleEn: 'Delegation',
      question: '你知道什么应该交给 AI 吗？',
      questionEn: 'Do you know what to delegate to AI?',
      score: 48,
      judgment: '你已经开始把复杂任务交给 AI，但仍然经常控制每一个中间步骤。',
      judgmentEn: 'You have started delegating complex tasks to AI, but still control many intermediate steps.',
      observations: [
        { zh: '拆解任务', en: 'Task decomposition' },
        { zh: '判断哪些步骤适合 AI', en: 'Task–AI fit' },
        { zh: '从一次提示词升级成智能代理', en: 'When to move from a prompt to an agent' }
      ],
      focus: '从人工监督，升级到目标驱动的委派。',
      focusEn: 'Move from step-by-step supervision to goal-driven delegation.',
      accent: 'violet',
      priority: false
    },
    {
      title: '任务描述',
      titleEn: 'Description',
      question: '你是否能够让 AI 真正理解任务？',
      questionEn: 'Can you make AI truly understand the task?',
      score: 71,
      judgment: '你的表达能力已经不是主要瓶颈。下一阶段不需要继续学习更多提示词技巧。',
      judgmentEn: 'Expression is no longer your main bottleneck. More prompt tricks are not the next step.',
      observations: [
        { zh: '目标是否清晰', en: 'Goal clarity' },
        { zh: '上下文是否完整', en: 'Context completeness' },
        { zh: '是否定义最终验收标准', en: 'Acceptance criteria' }
      ],
      focus: '把稳定背景沉淀成可复用的上下文。',
      focusEn: 'Turn stable background into reusable context.',
      accent: 'blue',
      priority: false
    },
    {
      title: '判断与验证',
      titleEn: 'Discernment',
      question: '你能判断 AI 是否真的做对了吗？',
      questionEn: 'Can you tell whether AI actually got it right?',
      score: 39,
      judgment: '最近 9 次高影响 AI 决策中，有 6 次没有出现明显验证行为。',
      judgmentEn: 'In 6 of your last 9 high-impact AI decisions, there was no clear verification behavior.',
      observations: [
        { zh: '验证关键结论', en: 'Verify key claims' },
        { zh: '区分事实与推断', en: 'Separate facts from inferences' },
        { zh: '发现 AI 的错误', en: 'Detect AI errors' }
      ],
      focus: '这是你当前最值得优先提升的能力。',
      focusEn: 'This is the capability most worth improving now.',
      accent: 'orange',
      priority: true
    },
    {
      title: '边界与责任',
      titleEn: 'Diligence',
      question: '你是否知道什么时候不能只相信 AI？',
      questionEn: 'Do you know when you should not rely on AI alone?',
      score: 63,
      judgment: '你已经开始关注责任边界，但高风险决策仍需要更明确的人类最终负责。',
      judgmentEn: 'You are beginning to notice responsibility boundaries, but high-risk decisions still need clearer human ownership.',
      observations: [
        { zh: '隐私与敏感信息', en: 'Privacy and sensitive data' },
        { zh: '来源可靠性', en: 'Source reliability' },
        { zh: 'AI 能力边界', en: 'AI capability boundaries' }
      ],
      focus: '让风险意识成为工作流中的固定检查点。',
      focusEn: 'Make risk awareness a fixed checkpoint in the workflow.',
      accent: 'green',
      priority: false
    },
    {
      title: '任务拆解',
      titleEn: 'Task decomposition',
      question: '你是否把完整目标交给 AI 决定执行路径？',
      questionEn: 'Do you give AI the full goal and let it choose the path?',
      score: 55,
      judgment: '你能拆出步骤，但还没有稳定地把中间路径交给 AI 自主选择。',
      judgmentEn: 'You can decompose work, but do not yet consistently let AI choose the middle path.',
      observations: [
        { zh: '定义目标和边界', en: 'Define the goal and boundaries' },
        { zh: '判断哪些步骤可以委派', en: 'Choose what to delegate' },
        { zh: '保留验收点而不是控制每一步', en: 'Keep acceptance checks, not every step' }
      ],
      focus: '从人工拆解，升级到目标驱动的委派。',
      focusEn: 'Move from human decomposition to goal-driven delegation.',
      accent: 'violet',
      priority: false
    },
    {
      title: '多轮协作',
      titleEn: 'Iterative collaboration',
      question: '你是否用反馈让 AI 结果真正改变？',
      questionEn: 'Do you use feedback to materially change the AI result?',
      score: 66,
      judgment: '你会追问和修改，但还需要记录反馈如何改变最终结果。',
      judgmentEn: 'You iterate and follow up, but should record how feedback changes the final result.',
      observations: [
        { zh: '提供具体反馈', en: 'Give concrete feedback' },
        { zh: '比较第一版与最终版', en: 'Compare first and final versions' },
        { zh: '保留可复用的改进方式', en: 'Keep reusable improvements' }
      ],
      focus: '把多轮对话变成可观察的反馈闭环。',
      focusEn: 'Turn multi-turn chat into an observable feedback loop.',
      accent: 'blue',
      priority: false
    },
    {
      title: 'AI 边界认知',
      titleEn: 'AI boundary awareness',
      question: '你知道 AI 能做什么、不能做什么吗？',
      questionEn: 'Do you know what AI can and cannot do?',
      score: 44,
      judgment: '你已经开始关注风险，但还需要把能力边界转成每次工作的责任检查。',
      judgmentEn: 'You notice risk, but still need to turn capability boundaries into a responsibility check.',
      observations: [
        { zh: '识别 AI 能力限制', en: 'Identify capability limits' },
        { zh: '区分事实、不确定性和推断', en: 'Separate facts, uncertainty, and inference' },
        { zh: '明确人类最终责任', en: 'Keep human accountability explicit' }
      ],
      focus: '把对 AI 能力的判断放进真实工作流。',
      focusEn: 'Put capability-boundary judgment into the real workflow.',
      accent: 'orange',
      priority: false
    }
  ],
  harness: [
    { title: '上下文', titleEn: 'Context', body: '理解你正在做什么。', bodyEn: 'Understand what you are working on.' },
    { title: '记忆', titleEn: 'Memory', body: '记住长期项目、能力状态和历史决策。', bodyEn: 'Remember long-term projects, capability states, and past decisions.' },
    { title: '观察', titleEn: 'Observation', body: '观察你真实使用 AI 的行为。', bodyEn: 'Observe how you actually work with AI.' },
    { title: '评估', titleEn: 'Evaluation', body: '判断哪些协作方式有效，哪些正在产生风险。', bodyEn: 'Identify which collaboration patterns work and which create risk.' },
    { title: '干预', titleEn: 'Intervention', body: '在合适的时候给你一个训练或工作流升级建议。', bodyEn: 'Offer a training or workflow upgrade at the right moment.' },
    { title: '循环', titleEn: 'Loop', body: '根据新的行为重新更新判断。', bodyEn: 'Update the judgment as new behavior arrives.' }
  ],
  capabilityShifts: [
    {
      number: '01',
      title: '智能代理的长期执行能力正在提高',
      titleEn: 'Agents are getting better at sustained execution',
      relevance: '96%',
      shift: '智能代理正在从短任务执行走向更长周期的自主工作。',
      shiftEn: 'Agents are moving from short tasks toward longer-horizon autonomous work.',
      impact: '你过去 7 天有 11 个任务仍然采用持续人工监督模式。',
      impactEn: 'You used continuous human supervision for 11 tasks in the last 7 days.',
      implication: '你现在需要提升的不是提示词，而是委派。',
      implicationEn: 'The next upgrade is not more prompt technique; it is delegation.',
      action: '不用继续读更多相关文章。这周实际交给智能代理一个完整任务。',
      actionEn: 'Do not read more articles this week. Delegate one complete task to an agent.'
    },
    {
      number: '02',
      title: '长期上下文构造正变得比提示词技巧更重要',
      titleEn: 'Context assembly is becoming more important than prompt technique',
      relevance: '89%',
      shift: '模型越来越能够处理复杂和长期上下文。',
      shiftEn: 'Models are increasingly able to work with complex, long-lived context.',
      impact: '过去 7 天，你有 8 次重新向 AI 描述同一个项目。',
      impactEn: 'You re-described the same project to AI 8 times in the last 7 days.',
      implication: '你正在重复解决一个本来应该由协作底座解决的问题。',
      implicationEn: 'You are repeatedly solving a problem that a harness should solve.',
      action: '建立一个长期项目上下文。推荐 1 篇文章，预计阅读时间 8 分钟。',
      actionEn: 'Create a persistent project context. One article is recommended; estimated reading time: 8 minutes.'
    }
  ],
  diet: [
    { label: 'AI 产品更新', labelEn: 'AI product updates', value: 42 },
    { label: '智能代理新闻', labelEn: 'Agent news', value: 31 },
    { label: '真实工作案例', labelEn: 'Real work cases', value: 12 },
    { label: '方法论', labelEn: 'Methods', value: 8 },
    { label: '不同观点', labelEn: 'Different viewpoints', value: 7 }
  ],
  loopSteps: [
    { zh: '观察', en: 'Observe' },
    { zh: '理解', en: 'Understand' },
    { zh: '发现', en: 'Detect' },
    { zh: '感知', en: 'Sense' },
    { zh: '过滤', en: 'Filter' },
    { zh: '训练', en: 'Train' },
    { zh: '验证', en: 'Verify' },
    { zh: '再次循环', en: 'Loop again' }
  ]
} as const

const DOMAIN_CAPABILITY_PREVIEW: DomainCapabilityProfile = {
  domain: 'MindIOU 产品与认知科学',
  overallMastery: 58,
  stage: 'L2',
  source: 'preview',
  dimensions: {
    conceptualUnderstanding: { score: 64, level: 'L3', stability: 'observed', evidence: [] },
    causalExplanation: { score: 49, level: 'L2', stability: 'one_shot', evidence: [] },
    practicalReproduction: { score: 73, level: 'L3', stability: 'observed', evidence: [] },
    boundariesAndRisks: { score: 42, level: 'L2', stability: 'one_shot', evidence: [] },
    transferAbility: { score: 51, level: 'L2', stability: 'one_shot', evidence: [] }
  }
}

const RESEARCH_EVIDENCE = [
  {
    source: 'NBER · 2025',
    title: { zh: 'AI 正在重塑团队协作与专业经验', en: 'AI is reshaping teamwork and expertise' },
    finding: { zh: '对 776 名专业人士的预注册现场实验发现，单人使用 AI 的表现可以达到无 AI 团队的水平；研究同时观察了表现、经验分享和社会互动。', en: 'A preregistered field experiment with 776 professionals found that individuals with AI could match teams without AI, while also changing expertise sharing and social interaction.' },
    use: { zh: '支持：评估不能只看输出，还要观察 AI 如何改变委派、协作和经验调用。', en: 'Supports: evaluate more than output; observe how AI changes delegation, collaboration, and expertise use.' },
    url: 'https://www.nber.org/papers/w33641'
  },
  {
    source: 'CHI · Microsoft Research · 2025',
    title: { zh: 'AI 使用中的批判性思考与信心', en: 'Critical thinking and confidence during AI use' },
    finding: { zh: '对 319 名知识工作者的调查显示，任务中对 AI 越有信心，越可能感到自己投入的批判性思考较少；但这是自我报告研究。', en: 'A survey of 319 knowledge workers found that higher confidence in AI was associated with less perceived critical-thinking effort; it is self-reported evidence.' },
    use: { zh: '支持：观察验证、证据要求与过度依赖；不能单独用它给用户贴能力标签。', en: 'Supports: observe verification, evidence-seeking, and over-reliance; do not use it alone to label capability.' },
    url: 'https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/'
  },
  {
    source: 'METR · 2025',
    title: { zh: '真实任务中的 AI 效果可能与主观感受相反', en: 'Real-task effects can differ from perceived AI benefits' },
    finding: { zh: '针对 16 名资深开源开发者、246 个真实任务的随机对照试验发现，允许使用当时的 AI 工具后，完成任务平均耗时反而增加 19%。', en: 'In an RCT with 16 experienced open-source developers across 246 real tasks, allowing the AI tools of that period increased completion time by 19% on average.' },
    use: { zh: '支持：同时记录真实结果、返工、监督成本和主观判断；不能外推到所有职业或今天的模型。', en: 'Supports: track real outcomes, rework, supervision cost, and perceived impact together; do not generalize to every job or current models.' },
    url: 'https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/'
  },
  {
    source: 'arXiv · 2024',
    title: { zh: '上下文信息会改变人的委派判断', en: 'Context changes human delegation decisions' },
    finding: { zh: '人机委派行为研究发现，提供关于任务和 AI 能力的上下文信息，可以改善委派场景中的人机团队表现。', en: 'A behavioral study of human delegation found that contextual information about the task and AI capability can improve human–AI team performance.' },
    use: { zh: '支持：把上下文完整度、任务—AI 适配度和委派选择纳入长期画像。', en: 'Supports: include context completeness, task–AI fit, and delegation choices in the longitudinal profile.' },
    url: 'https://arxiv.org/abs/2401.04729'
  },
  {
    source: 'NBER · 2023',
    title: { zh: 'AI 收益高度依赖人的经验与任务位置', en: 'AI gains vary with worker experience and task position' },
    finding: { zh: '对 5,179 名客服人员的现场研究发现，AI 平均提升生产率 14%，新手和低技能员工提升更大，而资深员工提升很小。', en: 'A field study of 5,179 customer-support agents found a 14% average productivity gain, with larger gains for novice and lower-skilled workers and minimal gains for experienced workers.' },
    use: { zh: '支持：把领域能力与 AI 协作能力并行建模，并按任务和经验分层解释结果。', en: 'Supports: model domain capability and AI collaboration capability in parallel, and interpret results by task and experience.' },
    url: 'https://www.nber.org/papers/w31161'
  }
] as const

function message(error: unknown): string {
  return error instanceof Error ? error.message : t('请求失败，请稍后重试', 'Request failed. Try again.')
}

function section(title: string, className = 'cognitive-loop-panel'): HTMLElement {
  const node = el('section', className)
  node.appendChild(el('h2', 'cognitive-loop-section-title', title))
  return node
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function renderFluencyPreview(startExperiment: () => void): HTMLElement {
  const preview = el('section', 'fluency-preview')

  const hero = el('section', 'fluency-section fluency-assistant-hero')
  const heroCopy = el('div', 'fluency-hero-copy')
  heroCopy.append(
    el('span', 'fluency-eyebrow', copy({ zh: '功能更新 · 预告', en: 'FEATURE UPDATE · PREVIEW' })),
    el('h1', 'fluency-hero-title', copy({ zh: 'MindIOU Loop', en: 'MindIOU Loop' })),
    el('p', 'fluency-hero-lead', copy({ zh: '一个一直在后台工作的认知助理。', en: 'A cognitive assistant that always works in the background.' })),
    el('p', 'fluency-hero-cn', copy({ zh: '它持续整理你的能力、认知欠条和 AI 使用状态，也替你阅读外面的文章、帖子和视频，帮你判断：现在的我，下一步最值得理解什么？', en: 'It keeps organizing your capabilities, cognitive debts, and AI usage. It also reads articles, posts, and videos for you, helping answer one question: what is most worth understanding next for me?' })),
    el('div', 'fluency-hero-tag', copy({ zh: '能力 · 欠条 · 信息', en: 'CAPABILITIES · DEBTS · SIGNALS' }))
  )
  const heroArt = el('div', 'fluency-hero-art')
  heroArt.setAttribute('aria-hidden', 'true')
  heroArt.append(
    el('span', 'fluency-orbit fluency-orbit-one'),
    el('span', 'fluency-orbit fluency-orbit-two'),
    el('span', 'fluency-orbit fluency-orbit-three'),
    el('strong', undefined, copy({ zh: '后台运行', en: 'ALWAYS ON' })),
    el('small', undefined, copy({ zh: '持续整理你的认知状态', en: 'KEEPING YOUR COGNITIVE STATE IN ORDER' }))
  )
  hero.append(heroCopy, heroArt)
  const outcomes = el('div', 'fluency-outcome-grid')
  ;[
    { title: { zh: '我现在会什么', en: 'What I know now' }, body: { zh: '专业能力与正在形成的能力', en: 'Domain skills and emerging capabilities' }, accent: 'violet' },
    { title: { zh: '我还有哪些认知欠条', en: 'What I still owe' }, body: { zh: '还没有稳定掌握、但已经影响工作的理解', en: 'Understanding I have used but not yet made stable' }, accent: 'orange' },
    { title: { zh: '最近有什么真正值得我看', en: 'What is worth my attention' }, body: { zh: 'Loop 已经替我读过、筛过的外部信息', en: 'Outside signals the Loop has already read and filtered' }, accent: 'blue' }
  ].forEach(outcome => {
    const card = el('article', `fluency-outcome-card fluency-outcome-${outcome.accent}`)
    card.append(el('span', 'fluency-outcome-mark', '↗'), el('h3', undefined, copy(outcome.title)), el('p', undefined, copy(outcome.body)))
    outcomes.appendChild(card)
  })
  hero.appendChild(outcomes)
  hero.appendChild(el('p', 'fluency-release-note', copy({ zh: '预计 8 月下旬上线第一版', en: 'First version expected in late August' })))
  preview.appendChild(hero)

  const running = el('section', 'fluency-section fluency-background-loop')
  const runningHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  runningHeader.append(
    el('span', 'fluency-eyebrow', copy({ zh: '02 · 后台循环', en: '02 · THE BACKGROUND LOOP' })),
    el('h2', undefined, copy({ zh: 'MindIOU 在后台一直做这件事', en: 'This is what MindIOU keeps doing in the background' })),
    el('p', undefined, copy({ zh: '你不需要每次重新整理自己。Loop 会把真实行为、项目和外部信息接起来，持续更新下一步判断。', en: 'You do not have to reorganize yourself every time. The Loop connects real behavior, projects, and outside signals to keep updating what comes next.' }))
  )
  running.appendChild(runningHeader)
  const loopMechanism = el('div', 'fluency-loop-mechanism-grid')
  const loopFlow = el('div', 'fluency-loop-flow')
  const loopItems: LocalizedText[] = [
    { zh: '我的 AI 对话 / 项目 / 学习记录', en: 'My AI conversations / projects / learning records' },
    { zh: '整理我的能力状态', en: 'Organize my capability state' },
    { zh: '更新我的认知欠条', en: 'Update my cognitive debts' },
    { zh: '判断最近最值得补的方向', en: 'Decide what is most worth filling next' },
    { zh: '去网上读文章 / 帖子 / 视频', en: 'Read articles / posts / videos from the outside world' },
    { zh: '筛掉重复和无关内容', en: 'Filter out repetition and irrelevant content' },
    { zh: '给我下一步建议和训练', en: 'Give me a next step and a practice' },
    { zh: '根据新行为再更新', en: 'Update again from new behavior' }
  ]
  loopItems.forEach((item, index) => {
    const step = el('div', `fluency-flow-step${index === 0 ? ' is-source' : ''}${index === loopItems.length - 1 ? ' is-loop-back' : ''}`)
    step.append(el('span', 'fluency-flow-index', String(index + 1).padStart(2, '0')), el('strong', undefined, copy(item)))
    loopFlow.appendChild(step)
    if (index < loopItems.length - 1) loopFlow.appendChild(el('span', 'fluency-flow-arrow', '↓'))
  })
  loopMechanism.appendChild(loopFlow)
  const metricGrid = el('div', 'fluency-metric-grid')
  const loopMetrics: LocalizedText[] = [
    { zh: '42 次 AI 对话', en: '42 AI conversations' },
    { zh: '7 个项目', en: '7 projects' },
    { zh: '126 条信息', en: '126 information signals' },
    { zh: '18 个视频', en: '18 videos' }
  ]
  ;['42', '7', '126', '18'].forEach((value, index) => {
    const card = el('article', 'fluency-metric-card')
    const metric = loopMetrics[index]
    card.append(el('strong', undefined, value), el('span', undefined, copy(metric)))
    metricGrid.appendChild(card)
  })
  const evidence = el('article', 'fluency-loop-evidence-card')
  evidence.append(
    el('span', 'fluency-eyebrow', copy({ zh: '本轮 Loop 已处理', en: 'THIS LOOP PROCESSED' })),
    metricGrid,
    el('p', undefined, copy({ zh: 'Loop 会根据你的下一次真实行为继续更新。', en: 'The Loop will update again when your next real behavior arrives.' }))
  )
  loopMechanism.appendChild(evidence)
  running.appendChild(loopMechanism)
  preview.appendChild(running)

  const capabilitySplit = el('section', 'fluency-section fluency-profile-section')
  const splitHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  splitHeader.append(
    el('span', 'fluency-eyebrow', copy({ zh: '03 · 认知画像', en: '03 · COGNITIVE PROFILE' })),
    el('h2', undefined, copy({ zh: '它越来越了解你，不只是给你打分。', en: 'It is learning you, not just scoring you.' })),
    el('p', undefined, copy({ zh: '专业能力和 AI 协作能力仍然分别观察，但它们只是更大一张认知画像的一部分。', en: 'Domain capability and AI collaboration are still observed separately, but they are only parts of a larger cognitive profile.' }))
  )
  capabilitySplit.appendChild(splitHeader)
  const profileGrid = el('div', 'fluency-profile-grid')
  const profileCard = el('article', 'fluency-profile-card')
  profileCard.append(el('span', 'fluency-profile-kicker', copy({ zh: '你的认知状态', en: 'YOUR COGNITIVE STATE' })), el('h3', undefined, copy({ zh: '一张会随真实行为更新的画像', en: 'A profile updated by real behavior' })))
  ;[
    [{ zh: '专业能力', en: 'Domain capability' }, { zh: 'MindIOU 产品与认知科学', en: 'MindIOU product and cognitive science' }],
    [{ zh: '正在形成的能力', en: 'Emerging capability' }, { zh: 'AI Agent Harness', en: 'AI agent harness' }],
    [{ zh: 'AI 协作能力', en: 'AI collaboration' }, { zh: '连续迭代已稳定', en: 'Iterative collaboration is stable' }],
    [{ zh: '认知欠条', en: 'Cognitive debts' }, { zh: '3 项待补齐', en: '3 items to revisit' }],
    [{ zh: '最近高频主题', en: 'Frequent topics' }, { zh: 'AI Agent · Context Engineering', en: 'AI agents · Context engineering' }],
    [{ zh: '当前项目目标', en: 'Current project goal' }, { zh: '把真实 AI 协作变成可验证成长', en: 'Turn real AI collaboration into verifiable growth' }]
  ].forEach(([label, value]) => {
    const row = el('div', 'fluency-profile-row')
    row.append(el('span', undefined, copy(label)), el('strong', undefined, copy(value)))
    profileCard.appendChild(row)
  })
  profileGrid.appendChild(profileCard)
  const insight = el('article', 'fluency-profile-insight')
  const profileTags = el('div', 'fluency-profile-tags')
  profileTags.append(el('span', undefined, copy({ zh: '已稳定 · 多轮迭代', en: 'Stable · Iteration' })), el('span', undefined, copy({ zh: '下一步 · 委派与验证', en: 'Next · Delegation and verification' })))
  insight.append(
    el('span', 'fluency-profile-kicker', copy({ zh: 'Loop 最近对你的理解', en: 'WHAT THE LOOP UNDERSTANDS' })),
    el('h3', undefined, copy({ zh: '你最近在大量研究 AI Agent。', en: 'You have been spending time understanding AI agents.' })),
    el('p', undefined, copy({ zh: '你对产品概念已经比较熟悉，但对 Harness、上下文构造的理解仍然比较零散。同时，你在实际使用 AI 时已经很擅长连续迭代，但任务委派和结果验证仍有明显提升空间。', en: 'You are becoming familiar with the product concepts, while your understanding of harnesses and context assembly is still fragmented. In real AI work, you are already strong at iteration, while delegation and result verification still have room to grow.' })),
    profileTags,
    el('small', 'fluency-profile-footnote', copy({ zh: '分数会在画像详情中展开；这里先看见整体状态。', en: 'Scores can be expanded in the profile detail; here you see the overall state first.' }))
  )
  profileGrid.appendChild(insight)
  capabilitySplit.appendChild(profileGrid)
  const debts = el('div', 'fluency-debt-panel')
  const debtsHeader = el('div', 'fluency-debt-header')
  const debtsTitle = el('div')
  debtsTitle.append(el('span', 'fluency-eyebrow', copy({ zh: '认知欠条', en: 'COGNITIVE DEBTS' })), el('h3', undefined, copy({ zh: 'Loop 也在替你照看还没补完的东西。', en: 'The Loop also keeps watch over what you have not finished learning.' })))
  debtsHeader.append(debtsTitle, el('p', undefined, copy({ zh: '它不会要求你一次补完所有欠条。Loop 会根据你现在正在做的事情，重新决定哪些值得优先处理。', en: 'It will not ask you to repay every debt at once. The Loop reorders them based on what you are doing now.' })))
  debts.appendChild(debtsHeader)
  const debtGrid = el('div', 'fluency-debt-grid')
  ;[
    [{ zh: '为什么长期 Agent 需要 Harness？', en: 'Why do long-running agents need a harness?' }, { zh: '最近出现 4 次 · 尚未稳定掌握', en: 'Appeared 4 times recently · Not stable yet' }],
    [{ zh: '如何解释循环采购的商业价值？', en: 'How do I explain the business value of circular procurement?' }, { zh: '与当前项目高度相关 · 建议本周补齐', en: 'Highly relevant to the current project · Suggested this week' }],
    [{ zh: '英语里如何自然解释 trade-off？', en: 'How do I explain “trade-off” naturally in English?' }, { zh: '最近口语训练中出现 6 次', en: 'Appeared 6 times in recent speaking practice' }]
  ].forEach(([title, meta], index) => {
    const card = el('article', 'fluency-debt-card')
    card.append(el('span', 'fluency-debt-index', `0${index + 1}`), el('h4', undefined, copy(title)), el('p', undefined, copy(meta)))
    debtGrid.appendChild(card)
  })
  debts.appendChild(debtGrid)
  capabilitySplit.appendChild(debts)
  preview.appendChild(capabilitySplit)

  const reading = el('section', 'fluency-section fluency-reading-section')
  const readingHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  readingHeader.append(
    el('span', 'fluency-eyebrow', copy({ zh: '04 · 替你读外部世界', en: '04 · READING FOR YOU' })),
    el('h2', undefined, copy({ zh: '你不用自己刷完这些东西。', en: 'You do not have to read through all of this yourself.' })),
    el('p', undefined, copy({ zh: 'Loop 不只看标题。对于视频，它会读取字幕、语音和关键画面，再判断这条信息是否真的与你有关。', en: 'The Loop does not only read titles. For videos, it reads subtitles, audio, and key frames before deciding whether a signal is truly relevant to you.' }))
  )
  reading.appendChild(readingHeader)
  const readingGrid = el('div', 'fluency-reading-grid')
  const intake = el('article', 'fluency-reading-intake')
  intake.append(el('span', 'fluency-reading-kicker', copy({ zh: '今天 Loop 已替你阅读', en: 'TODAY THE LOOP READ' })), el('h3', undefined, copy({ zh: '84 篇文章 / 帖子', en: '84 articles / posts' })))
  ;[
    [{ zh: '18 个视频', en: '18 videos' }, 'violet'],
    [{ zh: '7 个产品更新', en: '7 product updates' }, 'blue'],
    [{ zh: '3 份研究资料', en: '3 research documents' }, 'green']
  ].forEach(([label, accent]) => {
    intake.appendChild(el('div', `fluency-reading-count fluency-reading-count-${accent}`, copy(label as LocalizedText)))
  })
  intake.appendChild(el('p', undefined, copy({ zh: '你得到的不是更长的信息流，而是已经被理解和整理过的候选。', en: 'You get not a longer feed, but candidates that have already been understood and organized.' })))
  readingGrid.appendChild(intake)
  const filter = el('article', 'fluency-reading-filter')
  filter.append(el('span', 'fluency-reading-kicker', copy({ zh: 'Loop 自动筛选', en: 'THE LOOP FILTERED' })), el('h3', undefined, copy({ zh: '先替你排除不值得花时间的内容', en: 'It first removes what is not worth your time' })))
  ;[
    [{ value: '47', label: { zh: '条与你已知内容重复', en: 'repeated what you already know' } }, 'violet'],
    [{ value: '21', label: { zh: '条和当前工作无关', en: 'unrelated to your current work' } }, 'blue'],
    [{ value: '16', label: { zh: '条只有新闻价值', en: 'news-only updates' } }, 'orange'],
    [{ value: '22', label: { zh: '条信息密度过低', en: 'low-density items' } }, 'gray']
  ].forEach(([item, accent]) => {
    const filterItem = item as { value: string; label: LocalizedText }
    const row = el('div', `fluency-filter-row fluency-filter-${accent}`)
    row.append(el('strong', undefined, filterItem.value), el('span', undefined, copy(filterItem.label)))
    filter.appendChild(row)
  })
  readingGrid.appendChild(filter)
  const kept = el('article', 'fluency-reading-kept')
  kept.append(el('span', 'fluency-reading-kicker', copy({ zh: '真正值得你看的', en: 'WORTH YOUR ATTENTION' })), el('h3', undefined, copy({ zh: '只留下 3 条', en: 'Only 3 signals remain' })))
  ;[
    [{ zh: 'Agent 正在走向更长周期的独立执行', en: 'Agents are moving toward longer-horizon independent execution' }, { zh: '可能改变你最近的任务委派方式', en: 'May change how you delegate recent work' }],
    [{ zh: '上下文工程正在成为长期协作的关键', en: 'Context engineering is becoming key to long-term collaboration' }, { zh: '与你反复补充项目背景的行为有关', en: 'Connected to your repeated project re-explanations' }],
    [{ zh: '一份与你当前项目直接相关的研究', en: 'One study directly connected to your current project' }, { zh: '预计阅读时间：8 分钟', en: 'Estimated reading time: 8 minutes' }]
  ].forEach(([title, reason], index) => {
    const item = el('div', 'fluency-kept-item')
    const keptBody = el('div')
    keptBody.append(el('strong', undefined, copy(title)), el('p', undefined, copy(reason)))
    item.append(el('span', undefined, `0${index + 1}`), keptBody)
    kept.appendChild(item)
  })
  readingGrid.appendChild(kept)
  reading.appendChild(readingGrid)
  preview.appendChild(reading)

  const next = el('section', 'fluency-section fluency-next-section')
  const nextHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  nextHeader.append(
    el('span', 'fluency-eyebrow', copy({ zh: '05 · 为什么推荐给你', en: '05 · WHY THIS MATTERS' })),
    el('h2', undefined, copy({ zh: 'Loop 不只告诉你看什么，也告诉你为什么。', en: 'The Loop tells you why it matters, not only what to read.' })),
    el('p', undefined, copy({ zh: '我整理了最近的情况，这里有一个可能对你有帮助的发现。', en: 'I organized what has been happening recently. Here is one finding that may help you.' }))
  )
  next.appendChild(nextHeader)
  const recommendation = el('article', 'fluency-recommendation-card')
  recommendation.append(
    el('span', 'fluency-recommendation-kicker', copy({ zh: '为什么把它给你？', en: 'Why are we showing this to you?' })),
    el('h3', undefined, copy({ zh: '本周，不妨把一个低风险任务完整交给 Agent。', en: 'This week, try handing one low-risk task to an agent end to end.' })),
    el('p', 'fluency-recommendation-note', copy({ zh: '不需要继续看 10 篇相关文章。先用一次真实工作，验证这条变化对你有没有帮助。', en: 'You do not need to read ten more articles. Use one real task to test whether this change helps you.' }))
  )
  const recommendationRows = el('div', 'fluency-recommendation-rows')
  ;[
    [{ zh: '外面发生了什么', en: 'What changed outside' }, { zh: 'Agent 开始支持更长周期的独立任务。', en: 'Agents are beginning to support longer-horizon independent tasks.' }],
    [{ zh: '和你有什么关系', en: 'Why it matters to you' }, { zh: '过去 7 天，你仍有 11 个任务采用逐步骤人工监督。', en: 'You still used step-by-step human supervision for 11 tasks in the last 7 days.' }],
    [{ zh: '建议你做什么', en: 'What to do next' }, { zh: '只定义目标、上下文、约束和验收标准，然后观察 Agent 自己的执行路径。', en: 'Define the goal, context, constraints, and acceptance criteria, then observe the agent’s path.' }]
  ].forEach(([label, body]) => {
    const row = el('div', 'fluency-recommendation-row')
    row.append(el('span', undefined, copy(label)), el('p', undefined, copy(body)))
    recommendationRows.appendChild(row)
  })
  recommendation.appendChild(recommendationRows)
  const startButton = el('button', 'btn btn-primary fluency-start-button', copy({ zh: '开始这个实验', en: 'Start this experiment' })) as HTMLButtonElement
  startButton.type = 'button'
  startButton.onclick = startExperiment
  recommendation.appendChild(startButton)
  next.appendChild(recommendation)
  const nextActions = el('div', 'fluency-next-actions')
  ;[
    [{ zh: '理解', en: 'Understand' }, { zh: '知道 Agent 能力边界发生了什么变化。', en: 'Understand what changed in agent capabilities.' }],
    [{ zh: '练习', en: 'Practice' }, { zh: '把目标、上下文与验收标准说清楚。', en: 'Define the goal, context, and acceptance criteria.' }],
    [{ zh: '尝试', en: 'Try' }, { zh: '让 Agent 自己选择路径，再检查结果。', en: 'Let the agent choose the path, then verify the result.' }]
  ].forEach(([title, body], index) => {
    const card = el('article', 'fluency-next-action')
    card.append(el('span', 'fluency-next-action-index', `0${index + 1}`), el('h3', undefined, copy(title)), el('p', undefined, copy(body)))
    nextActions.appendChild(card)
  })
  next.appendChild(nextActions)
  preview.appendChild(next)

  const always = el('section', 'fluency-section fluency-future-section')
  const alwaysHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  alwaysHeader.append(el('span', 'fluency-eyebrow', copy({ zh: '06 · 它会一直更新', en: '06 · ALWAYS LEARNING WITH YOU' })), el('h2', undefined, copy({ zh: '每隔一段时间，Loop 会回来告诉你：', en: 'Every so often, the Loop comes back to tell you:' })))
  always.appendChild(alwaysHeader)
  const returnList = el('div', 'fluency-return-list')
  ;[
    { zh: '最近你学会了什么', en: 'What you have learned recently' },
    { zh: '还有哪些认知欠条值得补', en: 'Which cognitive debts are worth repaying' },
    { zh: '你的 AI 使用方式发生了什么变化', en: 'How your way of using AI has changed' },
    { zh: '外面有哪些新东西真的与你有关', en: 'What new things outside are truly relevant to you' },
    { zh: '下一步最值得花时间做什么', en: 'What is most worth your time next' }
  ].forEach((item, index) => {
    const row = el('div', 'fluency-return-item')
    row.append(el('span', undefined, `0${index + 1}`), el('strong', undefined, copy(item)))
    returnList.appendChild(row)
  })
  always.appendChild(returnList)
  always.appendChild(el('p', 'fluency-always-line', 'Always learning with you.'))
  always.appendChild(el('p', 'fluency-release-note', copy({ zh: 'MindIOU Loop · 预计 8 月下旬上线第一版', en: 'MindIOU Loop · First version expected in late August' })))
  preview.appendChild(always)
  return preview
}

function renderProfileCard(profile: CognitiveLoopProfile): HTMLElement {
  const card = el('article', 'cognitive-loop-profile-card')
  const head = el('div', 'cognitive-loop-profile-head')
  head.append(el('h3', 'cognitive-loop-profile-title', profile.label ? t(profile.label, profile.labelEn) : profile.labelEn), el('strong', 'cognitive-loop-profile-score', String(profile.score)))
  card.appendChild(head)
  const meter = el('div', 'cognitive-loop-meter')
  const fill = el('span', 'cognitive-loop-meter-fill')
  fill.style.width = String(profile.score) + '%'
  meter.appendChild(fill)
  card.appendChild(meter)
  const badges = el('div', 'cognitive-loop-badges')
  badges.append(
    el('span', 'cognitive-loop-badge', profile.evidenceStatus === 'observed' ? copy({ zh: '有行为证据', en: 'Behavior observed' }) : copy({ zh: '证据不足', en: 'Insufficient evidence' })),
    el('span', 'cognitive-loop-badge cognitive-loop-badge-muted', copy({ zh: '置信度：', en: 'Confidence: ' }) + profile.confidence)
  )
  card.appendChild(badges)
  card.appendChild(el('p', 'cognitive-loop-diagnosis', t(profile.diagnosis, profile.diagnosisEn)))
  const evidence = el('ul', 'cognitive-loop-evidence-list')
  if (!profile.evidence.length) {
    evidence.appendChild(el('li', undefined, copy({ zh: '本轮没有观察到足够的直接行为证据。', en: 'This loop did not observe enough direct behavioral evidence.' })))
  } else {
    profile.evidence.slice(0, 2).forEach(item => {
      const line = el('li')
      line.appendChild(el('span', undefined, item.excerpt))
      line.appendChild(el('small', 'cognitive-loop-evidence-meta', formatDate(item.occurredAt)))
      evidence.appendChild(line)
    })
  }
  card.appendChild(evidence)
  card.appendChild(el('p', 'cognitive-loop-next-action', copy({ zh: '下一步：', en: 'Next: ' }) + profile.nextAction))
  return card
}

const DOMAIN_DIMENSION_LABELS: Record<string, LocalizedText> = {
  conceptualUnderstanding: { zh: '概念理解', en: 'Conceptual understanding' },
  causalExplanation: { zh: '因果解释', en: 'Causal explanation' },
  practicalReproduction: { zh: '实践复现', en: 'Practical reproduction' },
  boundariesAndRisks: { zh: '边界与风险', en: 'Boundaries and risks' },
  transferAbility: { zh: '迁移应用', en: 'Transfer ability' }
}

function renderDomainCapabilityCard(profile: DomainCapabilityProfile, preview = false): HTMLElement {
  const card = el('article', `fluency-capability-summary fluency-capability-domain${preview ? ' is-preview' : ''}`)
  const domainScores = Object.values(profile.dimensions || {}).map(dimension => Number(dimension.score || 0)).filter(Number.isFinite)
  const overall = Number(profile.overallMastery ?? (domainScores.length ? Math.round(domainScores.reduce((sum, score) => sum + score, 0) / domainScores.length) : 0))
  card.append(
    el('span', 'fluency-capability-kicker', copy({ zh: '领域能力', en: 'DOMAIN CAPABILITY' })),
    el('h3', undefined, profile.domain || copy({ zh: '尚未指定领域', en: 'No domain specified yet' }))
  )
  const scoreRow = el('div', 'fluency-domain-score-row')
  scoreRow.append(el('strong', 'fluency-capability-score', String(overall)), el('span', 'fluency-capability-score-label', copy({ zh: '当前领域掌握度', en: 'current domain mastery' })))
  card.append(scoreRow, el('p', undefined, copy({ zh: '回答的是：你会不会做这件事？系统通过知识、训练、解释、迁移和真实工作验证来推进。', en: 'The question is: can you do this work? Progress comes through knowledge, training, explanation, transfer, and real-work verification.' })))
  const dimensionList = el('div', 'fluency-domain-dimension-list')
  Object.entries(profile.dimensions || {}).forEach(([key, dimension]) => {
    const row = el('div', 'fluency-domain-dimension-row')
    const label = DOMAIN_DIMENSION_LABELS[key] || { zh: key, en: key }
    const rowHead = el('div', 'fluency-domain-dimension-head')
    rowHead.append(el('span', undefined, copy(label)), el('strong', undefined, String(dimension.score)))
    const meter = el('div', 'fluency-dimension-meter')
    const fill = el('span', 'fluency-dimension-meter-fill')
    fill.style.width = `${Math.max(0, Math.min(100, Number(dimension.score || 0)))}%`
    meter.appendChild(fill)
    row.append(rowHead, meter)
    dimensionList.appendChild(row)
  })
  card.appendChild(dimensionList)
  card.appendChild(el('span', 'fluency-capability-note', copy({ zh: '干预方式：知识、训练、解释、迁移、真实工作验证', en: 'Interventions: knowledge, training, explanation, transfer, and real-work verification' })))
  return card
}

function renderCapabilitySplit(result: CognitiveLoopResult): HTMLElement {
  const sectionNode = section(copy({ zh: '两条并行能力线', en: 'Two parallel capability lines' }), 'cognitive-loop-panel cognitive-loop-capability-split')
  const profile = result.cognitiveProfile
  const domains = result.domainCapabilityProfiles || profile?.domainCapabilityProfiles || []
  if (domains.length) {
    domains.forEach(domain => sectionNode.appendChild(renderDomainCapabilityCard(domain)))
  } else {
    const empty = el('article', 'cognitive-loop-capability-empty')
    empty.append(
      el('h3', undefined, copy({ zh: '领域能力', en: 'Domain capability' })),
      el('p', undefined, copy({ zh: '本轮没有指定具体领域，因此系统不会把“证据不足”误写成领域缺口。填写领域后，才会启动专业能力观察。', en: 'No specific domain was supplied for this loop, so insufficient evidence is not turned into a domain gap. Add a domain to start professional-capability observation.' }))
    )
    sectionNode.appendChild(empty)
  }
  const ai = el('article', 'cognitive-loop-capability-summary')
  ai.append(
    el('span', 'fluency-capability-kicker', copy({ zh: 'AI 协作能力', en: 'AI COLLABORATION CAPABILITY' })),
    el('h3', undefined, copy({ zh: '七个行为维度', en: 'Seven behavioral dimensions' })),
    el('p', undefined, copy({ zh: '问题建模、任务拆解、上下文、判断与验证、多轮协作、工作流、AI 能力边界认知。', en: 'Problem modeling, task decomposition, context, verification, iteration, workflow, and AI boundary awareness.' })),
    el('span', 'fluency-capability-note', copy({ zh: '干预方式：行为实验、委派、验证、上下文、工作流升级', en: 'Interventions: behavior experiments, delegation, verification, context, and workflow upgrades' }))
  )
  sectionNode.appendChild(ai)
  return sectionNode
}

function renderPriorityInterventions(result: CognitiveLoopResult): HTMLElement {
  const interventions: PriorityIntervention[] = result.priorityInterventions || result.cognitiveProfile?.priorityInterventions || []
  const card = section(copy({ zh: '本轮统一干预 · 最多三项', en: 'Unified interventions · Up to three this loop' }), 'cognitive-loop-panel cognitive-loop-priority-interventions')
  if (!interventions.length) {
    card.appendChild(el('p', undefined, copy({ zh: '本轮还没有足够证据形成干预队列。', en: 'There is not enough evidence to form an intervention queue yet.' })))
    return card
  }
  const grid = el('div', 'cognitive-loop-intervention-grid')
  interventions.forEach(item => {
    const typeLabel = item.category === 'domain_capability'
      ? copy({ zh: '领域能力', en: 'Domain capability' })
      : item.category === 'ai_collaboration'
        ? copy({ zh: 'AI 协作能力', en: 'AI collaboration' })
        : copy({ zh: '前沿信息', en: 'Frontier information' })
    const intervention = el('article', `cognitive-loop-intervention-card is-${item.category}`)
    intervention.append(
      el('span', 'cognitive-loop-intervention-category', typeLabel),
      el('h3', undefined, item.title),
      el('p', 'cognitive-loop-intervention-action', item.action),
      el('p', 'cognitive-loop-intervention-path', copy({ zh: '方式：', en: 'Mode: ' }) + item.interventionPath.join(' · ')),
      el('small', undefined, item.reason)
    )
    grid.appendChild(intervention)
  })
  card.appendChild(grid)
  return card
}

function sendFeedback(
  runId: string,
  kind: 'recommendation' | 'correction' | 'experiment',
  targetId: string,
  payload: Record<string, unknown>,
  status: HTMLElement,
  ...buttons: HTMLButtonElement[]
): void {
  buttons.forEach(button => { button.disabled = true })
  status.textContent = copy({ zh: '正在保存反馈…', en: 'Saving feedback…' })
  void submitCognitiveLoopFeedback(runId, { kind, targetId, payload }).then(() => {
    status.textContent = copy({ zh: '反馈已保存；下一轮会使用这条反馈调整排序。', en: 'Feedback saved; the next loop will use it to adjust prioritization.' })
  }).catch(error => {
    status.textContent = message(error)
    buttons.forEach(button => { button.disabled = false })
  })
}

function renderDebt(result: CognitiveLoopResult, runId: string, status: HTMLElement): HTMLElement {
  const debt = (result.aiUsageDebts || [])[0]
  const card = section(copy({ zh: 'AI 使用欠条 · 本轮最值得改变的行为', en: 'AI usage debt · The behavior most worth changing this loop' }), 'cognitive-loop-panel cognitive-loop-debt')
  if (!debt) {
    card.appendChild(el('p', undefined, copy({ zh: '本轮没有形成新的 AI 使用欠条。', en: 'No new AI usage debt was formed in this loop.' })))
    return card
  }
  const head = el('div', 'cognitive-loop-debt-head')
  head.append(el('h3', undefined, debt.title), el('span', 'cognitive-loop-priority', debt.priority.toUpperCase()))
  card.appendChild(head)
  card.appendChild(el('p', 'cognitive-loop-debt-why', debt.why))
  card.appendChild(el('p', 'cognitive-loop-debt-action', copy({ zh: '建议动作：', en: 'Suggested action: ' }) + debt.nextAction))
  const evidence = el('ul', 'cognitive-loop-evidence-list')
  if (!debt.evidence.length) evidence.appendChild(el('li', undefined, copy({ zh: '这是一个“证据不足”提示，不代表你已经被判定为低能力。', en: 'This is an insufficient-evidence signal, not a judgment that you have low capability.' })))
  debt.evidence.forEach(item => evidence.appendChild(el('li', undefined, item.excerpt)))
  card.appendChild(evidence)
  const correction = el('div', 'cognitive-loop-feedback-row')
  correction.appendChild(el('span', undefined, copy({ zh: '这个判断符合当前任务吗？', en: 'Does this judgment fit the task?' })))
  const yes = el('button', 'btn btn-ghost btn-sm', copy({ zh: '符合', en: 'Yes' })) as HTMLButtonElement
  const no = el('button', 'btn btn-ghost btn-sm', copy({ zh: '需要纠正', en: 'Needs correction' })) as HTMLButtonElement
  yes.type = 'button'
  no.type = 'button'
  yes.onclick = () => sendFeedback(runId, 'correction', debt.id, { accepted: true }, status, yes, no)
  no.onclick = () => sendFeedback(runId, 'correction', debt.id, { accepted: false }, status, yes, no)
  correction.append(yes, no)
  card.appendChild(correction)
  return card
}

function renderBriefing(result: CognitiveLoopResult, runId: string, status: HTMLElement): HTMLElement {
  const briefing = result.briefing
  const card = section(briefing.title, 'cognitive-loop-panel cognitive-loop-briefing')
  const diet = briefing.informationDiet
  card.appendChild(el('p', 'cognitive-loop-briefing-explanation', briefing.explanation))
  card.appendChild(el('p', 'cognitive-loop-diet', copy({ zh: '候选 ', en: 'Candidates: ' }) + diet.candidateCount + copy({ zh: ' 条 · 去重后 ', en: ' · unique: ' }) + diet.uniqueCount + copy({ zh: ' 条 · 重复 ', en: ' · duplicates: ' }) + diet.duplicateCount + copy({ zh: ' 条 · 本轮推荐 ', en: ' · recommended: ' }) + diet.recommendedCount + copy({ zh: ' 条', en: '' })))
  if (!briefing.items.length) {
    card.appendChild(el('p', 'cognitive-loop-empty', copy({ zh: '没有可审计候选内容，系统选择不增加信息噪音。', en: 'There are no auditable content candidates; the system chose not to add noise.' })))
    return card
  }
  briefing.items.forEach(item => {
    const itemCard = el('article', 'cognitive-loop-content-card')
    const head = el('div', 'cognitive-loop-content-head')
    head.append(el('h3', undefined, item.title), el('span', 'cognitive-loop-content-decision', item.decision))
    itemCard.appendChild(head)
    itemCard.appendChild(el('p', 'cognitive-loop-content-meta', item.sourceName + ' · ' + copy({ zh: '相关性 ', en: 'relevance ' }) + item.relevance + ' · ' + copy({ zh: '证据强度 ', en: 'evidence strength ' }) + Math.round(item.contentRecord.evidenceStrength * 100) + '%'))
    itemCard.appendChild(el('p', undefined, item.summary))
    itemCard.appendChild(el('p', 'cognitive-loop-content-reason', item.decisionReason))
    const points = el('ul', 'cognitive-loop-evidence-list')
    item.keyPoints.slice(0, 4).forEach(point => points.appendChild(el('li', undefined, point)))
    itemCard.appendChild(points)
    const actions = el('div', 'cognitive-loop-feedback-row')
    const accept = el('button', 'btn btn-primary btn-sm', item.decision === 'skip' ? copy({ zh: '确认跳过', en: 'Confirm skip' }) : copy({ zh: '值得看', en: 'Worth reading' })) as HTMLButtonElement
    const reject = el('button', 'btn btn-ghost btn-sm', item.decision === 'skip' ? copy({ zh: '仍想了解', en: 'Still interested' }) : copy({ zh: '跳过', en: 'Skip' })) as HTMLButtonElement
    accept.type = 'button'
    reject.type = 'button'
    accept.onclick = () => sendFeedback(runId, 'recommendation', item.id, { decision: item.decision, accepted: true }, status, accept, reject)
    reject.onclick = () => sendFeedback(runId, 'recommendation', item.id, { decision: item.decision, accepted: false }, status, accept, reject)
    actions.append(accept, reject)
    if (item.url) {
      const link = el('a', 'text-link', copy({ zh: '打开来源', en: 'Open source' })) as HTMLAnchorElement
      link.href = item.url
      link.target = '_blank'
      link.rel = 'noreferrer'
      actions.appendChild(link)
    }
    itemCard.appendChild(actions)
    card.appendChild(itemCard)
  })
  return card
}

function renderExperiment(result: CognitiveLoopResult, runId: string, status: HTMLElement): HTMLElement {
  const experiment = result.experiment
  const card = section(copy({ zh: '行为实验与下一周验证', en: 'Behavior experiment and next-week verification' }), 'cognitive-loop-panel cognitive-loop-experiment')
  card.appendChild(el('h3', 'cognitive-loop-experiment-title', experiment.title))
  card.appendChild(el('p', undefined, experiment.instruction))
  card.appendChild(el('p', 'cognitive-loop-experiment-due', copy({ zh: '建议完成时间：', en: 'Suggested completion: ' }) + formatDate(experiment.dueAt)))
  const criteria = el('ul', 'cognitive-loop-evidence-list')
  experiment.successCriteria.forEach(item => criteria.appendChild(el('li', undefined, item)))
  card.appendChild(criteria)
  const form = el('form', 'cognitive-loop-verification-form') as HTMLFormElement
  const outcome = el('select', 'cognitive-loop-select') as HTMLSelectElement
  ;[['improved', copy({ zh: '已改变行为', en: 'Behavior changed' })], ['unchanged', copy({ zh: '还没有改变', en: 'Not changed yet' })], ['not_done', copy({ zh: '尚未执行', en: 'Not attempted' })]].forEach(([value, label]) => {
    const option = el('option', undefined, label) as HTMLOptionElement
    option.value = value
    outcome.appendChild(option)
  })
  const note = el('input', 'cognitive-loop-input') as HTMLInputElement
  note.placeholder = copy({ zh: '可选：记录下一周的真实证据', en: 'Optional: record evidence from next week' })
  const submit = el('button', 'btn btn-primary btn-sm', copy({ zh: '记录验证', en: 'Record verification' })) as HTMLButtonElement
  submit.type = 'submit'
  form.append(outcome, note, submit)
  form.onsubmit = event => {
    event.preventDefault()
    sendFeedback(runId, 'experiment', experiment.id, { outcome: outcome.value, note: note.value.trim() }, status, submit)
  }
  card.appendChild(form)
  return card
}

function renderLoopResult(root: HTMLElement, run: CognitiveLoopRun, feedbackCount: number): void {
  const result = run.result
  const resultBox = el('div', 'cognitive-loop-result')
  const summary = el('section', 'cognitive-loop-summary')
  summary.append(
    el('span', 'cognitive-loop-source-badge', t(result.sourceLabel, 'Auditable structured behavior rules')),
    el('h2', undefined, copy({ zh: '这周先改变一件事，而不是再看十条内容', en: 'Change one thing this week instead of reading ten more updates' })),
    el('p', undefined, copy({ zh: '读取 ', en: 'Read ' }) + result.inputSummary.activityCount + copy({ zh: ' 条近 ', en: ' activities from the last ' }) + result.window.days + copy({ zh: ' 天活动；已形成 ', en: ' days; formed ' }) + result.aiUsageDebts.length + copy({ zh: ' 个待验证行为缺口。', en: ' behavior gaps to verify.' }))
  )
  const status = el('p', 'cognitive-loop-status')
  if (feedbackCount) status.textContent = copy({ zh: '已记录 ', en: 'Recorded ' }) + feedbackCount + copy({ zh: ' 条反馈；它会进入下一轮排序。', en: ' feedback item(s); it will affect the next loop.' })
  summary.appendChild(status)
  resultBox.appendChild(summary)
  resultBox.appendChild(renderCapabilitySplit(result))
  resultBox.appendChild(renderPriorityInterventions(result))
  const profileSection = section(copy({ zh: 'AI 协作画像 · 7 个可观察维度', en: 'AI Collaboration Profile · 7 observable dimensions' }), 'cognitive-loop-panel')
  const grid = el('div', 'cognitive-loop-profile-grid')
  result.aiCollaborationProfile.forEach(profile => grid.appendChild(renderProfileCard(profile)))
  profileSection.appendChild(grid)
  resultBox.append(profileSection, renderDebt(result, run.id, status), renderBriefing(result, run.id, status), renderExperiment(result, run.id, status))
  const policy = el('aside', 'cognitive-loop-policy')
  policy.appendChild(el('strong', undefined, copy({ zh: '证据边界', en: 'Evidence boundary' })))
  policy.appendChild(el('p', undefined, result.evidencePolicy))
  policy.appendChild(el('p', undefined, copy({ zh: '当前内容候选为固定/策展演示输入，不代表已完成全网抓取、实时视频读取或长期能力认证。', en: 'Current content candidates are fixed/curated demo inputs; this does not represent full-web crawling, live video reading, or long-term capability certification.' })))
  resultBox.appendChild(policy)
  root.appendChild(resultBox)
}

function parseCandidates(value: string): CognitiveLoopContentCandidateInput[] {
  return value.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => {
    const parts = line.split('|').map(item => item.trim())
    return {
      id: 'manual-content-' + (index + 1),
      title: parts[0] || '固定信息源 ' + (index + 1),
      url: parts[1] || undefined,
      sourceName: parts[2] || '用户固定信息源',
      summary: parts[3] || parts[0] || ''
    }
  })
}

async function createProject(name: string): Promise<{ id: string; name: string }> {
  const response = await projectMemoryRequest<{ project: { id: string; name: string } }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, projectType: 'software' })
  })
  return response.project
}

export async function renderCognitiveLoopPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-cognitive-loop page-fluency-loop')
  const header = el('header', 'page-header cognitive-loop-page-header')
  const heading = el('div')
  heading.append(el('p', 'dashboard-kicker', copy({ zh: 'AI 协作循环 · 功能预告', en: 'FLUENCY LOOP · FEATURE PREVIEW' })), el('h1', 'page-title', copy({ zh: 'AI 协作循环', en: 'Fluency Loop' })), el('p', 'cognitive-loop-subtitle', copy({ zh: '你的 AI 一直在进化。你与它一起工作的方式，也应该持续进化。', en: 'Your AI keeps evolving. The way you work with it should too.' })))
  const actions = el('div', 'header-actions')
  const back = el('button', 'btn btn-ghost btn-sm', copy({ zh: '返回工作区', en: 'Back to workspace' })) as HTMLButtonElement
  back.type = 'button'
  back.onclick = () => navigate({ name: 'app' })
  actions.appendChild(back)
  header.append(heading, actions)
  page.appendChild(header)

  const main = el('main', 'cognitive-loop-main')
  const inputPanel = section(copy({ zh: '开始运行你的真实 AI 协作循环', en: 'Run your real AI collaboration loop' }), 'cognitive-loop-panel cognitive-loop-input-panel')
  inputPanel.appendChild(el('p', 'cognitive-loop-help', copy({ zh: '当前 MVP 接受一段脱敏 AI 对话和项目背景；原始材料不会作为长期完整文本展示，系统只保存结构化信号与有限证据摘录。', en: 'This MVP accepts a redacted AI conversation and project context. Raw material is not displayed as a complete long-term record; only structured signals and limited excerpts are stored.' })))
  const form = el('form', 'cognitive-loop-form') as HTMLFormElement
  const projectRow = el('div', 'cognitive-loop-project-row')
  const projectSelect = el('select', 'cognitive-loop-select') as HTMLSelectElement
  projectSelect.required = true
  const projectName = el('input', 'cognitive-loop-input') as HTMLInputElement
  projectName.placeholder = copy({ zh: '新项目名称', en: 'New project name' })
  const create = el('button', 'btn btn-ghost btn-sm', copy({ zh: '新建项目', en: 'Create project' })) as HTMLButtonElement
  create.type = 'button'
  const projectStatus = el('p', 'cognitive-loop-status')
  projectRow.append(projectSelect, projectName, create)
  form.appendChild(projectRow)
  const domain = el('input', 'cognitive-loop-input') as HTMLInputElement
  domain.placeholder = copy({ zh: '当前专业领域（如：软件产品、金融、设计；用于并行观察领域能力）', en: 'Current domain (e.g. software product, finance, design; used for parallel domain observation)' })
  form.appendChild(domain)
  const context = el('textarea', 'cognitive-loop-textarea') as HTMLTextAreaElement
  context.placeholder = copy({ zh: '项目背景：当前目标、阶段、约束、关键决策（建议脱敏）', en: 'Project context: current goal, stage, constraints, and key decisions (redact sensitive data)' })
  context.rows = 4
  form.appendChild(context)
  const activity = el('textarea', 'cognitive-loop-textarea') as HTMLTextAreaElement
  activity.placeholder = copy({ zh: '粘贴近 7 天的一段或多段 AI 对话（建议包含用户请求、AI 输出和你之后如何接受、验证或修改）', en: 'Paste one or more AI conversations from the last 7 days (include your request, the AI output, and how you accepted, verified, or changed it)' })
  activity.rows = 12
  activity.required = true
  form.appendChild(activity)
  const candidateInput = el('textarea', 'cognitive-loop-textarea cognitive-loop-candidate-input') as HTMLTextAreaElement
  candidateInput.placeholder = copy({ zh: '可选：固定信息源，每行：标题 | URL | 来源 | 摘要。留空则使用透明标记的策展演示候选。', en: 'Optional fixed sources, one per line: title | URL | source | summary. Leave blank to use transparent curated demo candidates.' })
  candidateInput.rows = 3
  form.appendChild(candidateInput)
  const formActions = el('div', 'cognitive-loop-form-actions')
  const demo = el('button', 'btn btn-ghost btn-sm', copy({ zh: '填入演示样本', en: 'Use demo sample' })) as HTMLButtonElement
  demo.type = 'button'
  demo.onclick = () => {
    activity.value = DEMO_ACTIVITY
    if (!domain.value) domain.value = copy({ zh: '软件产品与 AI 协作', en: 'Software product and AI collaboration' })
    if (!context.value) context.value = copy({ zh: 'MindIOU Web 产品；目标是验证 AI 协作行为是否真的改变；约束是复用现有账户、项目记忆和认知欠条。', en: 'MindIOU Web product; goal: verify whether AI collaboration behavior changes; constraints: reuse the existing account, project memory, and cognitive-debt system.' })
  }
  const submit = el('button', 'btn btn-primary', copy({ zh: '运行本周循环', en: 'Run this week’s loop' })) as HTMLButtonElement
  submit.type = 'submit'
  formActions.append(demo, submit)
  form.append(formActions)
  const status = el('p', 'cognitive-loop-status')
  form.appendChild(status)
  inputPanel.appendChild(form)
  const resultHost = el('div', 'cognitive-loop-result-host')
  resultHost.appendChild(el('section', 'cognitive-loop-empty-state', copy({ zh: '选择项目并导入活动后，这里会显示领域能力、七维 AI 协作画像、统一干预、有限信息简报和行为实验。', en: 'Select a project and import activity to see domain capability, a seven-dimensional AI collaboration profile, unified interventions, a limited briefing, and a behavior experiment.' })))
  const preview = renderFluencyPreview(() => inputPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  main.append(preview, inputPanel, resultHost)
  page.appendChild(main)
  root.appendChild(page)

  const loadLatest = async (projectId: string): Promise<void> => {
    if (!projectId) return
    resultHost.replaceChildren(el('p', 'loading', copy({ zh: '正在读取最近一轮 AI 协作循环…', en: 'Loading the latest AI collaboration loop…' })))
    try {
      const response = await fetchLatestCognitiveLoop(projectId)
      resultHost.replaceChildren()
      if (response.run) renderLoopResult(resultHost, response.run, response.feedback.length)
      else resultHost.appendChild(el('section', 'cognitive-loop-empty-state', copy({ zh: '这个项目还没有运行过 AI 协作循环。导入近 7 天活动后开始。', en: 'This project has not run an AI collaboration loop yet. Import activity from the last 7 days to begin.' })))
    } catch (error) {
      resultHost.replaceChildren()
      resultHost.appendChild(el('section', 'cognitive-loop-error-state', message(error)))
    }
  }

  try {
    const projects = await listProjects()
    projectSelect.appendChild(el('option', undefined, copy({ zh: '选择一个项目', en: 'Select a project' })) as HTMLOptionElement)
    projects.forEach(project => {
      const option = el('option', undefined, project.name) as HTMLOptionElement
      option.value = project.id
      projectSelect.appendChild(option)
    })
    const remembered = sessionStorage.getItem(PROJECT_KEY)
    if (remembered && projects.some(project => project.id === remembered)) projectSelect.value = remembered
    if (projectSelect.value) void loadLatest(projectSelect.value)
    projectSelect.onchange = () => {
      sessionStorage.setItem(PROJECT_KEY, projectSelect.value)
      void loadLatest(projectSelect.value)
    }
    projectStatus.textContent = projects.length ? '' : copy({ zh: '还没有项目，请先新建一个项目。', en: 'No projects yet. Create one first.' })
  } catch (error) {
    projectStatus.textContent = message(error)
  }

  create.onclick = async () => {
    const name = projectName.value.trim()
    if (!name) {
      projectStatus.textContent = copy({ zh: '请先填写项目名称。', en: 'Enter a project name first.' })
      projectName.focus()
      return
    }
    create.disabled = true
    try {
      const project = await createProject(name)
      const option = el('option', undefined, project.name) as HTMLOptionElement
      option.value = project.id
      projectSelect.appendChild(option)
      projectSelect.value = project.id
      sessionStorage.setItem(PROJECT_KEY, project.id)
      projectName.value = ''
      projectStatus.textContent = copy({ zh: '项目已创建。', en: 'Project created.' })
      void loadLatest(project.id)
    } catch (error) {
      projectStatus.textContent = message(error)
    } finally {
      create.disabled = false
    }
  }

  form.onsubmit = event => {
    event.preventDefault()
    if (!projectSelect.value) {
      status.textContent = copy({ zh: '请先选择或新建项目。', en: 'Select or create a project first.' })
      return
    }
    const content = activity.value.trim()
    if (!content) {
      status.textContent = copy({ zh: '请先导入一段 AI 对话。', en: 'Import an AI conversation first.' })
      activity.focus()
      return
    }
    submit.disabled = true
    status.textContent = copy({ zh: '正在运行结构化 AI 协作循环…', en: 'Running the structured AI collaboration loop…' })
    void runCognitiveLoop({
      projectId: projectSelect.value,
      projectContext: context.value.trim(),
      domain: domain.value.trim(),
      activities: [{ title: copy({ zh: '手动导入 AI 对话', en: 'Manually imported AI conversation' }), content, source: 'manual_paste' }],
      contentCandidates: parseCandidates(candidateInput.value),
      windowDays: 7,
      clientRunId: 'web-' + crypto.randomUUID()
    }).then(response => {
      status.textContent = copy({ zh: '本周 AI 协作循环已完成。', en: 'This week’s AI collaboration loop is complete.' })
      resultHost.replaceChildren()
      if (response.run) renderLoopResult(resultHost, response.run, response.feedback.length)
    }).catch(error => {
      status.textContent = message(error)
    }).finally(() => {
      submit.disabled = false
    })
  }
}

export function renderFluencyLoopPreviewPage(root: HTMLElement): void {
  const page = el('div', 'page page-fluency-loop page-fluency-preview-only')
  const topbar = el('div', 'fluency-preview-topbar')
  topbar.append(
    el('span', 'fluency-preview-topbar-brand', 'MindIOU'),
    el('span', 'fluency-preview-topbar-label', copy({ zh: 'MindIOU Loop · 功能预告', en: 'MindIOU Loop · Feature Preview' }))
  )
  const home = el('a', 'text-link fluency-preview-home-link', copy({ zh: '返回 MindIOU', en: 'Back to MindIOU' })) as HTMLAnchorElement
  home.href = '#/'
  topbar.appendChild(home)
  page.appendChild(topbar)
  const main = el('main', 'cognitive-loop-main fluency-preview-only-main')
  main.appendChild(renderFluencyPreview(() => navigate({ name: 'login' })))
  page.appendChild(main)
  root.appendChild(page)
}
