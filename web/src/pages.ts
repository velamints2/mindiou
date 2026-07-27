// MindIOU 面向用户 Web 端 — 页面渲染
// 结构化 HTML 语义节点 + 占位 className，视觉设计留给设计师 agent。
// 核心闭环：登录 → 输入材料 → 报告 → 选卡 → 清偿会话 → 结果

import {
  checkHealth,
  createSession,
  endSession,
  fetchDraft,
  fetchReport,
  fetchSession,
  generateReport,
  generateTimeline,
  getAccessToken,
  logoutAccess,
  saveDraftConfusions,
  setAccessToken,
  submitAnswer,
  validateAccessToken
} from './api'
import type {
  ClearanceReport,
  ClearanceSession,
  Confusion,
  ConfusionResolution,
  Draft,
  FeynmanCard,
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

// ── 登录页 ──

export function renderLoginPage(root: HTMLElement): void {
  const existing = getAccessToken()
  const page = el('div', 'page page-login')
  page.appendChild(el('h1', 'brand-title', 'MindIOU'))
  page.appendChild(el('p', 'brand-subtitle', '把 AI 代劳转化为真实能力成长'))

  const card = el('div', 'login-card')
  card.appendChild(el('h2', 'login-heading', '邀请码入口'))
  card.appendChild(el('p', 'login-desc', '请输入你收到的邀请码以继续。'))
  card.appendChild(connectionStatusBadge())

  const form = el('form', 'login-form') as HTMLFormElement
  const input = el('input', 'login-input') as HTMLInputElement
  input.type = 'password'
  input.placeholder = '输入邀请码'
  input.value = existing || ''
  input.required = true
  input.autocomplete = 'current-password'
  form.appendChild(input)

  const status = el('p', 'login-status')
  form.appendChild(status)

  const submit = el('button', 'btn btn-primary', '进入') as HTMLButtonElement
  submit.type = 'submit'
  form.appendChild(submit)

  form.onsubmit = async (e) => {
    e.preventDefault()
    const token = input.value.trim()
    if (!token) {
      status.textContent = '请输入邀请码'
      return
    }
    submit.disabled = true
    status.textContent = '验证中…'
    try {
      const ok = await validateAccessToken(token)
      if (ok) {
        setAccessToken(token)
        status.textContent = ''
        navigate({ name: 'app' })
      } else {
        status.textContent = '邀请码无效，请检查后重试'
      }
    } catch {
      // 网络错误时也接受 token：后端可能未开启鉴权，仅网络不通
      status.textContent = '无法连接服务，请稍后重试'
    } finally {
      submit.disabled = false
    }
  }
  card.appendChild(form)
  page.appendChild(card)
  root.appendChild(page)
}

// ── 产品页：输入材料 ──

export function renderAppPage(root: HTMLElement): void {
  const page = el('div', 'page page-app')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', 'MindIOU'))
  const headerActions = el('div', 'header-actions')
  headerActions.appendChild(connectionStatusBadge())
  const logout = el('button', 'btn btn-ghost btn-sm', '退出登录')
  logout.onclick = async () => {
    await logoutAccess()
    navigate({ name: 'landing' })
  }
  headerActions.appendChild(logout)
  header.appendChild(headerActions)
  page.appendChild(header)

  const intro = el('section', 'app-intro')
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
  const textarea = el('textarea', 'artifact-input') as HTMLTextAreaElement
  textarea.placeholder = '粘贴 ChatGPT/Claude 对话、AI 生成的方案、黑客松记录、会议纪要…'
  textarea.maxLength = 30000
  form.appendChild(textarea)

  // 字数计数
  const counter = el('p', 'input-counter', '0 / 30000')
  form.appendChild(counter)

  const hint = el('p', 'input-hint', '公开体验环境：请勿粘贴密码、密钥或客户隐私。')
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
    counter.textContent = `${len} / 30000`
    counter.classList.toggle('is-warn', len > 27000)
    submit.disabled = textarea.value.trim().length < 10
  }

  form.onsubmit = async (e) => {
    e.preventDefault()
    const text = textarea.value.trim()
    if (text.length < 10) return
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
  root.appendChild(page)
}

// ── 时间线与困惑标注页（三段式·第二段） ──

export async function renderTimelinePage(root: HTMLElement, draftId: string): Promise<void> {
  const page = el('div', 'page page-timeline')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', 'MindIOU'))
  const headerActions = el('div', 'header-actions')
  headerActions.appendChild(connectionStatusBadge())
  const logout = el('button', 'btn btn-ghost btn-sm', '退出登录')
  logout.onclick = async () => { await logoutAccess(); navigate({ name: 'landing' }) }
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

  const btn = el('button', 'btn btn-primary card-start-btn', '开始清偿')
  btn.onclick = async () => {
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
      node.appendChild(errNode)
      setTimeout(() => errNode.remove(), 4000)
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
