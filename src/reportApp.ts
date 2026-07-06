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
}

// ── Constants ──

const ARTIFACT_TYPES = [
  { value: 'chatgpt', label: 'ChatGPT 对话' },
  { value: 'claude', label: 'Claude 对话' },
  { value: 'cursor', label: 'Cursor 对话' },
  { value: 'codex', label: 'Codex 记录' },
  { value: 'hackathon', label: '黑客松项目' },
  { value: 'meeting', label: '会议纪要' },
  { value: 'article', label: 'AI 辅助文章' },
  { value: 'other', label: '其他' }
]

const API_BASE = ''

// ── State ──

const state: AppState = {
  report: null,
  loading: false,
  error: null,
  isFallback: false,
  selectedCardId: null,
  cardAnswers: {},
  cardSubmitting: {}
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
  const res = await fetch(`${API_BASE}/api/mvp0/report`, {
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

async function submitCardAnswer(reportId: string, cardId: string, answer: string): Promise<{ card: FeynmanCard; shouldFollowUp: boolean }> {
  const res = await fetch(`${API_BASE}/api/mvp0/reports/${reportId}/cards/${cardId}/answer`, {
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
  header.appendChild(el('h1', undefined, 'MindIOU — 认知欠条清算'))
  header.appendChild(el('p', undefined, '把 AI 代劳转化为真实能力成长'))
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

  const textarea = document.createElement('textarea')
  textarea.placeholder = '粘贴 AI 辅助工作的材料：ChatGPT/Claude 对话、AI 生成的方案、黑客松记录、会议纪要…'
  textarea.id = 'artifact-text'
  form.appendChild(textarea)

  const row = el('div', 'form-row')

  const select = document.createElement('select')
  select.id = 'artifact-type'
  for (const t of ARTIFACT_TYPES) {
    const opt = el('option', undefined, t.label) as HTMLOptionElement
    opt.value = t.value
    select.appendChild(opt)
  }
  row.appendChild(select)

  const btn = document.createElement('button')
  btn.className = 'btn-generate'
  btn.textContent = '生成清算报告'
  btn.disabled = state.loading
  btn.onclick = async () => {
    const text = (document.getElementById('artifact-text') as HTMLTextAreaElement).value.trim()
    const type = (document.getElementById('artifact-type') as HTMLSelectElement).value
    if (!text) return
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

  if (card.userAnswer) {
    // Show follow-up or summary on glasses
    const text = card.aiFollowUp || card.prompt
    display.appendChild(el('div', 'glasses-text', text))
  } else {
    display.appendChild(el('div', 'glasses-text', card.prompt))
  }

  container.appendChild(display)
  return container
}

// ── Init ──

render()
