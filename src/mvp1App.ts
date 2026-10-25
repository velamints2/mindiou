// ============================================================================
// ⚠️ DEPRECATED — 旧 MVP1 清偿前端（mvp1.html 入口）
// ----------------------------------------------------------------------------
// 该文件属于已废弃的旧多页前端，不再维护。当前产品前端是
// web/src/ 下的 SPA（入口 https://demo.mindiou.top/mindiou/index.html#/app）。
// 清偿会话渲染请前往 web/src/pages.ts。
// 新功能不要加到这里。
// ============================================================================
import './report-styles.css'
import './mvp1-styles.css'

// ── Types ──

type DangerousGap = {
  rank: number
  gap: string
  whyDangerous: string
  evidence: string
}

type NextAction = {
  item: string
  route: string
  reason: string
}

type ReportSummary = {
  id: string
  createdAt: string
  sections?: {
    dangerousGaps?: DangerousGap[]
    nextActions?: NextAction[]
  }
}

type SourceRecord = {
  id: string
  url: string
  title: string
  claim: string
  type: string
  credibility: string
}

type ScaffoldPoint = {
  id: string
  point: string
  whyItMatters: string
  sourceIds: string[]
}

type AttemptAnalysis = {
  status: string
  coverage: number
  demonstrated: string[]
  missing: string[]
  misconceptions: string[]
  evidence: string[]
  materialSourceIds: string[]
  feedback: string
  teaching: string
  nextQuestion: string
  recommendation: string
}

type ClearanceAttempt = {
  id: string
  createdAt: string
  answer: string
  analysis: AttemptAnalysis
}

type FinalResult = {
  status: string
  sourceReviewRequired: boolean
  evidence: string[]
  demonstrated: string[]
  remainingGaps: string[]
  materialSourceIds: string[]
  nextRecommendation: string
}

type ClearanceSession = {
  id: string
  reportId: string
  cardId: string
  state: string
  originalCard: {
    id: string
    target: string
    prompt: string
    targetLevel?: string
    difficulty?: string
  }
  clearanceQuestion: string
  researchSummary: string
  researchMode: string
  sources: SourceRecord[]
  scaffold?: ScaffoldPoint[]
  attempts: ClearanceAttempt[]
  finalResult: FinalResult | null
}

export type StoredSession = {
  sessionId: string
  reportId: string
  cardId: string
}

// ── Runtime config (guarded so tests can import pure helpers in node) ──

const isPublicDeployment = typeof location !== 'undefined' && location.pathname.startsWith('/mindiou/')
const runtimeParams = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const accessGateEnabled = isPublicDeployment || runtimeParams.get('earlyAccess') === '1'
const API_BASE = isPublicDeployment ? '/mindiou-api' : runtimeParams.get('api') || ''

const STORAGE_KEY = 'mindiou-mvp1-session'

// ── Pure helpers (exported for unit tests) ──

export function matchDangerousGap(gaps: DangerousGap[] | undefined, cardTarget: string): DangerousGap | null {
  if (!Array.isArray(gaps) || gaps.length === 0) return null
  const target = cardTarget.trim().toLowerCase()
  if (target) {
    const hit = gaps.find(gap => gap.gap.toLowerCase().includes(target))
    if (hit) return hit
  }
  return null
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'provisionally_cleared': return '暂时清偿'
    case 'needs_practice': return '需要练习'
    case 'needs_verification': return '需要核实来源'
    case 'invalid_attempt': return '无效尝试'
    case 'no_valid_attempt': return '无有效回答'
    default: return status || '未知状态'
  }
}

export function statusTone(status: string): string {
  switch (status) {
    case 'provisionally_cleared': return 'cleared'
    case 'needs_practice': return 'practice'
    case 'needs_verification': return 'verification'
    default: return 'invalid'
  }
}

export function sessionStateLabel(state: string): string {
  switch (state) {
    case 'awaiting_answer': return '等待首次回答'
    case 'teaching': return '教学中，可继续回答'
    case 'ready_to_end': return 'AI 建议可以结束清偿'
    case 'ended': return '已结束'
    default: return state || '未知状态'
  }
}

export function sourceTypeLabel(type: string): string {
  return type === 'official_doc' ? '官方文档' : '普通网页'
}

export function credibilityLabel(credibility: string): string {
  switch (credibility) {
    case 'high': return '可信度高'
    case 'medium': return '可信度中'
    case 'low': return '可信度低'
    default: return '可信度未知'
  }
}

export function credibilityNeedsReview(credibility: string): boolean {
  return credibility !== 'high' && credibility !== 'medium'
}

export function researchModeNotice(mode: string): string | null {
  if (!mode || mode === 'live_ai') return null
  if (mode === 'curated_demo_fallback') return '使用策展备用研究材料（非实时检索）'
  if (mode === 'stub') return '使用占位研究材料（非实时检索）'
  return `非实时研究模式（${mode}）：材料并非实时检索`
}

export function formatCoverage(coverage: number): string {
  const value = Number.isFinite(coverage) ? coverage : 0
  const clamped = Math.max(0, Math.min(1, value))
  return `${Math.round(clamped * 100)}%`
}

export function recommendationLabel(recommendation: string): string {
  return recommendation === 'end' ? 'AI 建议结束' : 'AI 建议继续'
}

const NEXT_ACTION_ROUTE_LABELS: Record<string, string> = {
  verify: '查证',
  note: '记录',
  task: '执行',
  ask: '询问他人'
}

export function routeLabel(route: string): string {
  return NEXT_ACTION_ROUTE_LABELS[route] || route
}

export function groupNextActions(actions: NextAction[] | undefined): Array<{ route: string; label: string; items: NextAction[] }> {
  if (!Array.isArray(actions) || actions.length === 0) return []
  const order = ['verify', 'note', 'task', 'ask']
  const byRoute = new Map<string, NextAction[]>()
  for (const action of actions) {
    const list = byRoute.get(action.route) || []
    list.push(action)
    byRoute.set(action.route, list)
  }
  const known = order
    .filter(route => byRoute.has(route))
    .map(route => ({ route, label: routeLabel(route), items: byRoute.get(route)! }))
  const unknown = [...byRoute.keys()]
    .filter(route => !order.includes(route))
    .map(route => ({ route, label: routeLabel(route), items: byRoute.get(route)! }))
  return [...known, ...unknown]
}

export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
    if (
      data &&
      typeof data.sessionId === 'string' && data.sessionId.length > 0 &&
      typeof data.reportId === 'string' && data.reportId.length > 0 &&
      typeof data.cardId === 'string' && data.cardId.length > 0
    ) {
      return { sessionId: data.sessionId, reportId: data.reportId, cardId: data.cardId }
    }
  } catch {
    // malformed JSON falls through to null
  }
  return null
}

export function storedSessionMatches(stored: StoredSession | null, reportId: string, cardId: string): stored is StoredSession {
  return stored !== null && stored.reportId === reportId && stored.cardId === cardId
}

// ── State ──

type AppState = {
  session: ClearanceSession | null
  report: ReportSummary | null
  reportFailed: boolean
  params: { reportId: string; cardId: string } | null
  loading: boolean
  error: string | null
  sessionMissing: boolean
  answerDraft: string
  submitting: boolean
  ending: boolean
}

const state: AppState = {
  session: null,
  report: null,
  reportFailed: false,
  params: null,
  loading: false,
  error: null,
  sessionMissing: false,
  answerDraft: '',
  submitting: false,
  ending: false
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

function appendIf(parent: HTMLElement, child: HTMLElement | null): void {
  if (child) parent.appendChild(child)
}

// ── API ──

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'same-origin'
  })
}

async function readError(res: Response): Promise<Error> {
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  return new Error(data.error || `HTTP ${res.status}`)
}

async function createSessionApi(reportId: string, cardId: string): Promise<ClearanceSession> {
  const res = await apiFetch('/api/mvp1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reportId, cardId })
  })
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  return data.session
}

async function fetchSessionApi(sessionId: string): Promise<ClearanceSession | null> {
  const res = await apiFetch(`/api/mvp1/sessions/${encodeURIComponent(sessionId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  return data.session
}

async function submitAnswerApi(sessionId: string, answer: string): Promise<ClearanceSession> {
  const res = await apiFetch(`/api/mvp1/sessions/${encodeURIComponent(sessionId)}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer })
  })
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  return data.session
}

async function endSessionApi(sessionId: string): Promise<ClearanceSession> {
  const res = await apiFetch(`/api/mvp1/sessions/${encodeURIComponent(sessionId)}/end`, {
    method: 'POST'
  })
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  return data.session
}

async function fetchReportApi(reportId: string): Promise<ReportSummary> {
  const res = await apiFetch(`/api/mvp0/reports/${encodeURIComponent(reportId)}`)
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  return data.report
}

// ── URL helpers ──

function reportUrl(): string {
  const url = isPublicDeployment
    ? new URL('/mindiou/report.html', location.origin)
    : new URL('/report.html', location.origin)
  if (!isPublicDeployment && API_BASE) url.searchParams.set('api', API_BASE)
  return url.toString()
}

// ── Rendering ──

function statusBadge(status: string): HTMLElement {
  return el('span', `status-badge ${statusTone(status)}`, statusLabel(status))
}

function render(): void {
  const app = document.getElementById('app')!
  clear(app)

  const surface = el('div', 'report-surface')

  const header = el('div', 'report-header')
  const headerCopy = el('div')
  headerCopy.appendChild(el('h1', undefined, 'MindIOU — MVP-1 认知欠条清偿'))
  headerCopy.appendChild(el('p', undefined, '用主动解释偿还一笔认知欠条'))
  header.appendChild(headerCopy)
  const headerActions = el('div', 'header-actions')
  const back = el('a', 'btn-back', '返回报告')
  back.href = reportUrl()
  headerActions.appendChild(back)
  if (accessGateEnabled) {
    const logout = el('button', 'btn-logout', '退出')
    logout.type = 'button'
    logout.onclick = async () => {
      await apiFetch('/api/access/logout', { method: 'POST' }).catch(() => undefined)
      sessionStorage.removeItem(STORAGE_KEY)
      location.href = reportUrl()
    }
    headerActions.appendChild(logout)
  }
  header.appendChild(headerActions)
  surface.appendChild(header)

  if (state.loading) {
    surface.appendChild(el('div', 'status-bar loading', '正在处理…'))
  }
  if (state.error) {
    surface.appendChild(el('div', 'status-bar error', `错误：${state.error}`))
  }
  if (state.sessionMissing) {
    const bar = el('div', 'status-bar fallback')
    bar.appendChild(el('span', undefined, '之前的清偿会话已不存在（服务可能已重置）。'))
    const retry = el('button', 'btn-retry', '重新创建清偿会话')
    retry.type = 'button'
    retry.onclick = () => { void startNewSession() }
    bar.appendChild(retry)
    surface.appendChild(bar)
  }

  if (state.session) {
    surface.appendChild(renderSession(state.session))
  } else if (!state.loading && !state.error && !state.sessionMissing) {
    surface.appendChild(el('div', 'status-bar loading', '正在准备清偿会话…'))
  }

  app.appendChild(surface)
}

function renderSession(session: ClearanceSession): HTMLElement {
  const container = el('div', 'mvp1-container')

  container.appendChild(renderReportContext(session))
  container.appendChild(renderQuestion(session))
  appendIf(container, renderDanger(session))
  container.appendChild(renderResearch(session))

  if (session.state === 'ended') {
    container.appendChild(renderFinal(session))
  } else {
    if (session.attempts.length > 0) {
      container.appendChild(renderLatestFeedback(session.attempts[session.attempts.length - 1], session.attempts.length))
    }
    container.appendChild(renderAnswer(session))
  }

  if (session.attempts.length > 0) {
    container.appendChild(renderAttempts(session))
  }

  if (session.state === 'ended') {
    appendIf(container, renderReportNextActions())
    const row = el('div', 'btn-row')
    const back = el('a', 'btn-back btn-back-large', '返回报告')
    back.href = reportUrl()
    row.appendChild(back)
    container.appendChild(row)
  }

  return container
}

function renderReportContext(session: ClearanceSession): HTMLElement {
  const section = el('div', 'report-section mvp1-context')
  section.appendChild(el('h2', undefined, '这笔欠条来自哪份报告'))

  const meta = el('div', 'mvp1-context-meta')
  meta.appendChild(el('span', 'context-pill', `报告 ID：${session.reportId}`))
  if (state.report?.createdAt) {
    meta.appendChild(el('span', 'context-pill', `创建时间：${new Date(state.report.createdAt).toLocaleString()}`))
  }
  if (state.reportFailed) {
    meta.appendChild(el('span', 'context-pill warn', '报告详情加载失败，仅显示清偿会话'))
  }
  section.appendChild(meta)

  const link = el('a', 'context-link', '返回该报告')
  link.href = reportUrl()
  section.appendChild(link)
  return section
}

function renderQuestion(session: ClearanceSession): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '当前清偿问题'))
  section.appendChild(el('p', 'clearance-question', session.clearanceQuestion || session.originalCard.prompt))

  const meta = el('div', 'question-meta')
  meta.appendChild(el('span', 'context-pill', `针对缺口：${session.originalCard.target}`))
  if (session.originalCard.targetLevel) {
    meta.appendChild(el('span', 'context-pill', `目标层级：${session.originalCard.targetLevel}`))
  }
  if (session.originalCard.difficulty) {
    meta.appendChild(el('span', 'context-pill', `难度：${session.originalCard.difficulty}`))
  }
  section.appendChild(meta)

  if (session.originalCard.prompt && session.originalCard.prompt !== session.clearanceQuestion) {
    section.appendChild(el('p', 'original-prompt', `原始卡片：${session.originalCard.prompt}`))
  }
  return section
}

function renderDanger(session: ClearanceSession): HTMLElement | null {
  const gap = matchDangerousGap(state.report?.sections?.dangerousGaps, session.originalCard.target)
  if (!gap) return null

  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '为什么系统认为它危险'))

  const entry = el('div', 'gap-entry')
  entry.appendChild(el('span', 'gap-rank', String(gap.rank)))
  entry.appendChild(el('span', 'item-text', gap.gap))
  entry.appendChild(el('span', 'gap-why', `为什么危险：${gap.whyDangerous}`))
  if (gap.evidence) {
    entry.appendChild(el('span', 'evidence-text', `证据：${gap.evidence}`))
  }
  section.appendChild(entry)
  return section
}

function renderResearch(session: ClearanceSession): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '来源与研究状态'))

  const notice = researchModeNotice(session.researchMode)
  if (notice) {
    section.appendChild(el('div', 'status-bar fallback research-mode', notice))
  } else {
    section.appendChild(el('p', 'research-live', '实时 AI 研究检索'))
  }

  if (session.researchSummary) {
    section.appendChild(el('p', 'research-summary', session.researchSummary))
  }

  if (session.sources.length === 0) {
    section.appendChild(el('p', 'empty-line', '（无来源记录）'))
    return section
  }

  const list = el('ul', 'item-list')
  for (const source of session.sources) {
    const entry = el('li', 'item-entry source-entry')

    const title = el('a', 'source-title', source.title)
    title.href = source.url
    title.target = '_blank'
    title.rel = 'noopener noreferrer'
    entry.appendChild(title)

    const badges = el('div', 'source-badges')
    badges.appendChild(el('span', 'source-badge type', sourceTypeLabel(source.type)))
    badges.appendChild(el('span', 'source-badge credibility', credibilityLabel(source.credibility)))
    if (credibilityNeedsReview(source.credibility)) {
      badges.appendChild(el('span', 'source-badge review', '需核对'))
    }
    entry.appendChild(badges)

    if (source.claim) {
      entry.appendChild(el('span', 'source-claim', source.claim))
    }
    list.appendChild(entry)
  }
  section.appendChild(list)
  return section
}

function renderAnswer(session: ClearanceSession): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '你的解释'))
  section.appendChild(el('p', 'session-state-line', `会话状态：${sessionStateLabel(session.state)} · 已提交 ${session.attempts.length} 次回答`))

  if (session.attempts.length === 0) {
    section.appendChild(el('p', 'answer-hint', '用自己的话解释上面的问题。首次回答前，系统不会显示任何参考要点。'))
  }

  const textarea = document.createElement('textarea')
  textarea.className = 'card-answer-input mvp1-answer-input'
  textarea.placeholder = '用自己的话解释…'
  textarea.value = state.answerDraft
  textarea.oninput = () => {
    state.answerDraft = textarea.value
  }
  section.appendChild(textarea)

  const row = el('div', 'btn-row')
  const submit = el('button', 'btn-submit-answer', state.submitting ? '正在提交…' : '提交回答')
  submit.type = 'button'
  submit.disabled = state.submitting || state.ending
  submit.onclick = () => { void onSubmitAnswer() }
  row.appendChild(submit)

  const end = el('button', 'btn-end', state.ending ? '正在结束…' : '结束清偿')
  end.type = 'button'
  end.disabled = state.submitting || state.ending
  end.onclick = () => { void onEndSession() }
  row.appendChild(end)
  section.appendChild(row)
  return section
}

function chipGroup(title: string, items: string[], kind: string): HTMLElement | null {
  if (items.length === 0) return null
  const group = el('div', 'chip-group')
  group.appendChild(el('h3', undefined, title))
  const list = el('ul', 'chip-list')
  for (const item of items) {
    list.appendChild(el('li', `chip ${kind}`, item))
  }
  group.appendChild(list)
  return group
}

function renderLatestFeedback(attempt: ClearanceAttempt, index: number): HTMLElement {
  const section = el('div', 'report-section feedback-panel')
  section.appendChild(el('h2', undefined, `AI 对第 ${index} 次回答的反馈`))

  const analysis = attempt.analysis
  const badges = el('div', 'feedback-badges')
  badges.appendChild(statusBadge(analysis.status))
  badges.appendChild(el('span', 'coverage-pill', `覆盖度 ${formatCoverage(analysis.coverage)}`))
  badges.appendChild(el('span', 'coverage-pill', recommendationLabel(analysis.recommendation)))
  section.appendChild(badges)

  if (analysis.feedback) {
    section.appendChild(el('p', 'feedback-text', analysis.feedback))
  }

  appendIf(section, chipGroup('已证明', analysis.demonstrated, 'demonstrated'))
  appendIf(section, chipGroup('仍缺失', analysis.missing, 'missing'))
  appendIf(section, chipGroup('误解', analysis.misconceptions, 'misconception'))

  if (analysis.teaching) {
    const block = el('div', 'teaching-block')
    block.appendChild(el('h3', undefined, '教学解释'))
    block.appendChild(el('p', undefined, analysis.teaching))
    section.appendChild(block)
  }

  if (analysis.nextQuestion) {
    const block = el('div', 'next-question-block')
    block.appendChild(el('h3', undefined, '下一问'))
    block.appendChild(el('p', undefined, analysis.nextQuestion))
    section.appendChild(block)
  }

  return section
}

function renderAttempts(session: ClearanceSession): HTMLElement {
  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '全部回答对比'))

  session.attempts.forEach((attempt, index) => {
    const entry = el('div', 'attempt-entry')

    const head = el('div', 'attempt-head')
    head.appendChild(el('span', 'attempt-index', `第 ${index + 1} 次回答`))
    head.appendChild(statusBadge(attempt.analysis.status))
    head.appendChild(el('span', 'coverage-pill', `覆盖度 ${formatCoverage(attempt.analysis.coverage)}`))
    head.appendChild(el('span', 'attempt-time', new Date(attempt.createdAt).toLocaleString()))
    entry.appendChild(head)

    entry.appendChild(el('p', 'attempt-answer', attempt.answer))
    if (attempt.analysis.feedback) {
      entry.appendChild(el('p', 'attempt-feedback', `AI 反馈：${attempt.analysis.feedback}`))
    }
    section.appendChild(entry)
  })

  return section
}

function finalList(title: string, items: string[], kind: string): HTMLElement {
  const group = el('div', 'chip-group')
  group.appendChild(el('h3', undefined, title))
  if (items.length === 0) {
    group.appendChild(el('p', 'empty-line', '（无）'))
    return group
  }
  const list = el('ul', 'chip-list')
  for (const item of items) {
    list.appendChild(el('li', `chip ${kind}`, item))
  }
  group.appendChild(list)
  return group
}

function renderFinal(session: ClearanceSession): HTMLElement {
  const section = el('div', 'report-section final-panel')
  section.appendChild(el('h2', undefined, '清偿结果'))

  const result = session.finalResult
  if (!result) {
    section.appendChild(el('p', undefined, '会话已结束，但服务未返回最终结果。'))
    return section
  }

  const head = el('div', 'final-head')
  head.appendChild(statusBadge(result.status))
  section.appendChild(head)
  section.appendChild(el('p', 'final-disclaimer', '该状态仅代表本次会话证据，不代表长期掌握。'))

  if (result.sourceReviewRequired) {
    section.appendChild(el('div', 'status-bar fallback', '本次结论引用了普通网页或低可信度来源，请先核对来源再采信。'))
  }

  section.appendChild(finalList('AI 认为你已经证明', result.demonstrated, 'demonstrated'))
  section.appendChild(finalList('仍然缺少', result.remainingGaps, 'missing'))

  if (result.nextRecommendation) {
    const block = el('div', 'next-rec-block')
    block.appendChild(el('h3', undefined, '下一步建议'))
    block.appendChild(el('p', undefined, result.nextRecommendation))
    section.appendChild(block)
  }

  if (session.scaffold && session.scaffold.length > 0) {
    const block = el('div', 'scaffold-block')
    block.appendChild(el('h3', undefined, '参考要点（清偿结束后可见）'))
    const sourceById = new Map(session.sources.map(source => [source.id, source]))
    for (const point of session.scaffold) {
      const entry = el('div', 'scaffold-entry')
      entry.appendChild(el('span', 'item-text', point.point))
      if (point.whyItMatters) {
        entry.appendChild(el('span', 'scaffold-why', `为什么重要：${point.whyItMatters}`))
      }
      const titles = point.sourceIds
        .map(id => sourceById.get(id)?.title)
        .filter((title): title is string => Boolean(title))
      if (titles.length > 0) {
        entry.appendChild(el('span', 'scaffold-sources', `来源：${titles.join('；')}`))
      }
      block.appendChild(entry)
    }
    section.appendChild(block)
  }

  // ── 训练系统信息 ──
  const trainingInfo = el('div', 'training-info-block')
  trainingInfo.appendChild(el('p', 'training-info-title', '已完成首次补偿训练'))

  const passed = result.status === 'provisionally_cleared'
  const masteryText = passed
    ? '你已经在当前材料帮助下完成了核心解释。当前状态：初步理解。'
    : '当前状态：需要继续练习。'
  trainingInfo.appendChild(el('p', 'training-info-mastery', masteryText))

  trainingInfo.appendChild(el('p', 'training-info-hints', '本次会话无提示记录。'))

  trainingInfo.appendChild(el('p', 'training-info-next', '系统将在未来通过无提示回忆和场景题继续验证你是否真正掌握。'))

  const trainingLink = el('a', 'btn btn-secondary training-link', '查看训练系统')
  trainingLink.href = '/training.html'
  trainingInfo.appendChild(trainingLink)

  section.appendChild(trainingInfo)

  return section
}

function renderReportNextActions(): HTMLElement | null {
  const groups = groupNextActions(state.report?.sections?.nextActions)
  if (groups.length === 0) return null

  const section = el('div', 'report-section')
  section.appendChild(el('h2', undefined, '报告给出的下一步行动'))

  for (const group of groups) {
    const wrapper = el('div', 'cog-group')
    wrapper.appendChild(el('h3', undefined, group.label))
    for (const action of group.items) {
      const entry = el('div', 'action-entry')
      entry.appendChild(el('span', `action-route ${group.route}`, group.label))
      const content = el('div', 'action-content')
      content.appendChild(el('span', 'action-item', action.item))
      if (action.reason) {
        content.appendChild(el('span', 'action-reason', action.reason))
      }
      entry.appendChild(content)
      wrapper.appendChild(entry)
    }
    section.appendChild(wrapper)
  }

  return section
}

// ── Session actions ──

async function loadReport(reportId: string): Promise<void> {
  try {
    state.report = await fetchReportApi(reportId)
  } catch {
    state.reportFailed = true
  }
  render()
}

async function startNewSession(): Promise<void> {
  if (!state.params) return
  state.loading = true
  state.error = null
  state.sessionMissing = false
  render()
  try {
    const session = await createSessionApi(state.params.reportId, state.params.cardId)
    state.session = session
    const stored: StoredSession = { sessionId: session.id, reportId: session.reportId, cardId: session.cardId }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err)
  } finally {
    state.loading = false
    render()
  }
}

async function onSubmitAnswer(): Promise<void> {
  if (!state.session || state.submitting || state.ending) return
  const answer = state.answerDraft.trim()
  if (!answer) return
  state.submitting = true
  state.error = null
  render()
  try {
    state.session = await submitAnswerApi(state.session.id, answer)
    state.answerDraft = ''
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err)
  } finally {
    state.submitting = false
    render()
  }
}

async function onEndSession(): Promise<void> {
  if (!state.session || state.submitting || state.ending) return
  state.ending = true
  state.error = null
  render()
  try {
    state.session = await endSessionApi(state.session.id)
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err)
  } finally {
    state.ending = false
    render()
  }
}

// ── Bootstrap ──

async function bootstrap(): Promise<void> {
  if (accessGateEnabled) {
    try {
      const response = await apiFetch('/api/access/session')
      if (!response.ok) {
        location.href = reportUrl()
        return
      }
    } catch {
      location.href = reportUrl()
      return
    }
  }

  const reportId = runtimeParams.get('reportId') || ''
  const cardId = runtimeParams.get('cardId') || ''
  if (!reportId || !cardId) {
    state.error = '缺少 reportId 或 cardId 参数，请从报告页重新进入。'
    render()
    return
  }
  state.params = { reportId, cardId }
  void loadReport(reportId)

  const stored = parseStoredSession(sessionStorage.getItem(STORAGE_KEY))
  if (storedSessionMatches(stored, reportId, cardId)) {
    state.loading = true
    render()
    try {
      const session = await fetchSessionApi(stored.sessionId)
      if (session) {
        state.session = session
      } else {
        sessionStorage.removeItem(STORAGE_KEY)
        state.sessionMissing = true
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : String(err)
    } finally {
      state.loading = false
      render()
    }
    return
  }

  await startNewSession()
}

if (typeof document !== 'undefined') {
  void bootstrap()
}
