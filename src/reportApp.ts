import './report-styles.css'

// ── Types ──

type EvidenceItem = {
  item: string
  evidence: string
  isInference: boolean
}

type DangerousGap = {
  rank: number
  gap: string
  whyDangerous: string
  evidence: string
}

type CognitiveStructure = {
  facts: EvidenceItem[]
  hypotheses: EvidenceItem[]
  questions: EvidenceItem[]
  decisions: EvidenceItem[]
  tradeoffs: EvidenceItem[]
}

type FeynmanCard = {
  id: string
  target: string
  prompt: string
  targetLevel?: string
  difficulty?: 'foundation' | 'intermediate' | 'advanced'
  userAnswer: string
  aiFollowUp: string
  answeredAt: string | null
}

type NextAction = {
  item: string
  route: 'verify' | 'note' | 'task' | 'ask'
  reason: string
}

type ClearanceReport = {
  id: string
  createdAt: string
  input: {
    artifactText: string
    artifactType: string
    charCount: number
  }
  analysis?: {
    artifactKind: string
    userCapability: {
      overall: string
      dimensions: Record<string, string>
      currentDomain: string
      evidenceSignals: string[]
      confidence: number
      recommendedCardLevel: string
    }
  }
  sections: {
    aiCompleted: EvidenceItem[]
    userContributed: EvidenceItem[]
    dangerousGaps: DangerousGap[]
    cognitiveStructure: CognitiveStructure
    feynmanCards: FeynmanCard[]
    nextActions: NextAction[]
  }
  corrections: unknown[]
  status: string
}

type AppState = {
  report: ClearanceReport | null
  loading: boolean
  error: string | null
  isFallback: boolean
  selectedCardId: string | null
  cardAnswers: Record<string, string>
  cardSubmitting: Record<string, boolean>
  detectedType: string | null
  typeEditing: boolean
  _lastInputText: string
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

// ── Auto-detect artifact type ──

function detectArtifactType(text: string): string {
  const lower = text.toLowerCase()

  // ChatGPT: contains "chatgpt", "gpt-4", "gpt-3", or typical ChatGPT UI markers
  if (/chatgpt|gpt-4|gpt-3\.5|gpt-3\b/i.test(text)) return 'chatgpt'
  if (lower.includes('user:') && lower.includes('assistant:')) return 'chatgpt'
  if (lower.includes('你是一个') && lower.includes('请')) return 'chatgpt'

  // Claude: contains "claude" or typical Claude patterns
  if (/claude|anthropic/i.test(text)) return 'claude'
  if (lower.includes('human:') && lower.includes('assistant:')) return 'claude'

  // Cursor: IDE-style interactions
  if (/cursor|cursor\s+ide|cursor\s+chat/i.test(text)) return 'cursor'
  if (lower.includes('@@codebase') || lower.includes('cmd+k') || lower.includes('ctrl+k')) return 'cursor'

  // Codex: AI coding session, commit messages, code diffs
  if (/codex|copilot|git\s+commit|diff\s+--git|patch/i.test(text)) return 'codex'
  if (lower.includes('function ') && lower.includes('import ') && lower.includes('const ')) return 'codex'
  if (/```[\s\S]*```/.test(text) && /function|class|const|import/.test(text)) return 'codex'

  // Hackathon: project pitches, demo schedules
  if (/hackathon|黑客松|demo\s+day|pitch|项目展示|路演/i.test(text)) return 'hackathon'
  if (lower.includes('评委') && lower.includes('项目')) return 'hackathon'

  // Meeting: meeting notes, action items
  if (/会议纪要|meeting\s+notes|action\s+items|参会人|主持人|议程/i.test(text)) return 'meeting'
  if (lower.includes('会议') && (lower.includes('讨论') || lower.includes('决定'))) return 'meeting'

  // Article: blog posts, essays with AI assistance
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
  report: null,
  loading: false,
  error: null,
  isFallback: false,
  selectedCardId: null,
  cardAnswers: {},
  cardSubmitting: {},
  detectedType: null,
  typeEditing: false,
  _lastInputText: ''
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

async function generateReport(artifactText: string, artifactType: string): Promise<{ report: ClearanceReport; fallback: boolean }> {
  const res = await apiFetch('/api/mvp0/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ artifactText, artifactType })
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return { report: data.report, fallback: data.fallback }
}

async function fetchReport(reportId: string): Promise<ClearanceReport> {
  const res = await apiFetch(`/api/mvp0/reports/${reportId}`)
  if (!res.ok) {
    throw new Error(`Report not found: ${reportId}`)
  }
  const data = await res.json()
  return data.report
}

async function submitCardAnswer(reportId: string, cardId: string, answer: string): Promise<{ card: FeynmanCard; shouldFollowUp: boolean }> {
  const res = await apiFetch(`/api/mvp0/reports/${reportId}/cards/${cardId}/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer })
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return { card: data.card, shouldFollowUp: data.shouldFollowUp }
}

// ── Rendering ──

function render(): void {
  const app = document.getElementById('app')!
  clear(app)

  const surface = el('div', 'report-surface')

  // Header
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

  // Input form
  surface.appendChild(renderInputForm())

  // Status bar
  if (state.loading) {
    const bar = el('div', 'status-bar loading', '正在生成清算报告…')
    surface.appendChild(bar)
  }
  if (state.error) {
    const bar = el('div', 'status-bar error', `错误：${state.error}`)
    surface.appendChild(bar)
  }
  if (state.isFallback && state.report) {
    const bar = el('div', 'status-bar fallback', 'AI 不可用，当前为结构化降级报告。所有条目标记为推断。')
    surface.appendChild(bar)
  }

  // Report
  if (state.report) {
    surface.appendChild(renderReport(state.report))
  }

  app.appendChild(surface)
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

  // Auto-detected type display (replaces selector)
  if (state.detectedType) {
    const typeBar = el('div', 'type-detect-bar')

    if (!state.typeEditing) {
      // Show "已识别为：XX，可修改"
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
      // Show selector for manual change
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
  btn.textContent = '生成清算报告'
  btn.disabled = state.loading
  btn.onclick = async () => {
    const text = (document.getElementById('artifact-text') as HTMLTextAreaElement).value.trim()
    if (!text) return
    const type = state.detectedType || 'other'
    state.loading = true
    state.error = null
    state.report = null
    state.isFallback = false
    render()
    try {
      const { report, fallback } = await generateReport(text, type)
      state.report = report
      state.isFallback = fallback
      state.selectedCardId = report.sections.feynmanCards[0]?.id || null
      sessionStorage.setItem('mindiou-report-id', report.id)
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
    } finally {
      state.loading = false
      render()
    }
  }
  row.appendChild(btn)

  form.appendChild(row)
  return form
}

function renderReport(report: ClearanceReport): HTMLElement {
  const container = el('div', 'report-container')

  if (report.analysis) {
    container.appendChild(renderCapabilityAnalysis(report.analysis))
  }
  container.appendChild(renderSection('AI 替你完成了什么', report.sections.aiCompleted))
  container.appendChild(renderSection('你真正提供了什么', report.sections.userContributed))
  container.appendChild(renderGaps(report.sections.dangerousGaps))
  container.appendChild(renderCognitiveStructure(report.sections.cognitiveStructure))
  container.appendChild(renderFeynmanCards(report.sections.feynmanCards, report.id))
  container.appendChild(renderNextActions(report.sections.nextActions))

  // Glasses preview
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
  meta.appendChild(el('span', 'capability-pill', `置信度 ${Math.round(cap.confidence * 100)}%`))
  section.appendChild(meta)

  if (cap.currentDomain && cap.currentDomain !== 'unknown') {
    section.appendChild(el('p', 'capability-domain', cap.currentDomain))
  }

  const dims = el('div', 'capability-dims')
  const labels: Record<string, string> = {
    domainProductUnderstanding: '领域理解',
    aiAgentSteering: 'AI 指挥',
    technicalDomainImplementation: '技术实现',
    validationDebugging: '验收调试'
  }
  for (const [key, label] of Object.entries(labels)) {
    const value = cap.dimensions[key]
    if (value) dims.appendChild(el('span', 'capability-dim', `${label}: ${value}`))
  }
  section.appendChild(dims)

  if (cap.evidenceSignals.length > 0) {
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

function renderGaps(gaps: DangerousGap[]): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '当前最危险的五个理解缺口'))

  for (const gap of gaps) {
    const entry = el('div', 'gap-entry')

    const rank = el('span', 'gap-rank', String(gap.rank))
    entry.appendChild(rank)

    entry.appendChild(el('span', 'item-text', gap.gap))
    entry.appendChild(el('span', 'gap-why', `为什么危险：${gap.whyDangerous}`))

    section.appendChild(entry)
  }

  return section
}

function renderCognitiveStructure(cs: CognitiveStructure): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '认知结构：事实 / 假设 / 问题 / 决定 / 取舍'))

  const groups: Array<[string, EvidenceItem[]]> = [
    ['事实 (Facts)', cs.facts],
    ['假设 (Hypotheses)', cs.hypotheses],
    ['问题 (Questions)', cs.questions],
    ['决定 (Decisions)', cs.decisions],
    ['取舍 (Tradeoffs)', cs.tradeoffs]
  ]

  for (const [label, items] of groups) {
    if (items.length === 0) continue
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
      list.appendChild(entry)
    }
    group.appendChild(list)
    section.appendChild(group)
  }

  if (section.children.length <= 1) {
    section.appendChild(el('p', undefined, '（无结构化条目）'))
  }

  return section
}

function renderFeynmanCards(cards: FeynmanCard[], reportId: string): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '费曼补偿卡'))

  for (const card of cards) {
    const cardEl = el('div', 'feynman-card')

    // Highlight selected card
    if (card.id === state.selectedCardId) {
      cardEl.style.borderColor = '#3d8b7a'
    }

    cardEl.appendChild(el('div', 'card-target', `针对缺口：${card.target}`))
    cardEl.appendChild(el('span', 'card-prompt', card.prompt))

    const clearanceBtn = document.createElement('button')
    clearanceBtn.className = 'btn-start-clearance'
    clearanceBtn.textContent = '开始 MVP-1 清偿'
    clearanceBtn.onclick = event => {
      event.stopPropagation()
      location.href = mvp1Url(reportId, card.id)
    }
    cardEl.appendChild(clearanceBtn)

    if (card.userAnswer) {
      // Answered state
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
      // Unanswered state
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
          // Update card in state
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

    // Click to select for glasses preview
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
    entry.appendChild(content)

    section.appendChild(entry)
  }

  return section
}

function renderGlassesPreview(card: FeynmanCard): HTMLElement {
  const container = el('div', 'glasses-preview')
  container.appendChild(el('div', 'glasses-preview-label', 'Glasses Preview (demo only)'))

  const display = el('div', 'glasses-display')

  // Glasses preview shows the cognitive debt reminder, not the AI follow-up.
  // Priority: card.target (debt label) + card.prompt (what to explain)
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

async function restoreReport(): Promise<void> {
  const savedId = sessionStorage.getItem('mindiou-report-id')
  if (!savedId) {
    render()
    return
  }
  state.loading = true
  render()
  try {
    const report = await fetchReport(savedId)
    state.report = report
    state.isFallback = false
    state.selectedCardId = report.sections.feynmanCards[0]?.id || null
  } catch {
    // Report no longer exists on server, clear stale id
    sessionStorage.removeItem('mindiou-report-id')
  } finally {
    state.loading = false
    render()
  }
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
      await restoreReport()
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
    await restoreReport()
    return
  }
  try {
    const response = await apiFetch('/api/access/session')
    if (!response.ok) {
      renderAccessGate()
      return
    }
    await restoreReport()
  } catch {
    renderAccessGate('暂时无法连接服务，请稍后重试。')
  }
}

void bootstrap()
