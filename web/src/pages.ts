// MindIOU 面向用户 Web 端 — 页面渲染
// 结构化 HTML 语义节点 + 占位 className，视觉设计留给设计师 agent。
// 核心闭环：登录 → 输入材料 → 报告 → 选卡 → 清偿会话 → 结果

import {
  ApiError,
  checkAuthSession,
  checkHealth,
  createDeviceToken,
  createSession,
  endSession,
  fetchCurrentUser,
  fetchDashboard,
  fetchDraft,
  fetchGenesis,
  fetchReport,
  fetchSession,
  fetchTodayTraining,
  fetchTrainingDebtDetail,
  fetchTrainingDebts,
  generateReport,
  generateTimeline,
  getAccessToken,
  getRepaymentProfile,
  listDeviceTokens,
  login,
  logoutAuth,
  register,
  revokeDeviceToken,
  saveDraftConfusions,
  setAccessToken,
  startReviewTask,
  submitAnswer,
  submitReviewAnswer,
  updateGenesisIdentity
} from './api'
import type { DeviceTokenInfo, GenesisIdentity } from './api'
import { renderSiteFooter } from './navigation'
import { isEnglish, t } from './i18n'
import type {
  ClearanceReport,
  ClearanceSession,
  Confusion,
  ConfusionResolution,
  Draft,
  FeynmanCard,
  RepaymentProfile,
  ReviewTask,
  SubmitReviewResponse,
  TimelineStep
} from './types'
import {
  clear,
  el,
  forgetSessionId,
  navigate,
  recallDraftId,
  recallReportId,
  recallSessionId,
  rememberDraftId,
  rememberReportId,
  rememberSessionId
} from './router'

/** 固定演示样本：服务器事故排查的 AI 辅助记录。
 *  配合 SPIRAL_DISABLE_AI=1 可稳定复现完整清偿链路。 */
const DEMO_SAMPLE_TEXT = `用户：线上服务器突然响应变慢，top 看到 load average 飙到 40+，很多进程卡在 D 状态。
iostat 显示 %iowait 超过 60%。我让 AI 帮我排查。

AI：根据你描述的症状（高 load、D 状态进程、高 iowait），这通常是磁盘 I/O 瓶颈。
建议检查：
1. dmesg 是否有磁盘错误
2. iotop 找出 I/O 最大的进程
3. 检查是否有大量 swap 导致 thrashing

用户：dmesg 没有磁盘错误。iotop 显示 nginx worker 进程在大量写日志。
我直接重启了 nginx，负载暂时降下来了。

AI：重启 nginx 只是缓解了症状。根因可能是：
1. 日志写入没有异步化
2. 磁盘本身性能不足
3. 日志级别设置过低导致写入量过大
建议长期修复：启用日志缓冲、升级磁盘、或将日志写入远程日志服务。

用户：好的，我先把日志级别调高，重启后负载正常了。
但我不确定根因是否真的修复了，因为只是减少了写入量而不是解决了 I/O 瓶颈。`

const DEMO_SAMPLE_TEXT_EN = `User: Our production server suddenly became slow. The load average exceeded 40, many processes were stuck in D state, and iowait was above 60%. I asked AI to investigate.

AI: Those symptoms usually indicate a disk I/O bottleneck. Check kernel disk errors, identify the heaviest writers with iotop, and rule out swap thrashing.

User: There were no disk errors. iotop showed nginx workers writing a large volume of logs. I restarted nginx and the load dropped temporarily.

AI: Restarting nginx treated the symptom. Possible causes include synchronous logging, insufficient disk performance, or an excessively verbose log level. Consider buffering logs, improving storage, or shipping logs remotely.

User: I raised the log level and the load returned to normal, but I am not sure the root cause is fixed because I reduced writes rather than proving the I/O bottleneck was removed.`

// ── 通用组件 ──

function loading(message: string): HTMLElement {
  return el('div', 'loading', message)
}

function errorBox(message: string): HTMLElement {
  return el('div', 'error-box', message)
}

function spinnerOverlay(label: string): HTMLElement {
  const box = el('div', 'spinner-overlay')
  box.appendChild(el('div', 'spinner'))
  box.appendChild(el('p', 'spinner-label', label))
  return box
}

function connectionStatusBadge(): HTMLElement {
  const badge = el('div', 'connection-pill is-checking')
  badge.appendChild(el('span', 'connection-dot'))
  const label = el('span', 'connection-label', '正在连接')
  badge.appendChild(label)
  void checkHealth().then(ok => {
    badge.classList.remove('is-checking')
    badge.classList.add(ok ? 'is-online' : 'is-offline')
    label.textContent = ok ? 'AI 服务已连接' : '服务未连接'
  })
  return badge
}

// 三步进度指示（1 输入 → 2 时间线与困惑 → 3 报告）
function stepIndicator(active: 1 | 2 | 3): HTMLElement {
  const wrap = el('div', 'step-indicator')
  const steps = [
    { n: 1, label: '输入材料' },
    { n: 2, label: '时间线与困惑' },
    { n: 3, label: '认知债务报告' }
  ]
  for (const s of steps) {
    const item = el('div', `step-dot ${s.n === active ? 'is-active' : ''} ${s.n < active ? 'is-done' : ''}`)
    item.appendChild(el('span', 'step-dot-num', String(s.n)))
    item.appendChild(el('span', 'step-dot-label', s.label))
    wrap.appendChild(item)
  }
  return wrap
}

// 能力画像卡片：按领域展示五维能力得分
const PROFILE_DOMAIN_LABELS: Record<string, string> = {
  'web-development': 'Web 开发',
  'system-architecture': '系统架构',
  general: '通用领域'
}
const PROFILE_DIMENSION_LABELS: Record<string, string> = {
  conceptualUnderstanding: '概念理解',
  causalExplanation: '因果解释',
  practicalReproduction: '实践复现',
  boundariesAndRisks: '边界与风险',
  transferAbility: '迁移能力'
}

function renderCapabilityProfileCard(profile: RepaymentProfile): HTMLElement {
  const card = el('article', 'profile-card')
  const head = el('div', 'profile-card-head')
  head.appendChild(el('strong', 'profile-card-domain', PROFILE_DOMAIN_LABELS[profile.domain] || profile.domain))
  head.appendChild(el('span', 'profile-card-updated', `更新于 ${new Date(profile.updatedAt).toLocaleDateString('zh-CN')}`))
  card.appendChild(head)
  const dims = el('div', 'profile-dims')
  for (const [key, label] of Object.entries(PROFILE_DIMENSION_LABELS)) {
    const dim = profile.dimensions?.[key]
    if (!dim) continue
    const row = el('div', 'profile-dim-row')
    row.appendChild(el('span', 'profile-dim-label', label))
    const meter = el('div', 'profile-dim-meter')
    const fill = el('div', 'profile-dim-fill')
    fill.style.width = `${Math.max(0, Math.min(100, dim.score))}%`
    meter.appendChild(fill)
    row.appendChild(meter)
    row.appendChild(el('span', 'profile-dim-score', `${dim.score} · ${dim.level}`))
    dims.appendChild(row)
  }
  card.appendChild(dims)
  card.appendChild(el('p', 'profile-card-note', '随每次清偿与复训持续更新，反映系统对你的长期了解。'))
  return card
}

// ── 登录页 ──

export function renderLoginPage(root: HTMLElement): void {
  const page = el('div', 'page page-login')
  page.appendChild(el('h1', 'brand-title', '登录 MindIOU'))
  page.appendChild(el('p', 'brand-subtitle', '把 AI 代劳转化为真实能力成长'))

  const card = el('div', 'login-card')
  card.appendChild(el('h2', 'login-heading', '账户登录'))
  card.appendChild(el('p', 'login-desc', '用邮箱和密码登录你的账户'))

  const form = el('form', 'login-form') as HTMLFormElement

  const emailInput = el('input', 'login-input') as HTMLInputElement
  emailInput.type = 'email'
  emailInput.placeholder = '邮箱'
  emailInput.required = true
  emailInput.autocomplete = 'email'
  form.appendChild(emailInput)

  const passwordInput = el('input', 'login-input') as HTMLInputElement
  passwordInput.type = 'password'
  passwordInput.placeholder = '密码'
  passwordInput.required = true
  passwordInput.autocomplete = 'current-password'
  form.appendChild(passwordInput)

  const status = el('p', 'login-status')
  form.appendChild(status)

  const submit = el('button', 'btn btn-primary', '登录') as HTMLButtonElement
  submit.type = 'submit'
  form.appendChild(submit)

  form.onsubmit = async (e) => {
    e.preventDefault()
    const email = emailInput.value.trim()
    const password = passwordInput.value
    if (!email || !password) {
      status.textContent = '请输入邮箱和密码'
      return
    }
    submit.disabled = true
    status.textContent = '登录中…'
    try {
      await login(email, password)
      // setAccessToken 已在 login 内完成
      status.textContent = ''
      navigate({ name: 'app' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        status.textContent = '邮箱或密码不正确'
      } else {
        status.textContent = err instanceof Error ? err.message : '登录失败，请稍后重试'
      }
    } finally {
      submit.disabled = false
    }
  }
  card.appendChild(form)

  const footer = el('p', 'login-footer')
  const registerLink = el('a', 'login-link', '还没有账户？注册') as HTMLAnchorElement
  registerLink.href = '#/register'
  footer.appendChild(registerLink)
  card.appendChild(footer)

  page.appendChild(card)
  root.appendChild(page)
}

// ── 注册页 ──

export function renderRegisterPage(root: HTMLElement): void {
  const page = el('div', 'page page-register')
  page.appendChild(el('h1', 'brand-title', '创建 MindIOU 账户'))
  page.appendChild(el('p', 'brand-subtitle', '把 AI 代劳转化为真实能力成长'))

  const card = el('div', 'login-card')
  card.appendChild(el('h2', 'login-heading', '创建账户'))
  card.appendChild(el('p', 'login-desc', '填写邮箱和密码创建你的 MindIOU 账户'))
  const genesisNotice = el('aside', 'genesis-register-notice')
  genesisNotice.appendChild(el('strong', undefined, t('首发体验者 001 期', 'Genesis Cohort 001')))
  genesisNotice.appendChild(el('p', undefined, t(
    '注册后将预留候选编号；完成首次真实分析后计入正式参与。永久身份是否公开展示，始终由你决定。',
    'Registration reserves a candidate ID. Your first real analysis makes you an official participant. Whether your permanent identity is public is always your choice.'
  )))
  card.appendChild(genesisNotice)

  const form = el('form', 'login-form') as HTMLFormElement

  const emailInput = el('input', 'login-input') as HTMLInputElement
  emailInput.type = 'email'
  emailInput.placeholder = '邮箱'
  emailInput.required = true
  emailInput.autocomplete = 'email'
  form.appendChild(emailInput)

  const passwordInput = el('input', 'login-input') as HTMLInputElement
  passwordInput.type = 'password'
  passwordInput.placeholder = '密码（至少 8 位）'
  passwordInput.required = true
  passwordInput.autocomplete = 'new-password'
  form.appendChild(passwordInput)

  const confirmInput = el('input', 'login-input') as HTMLInputElement
  confirmInput.type = 'password'
  confirmInput.placeholder = '确认密码'
  confirmInput.required = true
  confirmInput.autocomplete = 'new-password'
  form.appendChild(confirmInput)

  const nameInput = el('input', 'login-input') as HTMLInputElement
  nameInput.type = 'text'
  nameInput.placeholder = '昵称（可选）'
  nameInput.autocomplete = 'name'
  form.appendChild(nameInput)

  const status = el('p', 'login-status')
  form.appendChild(status)

  const submit = el('button', 'btn btn-primary', '创建账户') as HTMLButtonElement
  submit.type = 'submit'
  form.appendChild(submit)

  form.onsubmit = async (e) => {
    e.preventDefault()
    const email = emailInput.value.trim()
    const password = passwordInput.value
    const confirm = confirmInput.value
    const name = nameInput.value.trim()
    if (!email) {
      status.textContent = '请输入邮箱'
      return
    }
    if (password.length < 8) {
      status.textContent = '密码至少需要 8 位'
      return
    }
    if (password !== confirm) {
      status.textContent = '两次输入的密码不一致'
      return
    }
    submit.disabled = true
    status.textContent = '创建中…'
    try {
      await register(email, password, name || undefined)
      status.textContent = ''
      navigate({ name: 'app' })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        status.textContent = '该邮箱已注册'
      } else {
        status.textContent = err instanceof Error ? err.message : '注册失败，请稍后重试'
      }
    } finally {
      submit.disabled = false
    }
  }
  card.appendChild(form)

  const footer = el('p', 'login-footer')
  const loginLink = el('a', 'login-link', '已有账户？登录') as HTMLAnchorElement
  loginLink.href = '#/login'
  footer.appendChild(loginLink)
  card.appendChild(footer)

  page.appendChild(card)
  root.appendChild(page)
}

// ── 产品页：输入材料 ──

export async function renderAppPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-app')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', 'MindIOU'))
  const headerActions = el('div', 'header-actions')
  headerActions.appendChild(connectionStatusBadge())
  const accountSpan = el('span', 'header-account', '我的账户')
  void fetchCurrentUser().then(user => {
    if (user) accountSpan.textContent = user.email
  })
  headerActions.appendChild(accountSpan)
  const trainingBtn = el('button', 'btn btn-ghost btn-sm', '今日复训')
  trainingBtn.onclick = () => navigate({ name: 'training' })
  headerActions.appendChild(trainingBtn)
  const repaymentBtn = el('button', 'btn btn-ghost btn-sm', '认知清偿')
  repaymentBtn.onclick = () => navigate({ name: 'repayment' })
  headerActions.appendChild(repaymentBtn)
  const devicesBtn = el('button', 'btn btn-ghost btn-sm', '设备Token')
  devicesBtn.onclick = () => navigate({ name: 'devices' })
  headerActions.appendChild(devicesBtn)
  const ownershipBtn = el('button', 'btn btn-ghost btn-sm', '项目所有权')
  ownershipBtn.onclick = () => navigate({ name: 'projects' })
  headerActions.appendChild(ownershipBtn)
  const logout = el('button', 'btn btn-ghost btn-sm', '退出登录')
  logout.onclick = async () => {
    await logoutAuth()
    navigate({ name: 'landing' })
  }
  headerActions.appendChild(logout)
  header.appendChild(headerActions)
  page.appendChild(header)

  const dashboard = el('section', 'dashboard-shell')
  dashboard.appendChild(el('p', 'dashboard-kicker', t('我的认知仪表盘', 'My cognitive dashboard')))
  const dashboardBody = el('div', 'dashboard-body')
  dashboardBody.appendChild(loading(t('正在加载你的认知账户…', 'Loading your cognitive account…')))
  dashboard.appendChild(dashboardBody)
  page.appendChild(dashboard)
  root.appendChild(page)

  try {
    const response = await fetchDashboard()
    const data = response.dashboard
    clear(dashboardBody)
    const metrics = el('div', 'dashboard-metrics')
    const reportMetric = el('article', 'dashboard-metric')
    reportMetric.appendChild(el('strong', 'dashboard-metric-value', String(data.reportCount)))
    reportMetric.appendChild(el('span', 'dashboard-metric-label', t('已生成报告', 'Reports created')))
    metrics.appendChild(reportMetric)
    const debtMetric = el('article', 'dashboard-metric dashboard-metric-accent')
    debtMetric.appendChild(el('strong', 'dashboard-metric-value', String(data.outstandingDebts.length)))
    debtMetric.appendChild(el('span', 'dashboard-metric-label', t('尚未清偿', 'Outstanding debts')))
    metrics.appendChild(debtMetric)
    const repaidMetric = el('article', 'dashboard-metric')
    repaidMetric.appendChild(el('strong', 'dashboard-metric-value', String(data.repaidCount ?? 0)))
    repaidMetric.appendChild(el('span', 'dashboard-metric-label', t('已清偿', 'Repaid')))
    metrics.appendChild(repaidMetric)
    dashboardBody.appendChild(metrics)

    const grid = el('div', 'dashboard-grid')
    const latestReport = el('article', 'dashboard-card')
    latestReport.appendChild(el('p', 'dashboard-card-label', t('最近一份报告', 'Latest report')))
    if (data.latestReport) {
      const reportTitle = data.latestReport.display?.title || data.latestReport.analysis?.artifactTitle || t('认知债务报告', 'Cognitive debt report')
      latestReport.appendChild(el('h3', 'dashboard-card-title', reportTitle))
      if (data.latestReport.display?.domain) latestReport.appendChild(el('p', 'dashboard-card-domain', data.latestReport.display.domain))
      const reportGap = data.latestReport.sections.dangerousGaps?.[0]?.title || data.latestReport.sections.dangerousGaps?.[0]?.gap
      if (reportGap) latestReport.appendChild(el('p', 'dashboard-card-summary', `${t('主要欠条', 'Key debt')}: ${reportGap}`))
      latestReport.appendChild(el('p', 'dashboard-card-meta', `${t('生成于', 'Created')} ${new Date(data.latestReport.createdAt).toLocaleString(isEnglish() ? 'en' : 'zh-CN')}`))
      const view = el('button', 'btn btn-ghost btn-sm', t('查看报告', 'View report'))
      view.onclick = () => navigate({ name: 'report', reportId: data.latestReport!.id })
      latestReport.appendChild(view)
    } else latestReport.appendChild(el('p', 'dashboard-empty', t('暂无报告', 'No reports yet')))
    grid.appendChild(latestReport)

    const latestSession = el('article', 'dashboard-card')
    latestSession.appendChild(el('p', 'dashboard-card-label', t('最近一次清偿', 'Latest repayment')))
    if (data.latestSession) {
      if (data.latestSession.reportDisplay?.title) latestSession.appendChild(el('p', 'dashboard-card-parent', `${t('所属报告', 'From report')}: ${data.latestSession.reportDisplay.title}`))
      latestSession.appendChild(el('h3', 'dashboard-card-title', data.latestSession.cardTitle || data.latestSession.originalCard?.target || data.latestSession.clearanceQuestion || t('认知清偿', 'Cognitive repayment')))
      latestSession.appendChild(el('span', 'dashboard-status', data.latestSession.state === 'ended' ? t('已结束', 'Completed') : t('进行中', 'In progress')))
      const activityAt = data.latestSession.lastActivityAt || data.latestSession.updatedAt || data.latestSession.endedAt || data.latestSession.createdAt
      latestSession.appendChild(el('p', 'dashboard-card-meta', `${t('最后活动', 'Last activity')} ${new Date(activityAt).toLocaleString(isEnglish() ? 'en' : 'zh-CN')}`))
      const sessionAction = el('button', 'btn btn-ghost btn-sm', data.latestSession.state === 'ended' ? t('查看会话记录', 'View session') : t('继续清偿', 'Continue repayment'))
      sessionAction.onclick = () => navigate({ name: 'session', sessionId: data.latestSession!.id })
      latestSession.appendChild(sessionAction)
    } else latestSession.appendChild(el('p', 'dashboard-empty', t('暂无清偿会话', 'No clearance sessions yet')))
    grid.appendChild(latestSession)
    dashboardBody.appendChild(grid)

    const debts = el('section', 'dashboard-debts')
    debts.appendChild(el('h3', 'dashboard-section-title', t('尚未清偿的认知欠条', 'Outstanding cognitive debts')))
    if (data.outstandingDebts.length) {
      const list = el('div', 'dashboard-debt-list')
      data.outstandingDebts.slice(0, 5).forEach(debt => {
        const item = el('article', 'dashboard-debt-item')
        item.appendChild(el('span', 'dashboard-debt-title', debt.title))
        const action = el('button', 'btn btn-ghost btn-sm', t('继续清偿', 'Continue repayment'))
        action.onclick = async () => {
          const created = await createSession(debt.reportId, debt.cardId)
          navigate({ name: 'session', sessionId: created.session.id })
        }
        item.appendChild(action)
        list.appendChild(item)
      })
      debts.appendChild(list)
    } else debts.appendChild(el('p', 'dashboard-empty', t('暂无待清偿欠条', 'No outstanding debts')))
    dashboardBody.appendChild(debts)

    if (data.continuable) {
      const continuation = el('section', 'dashboard-continuation')
      continuation.appendChild(el('div', 'dashboard-continuation-copy', `${t('可以继续', 'Continue where you left off')}: ${data.continuable.title}`))
      const continueBtn = el('button', 'btn btn-primary btn-sm', t('继续清偿', 'Continue repayment'))
      continueBtn.onclick = () => navigate({ name: 'session', sessionId: data.continuable!.sessionId })
      continuation.appendChild(continueBtn)
      dashboardBody.appendChild(continuation)
    }

    // 能力画像：随清偿与复训积累，展示系统对用户的长期了解
    const profileSection = el('section', 'dashboard-profile')
    profileSection.appendChild(el('h3', 'dashboard-section-title', t('我的能力画像', 'My capability profile')))
    const profileBody = el('div', 'dashboard-profile-body')
    profileBody.appendChild(loading(t('正在加载能力画像…', 'Loading capability profile…')))
    profileSection.appendChild(profileBody)
    dashboardBody.appendChild(profileSection)
    void getRepaymentProfile().then(res => {
      clear(profileBody)
      const profiles = res.ok ? res.profiles || [] : []
      if (!profiles.length) {
        profileBody.appendChild(el('p', 'dashboard-empty', t(
          '完成几次清偿作答后，这里会逐渐形成你的长期能力画像。',
          'After a few repayment attempts, your long-term capability profile will form here.'
        )))
        return
      }
      for (const profile of profiles) {
        profileBody.appendChild(renderCapabilityProfileCard(profile))
      }
    }).catch(() => {
      clear(profileBody)
      profileBody.appendChild(el('p', 'dashboard-empty', t('能力画像加载失败', 'Could not load capability profile')))
    })
  } catch {
    clear(dashboardBody)
    dashboardBody.appendChild(errorBox(t('加载失败，请重试', 'Could not load your dashboard. Try again.')))
  }

  const intro = el('section', 'app-intro')
  intro.appendChild(el('p', 'dashboard-kicker', t('开始新的分析', 'Start a new analysis')))
  intro.appendChild(el('h2', 'app-heading', '识别你跳过的认知债务'))
  intro.appendChild(el('p', 'app-desc', '粘贴一段你用 AI 辅助完成的工作材料。MindIOU 会分析哪些理解过程被 AI 代劳了，并生成一份认知债务报告。'))
  page.appendChild(intro)

  // 会得到什么说明（预期管理）
  const expect = el('section', 'app-expect')
  expect.appendChild(el('h3', 'expect-heading', '接下来会经历什么'))
  const expectList = el('ul', 'expect-list')
  expectList.appendChild(el('li', 'expect-item', 'AI 把你的材料拆成协作步骤'))
  expectList.appendChild(el('li', 'expect-item', '你在每一步上标注「我哪里没看懂」'))
  expectList.appendChild(el('li', 'expect-item', '基于你的困惑生成认知债务报告'))
  expect.appendChild(expectList)
  page.appendChild(expect)

  // 三步进度指示
  page.appendChild(stepIndicator(1))

  const form = el('form', 'input-form') as HTMLFormElement

  // 演示样本按钮：一键填入固定文本，配合 SPIRAL_DISABLE_AI=1 可稳定复现
  const demoBar = el('div', 'demo-bar')
  const demoBtn = el('button', 'btn-demo-sample', '使用演示样本（服务器事故排查）')
  demoBtn.type = 'button'
  demoBtn.onclick = () => {
    textarea.value = isEnglish() ? DEMO_SAMPLE_TEXT_EN : DEMO_SAMPLE_TEXT
    textarea.dispatchEvent(new Event('input'))
  }
  demoBar.appendChild(demoBtn)
  form.appendChild(demoBar)

  const textarea = el('textarea', 'artifact-input') as HTMLTextAreaElement
  textarea.placeholder = t(
    '粘贴 ChatGPT/Claude 对话、AI 生成的方案、黑客松记录、会议纪要…',
    'Paste a ChatGPT/Claude conversation, AI-generated plan, hackathon log, or meeting notes…'
  )
  form.appendChild(textarea)
  const assessmentMaterial = sessionStorage.getItem('mindiou_assessment_activation')
  if (assessmentMaterial) {
    try {
      const activation = JSON.parse(assessmentMaterial) as { material?: string; selectedText?: string; understanding?: string }
      textarea.value = activation.material || ''
      if (activation.selectedText || activation.understanding) {
        textarea.dataset.assessmentSelectedText = activation.selectedText || ''
        textarea.dataset.assessmentUnderstanding = activation.understanding || ''
      }
    } catch {
      textarea.value = assessmentMaterial
    }
    sessionStorage.removeItem('mindiou_assessment_activation')
  }

  // 字数计数
  const counter = el('p', 'input-counter', '0 / 30,000')
  form.appendChild(counter)

  const limits = el('div', 'input-limits')
  limits.appendChild(el('p', 'input-limit-title', t('首期导入限制', 'Launch limits')))
  const limitList = el('ul', 'input-limit-list')
  limitList.appendChild(el('li', '', t('仅支持粘贴纯文本，最多 30,000 字符；暂不支持文件上传。', 'Paste plain text only, up to 30,000 characters. File upload is not supported yet.')))
  limitList.appendChild(el('li', '', t('超长内容请分段导入，或先摘要后再粘贴。', 'For longer content, import it in sections or summarize it first.')))
  limitList.appendChild(el('li', '', t('每位用户每天最多进行 3 次新分析。', 'Each user can start up to 3 new analyses per day.')))
  limits.appendChild(limitList)
  form.appendChild(limits)

  const hint = el('p', 'input-hint', t(
    '公开体验环境：请勿粘贴密码、密钥或客户隐私。',
    'Public preview: do not paste passwords, secrets, or customer data.'
  ))
  form.appendChild(hint)

  const actions = el('div', 'form-actions')
  const submit = el('button', 'btn btn-primary', '生成认知债务报告') as HTMLButtonElement
  submit.type = 'submit'
  submit.disabled = true
  actions.appendChild(submit)
  form.appendChild(actions)

  const status = el('p', 'form-status')
  form.appendChild(status)

  textarea.oninput = () => {
    const len = textarea.value.length
    counter.textContent = `${len.toLocaleString()} / 30,000`
    counter.classList.toggle('is-warn', len > 27000 && len <= 30000)
    counter.classList.toggle('is-error', len > 30000)
    if (len > 30000) {
      status.dataset.inputLimit = 'true'
      status.textContent = t(
        '文本超过 30,000 字符，请分段导入或先摘要后再分析。',
        'Text exceeds 30,000 characters. Split it into sections or summarize it first.'
      )
    } else if (status.dataset.inputLimit === 'true') {
      status.textContent = ''
      delete status.dataset.inputLimit
    }
    submit.disabled = textarea.value.trim().length < 10 || len > 30000
  }
  if (assessmentMaterial) textarea.dispatchEvent(new Event('input'))

  const rejectFiles = (event: DragEvent | ClipboardEvent) => {
    const files = event instanceof DragEvent ? event.dataTransfer?.files : event.clipboardData?.files
    if (!files?.length) return
    event.preventDefault()
    status.dataset.inputLimit = 'true'
    status.textContent = t(
      '当前仅支持粘贴纯文本，暂不支持文件上传。请打开文件并复制其中的文字。',
      'Only pasted plain text is supported right now. Open the file and copy its text instead.'
    )
  }
  textarea.ondrop = rejectFiles
  textarea.onpaste = rejectFiles

  form.onsubmit = async (e) => {
    e.preventDefault()
    const text = textarea.value.trim()
    if (text.length < 10) return
    if (text.length > 30000) {
      status.dataset.inputLimit = 'true'
      status.textContent = t(
        '文本超过 30,000 字符，请分段导入或先摘要后再分析。',
        'Text exceeds 30,000 characters. Split it into sections or summarize it first.'
      )
      return
    }
    submit.disabled = true
    status.textContent = ''
    const overlay = spinnerOverlay('AI 正在拆解你的协作步骤，通常需要 15-30 秒…')
    page.appendChild(overlay)
    try {
      const res = await generateTimeline(text)
      rememberDraftId(res.draft.id)
      navigate({ name: 'timeline', draftId: res.draft.id })
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : '拆解失败，请重试'
      submit.disabled = false
    } finally {
      overlay.remove()
    }
  }

  page.appendChild(form)
}

// ── 时间线与困惑标注页（三段式·第二段） ──

export async function renderTimelinePage(root: HTMLElement, draftId: string): Promise<void> {
  const page = el('div', 'page page-timeline')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', 'MindIOU'))
  const headerActions = el('div', 'header-actions')
  headerActions.appendChild(connectionStatusBadge())
  const logout = el('button', 'btn btn-ghost btn-sm', '退出登录')
  logout.onclick = async () => { await logoutAuth(); navigate({ name: 'landing' }) }
  headerActions.appendChild(logout)
  header.appendChild(headerActions)
  page.appendChild(header)

  page.appendChild(stepIndicator(2))

  const intro = el('section', 'timeline-intro')
  intro.appendChild(el('h2', 'timeline-heading', '看看 AI 帮你做了什么'))
  intro.appendChild(el('p', 'timeline-desc', 'AI 把你的材料拆成了下面的协作步骤。请在每一步下方标注你的困惑——哪里没看懂、哪里不确定。这些困惑会成为生成报告的关键输入。'))
  page.appendChild(intro)

  page.appendChild(loading('正在加载时间线…'))
  root.appendChild(page)

  let draft: Draft
  try {
    const res = await fetchDraft(draftId)
    if (!res.ok || !res.draft) {
      clear(page)
      page.appendChild(errorBox('时间线草稿加载失败'))
      const back = el('button', 'btn btn-ghost', '返回输入')
      back.onclick = () => navigate({ name: 'app' })
      page.appendChild(back)
      return
    }
    draft = res.draft
  } catch (err) {
    clear(page)
    page.appendChild(errorBox(err instanceof Error ? err.message : '加载失败'))
    return
  }

  clear(page)
  page.appendChild(header)
  page.appendChild(stepIndicator(2))
  page.appendChild(intro)

  // fallback 提示
  if (draft.generation?.fallback) {
    const notice = el('div', 'notice notice-fallback',
      'AI 不可用，已用结构化切分兜底。你仍可标注困惑并生成报告。')
    page.appendChild(notice)
  }

  // 步骤列表 + 困惑输入
  const steps = draft.timeline?.steps ?? []
  const confusionMap: Record<string, string> = {}
  const stepsWrap = el('div', 'timeline-steps')

  for (const step of steps) {
    confusionMap[step.id] = step.userConfusion || ''
    const card = el('div', 'timeline-card')
    card.appendChild(el('span', 'timeline-step-id', step.id))
    card.appendChild(el('h3', 'timeline-step-title', step.title))
    card.appendChild(el('p', 'timeline-step-ai', step.aiDid))

    if (step.keyActions?.length) {
      const actions = el('div', 'timeline-tags')
      for (const a of step.keyActions) actions.appendChild(el('span', 'tag tag-action', a))
      card.appendChild(actions)
    }
    if (step.keyConcepts?.length) {
      const concepts = el('div', 'timeline-tags')
      for (const c of step.keyConcepts) concepts.appendChild(el('span', 'tag tag-concept', c))
      card.appendChild(concepts)
    }

    const field = el('div', 'confusion-field')
    field.appendChild(el('label', 'confusion-label', '我在这步的困惑（可选）'))
    const ta = el('textarea', 'confusion-input') as HTMLTextAreaElement
    ta.placeholder = '哪里没看懂、哪里不确定…'
    ta.value = confusionMap[step.id]
    ta.oninput = () => { confusionMap[step.id] = ta.value }
    field.appendChild(ta)
    card.appendChild(field)

    stepsWrap.appendChild(card)
  }
  page.appendChild(stepsWrap)

  // 生成报告按钮
  const actions = el('div', 'timeline-actions')
  const status = el('p', 'form-status')
  const submit = el('button', 'btn btn-primary', '生成认知债务报告')
  submit.onclick = async () => {
    submit.disabled = true
    status.textContent = ''
    const overlay = spinnerOverlay('正在基于你的困惑生成报告，通常需要 30-60 秒…')
    page.appendChild(overlay)
    try {
      const confusions: Confusion[] = Object.entries(confusionMap)
        .filter(([, text]) => text.trim().length > 0)
        .map(([stepId, text]) => ({ stepId, text: text.trim() }))
      await saveDraftConfusions(draftId, confusions)
      const res = await generateReport({ draftId })
      rememberReportId(res.report.id)
      navigate({ name: 'report', reportId: res.report.id })
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : '生成失败，请重试'
      submit.disabled = false
    } finally {
      overlay.remove()
    }
  }
  actions.appendChild(submit)
  actions.appendChild(status)
  page.appendChild(actions)

  root.appendChild(page)
}

// ── 报告页 ──

export async function renderReportPage(root: HTMLElement, reportId: string): Promise<void> {
  const page = el('div', 'page page-report')
  page.appendChild(loading('正在加载报告…'))
  root.appendChild(page)

  let report: ClearanceReport
  try {
    const res = await fetchReport(reportId)
    report = res.report
  } catch (err) {
    clear(page)
    page.appendChild(errorBox(err instanceof Error ? err.message : '报告加载失败'))
    const back = el('button', 'btn btn-ghost', '返回首页')
    back.onclick = () => navigate({ name: 'app' })
    page.appendChild(back)
    return
  }

  clear(page)

  // 头部
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '认知债务报告'))
  const headerActions = el('div', 'header-actions')
  headerActions.appendChild(connectionStatusBadge())
  const back = el('button', 'btn btn-ghost', '新报告')
  back.onclick = () => navigate({ name: 'app' })
  headerActions.appendChild(back)
  header.appendChild(headerActions)
  page.appendChild(header)

  // 三步进度指示
  page.appendChild(stepIndicator(3))

  if (report.generation?.fallback) {
    const notice = el('div', 'notice notice-fallback')
    notice.appendChild(el('p', undefined, '当前为降级模式生成的报告，部分内容可能不完整。'))
    if (report.generation.error) notice.appendChild(el('p', 'notice-detail', report.generation.error))
    page.appendChild(notice)
  }

  // 第 1 部分：AI 完成了什么
  page.appendChild(renderSection('一、AI 完成了什么', 'ai-completed',
    report.sections.aiCompleted.map(item => evidenceItem(item.item, item.evidence))))

  // 第 2 部分：用户真正贡献了什么
  page.appendChild(renderSection('二、你真正贡献了什么', 'user-contributed',
    report.sections.userContributed.map(item => evidenceItem(item.item, item.evidence))))

  // 第 3 部分：危险的理解缺口
  page.appendChild(renderSection('三、最危险的理解缺口', 'dangerous-gaps',
    report.sections.dangerousGaps.map(g => gapCard(g.rank, g.gap, g.whyDangerous, g.evidence))))

  // 第 4 部分：认知结构
  const struct = report.sections.cognitiveStructure
  page.appendChild(renderSection('四、事实与推断', 'cognitive-structure', [
    renderSubList('事实', struct.facts),
    renderSubList('假设', struct.hypotheses),
    renderSubList('待验证问题', struct.questions),
    renderSubList('决定', struct.decisions),
    renderSubList('取舍', struct.tradeoffs)
  ]))

  // 第 5 部分：费曼补偿卡（选卡入口）
  const cardsSection = el('section', 'section cards-section')
  cardsSection.appendChild(el('h2', 'section-heading', '五、选择一笔认知欠条来清偿'))
  cardsSection.appendChild(el('p', 'section-desc', '每张卡片对应一个被 AI 代劳的理解过程。用自己的话解释它，清偿这笔欠条。'))
  const cardList = el('div', 'card-list')
  for (const card of report.sections.feynmanCards) {
    cardList.appendChild(renderCard(report.id, card))
  }
  cardsSection.appendChild(cardList)
  page.appendChild(cardsSection)

  // 第 6 部分：下一步行动
  page.appendChild(renderSection('六、下一步行动', 'next-actions',
    report.sections.nextActions.map(a => actionItem(a.item, a.route, a.reason))))

  // 困惑处理回执（三段式·第二段标注的困惑如何被处理）
  if (report.confusionResolutions?.length) {
    page.appendChild(renderConfusionResolutions(report.confusionResolutions))
  }
}

function renderConfusionResolutions(resolutions: ConfusionResolution[]): HTMLElement {
  const section = el('section', 'section confusion-resolutions')
  section.appendChild(el('h2', 'section-heading', '你的困惑如何被处理'))
  section.appendChild(el('p', 'section-desc', '你在时间线上标注的困惑，报告是这样回应的。'))
  const list = el('div', 'resolution-list')
  for (const r of resolutions) {
    const item = el('div', `resolution-item ${r.resolution === 'gap' ? 'is-gap' : 'is-not-gap'}`)
    item.appendChild(el('p', 'resolution-confusion', r.confusion))
    if (r.resolution === 'gap') {
      item.appendChild(el('span', 'tag tag-gap', `归入缺口 #${r.gapRank}`))
    } else {
      item.appendChild(el('span', 'tag tag-not-gap', '不构成能力缺口'))
    }
    item.appendChild(el('p', 'resolution-reason', r.reason))
    list.appendChild(item)
  }
  section.appendChild(list)
  return section
}

function renderSection(heading: string, className: string, children: HTMLElement[]): HTMLElement {
  const section = el('section', `section ${className}`)
  section.appendChild(el('h2', 'section-heading', heading))
  for (const child of children) section.appendChild(child)
  return section
}

function renderSubList(label: string, items: { item: string; evidence: string }[]): HTMLElement {
  const wrap = el('div', 'sub-list')
  wrap.appendChild(el('h3', 'sub-list-heading', label))
  if (!items?.length) {
    wrap.appendChild(el('p', 'empty', '暂无'))
    return wrap
  }
  for (const item of items) wrap.appendChild(evidenceItem(item.item, item.evidence))
  return wrap
}

function evidenceItem(item: string, evidence: string): HTMLElement {
  const node = el('div', 'evidence-item')
  node.appendChild(el('p', 'evidence-item-text', item))
  if (evidence) node.appendChild(el('p', 'evidence-item-source', evidence))
  return node
}

function gapCard(rank: number, gap: string, why: string, evidence: string): HTMLElement {
  const node = el('div', 'gap-card')
  node.appendChild(el('span', 'gap-rank', String(rank)))
  node.appendChild(el('h3', 'gap-title', gap))
  node.appendChild(el('p', 'gap-why', why))
  if (evidence) node.appendChild(el('p', 'gap-evidence', evidence))
  return node
}

function actionItem(item: string, route: string, reason: string): HTMLElement {
  const node = el('div', 'action-item')
  const routeLabels: Record<string, string> = {
    verify: '验证', note: '记录', task: '任务', ask: '请教'
  }
  node.appendChild(el('span', `action-tag action-${route}`, routeLabels[route] || route))
  node.appendChild(el('p', 'action-text', item))
  if (reason) node.appendChild(el('p', 'action-reason', reason))
  return node
}

function renderCard(reportId: string, card: FeynmanCard): HTMLElement {
  const node = el('div', 'feynman-card')
  if (card.difficulty) node.appendChild(el('span', `card-difficulty difficulty-${card.difficulty}`, card.difficulty))
  if (card.target) node.appendChild(el('p', 'card-target', card.target))
  node.appendChild(el('p', 'card-prompt', card.prompt))
  if (card.answeredAt) node.appendChild(el('span', 'card-badge card-answered', '已尝试'))
  if (card.clearance?.status === 'provisionally_cleared') {
    node.appendChild(el('span', 'card-badge card-cleared', '已清偿'))
  }

  const btn = el('button', 'btn btn-primary card-start-btn', '开始清偿')
  btn.onclick = async () => {
    node.querySelector('.error-inline')?.remove()
    btn.disabled = true
    btn.textContent = '正在创建会话…'
    // 创建会话需要大模型生成清偿问题与评估脚手架，耗时较长，给出明确加载提示
    const overlay = spinnerOverlay('AI 正在生成清偿问题与评估标准，通常需要 10-30 秒…')
    document.body.appendChild(overlay)
    try {
      const res = await createSession(reportId, card.id)
      rememberSessionId(res.session.id)
      navigate({ name: 'session', sessionId: res.session.id })
    } catch (err) {
      btn.disabled = false
      btn.textContent = '开始清偿'
      const msg = err instanceof Error ? err.message : '创建会话失败'
      const errNode = el('p', 'error-inline', msg)
      errNode.setAttribute('role', 'alert')
      node.appendChild(errNode)
    } finally {
      overlay.remove()
    }
  }
  node.appendChild(btn)
  return node
}

// ── 清偿会话页 ──

export async function renderSessionPage(root: HTMLElement, sessionId: string): Promise<void> {
  const page = el('div', 'page page-session')
  page.appendChild(loading('正在加载会话…'))
  root.appendChild(page)

  let session: ClearanceSession
  try {
    const res = await fetchSession(sessionId)
    session = res.session
  } catch (err) {
    clear(page)
    if (err instanceof Error && err.message.includes('404')) {
      forgetSessionId()
      page.appendChild(errorBox('会话已不存在，可能服务已重启。请返回报告重新开始。'))
    } else {
      page.appendChild(errorBox(err instanceof Error ? err.message : '会话加载失败'))
    }
    const back = el('button', 'btn btn-ghost', '返回首页')
    back.onclick = () => navigate({ name: 'app' })
    page.appendChild(back)
    return
  }

  clear(page)
  await drawSession(page, session)
}

// 欠条来源上下文：告诉用户这笔认知欠条是在哪段 AI 协作中、因为什么表现被识别的
async function renderDebtContext(session: ClearanceSession): Promise<HTMLElement | null> {
  if (!session.reportId) return null
  let report: ClearanceReport
  try {
    const res = await fetchReport(session.reportId)
    report = res.report
  } catch {
    return null
  }
  const card = report.sections?.feynmanCards?.find(c => c.id === session.cardId) || null
  const target = card?.target || session.clearanceQuestion || ''
  const gaps = report.sections?.dangerousGaps || []
  const gap = gaps.find(g => g.title === target)
    || gaps.find(g => target && (target.includes(g.title || '') || (g.title || '').includes(target)))
    || null

  const box = el('section', 'debt-context')
  box.appendChild(el('h3', 'debt-context-heading', '这笔欠条是在哪里产生的'))

  const scene = el('p', 'debt-context-scene')
  const artifactTitle = report.analysis?.artifactTitle || '一次 AI 协作'
  const when = report.createdAt ? new Date(report.createdAt).toLocaleString('zh-CN') : ''
  scene.textContent = `来自报告《${artifactTitle}》${when ? `（${when}）` : ''}。当时 AI 帮你完成了这项工作，而这个理解环节被它代劳了。`
  box.appendChild(scene)

  if (gap?.surfaceSignals?.length) {
    const signals = el('div', 'debt-context-signals')
    signals.appendChild(el('p', 'debt-context-sub', '当时的表现（系统据此识别出这笔欠条）：'))
    const ul = el('ul', 'debt-context-signal-list')
    for (const s of gap.surfaceSignals.slice(0, 4)) ul.appendChild(el('li', undefined, s))
    signals.appendChild(ul)
    box.appendChild(signals)
  }

  if (gap?.whyDangerous) {
    box.appendChild(el('p', 'debt-context-why', `为什么值得清偿：${gap.whyDangerous}`))
  }

  const confusions = report.input?.confusions || []
  if (confusions.length) {
    box.appendChild(el('p', 'debt-context-confusion', `你当时标注的困惑：${confusions[0].text}`))
  }
  return box
}

async function drawSession(page: HTMLElement, session: ClearanceSession): Promise<void> {
  clear(page)

  // 头部
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '清偿会话'))
  const headerActions = el('div', 'header-actions')
  headerActions.appendChild(connectionStatusBadge())
  const back = el('button', 'btn btn-ghost', '返回报告')
  const reportId = session.reportId
  back.onclick = () => {
    if (reportId) navigate({ name: 'report', reportId })
    else navigate({ name: 'app' })
  }
  headerActions.appendChild(back)
  header.appendChild(headerActions)
  page.appendChild(header)

  // 降级模式提示：策展备用研究或生成兜底，需对用户透明
  // ClearanceSession 类型未声明 generation，运行时可能存在，用类型断言安全访问
  const hasGenerationFallback =
    Boolean((session as { generation?: { fallback?: boolean } }).generation?.fallback)
  if (session.researchMode === 'curated_demo_fallback' || hasGenerationFallback) {
    page.appendChild(el('div', 'notice notice-fallback',
      '当前为策展备用模式，研究来源为预设材料'))
  }

  // 欠条来源上下文（产生场景 + 当时表现）
  const contextBox = await renderDebtContext(session)
  if (contextBox) page.appendChild(contextBox)

  // 清偿问题
  const questionBox = el('section', 'session-question')
  questionBox.appendChild(el('p', 'session-question-label', '清偿问题'))
  questionBox.appendChild(el('h2', 'session-question-text', session.clearanceQuestion))
  page.appendChild(questionBox)

  // 来源（如果有）
  if (session.sources && session.sources.length > 0) {
    const sourcesBox = el('section', 'session-sources')
    sourcesBox.appendChild(el('h3', 'sources-heading', '参考来源'))
    for (const src of session.sources) {
      const srcNode = el('div', 'source-item')
      if (src.title) srcNode.appendChild(el('p', 'source-title', src.title))
      if (src.credibility) srcNode.appendChild(el('span', `source-credibility cred-${src.credibility}`, src.credibility))
      if (src.url) {
        const a = el('a', 'source-url', src.url) as HTMLAnchorElement
        a.href = src.url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        srcNode.appendChild(a)
      }
      sourcesBox.appendChild(srcNode)
    }
    page.appendChild(sourcesBox)
  }

  // 历史回答与反馈
  const history = el('section', 'session-history')
  history.appendChild(el('h3', 'history-heading', '对话记录'))
  for (const attempt of session.attempts) {
    history.appendChild(renderAttempt(attempt.answer, attempt.analysis.feedback, attempt.analysis.teaching, attempt.analysis.nextQuestion))
  }
  page.appendChild(history)

  // 结果区（会话已结束）
  if (session.state === 'ended' && session.finalResult) {
    page.appendChild(renderFinalResult(session.finalResult))
    return
  }

  // 输入区
  const inputArea = el('section', 'session-input')
  const textarea = el('textarea', 'answer-input') as HTMLTextAreaElement
  textarea.placeholder = '用自己的话解释你对这个问题的理解…'
  textarea.rows = 6
  inputArea.appendChild(textarea)

  const actions = el('div', 'session-actions')
  const submit = el('button', 'btn btn-primary', '提交解释') as HTMLButtonElement
  const endBtn = el('button', 'btn btn-ghost', '结束会话')

  actions.appendChild(submit)
  actions.appendChild(endBtn)
  inputArea.appendChild(actions)

  const status = el('p', 'session-status')
  inputArea.appendChild(status)

  submit.onclick = async () => {
    const answer = textarea.value.trim()
    if (answer.length < 5) {
      status.textContent = '请写得更完整一些再提交。'
      return
    }
    submit.disabled = true
    endBtn.disabled = true
    status.textContent = 'AI 正在分析你的回答…'
    const overlay = spinnerOverlay('正在分析…')
    page.appendChild(overlay)
    try {
      const res = await submitAnswer(session.id, answer)
      // 重新拉取会话状态后重绘（确保最新 scaffold/attempts）
      const fresh = await fetchSession(session.id)
      clear(page)
      await drawSession(page, fresh.session)
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : '提交失败，请重试'
    } finally {
      overlay.remove()
      submit.disabled = false
      endBtn.disabled = false
    }
  }

  endBtn.onclick = async () => {
    endBtn.disabled = true
    submit.disabled = true
    status.textContent = '正在生成最终结果…'
    const overlay = spinnerOverlay('正在生成最终结果…')
    page.appendChild(overlay)
    try {
      const res = await endSession(session.id)
      clear(page)
      await drawSession(page, res.session)
      // 创世身份以弹出层呈现，非常驻页面；关闭后停留在清偿结果页
      if (res.genesisIdentity?.activatedAt) {
        showGenesisIdentityModal(res.genesisIdentity as GenesisIdentity)
      }
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : '结束会话失败'
    } finally {
      overlay.remove()
      endBtn.disabled = false
      submit.disabled = false
    }
  }

  page.appendChild(inputArea)
}

function renderGenesisIdentityChoice(identity: GenesisIdentity): HTMLElement {
  const panel = el('section', 'genesis-identity-panel')
  panel.appendChild(el('p', 'genesis-kicker', t('身份已激活', 'Identity activated')))
  panel.appendChild(el('h2', 'genesis-identity-number', identity.number))
  panel.appendChild(el('p', 'genesis-identity-copy', t(
    '你已进入 MindIOU 001 期产品历史。公开展示完全自愿，可以以后修改。',
    'You are now part of MindIOU Cohort 001 history. Public display is optional and can be changed later.'
  )))
  const select = el('select', 'genesis-visibility-select') as HTMLSelectElement
  ;[
    ['public', t('公开头像、昵称和编号', 'Show avatar, nickname, and ID')],
    ['anonymous', t('只公开匿名编号', 'Show anonymous ID only')],
    ['private', t('完全不公开，仅账户保留', 'Keep completely private')]
  ].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option)
  })
  select.value = identity.visibility
  panel.appendChild(select)
  const name = el('input', 'genesis-profile-input') as HTMLInputElement
  name.placeholder = t('公开昵称（可选）', 'Public nickname (optional)')
  panel.appendChild(name)
  const avatar = el('input', 'genesis-profile-input') as HTMLInputElement
  avatar.placeholder = t('头像 HTTPS 地址（可选）', 'Avatar HTTPS URL (optional)')
  panel.appendChild(avatar)
  const status = el('p', 'genesis-choice-status')
  const save = el('button', 'btn btn-primary', t('保存公开选择', 'Save privacy choice'))
  save.onclick = async () => {
    save.disabled = true
    try {
      await updateGenesisIdentity({ visibility: select.value as GenesisIdentity['visibility'], displayName: name.value.trim() || undefined, avatarUrl: avatar.value.trim() || undefined })
      status.textContent = t('已保存。你可以随时再次修改。', 'Saved. You can change this at any time.')
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : t('保存失败', 'Could not save')
    } finally { save.disabled = false }
  }
  panel.append(save, status)
  return panel
}

// 创世身份弹出层：清偿结束后一次性展示，可关闭，不常驻页面
function showGenesisIdentityModal(identity: GenesisIdentity): void {
  document.querySelector('.modal-overlay')?.remove()
  const overlay = el('div', 'modal-overlay')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  const dialog = el('div', 'modal-dialog')
  const close = el('button', 'modal-close', '×')
  close.setAttribute('aria-label', t('关闭', 'Close'))
  close.onclick = () => overlay.remove()
  dialog.appendChild(close)
  dialog.appendChild(renderGenesisIdentityChoice(identity))
  const later = el('button', 'btn btn-ghost', t('稍后再说', 'Maybe later'))
  later.onclick = () => overlay.remove()
  dialog.appendChild(later)
  overlay.appendChild(dialog)
  // 点击遮罩空白处关闭
  overlay.onclick = (event) => {
    if (event.target === overlay) overlay.remove()
  }
  document.body.appendChild(overlay)
}

export async function renderGenesisPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-genesis')
  page.appendChild(el('p', 'genesis-kicker', t('永久档案 · 001 期', 'Permanent archive · Cohort 001')))
  page.appendChild(el('h1', 'genesis-title', t('第一批用户，参与了 MindIOU 的诞生', 'The first users helped shape MindIOU')))
  page.appendChild(loading(t('正在读取 001 期档案…', 'Loading the Cohort 001 archive…')))
  root.appendChild(page)
  try {
    const { genesis } = await fetchGenesis(); page.querySelector('.loading')?.remove()

    const metrics = el('section', 'genesis-metrics')
    const metricData = [
      [t('已正式加入', 'Officially joined'), genesis.actual.joined, t('完成首次认知债务扫描后计入', 'Counted after the first cognitive-debt scan')],
      [t('已完成首次清偿', 'Completed first repayment'), genesis.actual.completedFirstClearance, t('不是登录签到，而是完成一次真实理解训练', 'A real understanding exercise—not a login check-in')],
      [t('共创建议已采纳', 'Co-creation ideas shipped'), genesis.actual.adoptedSuggestions, t('仅记录已经进入产品的真实改进', 'Only verified improvements already shipped')]
    ] as const
    metricData.forEach(([label, actual, note]) => {
      const item = el('article', 'genesis-metric'); item.appendChild(el('span', 'genesis-metric-label', label)); item.appendChild(el('strong', undefined, String(actual))); item.appendChild(el('small', undefined, note)); metrics.appendChild(item)
    })
    page.append(metrics)

    const wall = el('section', 'genesis-wall'); wall.appendChild(el('h2', undefined, t('首发体验者名录', 'Genesis participants')))
    if (!genesis.members.length) wall.appendChild(el('p', 'genesis-empty', t('等待第一位主动选择公开的完成者。', 'Waiting for the first finisher who chooses to be listed.')))
    wall.appendChild(el('p', 'genesis-section-copy', t('完成者可以选择公开头像、昵称和编号；只公开昵称或匿名编号；或完全不公开展示、仅在个人账户中永久保留身份。公开档案不会展示导入的 AI 对话、原始代码或私密训练内容。', 'Finishers may publish an avatar, name, and ID; publish only a name or anonymous ID; or remain entirely private while retaining the identity in their account. Imported AI conversations, source code, and private training content are never shown here.')))
    genesis.members.forEach(member => {
      const card = el('article', 'genesis-member')
      const identity = el('div', '')
      identity.appendChild(el('strong', undefined, member.nickname || t('匿名首发体验者', 'Anonymous genesis participant')))
      identity.appendChild(el('small', undefined, t('001 期 · 身份有效', 'Cohort 001 · Valid identity')))
      card.append(identity, el('span', undefined, member.number)); wall.appendChild(card)
    }); page.appendChild(wall)

    const section = (index: string, titleZh: string, titleEn: string, copyZh?: string, copyEn?: string) => {
      const node = el('section', 'genesis-section')
      node.appendChild(el('p', 'genesis-section-index', index))
      node.appendChild(el('h2', '', t(titleZh, titleEn)))
      if (copyZh) node.appendChild(el('p', 'genesis-section-copy', t(copyZh, copyEn || copyZh)))
      return node
    }
    const privacy = section('PRIVACY · CURRENT CAPABILITY', '隐私与数据说明', 'Privacy and data', '你的真实项目内容不会自动出现在公开档案中。', 'Your real project content will never automatically appear in the public archive.')
    const privacyGrid = el('div', 'genesis-privacy-grid')
    ;[
      [t('当前已支持', 'Available now'), [t('公开展示完全由用户主动选择', 'Public display is always opt-in'), t('活动页面只展示匿名汇总统计', 'Activity statistics are anonymous aggregates'), t('公开名录不展示原始对话、代码或私密训练内容', 'The public directory excludes original chats, code, and private training content')]],
      [t('上线前需补齐', 'Required before launch'), [t('自助删除导入内容和账户数据', 'Self-service deletion of imports and account data'), t('只保留结构化欠条、不长期保留完整原文的模式', 'A structured-debt-only mode without long-term source retention'), t('分享卡片生成前的逐次确认', 'Per-share confirmation before generating public cards')]]
    ].forEach(([title, items]) => { const card = el('article', 'genesis-privacy-card'); card.appendChild(el('h3', '', title as string)); const list = el('ul'); (items as string[]).forEach(item => list.appendChild(el('li', '', item))); card.appendChild(list); privacyGrid.appendChild(card) })
    privacy.appendChild(privacyGrid); page.appendChild(privacy)
  } catch (error) { page.querySelector('.loading')?.remove(); page.appendChild(errorBox(error instanceof Error ? error.message : t('档案加载失败', 'Could not load archive'))) }
  page.appendChild(renderSiteFooter())
}

function renderAttempt(answer: string, feedback: string, teaching?: string, nextQuestion?: string): HTMLElement {
  const node = el('div', 'attempt')
  node.appendChild(el('p', 'attempt-label', '你的解释'))
  node.appendChild(el('p', 'attempt-answer', answer))
  node.appendChild(el('p', 'attempt-label', 'AI 反馈'))
  node.appendChild(el('p', 'attempt-feedback', feedback))
  if (teaching) {
    node.appendChild(el('p', 'attempt-label', '教学补充'))
    node.appendChild(el('p', 'attempt-teaching', teaching))
  }
  if (nextQuestion) {
    node.appendChild(el('p', 'attempt-label', '追问'))
    node.appendChild(el('p', 'attempt-next', nextQuestion))
  }
  return node
}

function renderFinalResult(result: ClearanceSession['finalResult']): HTMLElement {
  const node = el('section', 'session-result')
  if (!result) return node

  const statusLabels: Record<string, string> = {
    provisionally_cleared: '初步清偿',
    needs_practice: '需要练习',
    needs_verification: '需要验证',
    no_valid_attempt: '无有效回答',
    invalid_attempt: '无有效回答'
  }
  const statusClass = `result-status status-${result.status}`
  node.appendChild(el('div', statusClass, statusLabels[result.status] || result.status))

  if (result.nextRecommendation) {
    node.appendChild(el('p', 'result-recommendation', result.nextRecommendation))
  }

  if (result.demonstrated && result.demonstrated.length > 0) {
    node.appendChild(el('h3', 'result-subheading', '已掌握'))
    for (const d of result.demonstrated) node.appendChild(el('p', 'result-item', d))
  }

  if (result.remainingGaps && result.remainingGaps.length > 0) {
    node.appendChild(el('h3', 'result-subheading', '仍需补足'))
    for (const g of result.remainingGaps) node.appendChild(el('p', 'result-item', g))
  }

  // 参考答案（首次结束才暴露）
  if (result.scaffold && result.scaffold.length > 0) {
    node.appendChild(el('h3', 'result-subheading', '参考要点'))
    for (const s of result.scaffold) {
      const pt = el('div', 'scaffold-point')
      pt.appendChild(el('p', 'scaffold-point-text', s.point))
      if (s.detail) pt.appendChild(el('p', 'scaffold-point-detail', s.detail))
      node.appendChild(pt)
    }
  }

  const actions = el('div', 'result-actions')
  const newBtn = el('button', 'btn btn-primary', '清偿下一笔欠条')
  newBtn.onclick = () => navigate({ name: 'app' })
  actions.appendChild(newBtn)
  node.appendChild(actions)

  return node
}

// ── 设备 Token 管理页 ──

export async function renderDevicesPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-devices')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', 'MindIOU'))
  const headerActions = el('div', 'header-actions')
  const backBtn = el('button', 'btn btn-ghost btn-sm', '返回')
  backBtn.onclick = () => navigate({ name: 'app' })
  headerActions.appendChild(backBtn)
  const logout = el('button', 'btn btn-ghost btn-sm', '退出登录')
  logout.onclick = async () => {
    await logoutAuth()
    navigate({ name: 'landing' })
  }
  headerActions.appendChild(logout)
  header.appendChild(headerActions)
  page.appendChild(header)

  const intro = el('section', 'app-intro')
  intro.appendChild(el('h2', 'app-heading', '设备 Token 管理'))
  intro.appendChild(el('p', 'app-desc', '为智能眼镜（G2/Rokid）生成专用访问 Token。每个 Token 只显示一次明文，请妥善保存。'))
  page.appendChild(intro)

  // 创建 Token 表单
  const form = el('form', 'device-form') as HTMLFormElement
  const nameInput = el('input', 'login-input') as HTMLInputElement
  nameInput.type = 'text'
  nameInput.placeholder = '设备名称（如：我的 Rokid）'
  nameInput.required = true
  form.appendChild(nameInput)

  const status = el('p', 'form-status')
  form.appendChild(status)

  const submit = el('button', 'btn btn-primary', '生成 Token') as HTMLButtonElement
  submit.type = 'submit'
  form.appendChild(submit)

  // 新创建的 Token 明文展示区（一次性）
  const tokenDisplay = el('div', 'token-display')
  tokenDisplay.style.display = 'none'
  form.appendChild(tokenDisplay)

  form.onsubmit = async (e) => {
    e.preventDefault()
    const name = nameInput.value.trim()
    if (!name) {
      status.textContent = '请输入设备名称'
      return
    }
    submit.disabled = true
    status.textContent = '生成中…'
    tokenDisplay.style.display = 'none'
    try {
      const info = await createDeviceToken(name)
      status.textContent = 'Token 已生成，请立即复制保存（关闭后不可再查看）'
      tokenDisplay.style.display = 'block'
      tokenDisplay.replaceChildren()
      tokenDisplay.appendChild(el('p', 'token-label', `设备：${info.name}`))
      const tokenBox = el('input', 'token-plaintext') as HTMLInputElement
      tokenBox.type = 'text'
      tokenBox.value = info.token || ''
      tokenBox.readOnly = true
      tokenBox.onclick = () => tokenBox.select()
      tokenDisplay.appendChild(tokenBox)
      const copyBtn = el('button', 'btn btn-ghost btn-sm', '复制')
      copyBtn.onclick = () => {
        tokenBox.select()
        try { void navigator.clipboard.writeText(tokenBox.value) } catch { /* */ }
      }
      tokenDisplay.appendChild(copyBtn)
      // 刷新列表
      void loadTokens()
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : '生成失败'
    } finally {
      submit.disabled = false
    }
  }
  page.appendChild(form)

  // 已有 Token 列表
  const listSection = el('section', 'device-list-section')
  listSection.appendChild(el('h3', 'device-list-title', '已有设备 Token'))
  const tokenList = el('div', 'device-list')
  tokenList.appendChild(loading('加载中…'))
  listSection.appendChild(tokenList)
  page.appendChild(listSection)

  root.appendChild(page)

  async function loadTokens(): Promise<void> {
    try {
      const tokens = await listDeviceTokens()
      tokenList.replaceChildren()
      if (tokens.length === 0) {
        tokenList.appendChild(el('p', 'admin-empty', '暂无设备 Token'))
        return
      }
      for (const t of tokens) {
        const row = el('div', 'device-row')
        row.appendChild(el('span', 'device-name', t.name))
        row.appendChild(el('span', 'device-date', `创建于 ${new Date(t.createdAt).toLocaleDateString('zh-CN')}`))
        if (t.lastUsedAt) {
          row.appendChild(el('span', 'device-used', `最近使用 ${new Date(t.lastUsedAt).toLocaleDateString('zh-CN')}`))
        } else {
          row.appendChild(el('span', 'device-used', '未使用'))
        }
        const revokeBtn = el('button', 'btn btn-ghost btn-sm', '撤销')
        revokeBtn.onclick = async () => {
          revokeBtn.disabled = true
          try {
            await revokeDeviceToken(t.id)
            void loadTokens()
          } catch (err) {
            revokeBtn.disabled = false
            status.textContent = err instanceof Error ? err.message : '撤销失败'
          }
        }
        row.appendChild(revokeBtn)
        tokenList.appendChild(row)
      }
    } catch {
      tokenList.replaceChildren()
      tokenList.appendChild(el('p', 'admin-empty', '无法加载设备 Token 列表'))
    }
  }

  void loadTokens()
}

// ── 训练系统页面 ──

export async function renderTrainingPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-training')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '今日复训'))
  const headerActions = el('div', 'header-actions')
  const debtsLink = el('button', 'btn btn-ghost btn-sm', '认知欠条')
  debtsLink.onclick = () => navigate({ name: 'training-debt', debtId: 'list' })
  headerActions.appendChild(debtsLink)
  const backBtn = el('button', 'btn btn-ghost btn-sm', '返回')
  backBtn.onclick = () => navigate({ name: 'app' })
  headerActions.appendChild(backBtn)
  header.appendChild(headerActions)
  page.appendChild(header)

  const intro = el('p', 'page-intro', '基于艾宾浩斯遗忘曲线与费曼掌握度模型，今天需要复习以下认知欠条。')
  page.appendChild(intro)

  const loadingEl = el('p', 'loading', '正在加载今日复训任务…')
  page.appendChild(loadingEl)
  root.appendChild(page)

  try {
    const [data, debtsData] = await Promise.all([fetchTodayTraining(), fetchTrainingDebts()])
    clear(page)
    page.appendChild(header)
    page.appendChild(intro)

    if (!data.ok) {
      const err = el('p', 'error', data.error || '加载失败')
      page.appendChild(err)
      return
    }

    if (data.totalDue === 0) {
      const empty = el('div', 'empty-state')
      empty.appendChild(el('p', 'empty-title', '今天没有复训任务'))
      empty.appendChild(el('p', 'empty-desc', '完成新的清偿后，系统会自动生成复训任务。'))
      page.appendChild(empty)
    } else {
      const list = el('div', 'task-list')
      for (const task of data.tasks) {
        const card = el('div', 'task-card')
        card.appendChild(el('div', 'task-stage', stageLabel(task.trainingStage)))
        card.appendChild(el('p', 'task-prompt', task.prompt))
        const meta = el('div', 'task-meta')
        meta.appendChild(el('span', 'task-due', `到期：${formatDate(task.dueAt)}`))
        card.appendChild(meta)
        const btn = el('button', 'btn btn-primary', '开始复训')
        btn.onclick = async () => {
          btn.disabled = true
          btn.textContent = '正在启动…'
          try {
            const result = await startReviewTask(task.id)
            if (result.ok) {
              await renderReviewSubmitForm(page, task)
            } else {
              btn.disabled = false
              btn.textContent = '开始复训'
              alert(result.error || '启动失败')
            }
          } catch (e) {
            btn.disabled = false
            btn.textContent = '开始复训'
            alert('网络错误')
          }
        }
        card.appendChild(btn)
        list.appendChild(card)
      }
      page.appendChild(list)
    }

    // 长期掌握度追踪：随清偿与复训累积的每笔记欠条掌握画像
    const profiles = data.profiles || []
    if (profiles.length > 0) {
      const debtTextById = new Map<string, string>()
      if (debtsData.ok) {
        for (const debt of debtsData.debts) debtTextById.set(debt.id, debt.gapText)
      }
      const tracking = el('section', 'mastery-tracking')
      tracking.appendChild(el('h2', 'mastery-tracking-title', '长期掌握度追踪'))
      tracking.appendChild(el('p', 'mastery-tracking-desc', '每条欠条的掌握度随清偿与复训持续累积，按遗忘曲线安排下次复习。'))
      const grid = el('div', 'mastery-grid')
      for (const profile of profiles) {
        const card = el('article', 'mastery-card')
        const debtText = debtTextById.get(profile.cognitiveDebtId) || '认知欠条'
        card.appendChild(el('p', 'mastery-card-debt', debtText))
        const meterRow = el('div', 'mastery-meter-row')
        const meter = el('div', 'mastery-meter')
        const fill = el('div', 'mastery-meter-fill')
        const score = Math.max(0, Math.min(100, profile.overallMastery))
        fill.style.width = `${score}%`
        meter.appendChild(fill)
        meterRow.appendChild(meter)
        meterRow.appendChild(el('strong', 'mastery-score-value', String(profile.overallMastery)))
        card.appendChild(meterRow)
        const meta = el('div', 'mastery-card-meta')
        meta.appendChild(el('span', undefined, stageLabel(profile.currentStage)))
        meta.appendChild(el('span', undefined, `练习 ${profile.attemptCount} 次`))
        if (profile.nextReviewAt) {
          meta.appendChild(el('span', undefined, `下次复习：${formatDate(profile.nextReviewAt)}`))
        }
        card.appendChild(meta)
        grid.appendChild(card)
      }
      tracking.appendChild(grid)
      page.appendChild(tracking)
    }
  } catch (e) {
    clear(page)
    page.appendChild(header)
    page.appendChild(el('p', 'error', '加载失败，请稍后重试。'))
  }
}

async function renderReviewSubmitForm(page: HTMLElement, task: ReviewTask): Promise<void> {
  clear(page)
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '复训中'))
  const headerActions = el('div', 'header-actions')
  const backBtn = el('button', 'btn btn-ghost btn-sm', '返回今日复训')
  backBtn.onclick = () => navigate({ name: 'training' })
  headerActions.appendChild(backBtn)
  header.appendChild(headerActions)
  page.appendChild(header)

  page.appendChild(el('div', 'task-stage', stageLabel(task.trainingStage)))
  page.appendChild(el('p', 'task-prompt-large', task.prompt))

  const textarea = document.createElement('textarea')
  textarea.className = 'answer-textarea'
  textarea.placeholder = '用你自己的话解释这个概念…'
  textarea.rows = 8
  page.appendChild(textarea)

  const btn = el('button', 'btn btn-primary', '提交答案')
  page.appendChild(btn)

  btn.onclick = async () => {
    const answer = textarea.value.trim()
    if (!answer) {
      alert('请输入你的回答')
      return
    }
    btn.disabled = true
    btn.textContent = '正在评估…'
    try {
      const result = await submitReviewAnswer(task.id, answer)
      if (result.ok) {
        renderReviewResult(page, result)
      } else {
        btn.disabled = false
        btn.textContent = '提交答案'
        alert(result.error || '提交失败')
      }
    } catch (e) {
      btn.disabled = false
      btn.textContent = '提交答案'
      alert('网络错误')
    }
  }
}

function renderReviewResult(page: HTMLElement, result: SubmitReviewResponse): void {
  clear(page)
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '复训结果'))
  page.appendChild(header)

  const score = result.evaluation.overallScore
  const passed = result.evaluation.passed
  const scoreEl = el('div', 'result-score', `${score} 分`)
  scoreEl.className = passed ? 'result-score passed' : 'result-score failed'
  page.appendChild(scoreEl)

  page.appendChild(el('p', 'result-status', passed ? '✓ 通过' : '✗ 未通过'))

  if (result.evaluation.userFeedback) {
    const feedback = el('div', 'result-feedback')
    feedback.appendChild(el('h3', 'result-section-title', 'AI 反馈'))
    feedback.appendChild(el('p', 'result-feedback-text', result.evaluation.userFeedback))
    page.appendChild(feedback)
  }

  if (result.evaluation.strengths.length > 0) {
    const sec = el('div', 'result-section')
    sec.appendChild(el('h3', 'result-section-title', '做得好的地方'))
    for (const s of result.evaluation.strengths) {
      sec.appendChild(el('li', 'result-item', s))
    }
    page.appendChild(sec)
  }

  if (result.evaluation.missingPoints.length > 0) {
    const sec = el('div', 'result-section')
    sec.appendChild(el('h3', 'result-section-title', '需要补充的点'))
    for (const m of result.evaluation.missingPoints) {
      sec.appendChild(el('li', 'result-item', m))
    }
    page.appendChild(sec)
  }

  const meta = el('div', 'result-meta')
  meta.appendChild(el('span', 'result-meta-item', `掌握度：${result.profile.overallMastery}`))
  meta.appendChild(el('span', 'result-meta-item', `下次复习：${formatDate(result.nextReviewAt)}`))
  page.appendChild(meta)

  const backBtn = el('button', 'btn btn-primary', '返回今日复训')
  backBtn.onclick = () => navigate({ name: 'training' })
  page.appendChild(backBtn)
}

export async function renderTrainingDebtListPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-training-debts')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '认知欠条'))
  const headerActions = el('div', 'header-actions')
  const todayBtn = el('button', 'btn btn-ghost btn-sm', '今日复训')
  todayBtn.onclick = () => navigate({ name: 'training' })
  headerActions.appendChild(todayBtn)
  const backBtn = el('button', 'btn btn-ghost btn-sm', '返回')
  backBtn.onclick = () => navigate({ name: 'app' })
  headerActions.appendChild(backBtn)
  header.appendChild(headerActions)
  page.appendChild(header)

  page.appendChild(el('p', 'page-intro', '所有被识别但尚未稳定掌握的认知欠条。完成清偿后会自动加入。'))

  const loadingEl = el('p', 'loading', '正在加载认知欠条…')
  page.appendChild(loadingEl)
  root.appendChild(page)

  try {
    const data = await fetchTrainingDebts()
    clear(page)
    page.appendChild(header)
    page.appendChild(el('p', 'page-intro', '所有被识别但尚未稳定掌握的认知欠条。完成清偿后会自动加入。'))

    if (!data.ok) {
      page.appendChild(el('p', 'error', data.error || '加载失败'))
      return
    }

    if (data.debts.length === 0) {
      const empty = el('div', 'empty-state')
      empty.appendChild(el('p', 'empty-title', '暂无认知欠条'))
      empty.appendChild(el('p', 'empty-desc', '完成清偿会话后，系统会自动创建认知欠条。'))
      page.appendChild(empty)
      return
    }

    const list = el('div', 'debt-list')
    for (const debt of data.debts) {
      const card = el('div', 'debt-card')
      card.appendChild(el('div', 'debt-status', debt.masteryLabel || '正在补偿'))
      card.appendChild(el('p', 'debt-gap', debt.gapText))
      const meta = el('div', 'debt-meta')
      if (debt.mastery) {
        meta.appendChild(el('span', 'debt-mastery', `掌握度 ${debt.mastery.overallMastery}`))
      }
      meta.appendChild(el('span', 'debt-stage', stageLabel(debt.mastery?.currentStage || 'initial_compensation')))
      card.appendChild(meta)
      card.onclick = () => navigate({ name: 'training-debt', debtId: debt.id })
      list.appendChild(card)
    }
    page.appendChild(list)
  } catch (e) {
    clear(page)
    page.appendChild(header)
    page.appendChild(el('p', 'error', '加载失败，请稍后重试。'))
  }
}

export async function renderTrainingDebtDetailPage(root: HTMLElement, debtId: string): Promise<void> {
  const page = el('div', 'page page-training-debt-detail')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '认知欠条详情'))
  const headerActions = el('div', 'header-actions')
  const listBtn = el('button', 'btn btn-ghost btn-sm', '返回列表')
  listBtn.onclick = () => navigate({ name: 'training-debt', debtId: 'list' })
  headerActions.appendChild(listBtn)
  header.appendChild(headerActions)
  page.appendChild(header)

  const loadingEl = el('p', 'loading', '正在加载…')
  page.appendChild(loadingEl)
  root.appendChild(page)

  try {
    const data = await fetchTrainingDebtDetail(debtId)
    clear(page)
    page.appendChild(header)

    if (!data.ok) {
      page.appendChild(el('p', 'error', data.error || '加载失败'))
      return
    }

    page.appendChild(el('div', `debt-status level-${data.understandingLevel}`, data.masteryLabel))
    page.appendChild(el('p', 'debt-gap-large', data.debt.gapText))

    if (data.projectMemory) {
      const memory = el('section', 'project-memory-panel')
      memory.appendChild(el('h3', 'result-section-title', '项目认知账本关联'))
      const links = data.projectMemory.links || []
      for (const link of links.slice(0, 12)) {
        const item = el('article', 'project-memory-card')
        item.appendChild(el('strong', undefined, link.artifact.repositoryRelativePath || link.artifact.name))
        item.appendChild(el('p', undefined, [
          link.artifact.symbolName,
          link.artifact.gitCommitHash ? 'Commit ' + link.artifact.gitCommitHash : '',
          link.workItemTitle,
          link.sessionTitle,
          link.decisionTitle
        ].filter(Boolean).join(' · ')))
        memory.appendChild(item)
      }
      const evidence = data.projectMemory.evidence || []
      const highest = evidence.reduce((current, item) => item.evidenceLevel > current ? item.evidenceLevel : current, 'E0')
      memory.appendChild(el('p', 'project-memory-status', '当前最高证据：' + highest + '；测试通过不自动等于项目所有权。'))
      if (data.projectMemory.recurrences.length) {
        memory.appendChild(el('h4', 'result-section-title', '复发记录'))
        for (const recurrence of data.projectMemory.recurrences.slice(0, 6)) {
          memory.appendChild(el('p', undefined, (recurrence.projectName || recurrence.projectId) + '：' + recurrence.reason))
        }
      }
      page.appendChild(memory)
    }

    if (data.profile) {
      const mastery = el('div', 'mastery-info')
      mastery.appendChild(el('h3', 'result-section-title', '掌握度信息'))
      mastery.appendChild(el('p', 'mastery-score', `总体掌握度：${data.profile.overallMastery}`))
      mastery.appendChild(el('p', 'mastery-stage', `当前阶段：${stageLabel(data.profile.currentStage)}`))
      mastery.appendChild(el('p', 'mastery-attempts', `练习次数：${data.profile.attemptCount}`))
      if (data.profile.nextReviewAt) {
        mastery.appendChild(el('p', 'mastery-next', `下次复习：${formatDate(data.profile.nextReviewAt)}`))
      }
      page.appendChild(mastery)
    }

    if (data.attempts.length > 0) {
      const history = el('div', 'attempt-history')
      history.appendChild(el('h3', 'result-section-title', '练习历史'))
      for (const attempt of data.attempts.slice(0, 10)) {
        const item = el('div', 'attempt-item')
        item.appendChild(el('div', 'attempt-score', `${attempt.evaluation.overallScore} 分`))
        item.appendChild(el('div', 'attempt-stage', stageLabel(attempt.trainingStage)))
        item.appendChild(el('div', 'attempt-date', formatDate(attempt.completedAt)))
        if (attempt.evaluation.userFeedback) {
          item.appendChild(el('p', 'attempt-feedback', attempt.evaluation.userFeedback.slice(0, 200)))
        }
        history.appendChild(item)
      }
      page.appendChild(history)
    }

    if (data.reviews.length > 0) {
      const reviews = el('div', 'review-history')
      reviews.appendChild(el('h3', 'result-section-title', '复训任务'))
      const reviewStatusLabels: Record<string, string> = {
        pending: '待复习', in_progress: '进行中', completed: '已完成'
      }
      for (const review of data.reviews) {
        const item = el('div', 'review-item')
        item.appendChild(el('span', 'review-stage', stageLabel(review.trainingStage)))
        item.appendChild(el('span', `review-status status-${review.status}`, reviewStatusLabels[review.status] || review.status))
        item.appendChild(el('span', 'review-due', formatDate(review.dueAt)))
        reviews.appendChild(item)
      }
      page.appendChild(reviews)
    }
  } catch (e) {
    clear(page)
    page.appendChild(header)
    page.appendChild(el('p', 'error', '加载失败，请稍后重试。'))
  }
}

// 训练阶段中文标签
function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    initial_compensation: '初始补偿',
    delayed_recall: '延迟回忆',
    misconception_check: '误区检查',
    scenario_transfer: '场景迁移',
    error_detection: '错误检测',
    real_work_validation: '真实工作验证'
  }
  return labels[stage] || stage
}

// 日期格式化
function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}
