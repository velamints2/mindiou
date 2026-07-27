import './report-styles.css'

// ── Types ──

type EvidenceItem = {
  item: string
  evidence: string
  isInference: boolean
}

type OutsourcedProcess = {
  process: string
  surfaceTask: string
  whyItMatters: string
  evidence: string
  isInference: boolean
}

type DangerousGap = {
  rank: number
  title?: string
  gap: string
  underlyingCapability?: string
  surfaceSignals?: string[]
  whyDangerous: string
  transferScenarios?: string[]
  confidence?: number
  alternativeExplanations?: string[]
  diagnosticQuestion?: string
  masteryCriteria?: string[]
  // Legacy field
  evidence?: string
}

type Hypothesis = EvidenceItem & {
  confidence?: number
  alternativeExplanation?: string
}

type Decision = EvidenceItem & {
  decisionOwner?: 'user' | 'ai' | 'shared' | 'unclear'
}

type CognitiveStructure = {
  facts: EvidenceItem[]
  hypotheses: Hypothesis[]
  questions: EvidenceItem[]
  decisions: Decision[]
  tradeoffs: EvidenceItem[]
}

type FeynmanCard = {
  id: string
  target: string
  cardType?: string
  prompt: string
  targetLevel?: string
  difficulty?: 'foundation' | 'intermediate' | 'advanced'
  evaluationCriteria?: string[]
  userAnswer: string
  aiFollowUp: string
  answeredAt: string | null
}

type NextAction = {
  item: string
  route: 'verify' | 'note' | 'task' | 'ask'
  reason: string
  relatedCapability?: string
}

type ResearchSource = {
  title: string
  url: string
  snippet: string
}

type ResearchDigest = {
  status: 'ok' | 'unavailable' | 'failed' | 'skipped'
  queries: Array<{ query: string; status: string; error: string }>
  sources: ResearchSource[]
}

type ConfusionResolution = {
  stepId: string
  confusion: string
  resolution: 'gap' | 'not_capability_gap'
  gapRank: number
  reason: string
}

type CapabilityDimension = {
  level: string
  evidenceStatus: string
  evidence: string[]
  confidence: number
}

type ClearanceReport = {
  id: string
  createdAt: string
  draftId?: string
  input: {
    artifactText: string
    artifactType: string
    charCount: number
  }
  analysis?: {
    artifactKind: string
    userCapability: {
      overall: string
      dimensions: Record<string, string | CapabilityDimension>
      currentDomain: string
      strongestDemonstratedAbility?: string
      highestPriorityGrowthArea?: string
      evidenceSignals: string[]
      confidence?: number
      recommendedCardLevel: string
    }
  }
  generation?: {
    fallback: boolean
    error: string
    failedStep?: string
  }
  sections: {
    aiCompleted: EvidenceItem[]
    userContributed: EvidenceItem[]
    cognitiveProcessesOutsourced?: OutsourcedProcess[]
    dangerousGaps: DangerousGap[]
    cognitiveStructure: CognitiveStructure
    feynmanCards: FeynmanCard[]
    nextActions: NextAction[]
  }
  research?: ResearchDigest
  confusionResolutions?: ConfusionResolution[]
  corrections: unknown[]
  status: string
}

type TimelineStep = {
  id: string
  title: string
  aiDid: string
  keyActions: string[]
  keyConcepts: string[]
  userConfusion: string
}

type Draft = {
  id: string
  createdAt: string
  updatedAt: string
  reportId: string
  input: {
    artifactText: string
    artifactType: string
    charCount: number
  }
  timeline: {
    steps: TimelineStep[]
  }
  generation: {
    fallback: boolean
    error: string
  }
  status: string
}

type Stage = 'input' | 'timeline' | 'report'

type AppState = {
  stage: Stage
  draft: Draft | null
  report: ClearanceReport | null
  loading: boolean
  loadingMessage: string
  error: string | null
  isFallback: boolean
  selectedCardId: string | null
  cardAnswers: Record<string, string>
  cardSubmitting: Record<string, boolean>
  detectedType: string | null
  typeEditing: boolean
  _lastInputText: string
  confusionEdits: Record<string, string>
  savingConfusions: boolean
}

// ── Constants ──

const ARTIFACT_TYPES = [
  { value: 'chatgpt', label: 'ChatGPT 对话' },
  { value: 'claude', label: 'Claude 对话' },
  { value: 'cursor', label: 'Cursor 对话' },
  { value: 'codex', label: 'AI 编程记录' },
  { value: 'hackathon', label: '黑客松方案' },
  { value: 'meeting', label: '会议纪要' },
  { value: 'article', label: 'AI 辅助文章' },
  { value: 'other', label: '其他' }
]

const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  ARTIFACT_TYPES.map(t => [t.value, t.label])
)

const DIMENSION_LABELS: Record<string, string> = {
  productProblemFraming: '问题框定',
  aiAgentSteering: 'AI 指挥',
  systemMentalModel: '系统心智模型',
  technicalDecisionComprehension: '技术决策理解',
  validationAndQualityJudgment: '验证与质量判断',
  // Legacy MVP-0 dimension keys
  domainProductUnderstanding: '领域理解',
  technicalDomainImplementation: '技术实现',
  validationDebugging: '验收调试'
}

const CARD_TYPE_LABELS: Record<string, string> = {
  system_map: '系统图',
  analogy: '类比',
  prediction: '场景预测',
  decision_explanation: '决策解释',
  comparison: '方案比较',
  transfer: '迁移',
  validation_design: '验证设计'
}

const EVIDENCE_STATUS_LABELS: Record<string, string> = {
  proven: '已证明',
  partial: '部分证明',
  unobserved: '未观察',
  misconception: '存在误区'
}

// ── Auto-detect artifact type ──

function detectArtifactType(text: string): string {
  const lower = text.toLowerCase()

  if (/chatgpt|gpt-4|gpt-3\.5|gpt-3\b/i.test(text)) return 'chatgpt'
  if (lower.includes('user:') && lower.includes('assistant:')) return 'chatgpt'
  if (lower.includes('你是一个') && lower.includes('请')) return 'chatgpt'

  if (/claude|anthropic/i.test(text)) return 'claude'
  if (lower.includes('human:') && lower.includes('assistant:')) return 'claude'

  if (/cursor|cursor\s+ide|cursor\s+chat/i.test(text)) return 'cursor'
  if (lower.includes('@@codebase') || lower.includes('cmd+k') || lower.includes('ctrl+k')) return 'cursor'

  if (/codex|copilot|git\s+commit|diff\s+--git|patch/i.test(text)) return 'codex'
  if (lower.includes('function ') && lower.includes('import ') && lower.includes('const ')) return 'codex'
  if (/```[\s\S]*```/.test(text) && /function|class|const|import/.test(text)) return 'codex'

  if (/hackathon|黑客松|demo\s+day|pitch|项目展示|路演/i.test(text)) return 'hackathon'
  if (lower.includes('评委') && lower.includes('项目')) return 'hackathon'

  if (/会议纪要|meeting\s+notes|action\s+items|参会人|主持人|议程/i.test(text)) return 'meeting'
  if (lower.includes('会议') && (lower.includes('讨论') || lower.includes('决定'))) return 'meeting'

  if (/^#|markdown|博客|blog|文章|essay/i.test(text.trim())) return 'article'
  if (lower.includes('摘要') && lower.includes('关键词')) return 'article'

  return 'other'
}

const runtimeParams = new URLSearchParams(location.search)
const isPublicDeployment = location.pathname.startsWith('/mindiou/')
const accessGateEnabled = isPublicDeployment || runtimeParams.get('earlyAccess') === '1'
const API_BASE = isPublicDeployment ? '/mindiou-api' : runtimeParams.get('api') || ''

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'same-origin'
  })
}

function mvp1Url(reportId: string, cardId: string): string {
  const url = isPublicDeployment
    ? new URL('/mindiou/mvp1.html', location.origin)
    : new URL('/mvp1.html', location.origin)
  url.searchParams.set('reportId', reportId)
  url.searchParams.set('cardId', cardId)
  if (!isPublicDeployment && API_BASE) url.searchParams.set('api', API_BASE)
  return url.toString()
}

// ── State ──

const state: AppState = {
  stage: 'input',
  draft: null,
  report: null,
  loading: false,
  loadingMessage: '',
  error: null,
  isFallback: false,
  selectedCardId: null,
  cardAnswers: {},
  cardSubmitting: {},
  detectedType: null,
  typeEditing: false,
  _lastInputText: '',
  confusionEdits: {},
  savingConfusions: false
}

// ── DOM helpers ──

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function clear(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

// ── API ──

async function apiJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function generateTimeline(artifactText: string, artifactType: string): Promise<{ draft: Draft; fallback: boolean }> {
  const res = await fetch(`${API_BASE}/api/mvp0/timelines`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ artifactText, artifactType })
  })
  const data = await apiJson<{ draft: Draft; fallback: boolean }>(res)
  return { draft: data.draft, fallback: Boolean(data.fallback) }
}

async function generateReport(body: { draftId?: string; artifactText?: string; artifactType?: string }): Promise<{ report: ClearanceReport; fallback: boolean }> {
  const res = await fetch(`${API_BASE}/api/mvp0/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await apiJson<{ report: ClearanceReport; fallback: boolean }>(res)
  return { report: data.report, fallback: Boolean(data.fallback) }
}

async function fetchReport(reportId: string): Promise<ClearanceReport> {
  const res = await fetch(`${API_BASE}/api/mvp0/reports/${reportId}`)
  if (!res.ok) throw new Error(`Report not found: ${reportId}`)
  const data = await res.json()
  return data.report
}

async function fetchDraft(draftId: string): Promise<Draft> {
  const res = await fetch(`${API_BASE}/api/mvp0/drafts/${draftId}`)
  if (!res.ok) throw new Error(`Draft not found: ${draftId}`)
  const data = await res.json()
  return data.draft
}

async function saveDraftConfusions(draftId: string): Promise<Draft> {
  const confusions = Object.entries(state.confusionEdits).map(([stepId, text]) => ({ stepId, text }))
  const res = await fetch(`${API_BASE}/api/mvp0/drafts/${draftId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confusions })
  })
  const data = await apiJson<{ draft: Draft }>(res)
  return data.draft
}

async function submitCardAnswer(reportId: string, cardId: string, answer: string): Promise<{ card: FeynmanCard; shouldFollowUp: boolean }> {
  const res = await apiFetch(`/api/mvp0/reports/${reportId}/cards/${cardId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer })
  })
  const data = await apiJson<{ card: FeynmanCard; shouldFollowUp: boolean }>(res)
  return { card: data.card, shouldFollowUp: data.shouldFollowUp }
}

// ── Flow actions ──

function startLoading(message: string) {
  state.loading = true
  state.loadingMessage = message
  state.error = null
  render()
}

function stopLoading() {
  state.loading = false
  state.loadingMessage = ''
}

async function runTimelineStep() {
  const text = (document.getElementById('artifact-text') as HTMLTextAreaElement | null)?.value.trim()
    || state._lastInputText.trim()
  if (!text) return
  const type = state.detectedType || 'other'
  state.report = null
  state.isFallback = false
  startLoading('正在生成协作时间线…')
  try {
    const { draft, fallback } = await generateTimeline(text, type)
    state.draft = draft
    state.isFallback = fallback
    state.confusionEdits = {}
    for (const step of draft.timeline.steps) {
      state.confusionEdits[step.id] = step.userConfusion || ''
    }
    state.stage = 'timeline'
    sessionStorage.setItem('mindiou-draft-id', draft.id)
    sessionStorage.removeItem('mindiou-report-id')
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err)
  } finally {
    stopLoading()
    render()
  }
}

async function runReportStep() {
  if (!state.draft) return
  startLoading('正在生成诊断报告（归因 → 根缺口 → 有界研究 → 卡片）…')
  try {
    state.savingConfusions = true
    state.draft = await saveDraftConfusions(state.draft.id)
    state.savingConfusions = false
    const { report, fallback } = await generateReport({ draftId: state.draft.id })
    state.report = report
    state.isFallback = fallback
    state.selectedCardId = report.sections.feynmanCards[0]?.id || null
    state.stage = 'report'
    sessionStorage.setItem('mindiou-report-id', report.id)
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err)
  } finally {
    state.savingConfusions = false
    stopLoading()
    render()
  }
}

async function runDirectReport() {
  const text = (document.getElementById('artifact-text') as HTMLTextAreaElement | null)?.value.trim()
    || state._lastInputText.trim()
  if (!text) return
  const type = state.detectedType || 'other'
  state.draft = null
  state.report = null
  state.isFallback = false
  startLoading('正在生成清算报告…')
  try {
    const { report, fallback } = await generateReport({ artifactText: text, artifactType: type })
    state.report = report
    state.isFallback = fallback
    state.selectedCardId = report.sections.feynmanCards[0]?.id || null
    state.stage = 'report'
    sessionStorage.setItem('mindiou-report-id', report.id)
    sessionStorage.removeItem('mindiou-draft-id')
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err)
  } finally {
    stopLoading()
    render()
  }
}

function resetToInput() {
  state.stage = 'input'
  state.draft = null
  state.report = null
  state.error = null
  state.isFallback = false
  state.confusionEdits = {}
  sessionStorage.removeItem('mindiou-draft-id')
  sessionStorage.removeItem('mindiou-report-id')
  render()
}

// ── Rendering ──

function render(): void {
  const app = document.getElementById('app')!
  clear(app)

  const surface = el('div', 'report-surface')

  const header = el('div', 'report-header')
  const headerCopy = el('div')
  headerCopy.appendChild(el('h1', undefined, 'MindIOU — 认知欠条清算'))
  headerCopy.appendChild(el('p', undefined, '把 AI 代劳转化为真实能力成长'))
  header.appendChild(headerCopy)
  if (accessGateEnabled) {
    const logout = el('button', 'btn-logout', '退出')
    logout.type = 'button'
    logout.onclick = async () => {
      await apiFetch('/api/access/logout', { method: 'POST' }).catch(() => undefined)
      sessionStorage.removeItem('mindiou-report-id')
      renderAccessGate()
    }
    header.appendChild(logout)
  }
  surface.appendChild(header)

  surface.appendChild(renderStageIndicator())

  if (state.loading) {
    surface.appendChild(el('div', 'status-bar loading', state.loadingMessage || '处理中…'))
  }
  if (state.error) {
    surface.appendChild(el('div', 'status-bar error', `错误：${state.error}`))
  }
  if (state.isFallback && (state.report || state.draft)) {
    surface.appendChild(el('div', 'status-bar fallback', 'AI 不可用，当前为结构化降级结果。所有条目标记为推断。'))
  }

  if (state.stage === 'input') {
    surface.appendChild(renderInputForm())
  } else if (state.stage === 'timeline' && state.draft) {
    surface.appendChild(renderTimelineStage(state.draft))
  } else if (state.stage === 'report' && state.report) {
    surface.appendChild(renderReport(state.report))
  }

  app.appendChild(surface)
}

function renderStageIndicator(): HTMLElement {
  const bar = el('div', 'stage-indicator')
  const stages: Array<[Stage, string]> = [
    ['input', '1 粘贴材料'],
    ['timeline', '2 时间线与困惑'],
    ['report', '3 诊断报告']
  ]
  for (const [stage, label] of stages) {
    const cls = stage === state.stage ? 'stage-step active' : 'stage-step'
    bar.appendChild(el('span', cls, label))
  }
  return bar
}

function renderInputForm(): HTMLElement {
  const form = el('div', 'input-form')

  if (isPublicDeployment) {
    form.appendChild(el(
      'p',
      'public-privacy-notice',
      '公开体验环境：请勿粘贴密码、密钥、客户隐私或其他敏感内容。报告仅凭当前浏览器保存的随机 ID 恢复。'
    ))
  }

  const textarea = document.createElement('textarea')
  textarea.placeholder = '粘贴 AI 辅助工作的材料：ChatGPT/Claude 对话、AI 生成的方案、黑客松记录、会议纪要…'
  textarea.id = 'artifact-text'
  textarea.value = state._lastInputText || ''
  textarea.oninput = () => {
    const text = textarea.value.trim()
    state._lastInputText = textarea.value
    if (text.length > 20) {
      const detected = detectArtifactType(text)
      if (detected !== state.detectedType) {
        state.detectedType = detected
        state.typeEditing = false
        render()
      }
    } else if (state.detectedType) {
      state.detectedType = null
      state.typeEditing = false
      render()
    }
  }
  form.appendChild(textarea)

  if (state.detectedType) {
    const typeBar = el('div', 'type-detect-bar')

    if (!state.typeEditing) {
      const label = el('span', 'type-detected-label', `已识别为：${TYPE_LABELS[state.detectedType] || state.detectedType}`)
      typeBar.appendChild(label)

      const editBtn = document.createElement('button')
      editBtn.className = 'btn-edit-type'
      editBtn.textContent = '可修改'
      editBtn.onclick = () => {
        state.typeEditing = true
        render()
      }
      typeBar.appendChild(editBtn)
    } else {
      const select = document.createElement('select')
      select.className = 'type-select'
      for (const t of ARTIFACT_TYPES) {
        const opt = el('option', undefined, t.label) as HTMLOptionElement
        opt.value = t.value
        if (t.value === state.detectedType) opt.selected = true
        select.appendChild(opt)
      }
      select.onchange = () => {
        state.detectedType = select.value
        state.typeEditing = false
        render()
      }
      typeBar.appendChild(select)

      const confirmBtn = document.createElement('button')
      confirmBtn.className = 'btn-edit-type'
      confirmBtn.textContent = '确认'
      confirmBtn.onclick = () => {
        state.typeEditing = false
        render()
      }
      typeBar.appendChild(confirmBtn)
    }

    form.appendChild(typeBar)
  }

  const row = el('div', 'form-row')

  const btn = document.createElement('button')
  btn.className = 'btn-generate'
  btn.textContent = '生成协作时间线 →'
  btn.disabled = state.loading
  btn.onclick = () => { void runTimelineStep() }
  row.appendChild(btn)

  const directBtn = document.createElement('button')
  directBtn.className = 'btn-secondary'
  directBtn.textContent = '跳过时间线，直接生成报告'
  directBtn.disabled = state.loading
  directBtn.onclick = () => { void runDirectReport() }
  row.appendChild(directBtn)

  form.appendChild(row)
  return form
}

function renderTimelineStage(draft: Draft): HTMLElement {
  const container = el('div', 'timeline-stage')

  const intro = el('div', 'timeline-intro')
  intro.appendChild(el('h2', undefined, '协作时间线'))
  intro.appendChild(el('p', undefined,
    '回顾 AI 协作的关键步骤。在任何一步写下你当时的困惑——你亲手标注的困惑会在诊断报告中优先处理。'))
  container.appendChild(intro)

  const steps = draft.timeline.steps
  if (steps.length === 0) {
    container.appendChild(el('p', 'timeline-empty', '未能从材料中拆出协作步骤。可以返回重新粘贴，或直接生成报告。'))
  }

  steps.forEach((step, idx) => {
    const stepEl = el('div', 'timeline-step')

    const stepHeader = el('div', 'timeline-step-header')
    stepHeader.appendChild(el('span', 'timeline-step-index', String(idx + 1)))
    stepHeader.appendChild(el('span', 'timeline-step-title', step.title))
    stepEl.appendChild(stepHeader)

    if (step.aiDid) {
      stepEl.appendChild(el('p', 'timeline-step-aidid', `AI 做了：${step.aiDid}`))
    }

    if (step.keyActions.length > 0) {
      const actions = el('div', 'timeline-tags')
      for (const action of step.keyActions) {
        actions.appendChild(el('span', 'timeline-tag action', action))
      }
      stepEl.appendChild(actions)
    }

    if (step.keyConcepts.length > 0) {
      const concepts = el('div', 'timeline-tags')
      for (const concept of step.keyConcepts) {
        concepts.appendChild(el('span', 'timeline-tag concept', concept))
      }
      stepEl.appendChild(concepts)
    }

    const confusionLabel = el('label', 'confusion-label', '我在这步的困惑（可选）：')
    const confusionInput = document.createElement('textarea')
    confusionInput.className = 'confusion-input'
    confusionInput.placeholder = '例如：我不明白为什么这里要用这个方案…'
    confusionInput.value = state.confusionEdits[step.id] ?? step.userConfusion ?? ''
    confusionInput.oninput = () => {
      state.confusionEdits[step.id] = confusionInput.value
    }
    stepEl.appendChild(confusionLabel)
    stepEl.appendChild(confusionInput)

    container.appendChild(stepEl)
  })

  const row = el('div', 'form-row timeline-actions')

  const reportBtn = document.createElement('button')
  reportBtn.className = 'btn-generate'
  reportBtn.textContent = '保存困惑并生成诊断报告 →'
  reportBtn.disabled = state.loading || state.savingConfusions
  reportBtn.onclick = () => { void runReportStep() }
  row.appendChild(reportBtn)

  const backBtn = document.createElement('button')
  backBtn.className = 'btn-secondary'
  backBtn.textContent = '← 重新粘贴材料'
  backBtn.disabled = state.loading
  backBtn.onclick = () => { resetToInput() }
  row.appendChild(backBtn)

  container.appendChild(row)
  return container
}

function renderReport(report: ClearanceReport): HTMLElement {
  const container = el('div', 'report-container')

  const nav = el('div', 'report-nav')
  if (state.draft) {
    const backBtn = document.createElement('button')
    backBtn.className = 'btn-secondary'
    backBtn.textContent = '← 返回时间线'
    backBtn.onclick = () => {
      state.stage = 'timeline'
      render()
    }
    nav.appendChild(backBtn)
  }
  const newBtn = document.createElement('button')
  newBtn.className = 'btn-secondary'
  newBtn.textContent = '新材料'
  newBtn.onclick = () => { resetToInput() }
  nav.appendChild(newBtn)
  container.appendChild(nav)

  if (report.generation?.fallback && report.generation.failedStep) {
    container.appendChild(el('div', 'status-bar fallback',
      `报告在「${report.generation.failedStep}」步骤降级：${report.generation.error || 'AI 不可用'}`))
  }

  if (report.analysis) {
    container.appendChild(renderCapabilityAnalysis(report.analysis))
  }
  container.appendChild(renderSection('AI 替你完成了什么', report.sections.aiCompleted))
  container.appendChild(renderSection('你真正提供了什么', report.sections.userContributed))
  container.appendChild(renderOutsourced(report.sections.cognitiveProcessesOutsourced || []))
  container.appendChild(renderGaps(report.sections.dangerousGaps))
  container.appendChild(renderConfusionResolutions(report.confusionResolutions || []))
  container.appendChild(renderCognitiveStructure(report.sections.cognitiveStructure))
  container.appendChild(renderResearch(report.research))
  container.appendChild(renderFeynmanCards(report.sections.feynmanCards, report.id))
  container.appendChild(renderNextActions(report.sections.nextActions))

  if (state.selectedCardId) {
    const card = report.sections.feynmanCards.find(c => c.id === state.selectedCardId)
    if (card) {
      container.appendChild(renderGlassesPreview(card))
    }
  }

  return container
}

function renderCapabilityAnalysis(analysis: NonNullable<ClearanceReport['analysis']>): HTMLElement {
  const section = el('div', 'report-section capability-section')
  section.appendChild(el('h2', undefined, '能力校准'))

  const cap = analysis.userCapability
  const meta = el('div', 'capability-meta')
  meta.appendChild(el('span', 'capability-pill', `任务类型 ${analysis.artifactKind}`))
  meta.appendChild(el('span', 'capability-pill', `整体 ${cap.overall}`))
  meta.appendChild(el('span', 'capability-pill', `卡片难度 ${cap.recommendedCardLevel}`))
  if (typeof cap.confidence === 'number') {
    meta.appendChild(el('span', 'capability-pill', `置信度 ${Math.round(cap.confidence * 100)}%`))
  }
  section.appendChild(meta)

  if (cap.currentDomain && cap.currentDomain !== 'unknown') {
    section.appendChild(el('p', 'capability-domain', cap.currentDomain))
  }

  const dims = el('div', 'capability-dims')
  for (const [key, rawValue] of Object.entries(cap.dimensions || {})) {
    const label = DIMENSION_LABELS[key] || key
    if (typeof rawValue === 'string') {
      // Legacy plain-string dimension
      dims.appendChild(el('span', 'capability-dim', `${label}: ${rawValue}`))
    } else if (rawValue && typeof rawValue === 'object') {
      const status = EVIDENCE_STATUS_LABELS[rawValue.evidenceStatus] || rawValue.evidenceStatus
      dims.appendChild(el('span', 'capability-dim', `${label}: ${rawValue.level}（${status}）`))
    }
  }
  section.appendChild(dims)

  if (cap.strongestDemonstratedAbility) {
    section.appendChild(el('p', 'capability-signal-line', `已证明的最强能力：${cap.strongestDemonstratedAbility}`))
  }
  if (cap.highestPriorityGrowthArea) {
    section.appendChild(el('p', 'capability-signal-line', `最高优先级成长点：${cap.highestPriorityGrowthArea}`))
  }

  if (Array.isArray(cap.evidenceSignals) && cap.evidenceSignals.length > 0) {
    const list = el('ul', 'capability-signals')
    for (const signal of cap.evidenceSignals.slice(0, 4)) {
      list.appendChild(el('li', undefined, signal))
    }
    section.appendChild(list)
  }

  return section
}

function renderSection(title: string, items: EvidenceItem[]): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, title))

  if (items.length === 0) {
    section.appendChild(el('p', undefined, '（无条目）'))
    return section
  }

  const list = el('ul', 'item-list')
  for (const item of items) {
    const entry = el('li', 'item-entry')

    const label = el('span', `evidence-label ${item.isInference ? 'inference' : 'source'}`)
    label.textContent = item.isInference ? '推断' : '原文'
    entry.appendChild(label)

    entry.appendChild(el('span', 'item-text', item.item))

    if (item.evidence) {
      entry.appendChild(el('span', 'evidence-text', `证据：${item.evidence}`))
    }

    list.appendChild(entry)
  }
  section.appendChild(list)
  return section
}

function renderOutsourced(items: OutsourcedProcess[]): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '你外包给 AI 的思考过程'))

  if (items.length === 0) {
    section.appendChild(el('p', undefined, '（无条目）'))
    return section
  }

  const list = el('ul', 'item-list')
  for (const item of items) {
    const entry = el('li', 'item-entry')

    const label = el('span', `evidence-label ${item.isInference ? 'inference' : 'source'}`)
    label.textContent = item.isInference ? '推断' : '原文'
    entry.appendChild(label)

    entry.appendChild(el('span', 'item-text', item.process))
    if (item.surfaceTask) {
      entry.appendChild(el('span', 'evidence-text', `表面任务：${item.surfaceTask}`))
    }
    if (item.whyItMatters) {
      entry.appendChild(el('span', 'evidence-text', `为什么重要：${item.whyItMatters}`))
    }
    if (item.evidence) {
      entry.appendChild(el('span', 'evidence-text', `证据：${item.evidence}`))
    }

    list.appendChild(entry)
  }
  section.appendChild(list)
  return section
}

function renderGaps(gaps: DangerousGap[]): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '根能力缺口（2-4 个，按危险程度排序）'))

  for (const gap of gaps) {
    const entry = el('div', 'gap-entry')

    const head = el('div', 'gap-head')
    head.appendChild(el('span', 'gap-rank', String(gap.rank)))
    head.appendChild(el('span', 'item-text', gap.title || gap.gap))
    if (typeof gap.confidence === 'number' && gap.confidence > 0) {
      head.appendChild(el('span', 'gap-confidence', `置信度 ${Math.round(gap.confidence * 100)}%`))
    }
    entry.appendChild(head)

    if (gap.title && gap.gap && gap.gap !== gap.title) {
      entry.appendChild(el('span', 'gap-detail', gap.gap))
    }
    if (gap.underlyingCapability) {
      entry.appendChild(el('span', 'gap-detail', `底层能力：${gap.underlyingCapability}`))
    }
    entry.appendChild(el('span', 'gap-why', `为什么危险：${gap.whyDangerous}`))

    const signals = gap.surfaceSignals && gap.surfaceSignals.length > 0
      ? gap.surfaceSignals
      : (gap.evidence ? [gap.evidence] : [])
    if (signals.length > 0) {
      const list = el('ul', 'gap-signals')
      for (const signal of signals) {
        list.appendChild(el('li', undefined, `表面信号：${signal}`))
      }
      entry.appendChild(list)
    }

    if (gap.transferScenarios && gap.transferScenarios.length > 0) {
      entry.appendChild(el('span', 'gap-detail', `迁移场景：${gap.transferScenarios.join('；')}`))
    }
    if (gap.diagnosticQuestion) {
      entry.appendChild(el('span', 'gap-detail', `诊断问题：${gap.diagnosticQuestion}`))
    }
    if (gap.masteryCriteria && gap.masteryCriteria.length > 0) {
      const list = el('ul', 'gap-signals')
      for (const criterion of gap.masteryCriteria) {
        list.appendChild(el('li', undefined, `掌握标准：${criterion}`))
      }
      entry.appendChild(list)
    }
    if (gap.alternativeExplanations && gap.alternativeExplanations.length > 0) {
      entry.appendChild(el('span', 'gap-detail gap-alt', `其他可能解释：${gap.alternativeExplanations.join('；')}`))
    }

    section.appendChild(entry)
  }

  return section
}

function renderConfusionResolutions(resolutions: ConfusionResolution[]): HTMLElement {
  const section = el('div', 'report-section')
  if (resolutions.length === 0) return section
  section.appendChild(el('h2', undefined, '你标注的困惑 → 报告如何处理'))

  const list = el('ul', 'item-list')
  for (const item of resolutions) {
    const entry = el('li', 'item-entry')
    const badge = el('span', `evidence-label ${item.resolution === 'gap' ? 'source' : 'inference'}`)
    badge.textContent = item.resolution === 'gap' ? `对应缺口 #${item.gapRank || '?'}` : '非能力缺口'
    entry.appendChild(badge)
    entry.appendChild(el('span', 'item-text', item.confusion))
    if (item.reason) {
      entry.appendChild(el('span', 'evidence-text', item.reason))
    }
    list.appendChild(entry)
  }
  section.appendChild(list)
  return section
}

function renderCognitiveStructure(cs: CognitiveStructure): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '认知结构：事实 / 假设 / 问题 / 决定 / 取舍'))

  function renderGroup(label: string, items: EvidenceItem[]) {
    if (items.length === 0) return
    const group = el('div', 'cog-group')
    group.appendChild(el('h3', undefined, label))

    const list = el('ul', 'item-list')
    for (const item of items) {
      const entry = el('li', 'item-entry')
      const badge = el('span', `evidence-label ${item.isInference ? 'inference' : 'source'}`)
      badge.textContent = item.isInference ? '推断' : '原文'
      entry.appendChild(badge)
      entry.appendChild(el('span', 'item-text', item.item))
      if (item.evidence) {
        entry.appendChild(el('span', 'evidence-text', `证据：${item.evidence}`))
      }
      const hypothesis = item as Hypothesis
      if (typeof hypothesis.confidence === 'number' && hypothesis.confidence > 0) {
        entry.appendChild(el('span', 'evidence-text', `置信度：${Math.round(hypothesis.confidence * 100)}%`))
      }
      if (hypothesis.alternativeExplanation) {
        entry.appendChild(el('span', 'evidence-text', `其他可能：${hypothesis.alternativeExplanation}`))
      }
      const decision = item as Decision
      if (decision.decisionOwner) {
        const ownerLabels: Record<string, string> = { user: '用户', ai: 'AI', shared: '共同', unclear: '不明' }
        entry.appendChild(el('span', 'evidence-text', `决策者：${ownerLabels[decision.decisionOwner] || decision.decisionOwner}`))
      }
      list.appendChild(entry)
    }
    group.appendChild(list)
    section.appendChild(group)
  }

  renderGroup('事实 (Facts)', cs.facts)
  renderGroup('假设 (Hypotheses)', cs.hypotheses)
  renderGroup('问题 (Questions)', cs.questions)
  renderGroup('决定 (Decisions)', cs.decisions)
  renderGroup('取舍 (Tradeoffs)', cs.tradeoffs)

  if (section.children.length <= 1) {
    section.appendChild(el('p', undefined, '（无结构化条目）'))
  }

  return section
}

function renderResearch(research: ResearchDigest | undefined): HTMLElement {
  const section = el('div', 'report-section research-section')
  section.appendChild(el('h2', undefined, '有界外部研究'))

  if (!research || research.status === 'skipped') {
    section.appendChild(el('p', 'research-status', '研究未运行（未配置外部研究）。报告不依赖外部来源。'))
    return section
  }
  if (research.status !== 'ok') {
    section.appendChild(el('p', 'research-status', '外部研究不可用，报告仅基于原材料。未编造任何来源。'))
    return section
  }

  section.appendChild(el('p', 'research-status', `研究完成 ${research.queries.filter(q => q.status === 'ok').length} 条查询，以下来源供验证：`))
  const list = el('ul', 'item-list')
  for (const source of research.sources) {
    const entry = el('li', 'item-entry')
    const link = document.createElement('a')
    link.href = source.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = source.title || source.url
    entry.appendChild(link)
    if (source.snippet) {
      entry.appendChild(el('span', 'evidence-text', source.snippet))
    }
    list.appendChild(entry)
  }
  section.appendChild(list)
  return section
}

function renderFeynmanCards(cards: FeynmanCard[], reportId: string): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '费曼补偿卡'))

  for (const card of cards) {
    const cardEl = el('div', 'feynman-card')

    if (card.id === state.selectedCardId) {
      cardEl.style.borderColor = '#3d8b7a'
    }

    const targetLine = el('div', 'card-target', `针对缺口：${card.target}`)
    if (card.cardType) {
      targetLine.appendChild(el('span', 'card-type-pill', CARD_TYPE_LABELS[card.cardType] || card.cardType))
    }
    cardEl.appendChild(targetLine)
    cardEl.appendChild(el('span', 'card-prompt', card.prompt))

    if (card.evaluationCriteria && card.evaluationCriteria.length > 0) {
      const criteria = el('details', 'card-criteria')
      criteria.appendChild(el('summary', undefined, '评分标准（答题后供对照）'))
      const list = el('ul', 'gap-signals')
      for (const criterion of card.evaluationCriteria) {
        list.appendChild(el('li', undefined, criterion))
      }
      criteria.appendChild(list)
      cardEl.appendChild(criteria)
    }

    const clearanceBtn = document.createElement('button')
    clearanceBtn.className = 'btn-start-clearance'
    clearanceBtn.textContent = '开始 MVP-1 清偿'
    clearanceBtn.onclick = event => {
      event.stopPropagation()
      location.href = mvp1Url(reportId, card.id)
    }
    cardEl.appendChild(clearanceBtn)

    if (card.userAnswer) {
      const answered = el('div', 'card-answered')
      answered.appendChild(el('span', undefined, '你的回答：'))
      answered.appendChild(el('span', 'card-user-answer', card.userAnswer))
      if (card.aiFollowUp) {
        answered.appendChild(el('span', undefined, 'AI 追问 / 总结：'))
        answered.appendChild(el('span', 'card-followup', card.aiFollowUp))
      }
      if (card.answeredAt) {
        answered.appendChild(el('span', 'card-answered-at', `回答时间：${new Date(card.answeredAt).toLocaleString()}`))
      }
      cardEl.appendChild(answered)
    } else {
      const input = document.createElement('textarea')
      input.className = 'card-answer-input'
      input.placeholder = '用自己的话解释…'
      input.value = state.cardAnswers[card.id] || ''
      input.oninput = () => {
        state.cardAnswers[card.id] = input.value
      }
      cardEl.appendChild(input)

      const btn = document.createElement('button')
      btn.className = 'btn-submit-answer'
      btn.textContent = '提交回答'
      btn.disabled = state.cardSubmitting[card.id] || false
      btn.onclick = async () => {
        const answer = input.value.trim()
        if (!answer) return
        state.cardSubmitting[card.id] = true
        state.selectedCardId = card.id
        render()
        try {
          const result = await submitCardAnswer(reportId, card.id, answer)
          if (state.report) {
            const idx = state.report.sections.feynmanCards.findIndex(c => c.id === card.id)
            if (idx >= 0) {
              state.report.sections.feynmanCards[idx] = result.card
            }
            sessionStorage.setItem('mindiou-report-id', state.report.id)
          }
          delete state.cardAnswers[card.id]
        } catch (err) {
          state.error = err instanceof Error ? err.message : String(err)
        } finally {
          state.cardSubmitting[card.id] = false
          render()
        }
      }
      cardEl.appendChild(btn)
    }

    cardEl.style.cursor = 'pointer'
    cardEl.onclick = (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      state.selectedCardId = card.id
      render()
    }

    section.appendChild(cardEl)
  }

  return section
}

function renderNextActions(actions: NextAction[]): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '下一步行动分流'))

  for (const action of actions) {
    const entry = el('div', 'action-entry')

    const routeLabel = el('span', `action-route ${action.route}`, action.route)
    entry.appendChild(routeLabel)

    const content = el('div', 'action-content')
    content.appendChild(el('span', 'action-item', action.item))
    content.appendChild(el('span', 'action-reason', action.reason))
    if (action.relatedCapability) {
      content.appendChild(el('span', 'action-reason', `对应能力：${action.relatedCapability}`))
    }
    entry.appendChild(content)

    section.appendChild(entry)
  }

  return section
}

function renderGlassesPreview(card: FeynmanCard): HTMLElement {
  const container = el('div', 'glasses-preview')
  container.appendChild(el('div', 'glasses-preview-label', 'Glasses Preview (demo only)'))

  const display = el('div', 'glasses-display')

  const debtLabel = el('div', 'glasses-text', `今日认知欠条：\n${card.target}`)
  display.appendChild(debtLabel)

  const promptLine = el('div', 'glasses-text', card.prompt)
  promptLine.style.fontSize = '0.8rem'
  promptLine.style.marginTop = '8px'
  promptLine.style.color = '#8ab0a4'
  display.appendChild(promptLine)

  container.appendChild(display)
  return container
}

// ── Init ──

async function restoreSession(): Promise<void> {
  const savedReportId = sessionStorage.getItem('mindiou-report-id')
  const savedDraftId = sessionStorage.getItem('mindiou-draft-id')

  if (savedReportId) {
    state.loading = true
    state.loadingMessage = '正在恢复诊断报告…'
    render()
    try {
      const report = await fetchReport(savedReportId)
      state.report = report
      state.selectedCardId = report.sections.feynmanCards[0]?.id || null
      state.stage = 'report'
      if (savedDraftId) {
        try {
          state.draft = await fetchDraft(savedDraftId)
          state.confusionEdits = {}
          for (const step of state.draft.timeline.steps) {
            state.confusionEdits[step.id] = step.userConfusion || ''
          }
        } catch {
          sessionStorage.removeItem('mindiou-draft-id')
        }
      }
    } catch {
      sessionStorage.removeItem('mindiou-report-id')
    } finally {
      stopLoading()
      render()
    }
    return
  }

  if (savedDraftId) {
    state.loading = true
    state.loadingMessage = '正在恢复协作时间线…'
    render()
    try {
      const draft = await fetchDraft(savedDraftId)
      state.draft = draft
      state.confusionEdits = {}
      for (const step of draft.timeline.steps) {
        state.confusionEdits[step.id] = step.userConfusion || ''
      }
      state.stage = 'timeline'
    } catch {
      sessionStorage.removeItem('mindiou-draft-id')
    } finally {
      stopLoading()
      render()
    }
    return
  }

  render()
}

function renderAccessGate(message = ''): void {
  const app = document.getElementById('app')!
  clear(app)

  const surface = el('div', 'access-surface')
  const panel = el('section', 'access-panel')
  panel.appendChild(el('div', 'access-brand', 'MINDIOU'))
  panel.appendChild(el('h1', undefined, '进入认知欠条'))
  panel.appendChild(el('p', 'access-intro', '当前为早期体验版。请输入邀请人提供的邀请码。'))

  const form = document.createElement('form')
  form.className = 'access-form'
  const input = document.createElement('input')
  input.type = 'password'
  input.name = 'access-code'
  input.autocomplete = 'one-time-code'
  input.placeholder = '体验邀请码'
  input.required = true
  input.setAttribute('aria-label', '体验邀请码')

  const button = el('button', 'btn-access', '进入产品')
  button.type = 'submit'
  const status = el('p', `access-status${message ? ' error' : ''}`, message)

  form.append(input, button)
  form.onsubmit = async event => {
    event.preventDefault()
    const code = input.value.trim()
    if (!code) return
    button.disabled = true
    button.textContent = '正在验证…'
    status.className = 'access-status'
    status.textContent = ''
    try {
      const response = await apiFetch('/api/access/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code })
      })
      const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
      if (!response.ok || payload.ok === false) throw new Error(payload.error || '邀请码验证失败')
      await restoreSession()
    } catch (error) {
      status.className = 'access-status error'
      status.textContent = error instanceof Error ? error.message : '邀请码验证失败'
      button.disabled = false
      button.textContent = '进入产品'
      input.select()
    }
  }

  panel.append(form, status)
  panel.appendChild(el('p', 'access-privacy', '请勿提交密码、API Key 或未授权的客户资料。'))
  surface.appendChild(panel)
  app.appendChild(surface)
  input.focus()
}

async function bootstrap(): Promise<void> {
  if (!accessGateEnabled) {
    await restoreSession()
    return
  }
  try {
    const response = await apiFetch('/api/access/session')
    if (!response.ok) {
      renderAccessGate()
      return
    }
    await restoreSession()
  } catch {
    renderAccessGate('暂时无法连接服务，请稍后重试。')
  }
}

void bootstrap()
