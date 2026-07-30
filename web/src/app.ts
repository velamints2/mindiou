// MindIOU 面向用户 Web 端 — 主入口
// 职责：路由分发 + 鉴权守卫 + 页面挂载。
// 公开区（landing/how-it-works）无需登录；产品区（app/report/session/login）需邀请码。
// 视觉样式见 styles.css（占位），由设计师 agent 重构。

import { checkAuthSession, getAccessToken, setAccessToken } from './api'
import { renderHowItWorksPage, renderLandingPage } from './marketing'
import {
  renderAppPage,
  renderDevicesPage,
  renderLoginPage,
  renderRegisterPage,
  renderReportPage,
  renderSessionPage,
  renderTimelinePage,
  renderTrainingDebtDetailPage,
  renderTrainingDebtListPage,
  renderTrainingPage
} from './pages'
import { renderRepaymentDetailPage, renderRepaymentPage } from './repayment'
import { clear, el, navigate, parseRoute, type Route } from './router'
import { initTracker, trackRoute } from './tracker'

const app = document.getElementById('app') as HTMLElement

async function render(route: Route): Promise<void> {
  clear(app)

  // 运营后台：独立鉴权，不走邀请码
  if (route.name === 'admin') {
    const admin = await import('./admin')
    if (localStorage.getItem('mindiou_admin_token')) {
      await admin.renderAdminDashboard(app)
    } else {
      admin.renderAdminLogin(app)
    }
    return
  }

  // 公开路由：直接渲染，无需登录
  if (route.name === 'landing') {
    renderLandingPage(app)
    trackRoute('landing')
    return
  }
  if (route.name === 'how-it-works') {
    renderHowItWorksPage(app)
    trackRoute('how-it-works')
    return
  }

  // 注册页：公开路由，未登录可访问
  if (route.name === 'register') {
    renderRegisterPage(app)
    trackRoute('register')
    return
  }

  // 非公开路由需要服务端会话。刷新后本地标记丢失时，以 HttpOnly Cookie 为准恢复。
  if (!getAccessToken()) {
    const hasServerSession = await checkAuthSession()
    if (hasServerSession) {
      setAccessToken('server-session')
    }
  }

  if (!getAccessToken()) {
    // 未登录：登录页直接渲染，其他路由跳登录
    if (route.name === 'login') {
      renderLoginPage(app)
      trackRoute('login')
    } else {
      navigate({ name: 'login' })
    }
    return
  }

  // 已登录用户访问登录页 → 跳工作区
  if (route.name === 'login') {
    navigate({ name: 'app' })
    return
  }

  switch (route.name) {
    case 'app':
      renderAppPage(app)
      trackRoute('app')
      return
    case 'timeline':
      await renderTimelinePage(app, route.draftId)
      trackRoute('timeline')
      return
    case 'devices':
      await renderDevicesPage(app)
      trackRoute('devices')
      return
    case 'report':
      await renderReportPage(app, route.reportId)
      trackRoute('report')
      return
    case 'session':
      await renderSessionPage(app, route.sessionId)
      trackRoute('session')
      return
    case 'training':
      await renderTrainingPage(app)
      trackRoute('training')
      return
    case 'training-debt':
      if (route.debtId === 'list') {
        await renderTrainingDebtListPage(app)
      } else {
        await renderTrainingDebtDetailPage(app, route.debtId)
      }
      trackRoute('training')
      return
    case 'repayment':
      await renderRepaymentPage(app)
      trackRoute('repayment')
      return
    case 'repayment-detail':
      await renderRepaymentDetailPage(app, route.gapId)
      trackRoute('repayment')
      return
    case 'not-found':
    default:
      renderNotFoundPage(app)
      return
  }
}

function renderNotFoundPage(root: HTMLElement): void {
  const page = el('div', 'page page-not-found')
  page.appendChild(el('h1', 'not-found-title', '页面不存在'))
  page.appendChild(el('p', 'not-found-desc', '你访问的页面可能已被移除或链接有误。'))
  const btn = el('button', 'btn btn-primary', '返回首页')
  btn.onclick = () => navigate({ name: 'landing' })
  page.appendChild(btn)
  root.appendChild(page)
}

async function boot(): Promise<void> {
  initTracker()
  window.addEventListener('hashchange', () => {
    void render(parseRoute())
  })
  await render(parseRoute())
}

void boot()
