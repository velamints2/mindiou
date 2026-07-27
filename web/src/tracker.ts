// 前端行为埋点
// 记录页面进入/离开与停留时长，发送到后端 POST /api/learn/events。
// 设计原则：不阻塞用户操作、失败静默、页面卸载用 sendBeacon 保证送达。
// 运营后台页面会调用 disableTracker() 避免污染用户数据。

import { API_BASE, getAccessToken } from './api'

// 单次页面会话标识（刷新即变）
const PAGE_SESSION = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const SESSION_START = Date.now()

let enabled = true
let currentScreen = ''
let screenEnterTime = 0

// 通用埋点发送
// 优先 fetch + keepalive：可带 Authorization 头，且页面卸载时也能送达（payload < 64KB）。
// 无 token 时（未登录访客）降级 sendBeacon：仅在后端未对 POST /api/learn/events 开启 requireToken 时有效；
// 若后端开启了鉴权，未登录访客的埋点会丢失 —— 见 ADMIN_SETUP.md「埋点鉴权」一节。
function send(type: string, data: Record<string, unknown>): void {
  if (!enabled) return
  const payload = { type, data: { ...data, pageSession: PAGE_SESSION, ts: Date.now() } }
  const url = `${API_BASE}/api/learn/events`
  const token = getAccessToken()
  const body = JSON.stringify(payload)

  try {
    if (token) {
      // 已登录：fetch + keepalive + Authorization 头
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      headers['Authorization'] = `Bearer ${token}`
      void fetch(url, { method: 'POST', headers, body, keepalive: true }).catch(() => { /* 静默 */ })
      return
    }
    // 未登录访客：只能用 sendBeacon（无法带鉴权头）
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))
      return
    }
    // sendBeacon 不可用时，尝试无鉴权 fetch（后端未开 requireToken 才会成功）
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => { /* 静默 */ })
  } catch {
    /* 静默 */
  }
}

// 记录进入某个页面
function trackScreenEnter(screen: string, context?: Record<string, unknown>): void {
  if (!enabled) return
  // 先结束上一个页面
  if (currentScreen && screenEnterTime) {
    trackScreenLeave(currentScreen)
  }
  currentScreen = screen
  screenEnterTime = Date.now()
  send('page_enter', { screen, ...context })
}

// 记录离开某个页面
function trackScreenLeave(screen: string): void {
  if (!enabled || !screenEnterTime) return
  const durationMs = Date.now() - screenEnterTime
  send('page_leave', { screen, durationMs })
  screenEnterTime = 0
}

// 初始化埋点监听
export function initTracker(): void {
  // 页面卸载时发送 leave + session 结束
  window.addEventListener('beforeunload', () => {
    if (currentScreen) trackScreenLeave(currentScreen)
    send('session_end', { durationMs: Date.now() - SESSION_START })
  })
  // 失去焦点时也记录（用户切走标签页）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && currentScreen && screenEnterTime) {
      send('screen_blur', { screen: currentScreen, durationMs: Date.now() - screenEnterTime })
    }
  })
}

// 路由切换时调用，记录当前页面
export function trackRoute(screen: string, context?: Record<string, unknown>): void {
  trackScreenEnter(screen, context)
}

// 自定义事件埋点
export function trackEvent(name: string, data?: Record<string, unknown>): void {
  send(name, data || {})
}

// 运营后台页面调用，关闭用户埋点
export function disableTracker(): void {
  enabled = false
}
