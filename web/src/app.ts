// MindIOU 面向用户 Web 端 — 主入口
// 职责：路由分发 + 鉴权守卫 + 页面挂载。
// 公开区（landing/how-it-works）无需登录；产品区（app/report/session/login）需邀请码。
// 视觉样式见 styles.css（占位），由设计师 agent 重构。

import { checkAuthSession, getAccessToken, setAccessToken } from './api'
import { renderHowItWorksPage, renderLandingPage } from './marketing'
import {
  renderAppPage,
  renderDevicesPage,
  renderGenesisPage,
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
import { getLocale, observeTranslations, setLocale } from './i18n'
import { renderPersistentNavigation } from './navigation'
import { renderAssessmentPage } from './assessment'
import { renderChallengePage } from './challenge'

const app = document.getElementById('app') as HTMLElement
observeTranslations(app)

function renderLanguageSwitch(route: Route): void {
  document.querySelector('.language-switch')?.remove()
  if (route.name === 'admin') return
  const publicRoute = route.name === 'landing' || route.name === 'how-it-works' || route.name === 'genesis'
  const wrap = el('div', `language-switch${publicRoute ? ' language-switch-public' : ''}`)
  wrap.setAttribute('aria-label', 'Language')
  const zh = el('button', `language-switch-option ${getLocale() === 'zh-CN' ? 'is-active' : ''}`, '中文')
  const en = el('button', `language-switch-option ${getLocale() === 'en' ? 'is-active' : ''}`, 'English')
  const choose = (locale: 'zh-CN' | 'en') => {
    setLocale(locale)
    const url = new URL(location.href)
    if (locale === 'en') url.searchParams.set('lang', 'en')
    else url.searchParams.delete('lang')
    location.href = url.toString()
  }
  zh.onclick = () => choose('zh-CN')
  en.onclick = () => choose('en')
  wrap.append(zh, en)
  document.body.appendChild(wrap)
}

async function render(route: Route): Promise<void> {
  clear(app)
  renderLanguageSwitch(route)
  renderPersistentNavigation(route)

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
  if (route.name === 'genesis') {
    await renderGenesisPage(app)
    trackRoute('genesis')
    return
  }
  if (route.name === 'assessment') {
    renderAssessmentPage(app)
    trackRoute('assessment')
    return
  }
  if (route.name === 'challenge') {
    renderChallengePage(app)
    trackRoute('challenge')
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
      await renderAppPage(app)
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
