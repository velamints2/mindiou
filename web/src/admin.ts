// 运营后台前端
// 独立路由 /admin，独立鉴权（admin token），只读聚合现有后端数据。
// 数据来源：GET /api/admin/stats（后端补丁聚合）、GET /api/admin/events、GET /health
// 生产环境 /api/mvp0/reports 被 nginx 封禁（防枚举），必须走 admin/stats。

import { API_BASE } from './api'
import { disableTracker } from './tracker'
import { navigate } from './router'

const ADMIN_TOKEN_KEY = 'mindiou_admin_token'

function getAdminToken(): string | null {
  try { return localStorage.getItem(ADMIN_TOKEN_KEY) } catch { return null }
}
function setAdminToken(t: string): void {
  try { localStorage.setItem(ADMIN_TOKEN_KEY, t) } catch { /* */ }
}
function clearAdminToken(): void {
  try { localStorage.removeItem(ADMIN_TOKEN_KEY) } catch { /* */ }
}

// ── DOM 工具 ──
function el(tag: string, cls = '', text = ''): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text) e.textContent = text
  return e
}
function clear(node: HTMLElement): void { node.replaceChildren() }

// 带鉴权的 fetch
async function adminFetch<T>(path: string): Promise<T | null> {
  const token = getAdminToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers })
    if (res.status === 401 || res.status === 403) return null
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

// ── 后端补丁返回的聚合数据结构（admin-backend-patch.js computeAdminStats） ──
type AdminStats = {
  generatedAt: string
  funnel: {
    drafts: number
    reportedDrafts: number
    reports: number
    interactedReports: number
    cardAnswers: number
    corrections: number
  }
  reportQuality: {
    total: number
    fallbackRate: number
    fallbackCount: number
    statusDist: Record<string, number>
    failStepDist: Record<string, number>
    artifactTypeDist: Record<string, number>
  }
  capabilityDist: Record<string, Record<string, number>>
  timelineStats: {
    totalDrafts: number
    avgSteps: number
    confusionRate: number
    fallbackRate: number
  }
  sessionStats: {
    total: number
    ended: number
    inProgress: number
    resultDist: Record<string, number>
    avgAttempts: number
  }
  tracking: {
    pageEnterCounts: Record<string, number>
    dwellTime: Record<string, { avgMs: number; count: number }>
  }
  spiral: unknown
  eventCount: number
}
type EventItem = { at?: string; type: string; data?: Record<string, unknown> }

// ── 登录页 ──
export function renderAdminLogin(root: HTMLElement): void {
  disableTracker()
  clear(root)
  const page = el('div', 'admin-page admin-login')
  page.appendChild(el('h1', 'admin-title', 'MindIOU 运营后台'))
  page.appendChild(el('p', 'admin-desc', '输入管理员 Token 进入'))
  const input = el('input', 'admin-token-input') as HTMLInputElement
  input.type = 'password'
  input.placeholder = 'Admin Token'
  const status = el('p', 'form-status')
  const btn = el('button', 'btn btn-primary', '进入')
  btn.onclick = async () => {
    const t = input.value.trim()
    if (!t) return
    setAdminToken(t)
    // 用 admin/stats 验证 token（401 即无效）
    const stats = await adminFetch<{ ok?: boolean; stats?: AdminStats }>('/api/admin/stats')
    if (stats === null) {
      clearAdminToken()
      status.textContent = 'Token 无效或后端不可达'
      return
    }
    // 登录成功，直接渲染看板
    await renderAdminDashboard(root)
  }
  const back = el('button', 'btn btn-ghost', '返回首页')
  back.onclick = () => navigate({ name: 'landing' })
  page.appendChild(input)
  page.appendChild(btn)
  page.appendChild(status)
  page.appendChild(back)
  root.appendChild(page)
}

// ── 看板页 ──
export async function renderAdminDashboard(root: HTMLElement): Promise<void> {
  disableTracker()
  clear(root)
  const page = el('div', 'admin-page')

  // 顶栏
  const header = el('header', 'admin-header')
  header.appendChild(el('h1', 'admin-brand', 'MindIOU 运营后台'))
  const actions = el('div', 'admin-actions')
  const refresh = el('button', 'btn btn-ghost btn-sm', '刷新')
  refresh.onclick = () => renderAdminDashboard(root)
  const logout = el('button', 'btn btn-ghost btn-sm', '退出')
  logout.onclick = () => { clearAdminToken(); navigate({ name: 'landing' }) }
  actions.appendChild(refresh)
  actions.appendChild(logout)
  header.appendChild(actions)
  page.appendChild(header)

  page.appendChild(el('div', 'admin-loading', '正在加载数据…'))
  root.appendChild(page)

  // 并行拉取：聚合 stats + 事件流 + 健康
  const [statsRes, eventsRes, healthRes] = await Promise.all([
    adminFetch<{ ok?: boolean; stats?: AdminStats }>('/api/admin/stats'),
    adminFetch<{ ok?: boolean; events?: EventItem[] }>('/api/admin/events'),
    adminFetch<{ ok?: boolean; ai?: string }>('/health')
  ])

  clear(page)
  page.appendChild(header)

  if (!statsRes?.stats) {
    page.appendChild(el('div', 'admin-empty', '无法加载统计数据。请确认后端已挂载 admin-backend-patch.js，且 MINDIOU_ADMIN_TOKEN 已配置。'))
    root.appendChild(page)
    return
  }

  const stats = statsRes.stats
  const events = eventsRes?.events || []

  // ── 1. 概览卡片 ──
  page.appendChild(renderOverview(stats, events, healthRes))

  // ── 2. 漏斗分析 ──
  page.appendChild(renderFunnel(stats))

  // ── 3. 节点停留时长 ──
  page.appendChild(renderDwellTime(stats))

  // ── 4. 报告质量 ──
  page.appendChild(renderReportQuality(stats))

  // ── 5. 能力画像分布 ──
  page.appendChild(renderCapabilityDist(stats))

  // ── 6. 时间线 & 会话 ──
  page.appendChild(renderTimelineSession(stats))

  // ── 7. 最近事件流 ──
  page.appendChild(renderEventStream(events))

  root.appendChild(page)
}

// ── 概览卡片 ──
function renderOverview(
  stats: AdminStats, events: EventItem[], health: unknown
): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '概览'))

  const today = new Date().toISOString().slice(0, 10)
  const todayEvents = events.filter(e => {
    const ts = e.data?.ts as number || 0
    return ts && new Date(ts).toISOString().startsWith(today)
  })
  // 活跃页面会话数（去重 pageSession）
  const sessions = new Set(events
    .filter(e => e.type === 'page_enter')
    .map(e => e.data?.pageSession as string)
    .filter(Boolean))

  const cards = [
    { label: '累计报告', value: stats.reportQuality.total, sub: `Fallback ${stats.reportQuality.fallbackCount}` },
    { label: '累计草稿', value: stats.funnel.drafts, sub: `已生成报告 ${stats.funnel.reportedDrafts}` },
    { label: '累计事件', value: stats.eventCount, sub: `今日 ${todayEvents.length}` },
    { label: '活跃会话', value: sessions.size, sub: `清偿会话 ${stats.sessionStats.total}` },
    { label: '服务健康', value: health ? '正常' : '异常', sub: health ? 'AI 已连接' : 'AI 不可达' }
  ]
  const grid = el('div', 'metric-grid')
  for (const c of cards) {
    const card = el('div', 'metric-card')
    card.appendChild(el('span', 'metric-value', String(c.value)))
    card.appendChild(el('span', 'metric-label', c.label))
    card.appendChild(el('span', 'metric-sub', c.sub))
    grid.appendChild(card)
  }
  section.appendChild(grid)
  return section
}

// ── 漏斗分析 ──
function renderFunnel(stats: AdminStats): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '用户漏斗'))
  section.appendChild(el('p', 'admin-section-desc', '从访问到完成清偿的各步骤转化'))

  const enter = stats.tracking.pageEnterCounts
  // 漏斗步骤：访问落地页 → 登录 → 输入材料(草稿) → 时间线 → 查看报告 → 清偿会话
  const steps = [
    { label: '访问落地页', count: enter['landing'] || 0 },
    { label: '登录', count: enter['login'] || 0 },
    { label: '输入材料', count: stats.funnel.drafts },
    { label: '时间线标注', count: enter['timeline'] || 0 },
    { label: '查看报告', count: stats.funnel.reports },
    { label: '清偿会话', count: stats.sessionStats.total }
  ]

  const max = Math.max(...steps.map(s => s.count), 1)
  const funnel = el('div', 'funnel-list')
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const pct = max > 0 ? (s.count / max) * 100 : 0
    const conv = i > 0 && steps[i - 1].count > 0
      ? `${((s.count / steps[i - 1].count) * 100).toFixed(1)}%`
      : '—'
    const row = el('div', 'funnel-row')
    row.appendChild(el('span', 'funnel-label', s.label))
    const bar = el('div', 'funnel-bar-track')
    const fill = el('div', 'funnel-bar-fill')
    fill.style.width = `${pct}%`
    bar.appendChild(fill)
    row.appendChild(bar)
    row.appendChild(el('span', 'funnel-count', String(s.count)))
    row.appendChild(el('span', 'funnel-conv', conv))
    funnel.appendChild(row)
  }
  section.appendChild(funnel)
  return section
}

// ── 节点停留时长 ──
function renderDwellTime(stats: AdminStats): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '页面停留时长'))
  section.appendChild(el('p', 'admin-section-desc', '用户在每个页面平均停留多久'))

  const dwell = stats.tracking.dwellTime
  const screens = Object.keys(dwell).sort()
  if (screens.length === 0) {
    section.appendChild(el('p', 'admin-empty', '暂无停留时长数据（需要用户访问产生埋点）'))
    return section
  }

  const list = el('div', 'dwell-list')
  for (const screen of screens) {
    const info = dwell[screen]
    const row = el('div', 'dwell-row')
    row.appendChild(el('span', 'dwell-screen', screen))
    row.appendChild(el('span', 'dwell-avg', formatDuration(info.avgMs)))
    row.appendChild(el('span', 'dwell-count', `${info.count} 次`))
    list.appendChild(row)
  }
  section.appendChild(list)
  return section
}

// ── 报告质量 ──
function renderReportQuality(stats: AdminStats): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '报告质量'))

  const rq = stats.reportQuality
  if (rq.total === 0) {
    section.appendChild(el('p', 'admin-empty', '暂无报告'))
    return section
  }

  const grid = el('div', 'quality-grid')
  // fallback 率
  const fbCard = el('div', 'quality-card')
  fbCard.appendChild(el('span', 'quality-value', `${(rq.fallbackRate * 100).toFixed(1)}%`))
  fbCard.appendChild(el('span', 'quality-label', 'Fallback 率'))
  fbCard.appendChild(el('span', 'quality-sub', `${rq.fallbackCount} / ${rq.total} 走兜底`))
  grid.appendChild(fbCard)

  // 状态分布
  const statusCard = el('div', 'quality-card')
  statusCard.appendChild(el('span', 'quality-label', '报告状态分布'))
  for (const [status, count] of Object.entries(rq.statusDist)) {
    statusCard.appendChild(el('div', 'quality-bar',
      `${status}: ${count} (${((count / rq.total) * 100).toFixed(1)}%)`))
  }
  grid.appendChild(statusCard)

  // 失败步骤
  if (Object.keys(rq.failStepDist).length > 0) {
    const failCard = el('div', 'quality-card')
    failCard.appendChild(el('span', 'quality-label', '失败步骤分布'))
    for (const [step, count] of Object.entries(rq.failStepDist)) {
      failCard.appendChild(el('div', 'quality-bar', `${step}: ${count}`))
    }
    grid.appendChild(failCard)
  }

  // 材料类型分布
  if (Object.keys(rq.artifactTypeDist).length > 0) {
    const typeCard = el('div', 'quality-card')
    typeCard.appendChild(el('span', 'quality-label', '材料类型分布'))
    for (const [type, count] of Object.entries(rq.artifactTypeDist)) {
      typeCard.appendChild(el('div', 'quality-bar', `${type}: ${count}`))
    }
    grid.appendChild(typeCard)
  }

  section.appendChild(grid)
  return section
}

// ── 能力画像分布 ──
function renderCapabilityDist(stats: AdminStats): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '用户能力画像'))

  const dims = stats.capabilityDist
  if (Object.keys(dims).length === 0) {
    section.appendChild(el('p', 'admin-empty', '暂无能力画像数据'))
    return section
  }

  const grid = el('div', 'capability-grid')
  for (const [dim, levels] of Object.entries(dims)) {
    const card = el('div', 'capability-card')
    card.appendChild(el('h3', 'capability-title', dim))
    for (const [level, count] of Object.entries(levels).sort()) {
      card.appendChild(el('div', 'capability-bar', `${level}: ${count}`))
    }
    grid.appendChild(card)
  }
  section.appendChild(grid)
  return section
}

// ── 时间线 & 清偿会话 ──
function renderTimelineSession(stats: AdminStats): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '时间线 & 清偿会话'))

  const grid = el('div', 'quality-grid')

  // 时间线
  const tlCard = el('div', 'quality-card')
  tlCard.appendChild(el('span', 'quality-label', '时间线草稿'))
  tlCard.appendChild(el('div', 'quality-bar', `总草稿: ${stats.timelineStats.totalDrafts}`))
  tlCard.appendChild(el('div', 'quality-bar', `平均步骤: ${stats.timelineStats.avgSteps.toFixed(1)}`))
  tlCard.appendChild(el('div', 'quality-bar', `困惑率: ${(stats.timelineStats.confusionRate * 100).toFixed(1)}%`))
  tlCard.appendChild(el('div', 'quality-bar', `兜底率: ${(stats.timelineStats.fallbackRate * 100).toFixed(1)}%`))
  grid.appendChild(tlCard)

  // 清偿会话
  const ss = stats.sessionStats
  const ssCard = el('div', 'quality-card')
  ssCard.appendChild(el('span', 'quality-label', '清偿会话'))
  ssCard.appendChild(el('div', 'quality-bar', `总会话: ${ss.total}`))
  ssCard.appendChild(el('div', 'quality-bar', `已结束: ${ss.ended}`))
  ssCard.appendChild(el('div', 'quality-bar', `进行中: ${ss.inProgress}`))
  ssCard.appendChild(el('div', 'quality-bar', `平均尝试: ${ss.avgAttempts.toFixed(1)}`))
  grid.appendChild(ssCard)

  // 结果分布
  if (Object.keys(ss.resultDist).length > 0) {
    const resultCard = el('div', 'quality-card')
    resultCard.appendChild(el('span', 'quality-label', '清偿结果分布'))
    for (const [status, count] of Object.entries(ss.resultDist)) {
      resultCard.appendChild(el('div', 'quality-bar', `${status}: ${count}`))
    }
    grid.appendChild(resultCard)
  }

  section.appendChild(grid)
  return section
}

// ── 事件流 ──
function renderEventStream(events: EventItem[]): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '最近事件流'))

  const recent = [...events]
    .sort((a, b) => {
      const ta = (a.data?.ts as number) || 0
      const tb = (b.data?.ts as number) || 0
      return tb - ta
    })
    .slice(0, 30)

  if (recent.length === 0) {
    section.appendChild(el('p', 'admin-empty', '暂无事件'))
    return section
  }

  const list = el('div', 'event-list')
  for (const e of recent) {
    const row = el('div', 'event-row')
    const ts = (e.data?.ts as number) || 0
    const time = ts ? new Date(ts).toLocaleTimeString('zh-CN') : (e.at || '--')
    const screen = (e.data?.screen as string) || ''
    row.appendChild(el('span', 'event-time', time))
    row.appendChild(el('span', 'event-type', e.type))
    if (screen) row.appendChild(el('span', 'event-screen', screen))
    list.appendChild(row)
  }
  section.appendChild(list)
  return section
}

// ── 工具 ──
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}min`
}
