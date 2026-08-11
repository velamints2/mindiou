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
  CognitiveLoopRun
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

  const hero = el('section', 'fluency-hero')
  const heroCopy = el('div', 'fluency-hero-copy')
  heroCopy.append(
    el('span', 'fluency-eyebrow', copy({ zh: '功能更新 · 预告', en: 'FEATURE UPDATE · PREVIEW' })),
    el('h2', 'fluency-hero-title', copy({ zh: 'AI 协作循环', en: 'Fluency Loop' })),
    el('p', 'fluency-hero-lead', copy({ zh: '你的 AI 一直在进化。', en: 'Your AI keeps evolving.' })),
    el('p', 'fluency-hero-lead fluency-hero-lead-muted', copy({ zh: '你与它一起工作的方式，也应该持续进化。', en: 'The way you work with it should too.' })),
    el('p', 'fluency-hero-cn', copy({ zh: 'AI 的能力每天都在变化。MindIOU 持续观察你真实的 AI 使用行为，理解你的协作习惯，并判断你现在最值得升级的 AI 使用方式。', en: 'AI capabilities change every day. MindIOU observes how you actually work with AI, understands your collaboration habits, and identifies the next behavior worth upgrading.' })),
    el('div', 'fluency-hero-tag', copy({ zh: '个人 AI 协作底座', en: 'Personal AI Harness' }))
  )
  const heroArt = el('div', 'fluency-hero-art')
  heroArt.setAttribute('aria-hidden', 'true')
  heroArt.append(
    el('span', 'fluency-orbit fluency-orbit-one'),
    el('span', 'fluency-orbit fluency-orbit-two'),
    el('span', 'fluency-orbit fluency-orbit-three'),
    el('strong', undefined, copy({ zh: '循环', en: 'LOOP' })),
    el('small', undefined, copy({ zh: '持续学习', en: 'ALWAYS LEARNING' }))
  )
  hero.append(heroCopy, heroArt)
  preview.appendChild(hero)

  const running = el('section', 'fluency-section fluency-running')
  const runningHeader = el('div', 'fluency-section-header')
  const runningTitle = el('div')
  runningTitle.append(el('span', 'fluency-eyebrow', copy({ zh: '你的循环正在运行', en: 'YOUR LOOP IS RUNNING' })), el('h2', undefined, copy({ zh: 'MindIOU 正在持续学习你的 AI 工作方式', en: 'MindIOU is continuously learning how you work with AI' })))
  const lastLoop = el('div', 'fluency-last-loop')
  lastLoop.append(el('span', 'fluency-live-dot'), el('span', undefined, copy({ zh: '最近一轮', en: 'Last Loop' })), el('strong', undefined, copy({ zh: '刚刚完成', en: 'Just completed' })))
  runningHeader.append(runningTitle, lastLoop)
  running.appendChild(runningHeader)
  const metricGrid = el('div', 'fluency-metric-grid')
  FLUENCY_LOOP_PREVIEW.metrics.forEach(metric => {
    const card = el('article', 'fluency-metric-card')
    card.append(el('strong', undefined, metric.value), el('span', undefined, copy({ zh: metric.label, en: metric.labelEn })))
    metricGrid.appendChild(card)
  })
  running.appendChild(metricGrid)
  const updateRow = el('div', 'fluency-update-row')
  updateRow.appendChild(el('span', 'fluency-update-label', copy({ zh: '本轮更新', en: 'THIS LOOP UPDATED' })))
  const updateList = el('div', 'fluency-update-list')
  FLUENCY_LOOP_PREVIEW.updates.forEach(update => updateList.appendChild(el('span', undefined, copy(update))))
  updateRow.appendChild(updateList)
  running.appendChild(updateRow)
  running.appendChild(el('p', 'fluency-running-note', copy({ zh: '下一次真实行为发生后，循环会继续更新。', en: 'The loop will update again when your next real behavior arrives.' })))
  preview.appendChild(running)

  const fluency = el('section', 'fluency-section')
  const fluencyHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  fluencyHeader.append(el('span', 'fluency-eyebrow', copy({ zh: 'AI 协作能力', en: 'AI FLUENCY' })), el('h2', undefined, copy({ zh: '不是你懂多少 AI。', en: 'It is not how much AI you know.' })), el('p', undefined, copy({ zh: '而是：你是否知道怎样与 AI 一起完成工作。MindIOU 持续理解你在四件事情上的真实表现。', en: 'It is whether you know how to get work done with AI. MindIOU keeps learning how you perform across four observable behaviors.' })))
  fluency.appendChild(fluencyHeader)
  const dimensionGrid = el('div', 'fluency-dimension-grid')
  FLUENCY_LOOP_PREVIEW.dimensions.forEach(dimension => {
    const card = el('article', `fluency-dimension-card fluency-accent-${dimension.accent}${dimension.priority ? ' is-priority' : ''}`)
    const top = el('div', 'fluency-dimension-top')
    top.append(el('span', 'fluency-dimension-name', copy({ zh: dimension.title, en: dimension.titleEn })), el('strong', 'fluency-dimension-score', String(dimension.score)))
    card.appendChild(top)
    const meter = el('div', 'fluency-dimension-meter')
    const fill = el('span', 'fluency-dimension-meter-fill')
    fill.style.width = `${dimension.score}%`
    meter.appendChild(fill)
    card.appendChild(meter)
    card.appendChild(el('h3', undefined, copy({ zh: dimension.question, en: dimension.questionEn })))
    card.appendChild(el('p', 'fluency-dimension-observation', copy({ zh: dimension.judgment, en: dimension.judgmentEn })))
    const observations = el('ul', 'fluency-observation-list')
    dimension.observations.forEach(item => observations.appendChild(el('li', undefined, copy(item))))
    card.appendChild(observations)
    card.appendChild(el('p', `fluency-dimension-focus${dimension.priority ? ' fluency-dimension-focus-priority' : ''}`, copy({ zh: dimension.focus, en: dimension.focusEn })))
    dimensionGrid.appendChild(card)
  })
  fluency.appendChild(dimensionGrid)
  preview.appendChild(fluency)

  const gapSection = el('section', 'fluency-section fluency-gap-layout')
  const gapCard = el('article', 'fluency-gap-card')
  gapCard.append(
    el('span', 'fluency-eyebrow', copy({ zh: '你的 AI 协作缺口', en: 'YOUR FLUENCY GAP' })),
    el('h2', undefined, copy({ zh: '你现在的问题已经不是提示词。', en: 'Your problem is no longer prompting.' })),
    el('p', undefined, copy({ zh: '根据最近两周的真实行为，你已经能够清楚表达复杂需求，也会通过多轮对话改善答案。', en: 'Based on the last two weeks of behavior, you can express complex needs clearly and improve answers through multiple turns.' })),
    el('p', undefined, copy({ zh: '但你的工作方式仍然大量停留在：', en: 'But your workflow still looks like:' })),
    el('strong', 'fluency-gap-chain', copy({ zh: '人拆解 → 人监督 → AI 执行一个小步骤 → 人继续下一步', en: 'Human decomposes → human supervises → AI executes one small step → human continues' })),
    el('p', undefined, copy({ zh: '与此同时，智能代理的长期执行能力已经开始让这种工作方式显得低效。', en: 'Meanwhile, agents are getting better at sustained execution, making this workflow less efficient.' }))
  )
  const transition = el('div', 'fluency-gap-transition')
  transition.append(el('span', undefined, copy({ zh: 'AI 使用者', en: 'AI User' })), el('span', undefined, '→'), el('span', undefined, copy({ zh: 'AI 委派者', en: 'AI Delegator' })))
  gapCard.appendChild(transition)
  const experimentCard = el('article', 'fluency-experiment-card')
  experimentCard.append(
    el('span', 'fluency-eyebrow', copy({ zh: '你的下一项实验', en: 'YOUR NEXT EXPERIMENT' })),
    el('h2', undefined, copy({ zh: '本周只升级一种行为', en: 'Upgrade one behavior this week' })),
    el('h3', undefined, copy({ zh: '把一个完整任务交给智能代理', en: 'Delegate one complete task to an agent' })),
    el('p', undefined, copy({ zh: '选择一个低风险任务，只定义目标、上下文、约束和验收标准。不要设计中间步骤，让智能代理自己决定执行路径。', en: 'Choose a low-risk task. Define only the goal, context, constraints, and acceptance criteria. Do not design the intermediate steps; let the agent choose the path.' }))
  )
  const experimentFields = el('div', 'fluency-experiment-fields')
  ;[
    [{ zh: '目标', en: 'Goal' }, { zh: '最终要完成什么？', en: 'What must be completed?' }],
    [{ zh: '上下文', en: 'Context' }, { zh: 'AI 可以使用哪些信息？', en: 'What information can AI use?' }],
    [{ zh: '约束', en: 'Constraints' }, { zh: '哪些事情不能做？', en: 'What must not happen?' }],
    [{ zh: '验收标准', en: 'Acceptance criteria' }, { zh: '怎样才算真正完成？', en: 'What counts as complete?' }]
  ].forEach(([label, body]) => {
    const field = el('div', 'fluency-experiment-field')
    field.append(el('strong', undefined, copy(label)), el('span', undefined, copy(body)))
    experimentFields.appendChild(field)
  })
  experimentCard.appendChild(experimentFields)
  const startButton = el('button', 'btn btn-primary fluency-start-button', copy({ zh: '开始实验', en: 'Start experiment' })) as HTMLButtonElement
  startButton.type = 'button'
  startButton.onclick = startExperiment
  experimentCard.appendChild(startButton)
  gapSection.append(gapCard, experimentCard)
  preview.appendChild(gapSection)

  const harness = el('section', 'fluency-section fluency-harness')
  const harnessHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  harnessHeader.append(el('span', 'fluency-eyebrow', copy({ zh: '你的个人 AI 协作底座', en: 'YOUR PERSONAL AI HARNESS' })), el('h2', undefined, copy({ zh: '模型负责生成。协作底座决定 AI 怎样真正参与工作。', en: 'Models generate. A harness determines how AI participates in real work.' })), el('p', undefined, copy({ zh: 'MindIOU 正在逐渐为你建立一层长期运行的个人 AI 协作底座。', en: 'MindIOU is gradually building a long-running Personal AI Harness around you.' })))
  harness.appendChild(harnessHeader)
  const harnessGrid = el('div', 'fluency-harness-grid')
  FLUENCY_LOOP_PREVIEW.harness.forEach((pillar, index) => {
    const card = el('article', 'fluency-harness-card')
    card.append(el('span', 'fluency-harness-index', String(index + 1).padStart(2, '0')), el('h3', undefined, copy({ zh: pillar.title, en: pillar.titleEn })), el('p', undefined, copy({ zh: pillar.body, en: pillar.bodyEn })))
    harnessGrid.appendChild(card)
  })
  harness.appendChild(harnessGrid)
  preview.appendChild(harness)

  const awareness = el('section', 'fluency-section')
  const awarenessHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  awarenessHeader.append(el('span', 'fluency-eyebrow', copy({ zh: '能力感知', en: 'CAPABILITY AWARENESS' })), el('h2', undefined, copy({ zh: '不追踪 AI 新闻。追踪 AI 能力边界的变化。', en: 'Do not track AI news. Track changes in AI capability boundaries.' })), el('p', undefined, copy({ zh: 'AI 世界每天都有大量信息。循环更关心：发生了什么变化？为什么与你有关？你应该改变什么？', en: 'The AI world produces endless information. The loop asks: What changed? Why does it matter to you? What should change?' })))
  awareness.appendChild(awarenessHeader)
  const shiftGrid = el('div', 'fluency-shift-grid')
  FLUENCY_LOOP_PREVIEW.capabilityShifts.forEach(shift => {
    const card = el('article', 'fluency-shift-card')
    const shiftTop = el('div', 'fluency-shift-top')
    shiftTop.append(el('span', 'fluency-shift-number', shift.number), el('span', 'fluency-relevance', `${copy({ zh: '与你的相关性', en: 'Relevance to you' })} · ${shift.relevance}`))
    card.appendChild(shiftTop)
    card.append(el('h3', undefined, copy({ zh: shift.title, en: shift.titleEn })), el('p', 'fluency-shift-label', copy({ zh: '能力变化', en: 'Capability shift' })), el('p', undefined, copy({ zh: shift.shift, en: shift.shiftEn })), el('p', 'fluency-shift-label', copy({ zh: '对你的影响', en: 'Impact on you' })), el('p', undefined, copy({ zh: shift.impact, en: shift.impactEn })), el('p', 'fluency-shift-label', copy({ zh: '协作启示', en: 'Fluency implication' })), el('strong', 'fluency-shift-implication', copy({ zh: shift.implication, en: shift.implicationEn })), el('p', 'fluency-shift-action', copy({ zh: shift.action, en: shift.actionEn })))
    const shiftButton = el('button', 'btn btn-ghost btn-sm', shift.number === '01' ? copy({ zh: '开始实验', en: 'Start experiment' }) : copy({ zh: '为什么推荐？', en: 'Why this one?' })) as HTMLButtonElement
    shiftButton.type = 'button'
    shiftButton.onclick = startExperiment
    card.appendChild(shiftButton)
    shiftGrid.appendChild(card)
  })
  awareness.appendChild(shiftGrid)
  preview.appendChild(awareness)

  const research = el('section', 'fluency-section fluency-research')
  const researchHeader = el('div', 'fluency-section-header fluency-section-header-stacked')
  researchHeader.append(
    el('span', 'fluency-eyebrow', copy({ zh: '评估依据', en: 'EVALUATION EVIDENCE' })),
    el('h2', undefined, copy({ zh: '为什么观察这些协作行为？', en: 'Why observe these collaboration behaviors?' })),
    el('p', undefined, copy({ zh: '这些研究支持评估方向，但不会替我们给出你的个人分数。MindIOU 仍然必须用你的长期行为与实际结果来判断。', en: 'These studies support the evaluation directions, but they do not produce your personal score. MindIOU still needs your longitudinal behavior and real outcomes.' }))
  )
  const researchGrid = el('div', 'fluency-research-grid')
  RESEARCH_EVIDENCE.forEach(item => {
    const card = el('article', 'fluency-research-card')
    card.append(
      el('span', 'fluency-research-source', item.source),
      el('h3', undefined, copy(item.title)),
      el('p', undefined, copy(item.finding)),
      el('p', 'fluency-research-use', copy(item.use))
    )
    const link = el('a', 'text-link', copy({ zh: '查看原始研究', en: 'Read the original study' })) as HTMLAnchorElement
    link.href = item.url
    link.target = '_blank'
    link.rel = 'noreferrer'
    card.appendChild(link)
    researchGrid.appendChild(card)
  })
  research.append(researchHeader, researchGrid)
  preview.appendChild(research)

  const diet = el('section', 'fluency-section fluency-diet-layout')
  const dietCopy = el('article', 'fluency-diet-copy')
  dietCopy.append(el('span', 'fluency-eyebrow', copy({ zh: '信息饮食', en: 'INFORMATION DIET' })), el('h2', undefined, copy({ zh: '信息更多 ≠ AI 协作更流畅。', en: 'More information ≠ more fluency.' })), el('p', undefined, copy({ zh: '过去 7 天，循环已经开始过滤与你当前阶段无关的内容。', en: 'Over the last 7 days, the loop has started filtering content unrelated to your current stage.' })), el('strong', 'fluency-diet-highlight', '72%'), el('p', undefined, copy({ zh: '与你已经知道的信息高度重复。', en: 'was highly repetitive with what you already know.' })), el('p', 'fluency-diet-muted', copy({ zh: '本周循环已自动过滤：43 条重复观点 · 13 个低信息密度视频 · 7 条只有发布信息、没有能力变化的信息', en: 'Filtered this week: 43 repeated viewpoints · 13 low-density videos · 7 release-only updates with no capability change' })), el('strong', 'fluency-time-saved', copy({ zh: '预计减少无效信息消费：4.3 小时', en: 'Estimated time saved from low-value consumption: 4.3 hours' })))
  const dietChart = el('article', 'fluency-diet-chart')
  FLUENCY_LOOP_PREVIEW.diet.forEach(item => {
    const row = el('div', 'fluency-diet-row')
    const label = el('div', 'fluency-diet-row-label')
    label.append(el('span', undefined, copy({ zh: item.label, en: item.labelEn })), el('strong', undefined, `${item.value}%`))
    const bar = el('div', 'fluency-diet-bar')
    const fill = el('span', 'fluency-diet-fill')
    fill.style.width = `${item.value}%`
    bar.appendChild(fill)
    row.append(label, bar)
    dietChart.appendChild(row)
  })
  const ignored = el('div', 'fluency-ignored-card')
  ignored.append(el('strong', undefined, copy({ zh: '23 条热门 AI 更新已被忽略。', en: '23 popular AI updates were ignored.' })), el('span', undefined, copy({ zh: '它们很热门，但暂时不会改变你的工作方式。', en: 'They are popular, but they will not change how you work right now.' })))
  dietChart.appendChild(ignored)
  diet.append(dietCopy, dietChart)
  preview.appendChild(diet)

  const always = el('section', 'fluency-section fluency-always')
  const alwaysCopy = el('div', 'fluency-always-copy')
  alwaysCopy.append(el('span', 'fluency-eyebrow', copy({ zh: '持续学习', en: 'ALWAYS LEARNING' })), el('h2', undefined, copy({ zh: 'MindIOU 不会给你一个永久不变的 AI 协作能力分数。', en: 'MindIOU will not give you a permanent AI fluency score.' })), el('p', undefined, copy({ zh: 'AI 在变化。你的工作在变化。你使用 AI 的方式也在变化。所以系统永远不会“评估完成”。', en: 'AI changes. Your work changes. The way you use AI changes. The system is never “done evaluating.”' })), el('p', undefined, copy({ zh: '每一次 AI 协作都会成为新的证据。每一次实验都会改变系统对你的判断。每一次 AI 能力边界移动，都可能产生新的协作缺口。', en: 'Every AI collaboration becomes new evidence. Every experiment changes the system’s judgment. Every shift in AI capability can create a new collaboration gap.' })))
  always.appendChild(alwaysCopy)
  const loop = el('div', 'fluency-loop-steps')
  FLUENCY_LOOP_PREVIEW.loopSteps.forEach((step, index) => {
    const stepCard = el('div', 'fluency-loop-step')
    stepCard.append(el('span', undefined, String(index + 1).padStart(2, '0')), el('strong', undefined, copy(step)))
    loop.appendChild(stepCard)
    if (index < FLUENCY_LOOP_PREVIEW.loopSteps.length - 1) loop.appendChild(el('span', 'fluency-loop-arrow', '↓'))
  })
  always.appendChild(loop)
  preview.appendChild(always)

  const footer = el('section', 'fluency-preview-footer')
  footer.append(el('span', 'fluency-eyebrow', copy({ zh: 'MINDIOU AI 协作循环', en: 'MINDIOU FLUENCY LOOP' })), el('h2', undefined, copy({ zh: '一层持续学习的 AI 协作底座。', en: 'An always-learning harness for how you work with AI.' })), el('p', undefined, copy({ zh: 'AI 在持续进化。你的 AI 使用方式，也应该持续进化。', en: 'AI keeps evolving. The way you work with it should too.' })))
  preview.appendChild(footer)
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
  const debt = result.aiUsageDebts[0]
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
  const profileSection = section(copy({ zh: 'AI 协作画像 · 4 个可观察维度', en: 'AI Collaboration Profile · 4 observable dimensions' }), 'cognitive-loop-panel')
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
  resultHost.appendChild(el('section', 'cognitive-loop-empty-state', copy({ zh: '选择项目并导入活动后，这里会显示本周的 4 维画像、AI 使用欠条、有限信息简报和行为实验。', en: 'Select a project and import activity to see this week’s four-dimensional profile, AI usage debt, limited briefing, and behavior experiment.' })))
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
    el('span', 'fluency-preview-topbar-label', copy({ zh: 'AI 协作循环 · 功能预告', en: 'Fluency Loop · Feature Preview' }))
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
