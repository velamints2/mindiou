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
  assessment: {
    total: number
    today: number
    byRole: Record<string, number>
    byLocale: Record<string, number>
    byMode: Record<string, number>
  }
  eventCount: number
}
type EventItem = { at?: string; type: string; data?: Record<string, unknown> }

// 用户注册情况 + 活跃度
type AdminUser = {
  id: string
  email: string
  createdAt: string
  emailVerified: boolean
  activeSessionCount: number
  lastSessionAt: string | null
  activeDeviceTokenCount: number
  reportCount: number
  draftCount: number
  clearanceSessionCount: number
  lastActivityAt: string | null
}

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

  // 并行拉取：聚合 stats + 事件流 + 健康 + 用户列表
  const [statsRes, eventsRes, healthRes, usersRes] = await Promise.all([
    adminFetch<{ ok?: boolean; stats?: AdminStats }>('/api/admin/stats'),
    adminFetch<{ ok?: boolean; events?: EventItem[] }>('/api/admin/events'),
    adminFetch<{ ok?: boolean; ai?: string }>('/health'),
    adminFetch<{ ok?: boolean; users?: AdminUser[]; total?: number }>('/api/admin/users')
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
  const users = usersRes?.users || []

  // ── 1. 概览卡片 ──
  page.appendChild(renderOverview(stats, events, healthRes))

  // ── 2. 用户注册情况 ── ★ 新增
  page.appendChild(renderUserRegistrations(users))

  // ── 3. 用户活跃度 ── ★ 新增
  page.appendChild(renderUserActivity(users))

  // ── 4. MBAI 协作测试统计 ── ★ 新增
  page.appendChild(renderAssessment(stats))

  // ── 5. 漏斗分析 ──
  page.appendChild(renderFunnel(stats))

  // ── 5. 节点停留时长 ──
  page.appendChild(renderDwellTime(stats))

  // ── 6. 报告质量 ──
  page.appendChild(renderReportQuality(stats))

  // ── 7. 能力画像分布 ──
  page.appendChild(renderCapabilityDist(stats))

  // ── 8. 时间线 & 会话 ──
  page.appendChild(renderTimelineSession(stats))

  // ── 9. 最近事件流 ──
  page.appendChild(renderEventStream(events))

  root.appendChild(page)
}

// ── MBAI 协作测试统计 ──
function renderAssessment(stats: AdminStats): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', 'MBAI 协作测试'))
  section.appendChild(el('p', 'admin-section-desc', 'AI 协作类型测试（/assessment）的完成情况，按角色 / 语言 / 评审模式分布'))

  const a = stats.assessment
  if (!a) {
    section.appendChild(el('p', 'admin-empty', '暂无测试数据（埋点未启用或后端版本过旧）'))
    return section
  }

  // 概览卡片
  const overviewGrid = el('div', 'metric-grid')
  const overviewCards = [
    { label: '累计测试', value: a.total, sub: `今日 ${a.today}` },
    { label: '今日测试', value: a.today, sub: a.total > 0 ? `${((a.today / a.total) * 100).toFixed(1)}% 占比` : '0%' },
    { label: '角色类型数', value: Object.keys(a.byRole).length, sub: '4 种为完整覆盖' },
    { label: '模型评审占比', value: a.byMode.model_structured || 0, sub: a.total > 0 ? `${(((a.byMode.model_structured || 0) / a.total) * 100).toFixed(1)}%` : '0%' }
  ]
  for (const c of overviewCards) {
    const card = el('div', 'metric-card')
    card.appendChild(el('span', 'metric-value', String(c.value)))
    card.appendChild(el('span', 'metric-label', c.label))
    card.appendChild(el('span', 'metric-sub', c.sub))
    overviewGrid.appendChild(card)
  }
  section.appendChild(overviewGrid)

  if (a.total === 0) {
    section.appendChild(el('p', 'admin-empty', '还没有人完成测试'))
    return section
  }

  // 分布表
  const ROLE_LABELS: Record<string, [string, string]> = {
    developer: ['开发者与 Vibe Coder', 'Developer'],
    product: ['产品经理与创业者', 'Product'],
    research: ['学生与研究者', 'Researcher'],
    creator: ['内容创作者', 'Creator']
  }
  const renderDist = (title: string, dist: Record<string, number>, labels?: Record<string, [string, string]>): HTMLElement => {
    const block = el('div', 'admin-dist-block')
    block.appendChild(el('h3', 'admin-dist-title', title))
    const entries = Object.entries(dist).sort((a, b) => b[1] - a[1])
    if (entries.length === 0) {
      block.appendChild(el('p', 'admin-empty', '无数据'))
      return block
    }
    const list = el('div', 'admin-dist-list')
    for (const [key, count] of entries) {
      const row = el('div', 'admin-dist-row')
      const name = labels?.[key]?.[0] || key
      const pct = a.total > 0 ? ((count / a.total) * 100).toFixed(1) : '0'
      row.appendChild(el('span', 'admin-dist-name', `${name} (${key})`))
      row.appendChild(el('span', 'admin-dist-count', String(count)))
      row.appendChild(el('span', 'admin-dist-pct', `${pct}%`))
      list.appendChild(row)
    }
    block.appendChild(list)
    return block
  }

  const distGrid = el('div', 'admin-dist-grid')
  distGrid.appendChild(renderDist('按角色分布', a.byRole, ROLE_LABELS))
  distGrid.appendChild(renderDist('按语言分布', a.byLocale))
  distGrid.appendChild(renderDist('按评审模式分布', a.byMode))
  section.appendChild(distGrid)

  return section
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

// ── 用户注册情况 ──
function renderUserRegistrations(users: AdminUser[]): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '用户注册情况'))
  section.appendChild(el('p', 'admin-section-desc', '所有已注册账户的基础信息'))

  if (users.length === 0) {
    section.appendChild(el('p', 'admin-empty', '暂无注册用户'))
    return section
  }

  // 概览卡片：总用户数、今日新增、已验证邮箱数、活跃会话数
  const today = new Date().toISOString().slice(0, 10)
  const todayNew = users.filter(u => u.createdAt?.startsWith(today)).length
  const verifiedCount = users.filter(u => u.emailVerified).length
  const activeSessions = users.reduce((sum, u) => sum + (u.activeSessionCount || 0), 0)
  const overviewGrid = el('div', 'metric-grid')
  const overviewCards = [
    { label: '总用户数', value: users.length, sub: `今日新增 ${todayNew}` },
    { label: '已验证邮箱', value: verifiedCount, sub: `${((verifiedCount / users.length) * 100).toFixed(1)}%` },
    { label: '活跃会话', value: activeSessions, sub: '当前在线' },
    { label: '设备 Token', value: users.reduce((s, u) => s + u.activeDeviceTokenCount, 0), sub: '未撤销' }
  ]
  for (const c of overviewCards) {
    const card = el('div', 'metric-card')
    card.appendChild(el('span', 'metric-value', String(c.value)))
    card.appendChild(el('span', 'metric-label', c.label))
    card.appendChild(el('span', 'metric-sub', c.sub))
    overviewGrid.appendChild(card)
  }
  section.appendChild(overviewGrid)

  // 用户表
  const tableWrap = el('div', 'admin-table-wrap')
  const table = el('table', 'admin-table user-table')
  // 表头
  const thead = el('thead')
  const headRow = el('tr')
  for (const h of ['邮箱', '注册时间', '邮箱验证', '活跃会话', '设备Token', '最近登录']) {
    headRow.appendChild(el('th', '', h))
  }
  thead.appendChild(headRow)
  table.appendChild(thead)

  // 表体
  const tbody = el('tbody')
  for (const u of users) {
    const row = el('tr')
    row.appendChild(el('td', 'user-email-cell', u.email))
    row.appendChild(el('td', 'user-date-cell', formatDate(u.createdAt)))
    row.appendChild(el('td', `user-verify-cell ${u.emailVerified ? 'is-verified' : 'is-unverified'}`, u.emailVerified ? '已验证' : '未验证'))
    row.appendChild(el('td', '', String(u.activeSessionCount || 0)))
    row.appendChild(el('td', '', String(u.activeDeviceTokenCount || 0)))
    row.appendChild(el('td', 'user-date-cell', u.lastSessionAt ? formatDate(u.lastSessionAt) : '从未'))
    tbody.appendChild(row)
  }
  table.appendChild(tbody)
  tableWrap.appendChild(table)
  section.appendChild(tableWrap)

  return section
}

// ── 用户活跃度 ──
function renderUserActivity(users: AdminUser[]): HTMLElement {
  const section = el('section', 'admin-section')
  section.appendChild(el('h2', 'admin-section-title', '用户活跃度'))
  section.appendChild(el('p', 'admin-section-desc', '每个用户的业务活动（报告、草稿、清偿会话、最近活动时间）'))

  if (users.length === 0) {
    section.appendChild(el('p', 'admin-empty', '暂无用户活动数据'))
    return section
  }

  // 活跃用户排序：有活动的优先，按最近活动时间倒序
  const sorted = [...users].sort((a, b) => {
    const ta = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0
    const tb = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0
    return tb - ta
  })

  const tableWrap = el('div', 'admin-table-wrap')
  const table = el('table', 'admin-table activity-table')
  const thead = el('thead')
  const headRow = el('tr')
  for (const h of ['邮箱', '草稿数', '报告数', '清偿会话', '最近活动']) {
    headRow.appendChild(el('th', '', h))
  }
  thead.appendChild(headRow)
  table.appendChild(thead)

  const tbody = el('tbody')
  for (const u of sorted) {
    const row = el('tr')
    row.appendChild(el('td', 'user-email-cell', u.email))
    row.appendChild(el('td', '', String(u.draftCount || 0)))
    row.appendChild(el('td', '', String(u.reportCount || 0)))
    row.appendChild(el('td', '', String(u.clearanceSessionCount || 0)))
    // 活跃度标签
    const activityLevel = classifyActivity(u)
    const lastCell = el('td', `user-activity-cell is-${activityLevel.level}`)
    lastCell.appendChild(el('span', 'activity-time', u.lastActivityAt ? formatDate(u.lastActivityAt) : '从未'))
    lastCell.appendChild(el('span', 'activity-level', activityLevel.label))
    row.appendChild(lastCell)
    tbody.appendChild(row)
  }
  table.appendChild(tbody)
  tableWrap.appendChild(table)
  section.appendChild(tableWrap)

  return section
}

function classifyActivity(u: AdminUser): { level: string; label: string } {
  const totalActivity = (u.draftCount || 0) + (u.reportCount || 0) + (u.clearanceSessionCount || 0)
  if (totalActivity === 0) return { level: 'dormant', label: '未活跃' }
  if (totalActivity >= 5) return { level: 'high', label: '高活跃' }
  if (totalActivity >= 2) return { level: 'medium', label: '中活跃' }
  return { level: 'low', label: '低活跃' }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 30) return `${diffDay} 天前`
  return d.toLocaleDateString('zh-CN')
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
