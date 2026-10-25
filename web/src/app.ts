// MindIOU 面向用户 Web 端 — 主入口
// 职责：路由分发 + 鉴权守卫 + 页面挂载。
// 公开区（landing/how-it-works）无需登录；产品区（app/report/session/login）需邀请码。
// 视觉样式见 styles.css（占位），由设计师 agent 重构。

import { checkAuthSession, setAccessToken } from './api'
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
  , renderEmailVerificationPage
} from './pages'
import { renderRepaymentDetailPage, renderRepaymentPage } from './repayment'
import { renderProfilePage } from './profile'
import { renderModuleDetailPage, renderOwnershipMapPage, renderProjectListPage as renderOwnershipProjectListPage } from './ownershipApp'
import { clear, el, navigate, parseRoute, type Route } from './router'
import { initTracker, trackRoute } from './tracker'
import { getLocale, observeTranslations, setLocale } from './i18n'
import { renderPersistentNavigation } from './navigation'
import { renderAssessmentPage } from './assessment'
import { renderChallengePage } from './challenge'
import { renderAgentSessionPage, renderProjectListPage, renderProjectPage, renderWorkItemPage } from './projectMemory'
import { renderCognitiveLoopPage, renderFluencyLoopPreviewPage } from './cognitiveLoop'
import { renderDigestPage } from './digest'
import { renderExp2Page } from './exp2'
import { renderExp1Page } from './exp1'
import { renderResearchPage } from './research'
import { ENABLE_COGNITIVE_LOOP } from './featureFlags'

const app = document.getElementById('app') as HTMLElement
observeTranslations(app)

function renderLanguageSwitch(route: Route): void {
  document.querySelector('.language-switch')?.remove()
  if (route.name === 'admin') return
  const publicRoute = route.name === 'landing' || route.name === 'how-it-works' || route.name === 'genesis' || route.name === 'fluency-loop-preview' || (route.name === 'cognitive-loop' && !ENABLE_COGNITIVE_LOOP)
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
  if (route.name === 'verify-email') {
    renderEmailVerificationPage(app, route.token, route.status)
    trackRoute('verify-email')
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
  if (route.name === 'fluency-loop-preview') {
    renderFluencyLoopPreviewPage(app)
    trackRoute('fluency-loop-preview')
    return
  }
  // Keep the old functional URL safe for bookmarks while the feature is in
  // internal testing. Production builds show the public preview instead of
  // exposing a runner that writes Loop activity.
  if (route.name === 'cognitive-loop' && !ENABLE_COGNITIVE_LOOP) {
    renderFluencyLoopPreviewPage(app)
    trackRoute('fluency-loop-preview')
    return
  }

  // 非公开路由始终以服务端 HttpOnly Cookie 为准。localStorage 里的标记
  // 只用于记住页面状态，不能绕过会话校验，否则 Cookie 过期后仍会进入
  // 工作区，并在生成时间线时收到误导性的 "Invalid token"。
  const hasServerSession = await checkAuthSession()
  if (!hasServerSession) {
    // 未登录：登录页直接渲染，其他路由跳登录
    if (route.name === 'login') {
      renderLoginPage(app)
      trackRoute('login')
    } else {
      navigate({ name: 'login' })
    }
    return
  }
  if (!hasServerSession.emailVerified) {
    navigate({ name: 'verify-email' })
    return
  }
  setAccessToken('server-session')

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
    case 'project-ownership':
      await renderOwnershipMapPage(app, route.projectId)
      trackRoute('project-ownership')
      return
    case 'project-ownership-module':
      await renderModuleDetailPage(app, route.projectId, route.moduleId)
      trackRoute('project-ownership-module')
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
    case 'profile':
      await renderProfilePage(app)
      trackRoute('profile')
      return
    case 'cognitive-loop':
      await renderCognitiveLoopPage(app)
      trackRoute('cognitive-loop')
      return
    case 'digest':
      await renderDigestPage(app)
      trackRoute('digest')
      return
    case 'exp2':
      await renderExp2Page(app)
      trackRoute('exp2')
      return
    case 'exp1':
      await renderExp1Page(app)
      trackRoute('exp1')
      return
    case 'research':
      await renderResearchPage(app)
      trackRoute('research')
      return
    case 'projects':
      await renderProjectListPage(app)
      trackRoute('projects')
      return
    case 'project':
      await renderProjectPage(app, route.projectId)
      trackRoute('project')
      return
    case 'work-item':
      await renderWorkItemPage(app, route.projectId, route.workItemId)
      trackRoute('work-item')
      return
    case 'agent-session':
      await renderAgentSessionPage(app, route.sessionId)
      trackRoute('agent-session')
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
