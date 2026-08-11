// MindIOU 面向用户 Web 端 — 认知清偿 V1 页面
// 列表页：待清偿 / 复习队列 / 清偿记录 / 从报告导入欠条。
// 详情页：证据、五维评估、作答、历史、复习信息。
// 安全约定：后端文本一律通过 textContent 上屏（el 工具），不使用 innerHTML；
// 证据的 start/end 偏移只用于后端定位，不向用户展示为"原文位置"以外的用途。

import {
  ApiError,
  dismissRepaymentReviewItem,
  fetchReport,
  getRepaymentGap,
  getRepaymentReviewQueue,
  importRepaymentGap,
  listMvp0Reports,
  listRepaymentGaps,
  repaymentStatus,
  submitRepaymentAttempt
} from './api'
import type {
  ClearanceReport,
  RepaymentAttempt,
  RepaymentDimensionScore,
  RepaymentEvaluation,
  RepaymentGap,
  RepaymentReviewItem
} from './types'
import { clear, el, navigate } from './router'
import { t } from './i18n'

// ── 文案映射 ──

const ACTIVE_STATUSES = ['identified', 'queued', 'attempting', 'partiallyRepaid', 'reviewDue']

function gapStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    identified: '已识别',
    queued: '待清偿',
    attempting: '作答中',
    partiallyRepaid: '部分清偿',
    repaid: '已清偿',
    reviewDue: '待复习',
    archived: '已归档'
  }
  return labels[status] || status
}

function priorityLabel(priority: string): string {
  const labels: Record<string, string> = { high: '高', medium: '中', low: '低' }
  return labels[priority] || priority
}

function questionTypeLabel(questionType: string): string {
  const labels: Record<string, string> = {
    feynman_reexplain: '费曼重述',
    boundary_probe: '边界追问',
    transfer_scenario: '迁移场景',
    verification_plan: '验证计划'
  }
  return labels[questionType] || questionType
}

function uncertaintyLabel(uncertainty: string): string {
  const labels: Record<string, string> = { low: '低', medium: '中', high: '高' }
  return labels[uncertainty] || uncertainty
}

const DIMENSION_LABELS: [keyof RepaymentEvaluation['dimensions'], string][] = [
  ['conceptualUnderstanding', '概念理解'],
  ['causalExplanation', '因果解释'],
  ['practicalReproduction', '实践复现'],
  ['boundariesAndRisks', '边界与风险'],
  ['transferAbility', '迁移能力']
]

// 本地时间显示（本地时区，风格与 pages.ts 的 formatDate 一致）
function formatLocal(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '请求失败，请稍后重试'
}

// 页面内错误条（含重试），不白屏、不输出堆栈
function renderErrorBar(container: HTMLElement, message: string, retry: () => void, cause?: unknown): void {
  const bar = el('div', 'error-box repayment-error-bar')
  bar.appendChild(el('span', 'repayment-error-text', message))
  const throttled = cause instanceof ApiError && [429, 503].includes(cause.status)
  const btn = el('button', 'btn btn-ghost btn-sm', throttled ? '请稍后再试' : '重试') as HTMLButtonElement
  btn.disabled = throttled
  btn.onclick = retry
  bar.appendChild(btn)
  container.appendChild(bar)
  if (throttled) {
    window.setTimeout(() => {
      btn.disabled = false
      btn.textContent = t('重试', 'Try again')
    }, Math.max(4000, (cause.retryAfterSeconds || 0) * 1000))
  }
}

function emptyState(title: string, desc: string): HTMLElement {
  const box = el('div', 'empty-state')
  box.appendChild(el('p', 'empty-title', title))
  box.appendChild(el('p', 'empty-desc', desc))
  return box
}

// ── 列表页 ──

export async function renderRepaymentPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-repayment')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '认知清偿'))
  const headerActions = el('div', 'header-actions')
  const backBtn = el('button', 'btn btn-ghost btn-sm', '返回工作区')
  backBtn.onclick = () => navigate({ name: 'app' })
  headerActions.appendChild(backBtn)
  header.appendChild(headerActions)
  page.appendChild(header)
  page.appendChild(el('p', 'loading', '正在加载认知清偿…'))
  root.appendChild(page)

  const retry = (): void => {
    clear(root)
    void renderRepaymentPage(root)
  }

  // 功能开关：未启用时只渲染提示，不请求业务数据
  let enabled = false
  try {
    const status = await repaymentStatus()
    enabled = Boolean(status.ok && status.enabled)
  } catch (err) {
    clear(page)
    page.appendChild(header)
    renderErrorBar(page, errorMessage(err), retry, err)
    return
  }
  if (!enabled) {
    clear(page)
    page.appendChild(header)
    const notice = el('div', 'notice notice-fallback')
    notice.appendChild(el('p', undefined, '认知清偿 V1 未启用。该能力正在逐步开放，请先从工作区生成认知债务报告。'))
    page.appendChild(notice)
    const back = el('button', 'btn btn-primary', '返回工作区')
    back.onclick = () => navigate({ name: 'app' })
    page.appendChild(back)
    return
  }

  try {
    const [gapsRes, queueRes, reportsRes] = await Promise.all([
      listRepaymentGaps(),
      getRepaymentReviewQueue(),
      listMvp0Reports()
    ])
    clear(page)
    page.appendChild(header)

    const gaps = gapsRes.gaps || []
    const reviewItems = (queueRes.items || []).filter(item => item.status === 'pending')
    const reports = reportsRes.reports || []

    const overview = el('section', 'repayment-overview-card')
    overview.appendChild(el('p', 'repayment-overview-copy', '把报告里的认知缺口变成可作答、可复习、可验证的清偿路径。'))
    const overviewMetrics = el('div', 'repayment-overview-metrics')
    ;[
      [gaps.filter(gap => ACTIVE_STATUSES.includes(gap.status)).length, '待清偿'],
      [reviewItems.length, '待复习'],
      [gaps.filter(gap => gap.status === 'repaid').length, '已清偿']
    ].forEach(([value, label]) => {
      const metric = el('article', 'repayment-overview-metric')
      metric.append(el('strong', undefined, String(value)), el('span', undefined, String(label)))
      overviewMetrics.appendChild(metric)
    })
    overview.appendChild(overviewMetrics)
    page.appendChild(overview)

    // 待清偿
    const activeSection = el('section', 'repayment-section-card')
    activeSection.appendChild(el('div', 'repayment-section-heading', '待清偿'))
    activeSection.appendChild(el('p', 'section-hint', '已生成报告中的危险缺口会自动进入这里，不需要再次手动导入。'))
    const active = gaps.filter(gap => ACTIVE_STATUSES.includes(gap.status))
    if (active.length === 0) {
      activeSection.appendChild(emptyState('暂无待清偿的认知欠条', '生成报告后，危险缺口会自动出现在这里。'))
    } else {
      const list = el('div', 'gap-list')
      for (const gap of active) list.appendChild(gapRow(gap))
      activeSection.appendChild(list)
    }
    page.appendChild(activeSection)

    // 复习队列
    const reviewSection = el('section', 'repayment-section-card')
    reviewSection.appendChild(el('div', 'repayment-section-heading', '复习队列'))
    reviewSection.appendChild(el('p', 'section-hint', '完成第一次清偿作答后，系统会根据结果安排间隔复习。'))
    if (reviewItems.length === 0) {
      reviewSection.appendChild(emptyState('暂时没有到期复习', '先从“待清偿”选择一条作答，系统会在需要复习时自动放入这里。'))
    } else {
      const list = el('div', 'review-list')
      for (const item of reviewItems) list.appendChild(reviewRow(item, retry))
      reviewSection.appendChild(list)
    }
    page.appendChild(reviewSection)

    // 清偿记录
    const repaidSection = el('section', 'repayment-section-card')
    repaidSection.appendChild(el('div', 'repayment-section-heading', '清偿记录'))
    repaidSection.appendChild(el('p', 'section-hint', '达到系统清偿条件的欠条会在这里保留记录。'))
    const repaid = gaps.filter(gap => gap.status === 'repaid')
    if (repaid.length === 0) {
      repaidSection.appendChild(emptyState('还没有已清偿的欠条', '两次独立通过评估后，欠条才会被标记为已清偿。'))
    } else {
      const list = el('div', 'gap-list')
      for (const gap of repaid) list.appendChild(repaidRow(gap))
      repaidSection.appendChild(list)
    }
    page.appendChild(repaidSection)

    // 从报告导入欠条
    const importSec = el('section', 'repayment-import')
    page.appendChild(importSec)
    renderImportSection(importSec, reports)
  } catch (err) {
    clear(page)
    page.appendChild(header)
    renderErrorBar(page, errorMessage(err), retry, err)
  }
}

function gapRow(gap: RepaymentGap): HTMLElement {
  const row = el('div', 'gap-row')
  const main = el('div', 'gap-row-main')
  main.appendChild(el('p', 'gap-row-title', gap.title || '未命名欠条'))
  const meta = el('div', 'gap-row-meta')
  meta.appendChild(el('span', `status-badge status-${gap.status}`, gapStatusLabel(gap.status)))
  meta.appendChild(el('span', 'gap-confidence', `置信度 ${Math.round((gap.confidence || 0) * 100)}%`))
  if (gap.nextReviewAt) {
    meta.appendChild(el('span', 'gap-next-review', `下次复习：${formatLocal(gap.nextReviewAt)}`))
  }
  main.appendChild(meta)
  row.appendChild(main)
  row.onclick = () => navigate({ name: 'repayment-detail', gapId: gap.gapId })
  return row
}

function repaidRow(gap: RepaymentGap): HTMLElement {
  const row = el('div', 'gap-row')
  const main = el('div', 'gap-row-main')
  main.appendChild(el('p', 'gap-row-title', gap.title || '未命名欠条'))
  const meta = el('div', 'gap-row-meta')
  meta.appendChild(el('span', 'status-badge status-repaid', gapStatusLabel('repaid')))
  meta.appendChild(el('span', 'gap-repaid-at', `清偿时间：${formatLocal(gap.updatedAt)}`))
  if (gap.latestAttempt?.evaluation) {
    meta.appendChild(el('span', 'gap-last-score', `${t('最近评估 ', 'Latest evaluation ')}${gap.latestAttempt.evaluation.overallScore}${t(' 分', ' points')}`))
  }
  main.appendChild(meta)
  row.appendChild(main)
  row.onclick = () => navigate({ name: 'repayment-detail', gapId: gap.gapId })
  return row
}

function reviewRow(item: RepaymentReviewItem, onChanged: () => void): HTMLElement {
  const row = el('div', 'review-row')
  const main = el('div', 'review-row-main')
  main.appendChild(el('p', 'review-row-title', item.gapTitle || '关联欠条'))
  const meta = el('div', 'gap-row-meta')
  meta.appendChild(el('span', `priority-badge priority-${item.priority}`, `优先级${priorityLabel(item.priority)}`))
  meta.appendChild(el('span', 'review-due', `到期：${formatLocal(item.dueAt)}`))
  meta.appendChild(el('span', 'review-type', questionTypeLabel(item.nextQuestionType)))
  main.appendChild(meta)
  if (item.reason) main.appendChild(el('p', 'review-reason', item.reason))
  row.appendChild(main)

  const actions = el('div', 'review-row-actions')
  const goBtn = el('button', 'btn btn-ghost btn-sm', '去作答')
  goBtn.onclick = () => navigate({ name: 'repayment-detail', gapId: item.gapId })
  actions.appendChild(goBtn)
  const dismissBtn = el('button', 'btn btn-ghost btn-sm', '忽略') as HTMLButtonElement
  dismissBtn.onclick = async () => {
    dismissBtn.disabled = true
    try {
      await dismissRepaymentReviewItem(item.reviewItemId)
      onChanged()
    } catch {
      dismissBtn.disabled = false
      dismissBtn.textContent = t('失败，再试', 'Failed. Try again')
    }
  }
  actions.appendChild(dismissBtn)
  row.appendChild(actions)
  return row
}

function renderImportSection(container: HTMLElement, reports: ClearanceReport[]): void {
  clear(container)
  container.appendChild(el('h2', 'section-title', '历史报告'))
  container.appendChild(el('p', 'section-hint', '历史报告仍保留在这里用于回看；新报告的缺口会自动进入待清偿。'))
  if (reports.length === 0) {
    container.appendChild(emptyState('还没有认知债务报告', '先回到工作区粘贴一段 AI 协作材料，生成报告后再来导入欠条。'))
    return
  }
  const list = el('div', 'report-import-list')
  for (const report of reports) {
    list.appendChild(reportImportItem(report))
  }
  container.appendChild(list)
}

function reportImportItem(report: ClearanceReport): HTMLElement {
  const item = el('div', 'report-import-item')
  const head = el('button', 'report-import-head') as HTMLButtonElement
  head.type = 'button'
  head.appendChild(el('span', 'report-import-label', `${report.input?.artifactType || '材料'} · ${formatLocal(report.createdAt)}`))
  head.appendChild(el('span', 'report-import-toggle', '展开'))
  item.appendChild(head)
  const body = el('div', 'report-import-body')
  body.style.display = 'none'
  item.appendChild(body)

  let loaded = false
  head.onclick = async () => {
    if (body.style.display !== 'none') {
      body.style.display = 'none'
      return
    }
    body.style.display = ''
    if (loaded) return
    loaded = true
    clear(body)
    body.appendChild(el('p', 'loading', '正在读取报告缺口…'))
    try {
      const res = await fetchReport(report.id)
      clear(body)
      if (!res.ok) {
        body.appendChild(el('p', 'error-box', res.error || '报告加载失败'))
        return
      }
      const dangerousGaps = res.report.sections?.dangerousGaps || []
      if (dangerousGaps.length === 0) {
        body.appendChild(el('p', 'empty-desc', '这份报告没有可导入的危险缺口。'))
        return
      }
      for (const g of dangerousGaps) {
        body.appendChild(importGapRow(report.id, g as { rank: number; gap?: string; title?: string }))
      }
    } catch (err) {
      clear(body)
      body.appendChild(el('p', 'error-box', errorMessage(err)))
    }
  }
  return item
}

function importGapRow(reportId: string, gap: { rank: number; gap?: string; title?: string }): HTMLElement {
  const row = el('div', 'import-gap-row')
  const text = (gap.title || gap.gap || '').trim()
  row.appendChild(el('p', 'import-gap-text', `#${gap.rank} ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`))
  const btn = el('button', 'btn btn-primary btn-sm', '导入清偿') as HTMLButtonElement
  btn.onclick = async () => {
    btn.disabled = true
    btn.textContent = t('导入中…', 'Importing…')
    try {
      const res = await importRepaymentGap(reportId, gap.rank)
      navigate({ name: 'repayment-detail', gapId: res.gap.gapId })
    } catch (err) {
      btn.disabled = false
      btn.textContent = t('导入清偿', 'Import for repayment')
      row.appendChild(el('p', 'error-inline', errorMessage(err)))
    }
  }
  row.appendChild(btn)
  return row
}

// ── 详情页 ──

export async function renderRepaymentDetailPage(root: HTMLElement, gapId: string): Promise<void> {
  const page = el('div', 'page page-repayment-detail')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '欠条详情'))
  const headerActions = el('div', 'header-actions')
  const backBtn = el('button', 'btn btn-ghost btn-sm', '返回列表')
  backBtn.onclick = () => navigate({ name: 'repayment' })
  headerActions.appendChild(backBtn)
  header.appendChild(headerActions)
  page.appendChild(header)
  page.appendChild(el('p', 'loading', '正在加载欠条详情…'))
  root.appendChild(page)

  const retry = (): void => {
    clear(root)
    void renderRepaymentDetailPage(root, gapId)
  }

  let data: Awaited<ReturnType<typeof getRepaymentGap>>
  try {
    data = await getRepaymentGap(gapId)
  } catch (err) {
    clear(page)
    page.appendChild(header)
    renderErrorBar(page, errorMessage(err), retry, err)
    return
  }
  clear(page)
  page.appendChild(header)
  if (!data.ok) {
    renderErrorBar(page, data.error || '加载失败', retry)
    return
  }

  const { gap } = data
  const attempts = data.attempts || []
  const reviewItems = data.reviewItems || []
  const latest = attempts.length > 0 ? attempts[attempts.length - 1] : null

  // 本地评价降级提示（黄色，醒目）
  if (latest?.fallbackUsed) {
    const notice = el('div', 'notice notice-fallback')
    notice.appendChild(el('p', undefined, 'AI 评价暂不可用，本次为本地评价结果，可稍后重试。'))
    page.appendChild(notice)
  }

  // 顶部摘要
  const summary = el('section', 'repayment-summary')
  summary.appendChild(el('h2', 'repayment-title', gap.title || '未命名欠条'))
  const meta = el('div', 'gap-row-meta')
  meta.appendChild(el('span', `status-badge status-${gap.status}`, gapStatusLabel(gap.status)))
  meta.appendChild(el('span', 'gap-confidence', `置信度 ${Math.round((gap.confidence || 0) * 100)}%`))
  meta.appendChild(el('span', 'gap-level', `能力基线：${gap.userCapabilityLevel || '未知'}`))
  summary.appendChild(meta)
  page.appendChild(summary)

  // 为什么重要
  if (gap.whyItMatters) {
    const sec = el('section', 'repayment-section')
    sec.appendChild(el('h3', 'section-title', '为什么重要'))
    sec.appendChild(el('p', 'section-text', gap.whyItMatters))
    page.appendChild(sec)
  }

  // 来源证据
  const evSec = el('section', 'repayment-section')
  evSec.appendChild(el('h3', 'section-title', '来源证据'))
  if (!gap.evidence || gap.evidence.length === 0) {
    evSec.appendChild(el('p', 'empty-desc', '该欠条没有附带证据记录。'))
  } else {
    for (const ev of gap.evidence) {
      const block = el('div', 'evidence-block')
      block.appendChild(el('blockquote', 'evidence-quote', ev.excerpt))
      const evMeta = el('div', 'evidence-meta')
      if (ev.evidenceType === 'direct_quote') {
        evMeta.appendChild(el('span', 'evidence-badge evidence-direct', '原文证据 · 来自输入材料'))
      } else {
        evMeta.appendChild(el('span', 'evidence-badge evidence-inferred', '推断'))
        evMeta.appendChild(el('span', 'evidence-inferred-note', '未能定位到输入材料原文，置信度已下调'))
      }
      block.appendChild(evMeta)
      evSec.appendChild(block)
    }
  }
  page.appendChild(evSec)

  // 系统判断依据
  if (gap.systemReasoningSummary) {
    const sec = el('section', 'repayment-section')
    sec.appendChild(el('h3', 'section-title', '系统判断依据'))
    sec.appendChild(el('p', 'section-text', gap.systemReasoningSummary))
    page.appendChild(sec)
  }

  // 验证方式
  if (gap.verificationMethod) {
    const sec = el('section', 'repayment-section')
    sec.appendChild(el('h3', 'section-title', '验证方式'))
    sec.appendChild(el('p', 'section-text', gap.verificationMethod))
    page.appendChild(sec)
  }

  // 最近一次评估
  if (latest) {
    page.appendChild(renderLatestAttempt(latest))
  }

  // 作答区（已归档欠条不可作答，后端同样返回 409）
  if (gap.status === 'archived') {
    const sec = el('section', 'repayment-section')
    sec.appendChild(el('p', 'empty-desc', '该欠条已归档，不能再提交作答。'))
    page.appendChild(sec)
  } else {
    page.appendChild(renderAnswerForm(root, gap.gapId))
  }

  // 作答历史
  if (attempts.length > 0) {
    const sec = el('section', 'repayment-section')
    sec.appendChild(el('h3', 'section-title', '作答历史'))
    for (const at of [...attempts].reverse().slice(0, 10)) {
      const item = el('div', 'attempt-row')
      item.appendChild(el('span', 'attempt-score', `${at.evaluation?.overallScore ?? 0}${t(' 分', ' points')}`))
      item.appendChild(el('span', at.evaluation?.passed ? 'attempt-pass passed' : 'attempt-pass failed', at.evaluation?.passed ? '通过' : '未通过'))
      item.appendChild(el('span', 'attempt-status', gapStatusLabel(at.repaymentStatus)))
      item.appendChild(el('span', 'attempt-date', formatLocal(at.submittedAt)))
      sec.appendChild(item)
    }
    page.appendChild(sec)
  }

  // 复习信息（该欠条的待处理复习项）
  const pendingReviews = reviewItems.filter(item => item.status === 'pending')
  if (pendingReviews.length > 0) {
    const sec = el('section', 'repayment-section')
    sec.appendChild(el('h3', 'section-title', '复习信息'))
    for (const item of pendingReviews) {
      const row = el('div', 'review-row')
      const meta2 = el('div', 'gap-row-meta')
      meta2.appendChild(el('span', `priority-badge priority-${item.priority}`, `优先级${priorityLabel(item.priority)}`))
      meta2.appendChild(el('span', 'review-due', `到期：${formatLocal(item.dueAt)}`))
      meta2.appendChild(el('span', 'review-type', questionTypeLabel(item.nextQuestionType)))
      row.appendChild(meta2)
      if (item.reason) row.appendChild(el('p', 'review-reason', item.reason))
      sec.appendChild(row)
    }
    page.appendChild(sec)
  }
}

function renderLatestAttempt(attempt: RepaymentAttempt): HTMLElement {
  const sec = el('section', 'repayment-section repayment-latest')
  sec.appendChild(el('h3', 'section-title', '最近一次评估'))
  const evaluation = attempt.evaluation
  if (evaluation?.dimensions) {
    const dims = el('div', 'dim-list')
    for (const [key, label] of DIMENSION_LABELS) {
      const dim = evaluation.dimensions[key]
      if (dim) dims.appendChild(dimRow(label, dim))
    }
    sec.appendChild(dims)
    sec.appendChild(el('p', 'dim-overall', `${t('综合得分：', 'Overall score: ')}${evaluation.overallScore}${t(' 分 · ', ' points · ')}${evaluation.passed ? t('本次通过', 'Passed this time') : t('本次未通过', 'Not passed this time')}`))
  }
  if (attempt.feedback) {
    const fb = el('div', 'feedback-box')
    fb.appendChild(el('h4', 'feedback-title', 'AI 反馈'))
    fb.appendChild(el('p', 'feedback-text', attempt.feedback))
    sec.appendChild(fb)
  }
  if (attempt.nextQuestion) {
    const nq = el('div', 'next-question-box')
    nq.appendChild(el('h4', 'feedback-title', '下一问'))
    nq.appendChild(el('p', 'feedback-text', attempt.nextQuestion))
    sec.appendChild(nq)
  }
  return sec
}

function dimRow(label: string, dim: RepaymentDimensionScore): HTMLElement {
  const row = el('div', 'dim-row')
  const head = el('div', 'dim-head')
  head.appendChild(el('span', 'dim-label', label))
  head.appendChild(el('span', 'dim-score', `${dim.score}`))
  head.appendChild(el('span', `uncertainty-badge uncertainty-${dim.uncertainty}`, `不确定度${uncertaintyLabel(dim.uncertainty)}`))
  row.appendChild(head)
  const meter = el('div', 'dim-meter')
  const fill = el('div', 'dim-meter-fill')
  fill.style.width = `${Math.max(0, Math.min(100, dim.score))}%`
  meter.appendChild(fill)
  row.appendChild(meter)
  if (dim.feedback) row.appendChild(el('p', 'dim-feedback', dim.feedback))
  if (dim.evidence) row.appendChild(el('p', 'dim-evidence', `依据：${dim.evidence}`))
  return row
}

function renderAnswerForm(root: HTMLElement, gapId: string): HTMLElement {
  const sec = el('section', 'repayment-section repayment-answer')
  sec.appendChild(el('h3', 'section-title', '我的清偿作答'))
  sec.appendChild(el('p', 'section-hint', '用自己的话解释这个缺口涉及的概念与因果，系统会从五个维度评估。'))

  const textarea = el('textarea', 'answer-textarea') as HTMLTextAreaElement
  textarea.placeholder = t('写下你的解释…', 'Write your explanation…')
  textarea.rows = 6
  sec.appendChild(textarea)

  const confRow = el('div', 'confidence-row')
  confRow.appendChild(el('label', 'confidence-label', '自评信心（可选）'))
  const select = el('select', 'confidence-select') as HTMLSelectElement
  const options: [string, string][] = [
    ['', '不填写'],
    ['1', '1 · 很不确定'],
    ['2', '2 · 不太确定'],
    ['3', '3 · 一般'],
    ['4', '4 · 比较确定'],
    ['5', '5 · 很确定']
  ]
  for (const [value, label] of options) {
    const opt = el('option', undefined, label) as HTMLOptionElement
    opt.value = value
    select.appendChild(opt)
  }
  confRow.appendChild(select)
  sec.appendChild(confRow)

  const submit = el('button', 'btn btn-primary', '提交作答') as HTMLButtonElement
  submit.disabled = true
  const status = el('p', 'form-status')
  sec.appendChild(submit)
  sec.appendChild(status)

  // 本次作答期间复用同一 clientAttemptId：双击与失败重试不会产生重复记录
  const clientAttemptId = newClientAttemptId()

  textarea.oninput = () => {
    submit.disabled = textarea.value.trim().length === 0
  }

  submit.onclick = async () => {
    const answer = textarea.value.trim()
    if (!answer) return
    submit.disabled = true
    submit.textContent = t('评估中…', 'Evaluating…')
    status.textContent = ''
    try {
      const payload: { answer: string; selfConfidence?: number; clientAttemptId: string } = { answer, clientAttemptId }
      if (select.value) payload.selfConfidence = Number(select.value)
      await submitRepaymentAttempt(gapId, payload)
      // 成功后整体重载详情：展示新评估、最新状态与复习安排
      clear(root)
      await renderRepaymentDetailPage(root, gapId)
    } catch (err) {
      status.textContent = errorMessage(err)
      submit.disabled = false
      submit.textContent = t('提交作答', 'Submit answer')
    }
  }
  return sec
}

function newClientAttemptId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* 不可用时走下方降级 */
  }
  return `caid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
