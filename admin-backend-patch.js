/**
 * MindIOU 运营后台后端补丁
 *
 * 这是一个独立 ESM 模块，需要在主仓库 server.js 里挂载。
 * 不修改任何现有端点，只新增只读统计端点。
 *
 * 挂载方法见同目录 ADMIN_SETUP.md。
 *
 * 暴露的端点：
 *   GET /api/admin/stats          — 聚合统计数据（需 Admin Token）
 *   GET /api/admin/events          — 事件流（需 Admin Token）
 *
 * 鉴权：通过环境变量 MINDIOU_ADMIN_TOKEN 设置。
 *       请求需带 Authorization: Bearer <token>。
 *       若未设置该环境变量，则使用 LEARNING_API_TOKEN 作为 fallback。
 */

// ── 数据聚合函数（纯函数，接收 store 实例） ──

/**
 * 计算运营统计。
 * @param {object} mvp0Store - mvp0-store 实例（需有 getState 方法）
 * @param {object} spiralStore - spiral-store 实例（需有 dashboard 方法）
 * @param {Array} eventLog - 业务事件日志数组
 * @param {Map} mvp1Sessions - MVP-1 会话 Map（内存）
 * @returns {object} 统计数据
 */
export function computeAdminStats(mvp0Store, spiralStore, eventLog, mvp1Sessions) {
  const state = mvp0Store.getState()
  const reports = state.clearanceReports || []
  const drafts = state.drafts || []

  // ── 漏斗 ──
  const funnel = {
    drafts: drafts.length,
    reportedDrafts: drafts.filter(d => d.reportId).length,
    reports: reports.length,
    interactedReports: reports.filter(r => r.status === 'interacted' || r.status === 'corrected').length,
    cardAnswers: reports.reduce((sum, r) =>
      sum + (r.sections?.feynmanCards?.filter(c => c.userAnswer).length || 0), 0),
    corrections: reports.reduce((sum, r) => sum + (r.corrections?.length || 0), 0)
  }

  // ── 报告质量 ──
  const fallbackCount = reports.filter(r => r.generation?.fallback).length
  const statusDist = {}
  for (const r of reports) statusDist[r.status] = (statusDist[r.status] || 0) + 1
  const failStepDist = {}
  for (const r of reports) {
    if (r.generation?.failedStep) failStepDist[r.generation.failedStep] = (failStepDist[r.generation.failedStep] || 0) + 1
  }
  const artifactTypeDist = {}
  for (const r of reports) {
    const t = r.input?.artifactType || 'unknown'
    artifactTypeDist[t] = (artifactTypeDist[t] || 0) + 1
  }

  // ── 能力画像 ──
  const capabilityDist = {}
  for (const r of reports) {
    const dims = r.analysis?.userCapability?.dimensions
    if (!dims) continue
    for (const [name, info] of Object.entries(dims)) {
      if (!capabilityDist[name]) capabilityDist[name] = {}
      const level = info.level || 'unknown'
      capabilityDist[name][level] = (capabilityDist[name][level] || 0) + 1
    }
  }

  // ── 时间线 ──
  const timelineStats = {
    totalDrafts: drafts.length,
    avgSteps: 0,
    confusionRate: 0,
    fallbackRate: drafts.filter(d => d.generation?.fallback).length / Math.max(drafts.length, 1)
  }
  let totalSteps = 0
  let totalConfusedSteps = 0
  let totalStepsAll = 0
  for (const d of drafts) {
    const steps = d.timeline?.steps || []
    totalSteps += steps.length
    for (const s of steps) {
      totalStepsAll++
      if (s.userConfusion) totalConfusedSteps++
    }
  }
  timelineStats.avgSteps = drafts.length > 0 ? totalSteps / drafts.length : 0
  timelineStats.confusionRate = totalStepsAll > 0 ? totalConfusedSteps / totalStepsAll : 0

  // ── 清偿会话（内存，当前进程） ──
  const sessions = Array.from(mvp1Sessions.values())
  const sessionStats = {
    total: sessions.length,
    ended: sessions.filter(s => s.state === 'ended').length,
    inProgress: sessions.filter(s => s.state !== 'ended').length,
    resultDist: {},
    avgAttempts: 0
  }
  let totalAttempts = 0
  for (const s of sessions) {
    totalAttempts += s.attempts?.length || 0
    if (s.finalResult?.status) {
      sessionStats.resultDist[s.finalResult.status] = (sessionStats.resultDist[s.finalResult.status] || 0) + 1
    }
  }
  sessionStats.avgAttempts = sessions.length > 0 ? totalAttempts / sessions.length : 0

  // ── 事件埋点统计 ──
  const pageEnterCounts = {}
  const pageLeaveDurations = {}
  for (const e of eventLog) {
    if (e.type === 'page_enter') {
      const screen = e.data?.screen || 'unknown'
      pageEnterCounts[screen] = (pageEnterCounts[screen] || 0) + 1
    }
    if (e.type === 'page_leave') {
      const screen = e.data?.screen || 'unknown'
      const dur = e.data?.durationMs || 0
      if (!pageLeaveDurations[screen]) pageLeaveDurations[screen] = []
      if (dur > 0) pageLeaveDurations[screen].push(dur)
    }
  }
  const dwellTime = {}
  for (const [screen, durs] of Object.entries(pageLeaveDurations)) {
    const avg = durs.reduce((a, b) => a + b, 0) / durs.length
    dwellTime[screen] = { avgMs: avg, count: durs.length }
  }

  // ── Spiral 指标（如有） ──
  let spiralMetrics = null
  try {
    if (spiralStore?.dashboard) {
      spiralMetrics = spiralStore.dashboard().metrics
    }
  } catch { /* */ }

  return {
    generatedAt: new Date().toISOString(),
    funnel,
    reportQuality: {
      total: reports.length,
      fallbackRate: reports.length > 0 ? fallbackCount / reports.length : 0,
      fallbackCount,
      statusDist,
      failStepDist,
      artifactTypeDist
    },
    capabilityDist,
    timelineStats,
    sessionStats,
    tracking: {
      pageEnterCounts,
      dwellTime
    },
    spiral: spiralMetrics,
    eventCount: eventLog.length
  }
}

// ── 路由挂载函数 ──

/**
 * 在 server.js 的请求处理里调用此函数。
 * @param {object} req - Node http IncomingMessage
 * @param {object} res - Node http ServerResponse
 * @param {string} pathname - url.pathname
 * @param {string} method - HTTP 方法
 * @param {object} deps - { mvp0Store, spiralStore, eventLog, mvp1Sessions, authStore, trainingStore }
 * @returns {boolean} true 表示已处理（应中断后续路由）
 */
export function handleAdminRoute(req, res, pathname, method, deps) {
  if (!pathname.startsWith('/api/admin/')) return false

  // 鉴权
  const adminToken = process.env.MINDIOU_ADMIN_TOKEN || process.env.LEARNING_API_TOKEN
  if (adminToken) {
    const auth = req.headers['authorization'] || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (token !== adminToken) {
      jsonResponse(res, 401, { ok: false, error: 'admin token required' })
      return true
    }
  }

  if (pathname === '/api/admin/stats' && method === 'GET') {
    const stats = computeAdminStats(
      deps.mvp0Store, deps.spiralStore, deps.eventLog, deps.mvp1Sessions
    )
    jsonResponse(res, 200, { ok: true, stats })
    return true
  }

  if (pathname === '/api/admin/events' && method === 'GET') {
    const limit = parseInt(new URL(req.url, 'http://x').searchParams.get('limit') || '200', 10)
    const events = deps.eventLog.slice(-limit)
    jsonResponse(res, 200, { ok: true, events })
    return true
  }

  // 用户注册情况 + 用户活跃度（结合 authStore + mvp0Store + trainingStore）
  if (pathname === '/api/admin/users' && method === 'GET') {
    if (!deps.authStore || !deps.authStore.listUsersWithStats) {
      jsonResponse(res, 503, { ok: false, error: 'authStore not available' })
      return true
    }
    const users = deps.authStore.listUsersWithStats()
    // 关联 mvp0Store 业务活动：按 userId 聚合报告数、草稿数、最近活动时间
    const allReports = deps.mvp0Store.listReports()
    const allDrafts = deps.mvp0Store.listDrafts()
    const byUser = new Map()
    for (const r of allReports) {
      const uid = r.userId || 'legacy'
      if (!byUser.has(uid)) byUser.set(uid, { reportCount: 0, draftCount: 0, lastActivityAt: null })
      const entry = byUser.get(uid)
      entry.reportCount += 1
      if (r.createdAt && r.createdAt > (entry.lastActivityAt || '')) entry.lastActivityAt = r.createdAt
    }
    for (const d of allDrafts) {
      const uid = d.userId || 'legacy'
      if (!byUser.has(uid)) byUser.set(uid, { reportCount: 0, draftCount: 0, lastActivityAt: null })
      const entry = byUser.get(uid)
      entry.draftCount += 1
      if (d.createdAt && d.createdAt > (entry.lastActivityAt || '')) entry.lastActivityAt = d.createdAt
    }
    // 关联 mvp1Store 清偿会话
    const mvp1Sessions = deps.mvp1Sessions && deps.mvp1Sessions.values ? Array.from(deps.mvp1Sessions.values()) : []
    const sessionsByUser = new Map()
    for (const s of mvp1Sessions) {
      const uid = s.userId || 'legacy'
      if (!sessionsByUser.has(uid)) sessionsByUser.set(uid, { sessionCount: 0, lastSessionAt: null })
      const entry = sessionsByUser.get(uid)
      entry.sessionCount += 1
      if (s.createdAt && s.createdAt > (entry.lastSessionAt || '')) entry.lastSessionAt = s.createdAt
      if (s.updatedAt && s.updatedAt > (entry.lastSessionAt || '')) entry.lastSessionAt = s.updatedAt
    }
    const usersWithActivity = users.map(u => {
      const act = byUser.get(u.id) || { reportCount: 0, draftCount: 0, lastActivityAt: null }
      const sess = sessionsByUser.get(u.id) || { sessionCount: 0, lastSessionAt: null }
      return {
        ...u,
        reportCount: act.reportCount,
        draftCount: act.draftCount,
        clearanceSessionCount: sess.sessionCount,
        lastActivityAt: act.lastActivityAt || sess.lastSessionAt || u.lastSessionAt
      }
    })
    jsonResponse(res, 200, { ok: true, users: usersWithActivity, total: usersWithActivity.length })
    return true
  }

  jsonResponse(res, 404, { ok: false, error: 'not found' })
  return true
}

// 简易 JSON 响应（与 server.js 现有 jsonResponse 行为对齐：含 CORS 与 cache-control）
function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization'
  })
  res.end(payload)
}
