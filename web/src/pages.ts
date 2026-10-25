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
  linkReportToProjectMemory,
  listProjectHookTokens,
  listProjects,
  listDeviceTokens,
  login,
  logoutAuth,
  projectMemoryRequest,
  resendVerificationEmail,
  register,
  verifyEmail,
  createProjectHookToken,
  revokeProjectHookToken,
  revokeDeviceToken,
  saveDraftConfusions,
  setAccessToken,
  startReviewTask,
  submitAnswer,
  submitReviewAnswer,
  updateGenesisIdentity
} from './api'
import type { DeviceTokenInfo, GenesisIdentity, ProjectHookTokenInfo } from './api'
import { renderSiteFooter } from './navigation'
import { isEnglish, t } from './i18n'
import type {
  ClearanceReport,
  ClearanceSession,
  Confusion,
  ConfusionResolution,
  Draft,
  FeynmanCard,
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
  recallProjectMemoryProjectId,
  recallReportId,
  recallSessionId,
  rememberDraftId,
  rememberProjectMemoryProjectId,
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

type ReportGenerationProgress = {
  node: HTMLElement
  setStage: (index: number) => void
  markFailed: (message: string) => void
}

const REPORT_GENERATION_STAGES = [
  ['Step A：归因与能力校准', 'Step A: Attribution and capability calibration'],
  ['Step B：根能力缺口分析', 'Step B: Root capability gap analysis'],
  ['最多 3 次外部资料检索，当前是串行执行', 'Up to 3 external research queries, currently run sequentially'],
  ['Step D：生成认知欠条、训练卡片和下一步行动', 'Step D: Generating cognitive debts, training cards, and next actions'],
  ['保存报告、能力领域、欠条和清偿记录', 'Saving the report, capability domain, debts, and repayment records']
] as const

/**
 * Report generation is currently one HTTP request. These are honest UX
 * milestones around that request: the final stage is only shown after the
 * server returns a report, while earlier stages make the long request
 * inspectable instead of looking frozen.
 */
function reportGenerationProgress(): ReportGenerationProgress {
  const overlay = el('div', 'spinner-overlay report-progress-overlay')
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-live', 'polite')
  overlay.setAttribute('aria-busy', 'true')

  const card = el('section', 'report-progress-card')
  const spinner = el('div', 'spinner')
  spinner.setAttribute('aria-hidden', 'true')
  card.appendChild(spinner)
  card.appendChild(el('p', 'report-progress-kicker', t('报告生成中', 'Report generation')))
  const title = el('h2', 'report-progress-title', REPORT_GENERATION_STAGES[0][isEnglish() ? 1 : 0])
  card.appendChild(title)
  card.appendChild(el('p', 'report-progress-note', t(
    '系统会在报告真正返回后进入最后阶段，请保持页面打开。',
    'The final stage appears only after the report is returned. Keep this page open.'
  )))

  const list = el('ol', 'report-progress-list')
  const items = REPORT_GENERATION_STAGES.map((stage, index) => {
    const item = el('li', `report-progress-step ${index === 0 ? 'is-active' : ''}`)
    item.dataset.stage = String(index)
    const marker = el('span', 'report-progress-marker', index === 0 ? '·' : String(index + 1))
    marker.setAttribute('aria-hidden', 'true')
    item.appendChild(marker)
    item.appendChild(el('span', 'report-progress-label', stage[isEnglish() ? 1 : 0]))
    list.appendChild(item)
    return item
  })
  card.appendChild(list)

  const status = el('p', 'report-progress-status')
  status.textContent = t('正在处理，请稍候…', 'Processing, please wait…')
  card.appendChild(status)
  overlay.appendChild(card)

  const setStage = (index: number) => {
    const currentStage = Math.max(0, Math.min(REPORT_GENERATION_STAGES.length - 1, index))
    items.forEach((item, itemIndex) => {
      item.classList.toggle('is-done', itemIndex < currentStage)
      item.classList.toggle('is-active', itemIndex === currentStage)
      item.classList.toggle('is-pending', itemIndex > currentStage)
      const marker = item.querySelector('.report-progress-marker')
      if (marker) marker.textContent = itemIndex < currentStage ? '✓' : itemIndex === currentStage ? '·' : String(itemIndex + 1)
    })
    title.textContent = REPORT_GENERATION_STAGES[currentStage][isEnglish() ? 1 : 0]
    status.textContent = currentStage === REPORT_GENERATION_STAGES.length - 1
      ? t('分析已返回，正在打开报告…', 'Analysis returned. Opening your report…')
      : t('正在处理，请稍候…', 'Processing, please wait…')
  }

  const markFailed = (message: string) => {
    overlay.setAttribute('aria-busy', 'false')
    overlay.classList.add('is-failed')
    status.textContent = message || t('生成失败，请重试。', 'Generation failed. Please try again.')
  }

  return { node: overlay, setStage, markFailed }
}

type ProjectMemoryProject = { id: string; name: string; status?: string }

function renderProjectMemoryAttach(reportId?: string): HTMLElement {
  const section = el('section', 'project-memory-attach')
  section.appendChild(el('h2', 'section-heading', t('归入项目记忆', 'Attach to project memory')))
  section.appendChild(el('p', 'section-desc', reportId
    ? '不用重新粘贴材料。选择项目后，当前报告会和会话摘要、功能任务、产出物及认知欠条建立关联。'
    : '选择项目后，生成报告会自动把本次材料归入项目记忆。'))
  const row = el('div', 'project-memory-attach-row')
  const select = el('select', 'project-memory-select') as HTMLSelectElement
  const emptyProjectOption = el('option', undefined, t('生成后不关联项目', 'Do not attach to a project')) as HTMLOptionElement
  emptyProjectOption.value = ''
  select.appendChild(emptyProjectOption)
  const createName = el('input', 'project-memory-project-input') as HTMLInputElement
  createName.type = 'text'
  createName.placeholder = t('新项目名称（可选）', 'New project name (optional)')
  const create = el('button', 'btn btn-ghost btn-sm', t('新建项目', 'New project')) as HTMLButtonElement
  create.type = 'button'
  const attach = el('button', `btn ${reportId ? 'btn-primary' : 'btn-ghost'} btn-sm`, reportId ? t('归入项目记忆', 'Attach to project memory') : t('选择后自动归入', 'Attach automatically after selection')) as HTMLButtonElement
  attach.type = 'button'
  attach.disabled = !reportId
  const status = el('p', 'project-memory-attach-status')
  row.append(select, createName, create, attach)
  section.append(row, status)

  const loadProjects = async (): Promise<void> => {
    try {
      const response = await projectMemoryRequest<{ projects: ProjectMemoryProject[] }>('/api/projects')
      for (const project of response.projects || []) {
        const option = el('option') as HTMLOptionElement
        option.value = project.id
        option.textContent = project.name
        select.appendChild(option)
      }
      const remembered = recallProjectMemoryProjectId()
      if (remembered && response.projects?.some(project => project.id === remembered)) {
        select.value = remembered
        attach.disabled = !reportId || !select.value
        if (reportId) void attachReport(remembered, true)
      }
      if (!response.projects?.length) status.textContent = t('还没有项目；可在右侧输入项目名称后新建。', 'No projects yet. Enter a project name on the right to create one.')
    } catch {
      status.textContent = t('项目列表暂时不可用，报告仍可正常生成。', 'The project list is temporarily unavailable. You can still generate the report.')
    }
  }

  const attachReport = async (projectId: string, automatic = false): Promise<void> => {
    if (!reportId || !projectId) return
    attach.disabled = true
    status.textContent = automatic ? t('正在同步到项目记忆…', 'Syncing with project memory…') : t('正在建立项目关联…', 'Creating the project link…')
    try {
      const response = await linkReportToProjectMemory(reportId, projectId)
      status.textContent = `${t('已归入项目：', 'Attached to project: ')}${response.project.name}${response.idempotent ? t('（已存在关联）', ' (already linked)') : ''}`
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : t('项目关联失败，请稍后重试', 'Could not link the project. Try again later.')
      attach.disabled = false
    }
  }

  select.onchange = () => {
    rememberProjectMemoryProjectId(select.value || null)
    attach.disabled = !reportId || !select.value
  }
  create.onclick = async () => {
    const name = createName.value.trim()
    if (!name) {
    status.textContent = t('请先输入项目名称。', 'Enter a project name first.')
      createName.focus()
      return
    }
    create.disabled = true
    try {
      const response = await projectMemoryRequest<{ project: ProjectMemoryProject }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name, projectType: 'software' })
      })
      const option = el('option') as HTMLOptionElement
      option.value = response.project.id
      option.textContent = response.project.name
      select.appendChild(option)
      select.value = response.project.id
      rememberProjectMemoryProjectId(response.project.id)
      attach.disabled = !reportId
      createName.value = ''
      status.textContent = reportId ? t('项目已创建，点击“归入项目记忆”完成关联。', 'Project created. Click “Attach to project memory” to finish linking it.') : t('项目已创建，生成报告后会自动归入。', 'Project created. The report will be attached automatically after it is generated.')
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : t('项目创建失败', 'Could not create the project')
    } finally {
      create.disabled = false
    }
  }
  if (reportId) attach.onclick = () => void attachReport(select.value)
  void loadProjects()
  return section
}

function connectionStatusBadge(): HTMLElement {
  const badge = el('div', 'connection-pill is-checking')
  badge.appendChild(el('span', 'connection-dot'))
  const label = el('span', 'connection-label', t('正在连接', 'Connecting'))
  badge.appendChild(label)
  void checkHealth().then(ok => {
    badge.classList.remove('is-checking')
    badge.classList.add(ok ? 'is-online' : 'is-offline')
    label.textContent = ok ? t('AI 服务已连接', 'AI service connected') : t('服务未连接', 'Service unavailable')
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
      } else if (err instanceof ApiError && err.status === 403) {
        sessionStorage.setItem('mindiou_pending_verification_email', email)
        status.textContent = '请先验证邮箱，我们已为你保留验证入口。'
        navigate({ name: 'verify-email' })
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

export function renderEmailVerificationPage(root: HTMLElement, token?: string, status?: string): void {
  const page = el('div', 'page page-verify-email')
  page.appendChild(el('h1', 'brand-title', status === 'success' ? '邮箱验证成功' : '请验证你的邮箱'))
  page.appendChild(el('p', 'brand-subtitle', status === 'success' ? '现在可以登录并进入工作区。' : '我们已向你的注册邮箱发送验证链接。'))
  const message = el('p', 'login-status')
  page.appendChild(message)
  if (status === 'success') {
    const button = el('button', 'btn btn-primary', '返回登录') as HTMLButtonElement
    button.onclick = () => navigate({ name: 'login' })
    page.appendChild(button)
  } else if (status === 'failed') {
    message.textContent = '验证链接无效或已过期，请重新登录后重发。'
  } else if (token) {
    message.textContent = '正在验证…'
    void verifyEmail(token).then(() => { location.hash = '/verify-email?status=success' }).catch(() => { location.hash = '/verify-email?status=failed' })
  } else {
    const resend = el('button', 'btn btn-secondary', '重新发送验证邮件') as HTMLButtonElement
    resend.onclick = async () => { resend.disabled = true; try { await resendVerificationEmail(sessionStorage.getItem('mindiou_pending_verification_email') || undefined); message.textContent = '验证邮件已重新发送。' } catch { message.textContent = '发送失败，请稍后重试。' } finally { resend.disabled = false } }
    page.appendChild(resend)
  }
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
      navigate({ name: 'verify-email' })
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
  const profileBtn = el('button', 'btn btn-ghost btn-sm', '用户画像')
  profileBtn.onclick = () => navigate({ name: 'profile' })
  headerActions.appendChild(profileBtn)
  const devicesBtn = el('button', 'btn btn-ghost btn-sm', '设备Token')
  devicesBtn.onclick = () => navigate({ name: 'devices' })
  headerActions.appendChild(devicesBtn)
  const ownershipBtn = el('button', 'btn btn-ghost btn-sm', '项目记忆')
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
      data.outstandingDebts.forEach(debt => {
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
  } catch {
    clear(dashboardBody)
    dashboardBody.appendChild(errorBox(t('加载失败，请重试', 'Could not load your dashboard. Try again.')))
  }

  const intro = el('section', 'app-intro')
  intro.appendChild(el('p', 'dashboard-kicker', t('开始新的分析', 'Start a new analysis')))
  intro.appendChild(el('h2', 'app-heading', t('识别你跳过的认知债务', 'Find the cognitive work AI skipped for you')))
  intro.appendChild(el('p', 'app-desc', t('粘贴一段你用 AI 辅助完成的工作材料。MindIOU 会分析哪些理解过程被 AI 代劳了，并生成一份认知债务报告。', 'Paste work you completed with AI. MindIOU identifies the reasoning you delegated and turns it into a cognitive debt report.')))
  page.appendChild(intro)

  // 会得到什么说明（预期管理）
  const expect = el('section', 'app-expect')
  expect.appendChild(el('h3', 'expect-heading', t('接下来会经历什么', 'What happens next')))
  const expectList = el('ul', 'expect-list')
  expectList.appendChild(el('li', 'expect-item', t('AI 把你的材料拆成协作步骤', 'AI breaks your material into collaboration steps')))
  expectList.appendChild(el('li', 'expect-item', t('你在每一步上标注「我哪里没看懂」', 'Mark what you did not understand at each step')))
  expectList.appendChild(el('li', 'expect-item', t('基于你的困惑生成认知债务报告', 'Generate a cognitive debt report from your questions')))
  expect.appendChild(expectList)
  page.appendChild(expect)

  // 三步进度指示
  page.appendChild(stepIndicator(1))

  // 项目记忆作为生成认知欠条主流程的可选归档目标；不要求用户再次粘贴材料。
  page.appendChild(renderProjectMemoryAttach())

  const form = el('form', 'input-form') as HTMLFormElement

  // 演示样本按钮：一键填入固定文本，配合 SPIRAL_DISABLE_AI=1 可稳定复现
  const demoBar = el('div', 'demo-bar')
  const demoBtn = el('button', 'btn-demo-sample', t('使用演示样本（服务器事故排查）', 'Use the demo sample (server incident investigation)'))
  demoBtn.type = 'button'
  demoBtn.onclick = () => {
    textarea.value = isEnglish() ? DEMO_SAMPLE_TEXT_EN : DEMO_SAMPLE_TEXT
    textarea.dispatchEvent(new Event('input'))
  }
  demoBar.appendChild(demoBtn)
  form.appendChild(demoBar)

  const textarea = el('textarea', 'artifact-input') as HTMLTextAreaElement
  textarea.placeholder = t(
    '粘贴 AI 协作对话、AI 生成的方案、黑客松记录、会议纪要…',
    'Paste an AI-assisted conversation, AI-generated plan, hackathon log, or meeting notes…'
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
  const submit = el('button', 'btn btn-primary', t('生成认知债务报告', 'Generate a cognitive debt report')) as HTMLButtonElement
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
    const progress = reportGenerationProgress()
    page.appendChild(progress.node)
    progress.setStage(0)
    let waitingTimer: number | undefined
    try {
      const confusions: Confusion[] = Object.entries(confusionMap)
        .filter(([, text]) => text.trim().length > 0)
        .map(([stepId, text]) => ({ stepId, text: text.trim() }))
      await saveDraftConfusions(draftId, confusions)
      progress.setStage(1)
      // The API currently returns one completed report rather than server-side
      // progress events. Move through analysis stages while that request is
      // pending, and reserve “报告即将完成” for the actual response.
      progress.setStage(2)
      waitingTimer = window.setTimeout(() => progress.setStage(3), 2200)
      const projectId = recallProjectMemoryProjectId() || undefined
      const res = await generateReport({ draftId, projectId })
      if (waitingTimer !== undefined) window.clearTimeout(waitingTimer)
      progress.setStage(4)
      await new Promise(resolve => window.setTimeout(resolve, 260))
      rememberReportId(res.report.id)
      navigate({ name: 'report', reportId: res.report.id })
    } catch (err) {
      if (waitingTimer !== undefined) window.clearTimeout(waitingTimer)
      const message = err instanceof Error ? err.message : '生成失败，请重试'
      progress.markFailed(message)
      status.textContent = message
      submit.disabled = false
      window.setTimeout(() => progress.node.remove(), 900)
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

  page.appendChild(renderProjectMemoryAttach(reportId))

  // 明确区分“被分析的原始材料”和“系统生成的清偿训练”。原始材料只在
  // 用户主动展开时显示，避免把上传的 AI 对话误认成 MindIOU 的提问。
  page.appendChild(renderSourceMaterial(report))

  // 第 1 部分：AI 完成了什么
  page.appendChild(renderSection('一、AI 完成了什么', 'ai-completed',
    report.sections.aiCompleted.map(item => evidenceItem(item.item, item.evidence))))

  // 第 2 部分：用户真正贡献了什么
  page.appendChild(renderSection('二、你真正贡献了什么', 'user-contributed',
    report.sections.userContributed.map(item => evidenceItem(item.item, item.evidence))))

  // 第 3 部分：危险的理解缺口
  page.appendChild(renderSection('三、最危险的理解缺口', 'dangerous-gaps',
    report.sections.dangerousGaps.map(g => gapCard(g.rank, g.gap, g.whyDangerous, g.evidence, g.cognitiveDebtId))))

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

function gapCard(rank: number, gap: string, why: string, evidence: string, cognitiveDebtId?: string): HTMLElement {
  const node = el('div', 'gap-card')
  node.appendChild(el('span', 'gap-rank', String(rank)))
  node.appendChild(el('h3', 'gap-title', gap))
  if (cognitiveDebtId) node.appendChild(el('span', 'gap-debt-binding', `认知欠条：${cognitiveDebtId}`))
  node.appendChild(el('p', 'gap-why', why))
  if (evidence) node.appendChild(el('p', 'gap-evidence', evidence))
  return node
}

function renderSourceMaterial(report: ClearanceReport): HTMLElement {
  const section = el('section', 'section source-material-section')
  section.appendChild(el('h2', 'section-heading', '本报告分析的原始材料'))
  section.appendChild(el('p', 'section-desc', '下面是你提交给 MindIOU 的 AI 对话材料，不是清偿阶段生成的问题。'))
  const details = document.createElement('details')
  details.className = 'source-material-details'
  const summary = document.createElement('summary')
  summary.textContent = `${report.input?.artifactType || 'AI 协作材料'} · 展开查看原文`
  details.appendChild(summary)
  details.appendChild(el('pre', 'source-material-text', report.input?.artifactText || '未保存原始材料'))
  section.appendChild(details)
  return section
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
  if (card.cognitiveDebtId) {
    node.appendChild(el('span', 'card-debt-binding', `对应认知欠条：${card.cognitiveDebtId}`))
  } else if (card.gapRank) {
    node.appendChild(el('span', 'card-debt-binding', `对应缺口：#${card.gapRank}`))
  }
  if (card.target) node.appendChild(el('p', 'card-target', card.target))
  node.appendChild(el('p', 'card-prompt', card.prompt))
  if (card.answeredAt) node.appendChild(el('span', 'card-badge card-answered', '已尝试'))

  const btn = el('button', 'btn btn-primary card-start-btn', '开始清偿')
  btn.onclick = async () => {
    node.querySelector('.error-inline')?.remove()
    btn.disabled = true
    btn.textContent = '正在创建会话…'
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
  drawSession(page, session)
}

function drawSession(page: HTMLElement, session: ClearanceSession): void {
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

  // 清偿问题
  const questionBox = el('section', 'session-question')
  questionBox.appendChild(el('p', 'session-question-label', 'MindIOU 生成的清偿问题'))
  questionBox.appendChild(el('h2', 'session-question-text', session.clearanceQuestion))
  if (session.cognitiveDebtId) {
    questionBox.appendChild(el('p', 'session-debt-binding', `对应认知欠条：${session.cognitiveDebtId}`))
  }
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
    history.appendChild(renderAttempt(attempt.question || session.originalCard.prompt, attempt.answer, attempt.analysis.feedback, attempt.analysis.teaching, attempt.analysis.nextQuestion))
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
      drawSession(page, fresh.session)
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
      drawSession(page, res.session)
      if (res.genesisIdentity?.activatedAt) {
        page.appendChild(renderGenesisIdentityChoice(res.genesisIdentity as GenesisIdentity))
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
      // This is a cross-version historical total supplied for the public copy,
      // not the live Cohort 001 account count returned by the API.
      [t('注册用户', 'Registered users'), 36, t('历史 / 跨版本累计，不等同于当前 001 期实时账户数', 'Historical cross-version total; not the live Cohort 001 account count')],
      [t('已完成首次清偿', 'Completed first repayment'), genesis.actual.completedFirstClearance, t('不是登录签到，而是完成一次真实理解训练', 'A real understanding exercise—not a login check-in')],
      [t('共创建议已采纳', 'Co-creation ideas shipped'), genesis.actual.adoptedSuggestions, t('仅记录已经进入产品的真实改进', 'Only verified improvements already shipped')]
    ] as const
    metricData.forEach(([label, actual, note]) => {
      const item = el('article', 'genesis-metric'); item.appendChild(el('span', 'genesis-metric-label', label)); item.appendChild(el('strong', undefined, String(actual))); item.appendChild(el('small', undefined, note)); metrics.appendChild(item)
    })
    page.append(metrics)

    const wall = el('section', 'genesis-wall'); wall.appendChild(el('h2', undefined, t('首发体验者名录', 'Genesis participants')))
    if (!genesis.members.length) wall.appendChild(el('p', 'genesis-empty', t('等待第一位主动选择公开的完成者。', 'Waiting for the first finisher who chooses to be listed.')))
    wall.appendChild(el('p', 'genesis-section-copy', t('名录优先展示真实的首发体验者编号；用户主动公开昵称后才会显示昵称和头像。这里不会展示邮箱、导入的 AI 对话、原始代码或私密训练内容。', 'The directory first shows real genesis participant numbers; names and avatars appear only after a participant opts in. Emails, imported AI conversations, source code, and private training content are never shown here.')))
    genesis.members.forEach(member => {
      const card = el('article', 'genesis-member')
      const identity = el('div', '')
      identity.appendChild(el('strong', undefined, member.nickname || `${t('首发体验者', 'Genesis participant')} ${member.number}`))
      identity.appendChild(el('small', undefined, member.activatedAt
        ? t('001 期 · 身份有效', 'Cohort 001 · Valid identity')
        : t('001 期 · 已注册首发用户', 'Cohort 001 · Registered genesis user')))
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
      [t('当前已支持', 'Available now'), [t('公开展示完全由用户主动选择', 'Public display is always opt-in'), t('活动页面只展示匿名汇总统计', 'Activity statistics are anonymous aggregates'), t('公开名录不展示邮箱、原始对话、代码或私密训练内容', 'The public directory excludes emails, original chats, code, and private training content')]]
    ].forEach(([title, items]) => { const card = el('article', 'genesis-privacy-card'); card.appendChild(el('h3', '', title as string)); const list = el('ul'); (items as string[]).forEach(item => list.appendChild(el('li', '', item))); card.appendChild(list); privacyGrid.appendChild(card) })
    privacy.appendChild(privacyGrid); page.appendChild(privacy)
  } catch (error) { page.querySelector('.loading')?.remove(); page.appendChild(errorBox(error instanceof Error ? error.message : t('档案加载失败', 'Could not load archive'))) }
  page.appendChild(renderSiteFooter())
}

function renderAttempt(question: string, answer: string, feedback: string, teaching?: string, nextQuestion?: string): HTMLElement {
  const node = el('div', 'attempt')
  node.appendChild(el('p', 'attempt-label', '本轮问题'))
  node.appendChild(el('p', 'attempt-question', question))
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
  const backBtn = el('button', 'btn btn-ghost btn-sm', t('返回', 'Back'))
  backBtn.onclick = () => navigate({ name: 'app' })
  headerActions.appendChild(backBtn)
  const logout = el('button', 'btn btn-ghost btn-sm', t('退出登录', 'Sign out'))
  logout.onclick = async () => {
    await logoutAuth()
    navigate({ name: 'landing' })
  }
  headerActions.appendChild(logout)
  header.appendChild(headerActions)
  page.appendChild(header)

  const intro = el('section', 'app-intro')
  intro.appendChild(el('h2', 'app-heading', t('设备 Token 管理', 'Device token management')))
  intro.appendChild(el('p', 'app-desc', t('为智能眼镜（G2/Rokid）生成专用访问 Token。每个 Token 只显示一次明文，请妥善保存。', 'Generate a dedicated access token for smart glasses (G2/Rokid). The plaintext is shown only once, so save it securely.')))
  page.appendChild(intro)

  // 创建 Token 表单
  const form = el('form', 'device-form') as HTMLFormElement
  const nameInput = el('input', 'login-input') as HTMLInputElement
  nameInput.type = 'text'
  nameInput.placeholder = t('设备名称（如：我的 Rokid）', 'Device name (for example: My Rokid)')
  nameInput.required = true
  form.appendChild(nameInput)

  const status = el('p', 'form-status')
  form.appendChild(status)

  const submit = el('button', 'btn btn-primary', t('生成 Token', 'Generate token')) as HTMLButtonElement
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
      status.textContent = t('请输入设备名称', 'Enter a device name')
      return
    }
    submit.disabled = true
    status.textContent = t('生成中…', 'Generating…')
    tokenDisplay.style.display = 'none'
    try {
      const info = await createDeviceToken(name)
      status.textContent = t('Token 已生成，请立即复制保存（关闭后不可再查看）', 'Token generated. Copy and save it now; it will not be shown again after closing.')
      tokenDisplay.style.display = 'block'
      tokenDisplay.replaceChildren()
      tokenDisplay.appendChild(el('p', 'token-label', `设备：${info.name}`))
      const tokenBox = el('input', 'token-plaintext') as HTMLInputElement
      tokenBox.type = 'text'
      tokenBox.value = info.token || ''
      tokenBox.readOnly = true
      tokenBox.onclick = () => tokenBox.select()
      tokenDisplay.appendChild(tokenBox)
      const copyBtn = el('button', 'btn btn-ghost btn-sm', t('复制', 'Copy'))
      copyBtn.onclick = () => {
        tokenBox.select()
        try { void navigator.clipboard.writeText(tokenBox.value) } catch { /* */ }
      }
      tokenDisplay.appendChild(copyBtn)
      // 刷新列表
      void loadTokens()
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : t('生成失败', 'Could not generate the token')
    } finally {
      submit.disabled = false
    }
  }
  page.appendChild(form)

  // 已有 Token 列表
  const listSection = el('section', 'device-list-section')
  listSection.appendChild(el('h3', 'device-list-title', t('已有设备 Token', 'Existing device tokens')))
  const tokenList = el('div', 'device-list')
  tokenList.appendChild(loading('加载中…'))
  listSection.appendChild(tokenList)
  page.appendChild(listSection)

  // 项目 MCP / Hook Token 管理：与眼镜 Token 共用登录入口，但按项目隔离。
  const hookSection = el('section', 'device-list-section project-hook-section')
  hookSection.appendChild(el('h3', 'device-list-title', t('项目 MCP / Hook Token', 'Project MCP / Hook tokens')))
  hookSection.appendChild(el('p', 'device-token-help', t('给 TRAE、远程 MCP 或代码 Hook 使用。每个 Token 只绑定一个项目，明文只在生成成功后显示一次。', 'For TRAE, remote MCP, or code hooks. Each token is bound to one project, and plaintext is shown only after successful creation.')))

  const hookForm = el('form', 'hook-token-form') as HTMLFormElement
  const projectSelect = el('select', 'login-input') as HTMLSelectElement
  projectSelect.required = true
  const emptyHookProject = el('option', undefined, t('选择项目…', 'Select a project…')) as HTMLOptionElement
  emptyHookProject.value = ''
  projectSelect.appendChild(emptyHookProject)
  const hookNameInput = el('input', 'login-input') as HTMLInputElement
  hookNameInput.type = 'text'
  hookNameInput.placeholder = t('Token 名称（如：评委演示）', 'Token name (for example: Reviewer demo)')
  hookNameInput.required = true
  const hookSubmit = el('button', 'btn btn-primary', t('生成项目 Token', 'Generate project token')) as HTMLButtonElement
  hookSubmit.type = 'submit'
  const hookStatus = el('p', 'form-status')
  const hookTokenDisplay = el('div', 'token-display')
  hookTokenDisplay.style.display = 'none'
  hookForm.append(projectSelect, hookNameInput, hookSubmit, hookStatus, hookTokenDisplay)
  hookSection.appendChild(hookForm)

  const hookListTitle = el('h4', 'hook-token-list-title', t('已有项目 Token', 'Existing project tokens'))
  const hookList = el('div', 'device-list')
  hookList.appendChild(el('p', 'admin-empty', t('请选择项目', 'Select a project')))
  hookSection.append(hookListTitle, hookList)
  page.appendChild(hookSection)

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

  function renderHookTokenList(tokens: ProjectHookTokenInfo[]): void {
    hookList.replaceChildren()
    if (!tokens.length) {
      hookList.appendChild(el('p', 'admin-empty', '暂无项目 Token'))
      return
    }
    for (const token of tokens) {
      const row = el('div', 'device-row hook-token-row')
      row.appendChild(el('span', 'device-name', token.name))
      row.appendChild(el('span', 'device-date', `创建于 ${new Date(token.createdAt).toLocaleDateString('zh-CN')}`))
      if (token.revokedAt) {
        row.appendChild(el('span', 'device-used token-revoked', `已于 ${new Date(token.revokedAt).toLocaleDateString('zh-CN')} 撤销`))
      } else {
        row.appendChild(el('span', 'device-used', '可用'))
        const revokeBtn = el('button', 'btn btn-ghost btn-sm', '撤销') as HTMLButtonElement
        revokeBtn.type = 'button'
        revokeBtn.onclick = async () => {
          revokeBtn.disabled = true
          try {
            await revokeProjectHookToken(projectSelect.value, token.id)
            hookStatus.textContent = '项目 Token 已撤销。'
            await loadHookTokens()
          } catch (error) {
            revokeBtn.disabled = false
            hookStatus.textContent = error instanceof Error ? error.message : '撤销失败'
          }
        }
        row.appendChild(revokeBtn)
      }
      hookList.appendChild(row)
    }
  }

  async function loadHookTokens(hidePlaintext = true): Promise<void> {
    const projectId = projectSelect.value
    if (hidePlaintext) hookTokenDisplay.style.display = 'none'
    if (!projectId) {
      hookList.replaceChildren(el('p', 'admin-empty', '请选择项目'))
      return
    }
    hookList.replaceChildren(loading('加载项目 Token…'))
    try {
      renderHookTokenList(await listProjectHookTokens(projectId))
    } catch (error) {
      hookList.replaceChildren(el('p', 'admin-empty', error instanceof Error ? error.message : '无法加载项目 Token 列表'))
    }
  }

  hookForm.onsubmit = async (event) => {
    event.preventDefault()
    const projectId = projectSelect.value
    const name = hookNameInput.value.trim()
    if (!projectId) {
      hookStatus.textContent = '请先选择项目。'
      return
    }
    if (!name) {
      hookStatus.textContent = '请输入 Token 名称。'
      return
    }
    hookSubmit.disabled = true
    hookStatus.textContent = '生成中…'
    hookTokenDisplay.style.display = 'none'
    try {
      const info = await createProjectHookToken(projectId, name)
      hookStatus.textContent = '项目 Token 已生成，请立即复制保存；关闭或刷新后不可再查看。'
      hookTokenDisplay.replaceChildren()
      hookTokenDisplay.appendChild(el('p', 'token-label', `项目：${projectSelect.selectedOptions[0]?.textContent || projectId} · 名称：${info.name}`))
      const tokenBox = el('input', 'token-plaintext') as HTMLInputElement
      tokenBox.type = 'text'
      tokenBox.value = info.token || ''
      tokenBox.readOnly = true
      tokenBox.setAttribute('aria-label', '项目 Hook Token 明文')
      tokenBox.onclick = () => tokenBox.select()
      hookTokenDisplay.appendChild(tokenBox)
      const copyBtn = el('button', 'btn btn-ghost btn-sm', '复制') as HTMLButtonElement
      copyBtn.type = 'button'
      copyBtn.onclick = () => {
        tokenBox.select()
        try { void navigator.clipboard.writeText(tokenBox.value) } catch { /* */ }
      }
      hookTokenDisplay.appendChild(copyBtn)
      hookTokenDisplay.style.display = 'block'
      hookNameInput.value = ''
      await loadHookTokens(false)
    } catch (error) {
      hookStatus.textContent = error instanceof Error ? error.message : '生成失败'
    } finally {
      hookSubmit.disabled = false
    }
  }

  projectSelect.onchange = () => {
    hookStatus.textContent = ''
    void loadHookTokens()
  }

  try {
    const projects = await listProjects()
    for (const project of projects) {
      const option = el('option') as HTMLOptionElement
      option.value = project.id
      option.textContent = project.name
      projectSelect.appendChild(option)
    }
    const remembered = recallProjectMemoryProjectId()
    const preferred = projects.find(project => project.id === remembered) || projects.find(project => project.name === '认知欠条') || projects[0]
    if (preferred) {
      projectSelect.value = preferred.id
      await loadHookTokens()
    } else {
      hookStatus.textContent = '还没有项目，请先在项目记忆中创建一个项目。'
    }
  } catch (error) {
    hookStatus.textContent = error instanceof Error ? error.message : '无法加载项目列表'
    hookList.replaceChildren(el('p', 'admin-empty', '无法加载项目列表'))
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
    const data = await fetchTodayTraining()
    clear(page)
    page.appendChild(header)
    page.appendChild(intro)

    if (!data.ok) {
      const err = el('section', 'training-error-card')
      err.appendChild(el('p', undefined, data.error || '加载失败'))
      const retry = el('button', 'btn btn-ghost btn-sm', '重试')
      retry.onclick = () => {
        root.replaceChildren()
        void renderTrainingPage(root)
      }
      err.appendChild(retry)
      page.appendChild(err)
      return
    }

    const overview = el('section', 'training-overview-card')
    overview.appendChild(el('h2', undefined, data.totalDue === 0 ? '今天可以轻松一点' : `今天有 ${data.totalDue} 个复训任务`))
    overview.appendChild(el('p', undefined, '每次复训都只记录你实际能解释、识别边界和迁移的证据。'))
    page.appendChild(overview)

    if (data.totalDue === 0) {
      const empty = el('section', 'empty-state training-empty-card')
      empty.appendChild(el('p', 'empty-title', '今天没有复训任务'))
      empty.appendChild(el('p', 'empty-desc', '完成新的认知清偿后，系统会自动生成复训任务。你也可以先去认知清偿查看待处理欠条。'))
      const go = el('button', 'btn btn-ghost btn-sm', '查看认知清偿')
      go.onclick = () => navigate({ name: 'repayment' })
      empty.appendChild(go)
      page.appendChild(empty)
      return
    }

    const list = el('div', 'task-list')
    for (const task of data.tasks) {
      const card = el('div', 'task-card')
      card.appendChild(el('div', 'task-stage', stageLabel(task.trainingStage)))
      card.appendChild(el('p', 'task-prompt', task.prompt))
      const meta = el('div', 'task-meta')
      meta.appendChild(el('span', 'task-due', `到期：${formatDate(task.dueAt)}`))
      card.appendChild(meta)
      const btn = el('button', 'btn btn-primary', '开始复训')
      const actionMessage = el('p', 'training-action-message')
      btn.onclick = async () => {
        btn.disabled = true
        btn.textContent = '正在启动…'
        actionMessage.textContent = ''
        try {
          const result = await startReviewTask(task.id)
          if (result.ok) {
            await renderReviewSubmitForm(page, task)
          } else {
            btn.disabled = false
            btn.textContent = '开始复训'
            actionMessage.textContent = result.error || '启动失败，请稍后重试。'
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            navigate({ name: 'login' })
            return
          }
          btn.disabled = false
          btn.textContent = '开始复训'
          actionMessage.textContent = e instanceof Error ? e.message : '网络错误，请稍后重试。'
        }
      }
      card.appendChild(btn)
      card.appendChild(actionMessage)
      list.appendChild(card)
    }
    page.appendChild(list)
  } catch (e) {
    clear(page)
    page.appendChild(header)
    if (e instanceof ApiError && e.status === 401) {
      const expiredCard = el('section', 'training-session-expired')
      expiredCard.appendChild(el('h2', undefined, t('登录状态已失效', 'Your session has expired')))
      expiredCard.appendChild(el('p', undefined, t('今日复训需要有效的账号登录状态。请重新登录后再继续，训练记录不会被删除。', 'Today’s review requires an active account session. Sign in again to continue; your training records are not deleted.')))
      const login = el('button', 'btn btn-primary btn-sm', t('重新登录', 'Sign in again'))
      login.onclick = () => navigate({ name: 'login' })
      expiredCard.appendChild(login)
      page.appendChild(expiredCard)
    } else {
      const errorCard = el('section', 'training-error-card')
      errorCard.appendChild(el('p', undefined, e instanceof Error ? e.message : t('加载失败，请稍后重试。', 'Could not load today’s review. Please try again.')))
      const retry = el('button', 'btn btn-ghost btn-sm', t('重试', 'Try again'))
      retry.onclick = () => {
        root.replaceChildren()
        void renderTrainingPage(root)
      }
      errorCard.appendChild(retry)
      page.appendChild(errorCard)
    }
  }
}

async function renderReviewSubmitForm(page: HTMLElement, task: ReviewTask): Promise<void> {
  clear(page)
  page.className = 'page page-session page-training-conversation'
  const header = el('header', 'session-header')
  const heading = el('div')
  heading.appendChild(el('p', 'session-kicker', '今日复训 · 人类回答'))
  heading.appendChild(el('h1', 'page-title', '把这条认知欠条讲清楚'))
  heading.appendChild(el('p', 'session-subtitle', '先独立回答，再看 AI 反馈。你的回答会成为后续掌握度和项目所有权的证据。'))
  header.appendChild(heading)
  const headerActions = el('div', 'session-actions')
  const back = el('a', 'btn btn-ghost btn-sm', '返回今日复训') as HTMLAnchorElement
  back.href = '#/training'
  headerActions.appendChild(back)
  header.appendChild(headerActions)
  page.appendChild(header)

  const context = el('section', 'session-sources')
  context.appendChild(el('h2', 'session-section-title', '这次复训的来源'))
  context.appendChild(el('p', 'session-source-note', `训练阶段：${stageLabel(task.trainingStage)} · 到期：${formatDate(task.dueAt)}`))
  try {
    const detail = await fetchTrainingDebtDetail(task.cognitiveDebtId)
    if (detail.ok) {
      context.appendChild(el('p', 'session-source-note', `认知欠条：${detail.debt.gapText}`))
      const links = detail.projectMemory?.links || []
      if (links.length) {
        const sourceList = el('div', 'session-source-list')
        for (const source of links.slice(0, 4)) {
          const sourceCard = el('article', 'session-source-card')
          sourceCard.appendChild(el('strong', undefined, source.artifact.repositoryRelativePath || source.artifact.name))
          sourceCard.appendChild(el('p', undefined, [source.artifact.symbolName, source.artifact.gitCommitHash ? `Commit ${source.artifact.gitCommitHash}` : '', source.workItemTitle, source.sessionTitle].filter(Boolean).join(' · ')))
          sourceList.appendChild(sourceCard)
        }
        context.appendChild(sourceList)
      }
    }
  } catch {
    context.appendChild(el('p', 'session-source-note', '暂时无法加载项目材料，但不影响本次回答。'))
  }
  page.appendChild(context)

  const question = el('section', 'session-question')
  question.appendChild(el('span', 'session-question-label', 'AI 的问题'))
  question.appendChild(el('p', 'session-question-text', task.prompt))
  page.appendChild(question)

  const inputCard = el('section', 'session-input')
  inputCard.appendChild(el('h2', 'session-section-title', '你的回答'))
  inputCard.appendChild(el('p', 'session-input-hint', '请用自己的话解释，不要只复述结论；如果还不确定，也可以明确说出你的疑问。'))
  const textarea = el('textarea', 'answer-input') as HTMLTextAreaElement
  textarea.placeholder = '用你自己的话解释这个概念…'
  textarea.rows = 7
  inputCard.appendChild(textarea)

  const footer = el('div', 'session-input-footer')
  const btn = el('button', 'btn btn-primary', '提交回答') as HTMLButtonElement
  footer.appendChild(btn)
  const actionMessage = el('p', 'session-status')
  footer.appendChild(actionMessage)
  inputCard.appendChild(footer)
  page.appendChild(inputCard)

  btn.onclick = async () => {
    const answer = textarea.value.trim()
    if (!answer) {
      actionMessage.textContent = '请先输入你的回答，再提交评估。'
      return
    }
    btn.disabled = true
    btn.textContent = '正在评估…'
    actionMessage.textContent = ''
    try {
      const result = await submitReviewAnswer(task.id, answer)
      if (result.ok) {
        renderReviewResult(page, result)
      } else {
        btn.disabled = false
        btn.textContent = '提交答案'
        actionMessage.textContent = result.error || '提交失败，请稍后重试。'
      }
    } catch (e) {
      btn.disabled = false
      btn.textContent = '提交答案'
      actionMessage.textContent = e instanceof Error ? e.message : '网络错误，请稍后重试。'
    }
  }
}

function renderReviewResult(page: HTMLElement, result: SubmitReviewResponse): void {
  clear(page)
  page.className = 'page page-session page-training-conversation'
  const header = el('header', 'session-header')
  const heading = el('div')
  heading.appendChild(el('p', 'session-kicker', '今日复训 · AI 反馈'))
  heading.appendChild(el('h1', 'page-title', '这次回答的反馈'))
  heading.appendChild(el('p', 'session-subtitle', '反馈已经保存；你可以回到复训列表继续下一条，也可以打开认知欠条查看完整来源链路。'))
  header.appendChild(heading)
  const actions = el('div', 'session-actions')
  const back = el('a', 'btn btn-ghost btn-sm', '返回今日复训') as HTMLAnchorElement
  back.href = '#/training'
  actions.appendChild(back)
  header.appendChild(actions)
  page.appendChild(header)

  const resultCard = el('section', 'session-result')
  const score = result.evaluation.overallScore
  const passed = result.evaluation.passed
  const scoreEl = el('div', passed ? 'result-score passed' : 'result-score failed', `${score}${t(' 分', ' points')}`)
  resultCard.appendChild(scoreEl)
  resultCard.appendChild(el('p', 'result-status', passed ? '✓ 已通过这一阶段' : '✗ 还需要再验证一次'))
  resultCard.appendChild(el('p', 'session-result-note', `掌握度：${result.profile.overallMastery} · 下一次复习：${formatDate(result.nextReviewAt)}`))
  page.appendChild(resultCard)

  if (result.evaluation.userFeedback) {
    const feedback = el('section', 'session-sources result-feedback')
    feedback.appendChild(el('h3', 'result-section-title', 'AI 反馈'))
    feedback.appendChild(el('p', 'result-feedback-text', result.evaluation.userFeedback))
    page.appendChild(feedback)
  }

  if (result.evaluation.strengths.length > 0) {
    const sec = el('section', 'session-sources result-section')
    sec.appendChild(el('h3', 'result-section-title', '做得好的地方'))
    for (const s of result.evaluation.strengths) {
      sec.appendChild(el('li', 'result-item', s))
    }
    page.appendChild(sec)
  }

  if (result.evaluation.missingPoints.length > 0) {
    const sec = el('section', 'session-sources result-section')
    sec.appendChild(el('h3', 'result-section-title', '需要补充的点'))
    for (const m of result.evaluation.missingPoints) {
      sec.appendChild(el('li', 'result-item', m))
    }
    page.appendChild(sec)
  }

  const next = el('section', 'session-input')
  next.appendChild(el('h2', 'session-section-title', '接下来'))
  next.appendChild(el('p', 'session-input-hint', passed ? '这次证据已保存。请在下一次复训或真实项目验证中继续确认，而不是把一次通过当成永久掌握。' : '请根据反馈重新解释关键因果；下一次复训会继续追踪这条欠条。'))
  const nextActions = el('div', 'session-actions')
  const listLink = el('a', 'btn btn-primary', '继续今日复训') as HTMLAnchorElement
  listLink.href = '#/training'
  const debtLink = el('a', 'btn btn-ghost', '查看这条认知欠条') as HTMLAnchorElement
  debtLink.href = '#/training-debt/' + encodeURIComponent(result.attempt.cognitiveDebtId)
  nextActions.append(listLink, debtLink)
  next.appendChild(nextActions)
  page.appendChild(next)
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
  const page = el('div', 'page page-training-debt-detail page-session')
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

    const summary = el('section', 'session-question')
    summary.appendChild(el('span', 'session-question-label', '认知欠条'))
    summary.appendChild(el('p', 'session-question-text', data.debt.gapText))
    summary.appendChild(el('div', `debt-status level-${data.understandingLevel}`, data.masteryLabel))
    page.appendChild(summary)

    if (data.projectMemory) {
      const memory = el('section', 'project-memory-panel')
      memory.appendChild(el('h2', 'project-memory-panel-title', '这条欠条当时在哪里出现？'))
      memory.appendChild(el('p', 'session-source-note', '下面的项目、功能任务、Agent 会话、文件和决策来自同一条项目记忆链路。'))
      const links = data.projectMemory.links || []
      for (const link of links.slice(0, 12)) {
        const item = el('article', 'project-memory-card')
        const projectHref = '#/projects/' + encodeURIComponent(link.artifact.projectId)
        const artifactLink = el('a', 'project-memory-card-link', link.artifact.repositoryRelativePath || link.artifact.name) as HTMLAnchorElement
        artifactLink.href = projectHref
        item.appendChild(artifactLink)
        item.appendChild(el('p', undefined, [
          link.artifact.symbolName,
          link.artifact.gitCommitHash ? 'Commit ' + link.artifact.gitCommitHash : '',
          link.workItemTitle,
          link.sessionTitle,
          link.decisionTitle
        ].filter(Boolean).join(' · ')))
        const context = el('small', undefined, '打开项目认知账本查看完整链路')
        item.appendChild(context)
        memory.appendChild(item)
      }
      if (!links.length) memory.appendChild(el('p', 'project-memory-empty', '这条欠条目前还没有绑定项目产出物；后续导入会话或手动关联后会显示来源。'))
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
        item.appendChild(el('div', 'attempt-score', `${attempt.evaluation.overallScore}${t(' 分', ' points')}`))
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
      for (const review of data.reviews) {
        const item = el('div', 'review-item')
        item.appendChild(el('span', 'review-stage', stageLabel(review.trainingStage)))
        item.appendChild(el('span', `review-status status-${review.status}`, review.status))
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
