// 项目认知所有权地图 — 前端页面组件
// 职责：展示项目模块的所有权状态、AI 决策、用户证据、欠条与下一步训练入口。
// 与 /cognitive-profile 区分：此处只展示一个具体项目的模块所有权状态，
// 不替代跨项目的用户能力画像。
// 状态由后端确定性代码计算，前端只负责展示，不做所有权判断。

import {
  fetchModuleDetail,
  fetchProjectOwnership,
  listProjects,
  recalculateOwnership,
  type ModuleDetailResponse,
  type ModuleDetailView,
  type ModuleOwnershipStatus,
  type ModuleOwnershipView,
  type ProjectOwnershipView,
  type UserEvidenceGroup,
  type UserEvidenceItem
} from './api'
import { clear, el, navigate } from './router'

// ── 状态标签映射 ──
// 与后端 MODULE_STATUS_LABELS 保持一致，避免依赖后端返回的 statusLabel。

const MODULE_STATUS_LABEL: Record<ModuleOwnershipStatus, string> = {
  high_risk_unowned: '高风险无人负责',
  needs_initial_understanding: '缺少初步理解',
  needs_error_boundary_validation: '缺少错误与边界验证',
  needs_transfer_validation: '缺少迁移验证',
  needs_real_work_validation: '缺少独立修改证据',
  owned: '已具备人类所有权'
}

const MODULE_STATUS_CLASS: Record<ModuleOwnershipStatus, string> = {
  high_risk_unowned: 'is-high-risk',
  needs_initial_understanding: 'is-needs-understanding',
  needs_error_boundary_validation: 'is-needs-boundary',
  needs_transfer_validation: 'is-needs-transfer',
  needs_real_work_validation: 'is-needs-realwork',
  owned: 'is-owned'
}

const EVIDENCE_LEVEL_LABEL: Record<number, string> = {
  0: 'E0 · 无证据',
  1: 'E1 · 初步理解',
  2: 'E2 · 能独立解释',
  3: 'E3 · 能识别错误',
  4: 'E4 · 能迁移使用',
  5: 'E5 · 能独立修改'
}

const RISK_LABEL: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  critical: '关键风险'
}

const RISK_CLASS: Record<string, string> = {
  low: 'is-risk-low',
  medium: 'is-risk-medium',
  high: 'is-risk-high',
  critical: 'is-risk-critical'
}

// 训练阶段中文标签
const TRAINING_STAGE_LABEL: Record<string, string> = {
  initial_compensation: '初始补偿训练',
  delayed_recall: '延迟回忆',
  misconception_check: '误区识别',
  scenario_transfer: '场景迁移',
  error_detection: '错误检测',
  real_work_validation: '真实工作验证'
}

// 决策类型标签
const DECISION_TYPE_LABEL: Record<string, string> = {
  architecture: '架构',
  security: '安全',
  database: '数据库',
  dependency: '依赖',
  api: 'API',
  deployment: '部署',
  product: '产品',
  other: '其他'
}

// 决策者标签
const DECISION_MAKER_LABEL: Record<string, string> = {
  agent: 'AI',
  user: '用户',
  collaborative: '协作',
  unknown: '未知'
}

// 用户参与程度标签
const USER_PARTICIPATION_LABEL: Record<string, string> = {
  none: '未参与',
  accepted: '接受',
  selected: '选择',
  modified: '修改',
  initiated: '发起'
}

// 证据类型标签（用于缺失证据展示）
const EVIDENCE_TYPE_LABEL: Record<string, string> = {
  reading_acceptance: '阅读/接受',
  independent_explanation: '独立解释',
  delayed_recall: '延迟回忆',
  error_detection: '错误检测',
  misconception_check: '误区识别',
  scenario_transfer: '场景迁移',
  real_work_modification: '真实修改',
  test_passed: '测试通过',
  manual_review: '人工评审'
}

// 风险类型标签
const RISK_TYPE_LABEL: Record<string, string> = {
  security_risk: '安全风险',
  privacy_risk: '隐私风险',
  financial_risk: '财务风险',
  compliance_risk: '合规风险',
  reliability_risk: '可靠性风险'
}

// 欠条状态标签
const DEBT_STATUS_LABEL: Record<string, string> = {
  open: '未处理',
  in_progress: '进行中',
  practicing: '练习中',
  provisionally_cleared: '临时清偿',
  mastered: '已掌握',
  relapsed: '已复发',
  ignored: '已忽略'
}

// ── 通用组件 ──

function loadingNode(message: string): HTMLElement {
  return el('div', 'loading', message)
}

function errorNode(message: string): HTMLElement {
  return el('div', 'error-box', message)
}

function emptyStateNode(message: string): HTMLElement {
  return el('div', 'empty-state', message)
}

function formatTime(iso?: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '—'
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  } catch {
    return '—'
  }
}

function backToProjectsBtn(): HTMLElement {
  const btn = el('button', 'btn btn-ghost btn-sm', '← 返回项目列表')
  btn.onclick = () => navigate({ name: 'projects' })
  return btn
}

function backToOwnershipBtn(projectId: string): HTMLElement {
  const btn = el('button', 'btn btn-ghost btn-sm', '← 返回所有权地图')
  btn.onclick = () => navigate({ name: 'project-ownership', projectId })
  return btn
}

function backButtonToApp(): HTMLElement {
  const btn = el('button', 'btn btn-ghost btn-sm', '← 返回工作区')
  btn.onclick = () => navigate({ name: 'app' })
  return btn
}

// ── 项目列表页 ──

export async function renderProjectListPage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-projects')
  const header = el('header', 'page-header')
  header.appendChild(el('h1', 'page-title', '项目认知所有权'))
  const actions = el('div', 'header-actions')
  actions.appendChild(backButtonToApp())
  header.appendChild(actions)
  page.appendChild(header)

  const intro = el('section', 'ownership-intro')
  intro.appendChild(el('h2', 'section-heading', '哪些 AI 产出真正属于你？'))
  intro.appendChild(el('p', 'section-desc',
    '按功能模块查看 AI 做了哪些关键决策、你已经用什么证据证明掌握、还缺少哪些证据，以及哪些高风险模块尚无人独立负责。'
  ))
  page.appendChild(intro)

  page.appendChild(loadingNode('正在加载项目列表…'))
  root.appendChild(page)

  try {
    const projects = await listProjects()
    clear(page)
    page.appendChild(header)
    page.appendChild(intro)

    if (projects.length === 0) {
      page.appendChild(emptyStateNode('尚未导入任何项目。可让管理员通过种子数据或 Agent 会话导入来初始化项目。'))
      root.appendChild(page)
      return
    }

    const list = el('div', 'project-list')
    for (const p of projects) {
      const card = el('div', 'project-card')
      card.appendChild(el('h3', 'project-card-title', p.name))
      if (p.description) {
        card.appendChild(el('p', 'project-card-desc', p.description))
      }
      const meta = el('div', 'project-card-meta')
      meta.appendChild(el('span', 'meta-item', `创建于 ${formatTime(p.createdAt)}`))
      card.appendChild(meta)

      const enterBtn = el('button', 'btn btn-primary btn-sm', '查看所有权地图')
      enterBtn.onclick = () => navigate({ name: 'project-ownership', projectId: p.id })
      card.appendChild(enterBtn)

      list.appendChild(card)
    }
    page.appendChild(list)
    root.appendChild(page)
  } catch (err) {
    clear(page)
    page.appendChild(header)
    page.appendChild(intro)
    page.appendChild(errorNode(err instanceof Error ? err.message : '加载项目列表失败'))
    root.appendChild(page)
  }
}

// ── 项目所有权地图主页 ──

export async function renderOwnershipMapPage(root: HTMLElement, projectId: string): Promise<void> {
  const page = el('div', 'page page-ownership')
  page.appendChild(loadingNode('正在计算项目所有权状态…'))
  root.appendChild(page)

  let view: ProjectOwnershipView
  try {
    view = await fetchProjectOwnership(projectId)
  } catch (err) {
    clear(page)
    page.appendChild(backToProjectsBtn())
    page.appendChild(errorNode(err instanceof Error ? err.message : '加载所有权地图失败'))
    return
  }

  clear(page)
  renderOwnershipHeader(page, view, projectId)
  renderOwnershipSummary(page, view)
  renderModuleList(page, view, projectId)
  root.appendChild(page)
}

function renderOwnershipHeader(page: HTMLElement, view: ProjectOwnershipView, projectId: string): void {
  const header = el('header', 'page-header')
  const titleWrap = el('div', 'header-title-wrap')
  titleWrap.appendChild(el('h1', 'page-title', view.project.name))
  if (view.project.description) {
    titleWrap.appendChild(el('p', 'page-subtitle', view.project.description))
  }
  header.appendChild(titleWrap)

  const actions = el('div', 'header-actions')
  actions.appendChild(backToProjectsBtn())
  const refreshBtn = el('button', 'btn btn-ghost btn-sm', '重新计算')
  refreshBtn.onclick = async () => {
    refreshBtn.disabled = true
    refreshBtn.textContent = '计算中…'
    try {
      const newView = await recalculateOwnership(view.project.id)
      clear(page)
      renderOwnershipHeader(page, newView, view.project.id)
      renderOwnershipSummary(page, newView)
      renderModuleList(page, newView, view.project.id)
    } catch (err) {
      refreshBtn.disabled = false
      refreshBtn.textContent = '重新计算'
      alert(err instanceof Error ? err.message : '重新计算失败')
    }
  }
  actions.appendChild(refreshBtn)
  header.appendChild(actions)
  page.appendChild(header)
}
function renderOwnershipSummary(page: HTMLElement, view: ProjectOwnershipView): void {
  const s = view.summary
  const section = el('section', 'ownership-summary')

  // 顶部统计：共检测到 N 个重要 AI 决策
  const totalRow = el('div', 'summary-total')
  totalRow.appendChild(el('span', 'summary-total-label', '共检测到'))
  totalRow.appendChild(el('span', 'summary-total-num', String(s.importantDecisionCount)))
  totalRow.appendChild(el('span', 'summary-total-label', '个重要 AI 决策'))
  section.appendChild(totalRow)

  // 四项分类数字（可点击过滤）
  const stats = el('div', 'summary-stats')
  stats.appendChild(statCard('已具备人类所有权', s.ownedDecisionCount, 'is-owned', 'owned'))
  stats.appendChild(statCard('只有初步理解', s.initialUnderstandingCount, 'is-needs-understanding', 'initial'))
  stats.appendChild(statCard('缺少验证', s.missingVerificationCount, 'is-needs-transfer', 'missing'))
  stats.appendChild(statCard('高风险无人负责', s.highRiskUnownedCount, 'is-high-risk', 'highrisk'))
  section.appendChild(stats)

  // 覆盖率与高风险模块
  const meta = el('div', 'summary-meta')
  meta.appendChild(metaItem('所有权覆盖率', `${s.ownershipCoverage}%`))
  meta.appendChild(metaItem('模块总数', String(s.moduleCount)))
  meta.appendChild(metaItem('已拥有模块', String(s.ownedModuleCount)))
  meta.appendChild(metaItem('高风险模块', String(s.highRiskModuleCount)))
  meta.appendChild(metaItem('缺少真实修改证据', String(s.needsRealWorkModuleCount)))
  meta.appendChild(metaItem('最近计算时间', formatTime(s.calculatedAt)))
  section.appendChild(meta)

  section.appendChild(el('p', 'summary-note',
    '说明：所有权覆盖率 = 已拥有 high/critical 决策数 ÷ 全部 high/critical AI 决策数。状态由确定性代码基于证据记录计算，不由大模型判断。'
  ))

  page.appendChild(section)
}

function statCard(label: string, count: number, cls: string, _filter: string): HTMLElement {
  const card = el('div', `stat-card ${cls}`)
  card.appendChild(el('div', 'stat-num', String(count)))
  card.appendChild(el('div', 'stat-label', label))
  return card
}

function metaItem(label: string, value: string): HTMLElement {
  const item = el('div', 'meta-item')
  item.appendChild(el('span', 'meta-label', label))
  item.appendChild(el('span', 'meta-value', value))
  return item
}

// 模块列表
type ModuleFilter = 'all' | 'highrisk' | 'needs-understanding' | 'needs-transfer' | 'needs-realwork' | 'owned'

let currentFilter: ModuleFilter = 'all'

function renderModuleList(page: HTMLElement, view: ProjectOwnershipView, projectId: string): void {
  const section = el('section', 'module-list-section')
  section.appendChild(el('h2', 'section-heading', '模块所有权列表'))

  // 筛选按钮
  const filterBar = el('div', 'filter-bar')
  const filters: Array<{ key: ModuleFilter; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'highrisk', label: '高风险' },
    { key: 'needs-understanding', label: '缺少理解' },
    { key: 'needs-transfer', label: '缺少迁移' },
    { key: 'needs-realwork', label: '缺少真实验证' },
    { key: 'owned', label: '已拥有' }
  ]
  for (const f of filters) {
    const btn = el('button', `filter-btn ${currentFilter === f.key ? 'is-active' : ''}`, f.label)
    btn.onclick = () => {
      currentFilter = f.key
      const listArea = section.querySelector('.module-list') as HTMLElement | null
      if (listArea) {
        clear(listArea)
        renderModuleRows(listArea, view, f.key, projectId)
      }
      filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('is-active'))
      btn.classList.add('is-active')
    }
    filterBar.appendChild(btn)
  }
  section.appendChild(filterBar)

  const list = el('div', 'module-list')
  renderModuleRows(list, view, currentFilter, projectId)
  section.appendChild(list)

  page.appendChild(section)
}

function renderModuleRows(list: HTMLElement, view: ProjectOwnershipView, filter: ModuleFilter, projectId: string): void {
  let modules = view.modules
  if (filter !== 'all') {
    modules = modules.filter(m => matchFilter(m, filter))
  }

  // 默认排序：高风险 → 缺少初步理解 → 缺少迁移 → 缺少真实修改 → 已拥有
  const order: Record<ModuleOwnershipStatus, number> = {
    high_risk_unowned: 0,
    needs_initial_understanding: 1,
    needs_error_boundary_validation: 2,
    needs_transfer_validation: 3,
    needs_real_work_validation: 4,
    owned: 5
  }
  modules = [...modules].sort((a, b) => {
    const oa = order[a.status] ?? 99
    const ob = order[b.status] ?? 99
    if (oa !== ob) return oa - ob
    // 同状态按重要决策数倒序
    return b.importantDecisionCount - a.importantDecisionCount
  })

  if (modules.length === 0) {
    list.appendChild(emptyStateNode('当前筛选条件下没有模块。'))
    return
  }

  for (const m of modules) {
    list.appendChild(moduleRow(m, projectId))
  }
}

function matchFilter(m: ModuleOwnershipView, filter: ModuleFilter): boolean {
  switch (filter) {
    case 'highrisk': return m.status === 'high_risk_unowned'
    case 'needs-understanding': return m.status === 'needs_initial_understanding' || m.status === 'needs_error_boundary_validation'
    case 'needs-transfer': return m.status === 'needs_transfer_validation'
    case 'needs-realwork': return m.status === 'needs_real_work_validation'
    case 'owned': return m.status === 'owned'
    default: return true
  }
}

function moduleRow(m: ModuleOwnershipView, projectId: string): HTMLElement {
  const row = el('div', `module-row ${MODULE_STATUS_CLASS[m.status]}`)

  const head = el('div', 'module-row-head')
  head.appendChild(el('h3', 'module-title', m.title))
  const statusBadge = el('span', `status-badge ${MODULE_STATUS_CLASS[m.status]}`, MODULE_STATUS_LABEL[m.status])
  head.appendChild(statusBadge)
  const riskBadge = el('span', `risk-badge ${RISK_CLASS[m.riskLevel] || ''}`, RISK_LABEL[m.riskLevel] || m.riskLevel)
  head.appendChild(riskBadge)
  row.appendChild(head)

  const meta = el('div', 'module-row-meta')
  meta.appendChild(metaItem('重要决策', String(m.importantDecisionCount)))
  meta.appendChild(metaItem('关联欠条', String(m.openDebtCount)))
  meta.appendChild(metaItem('高风险欠条', String(m.highRiskDebtCount)))
  meta.appendChild(metaItem('最高证据', EVIDENCE_LEVEL_LABEL[m.highestEvidenceLevel] || `E${m.highestEvidenceLevel}`))
  meta.appendChild(metaItem('AI 对话', String(m.relatedSessionCount)))
  meta.appendChild(metaItem('产出物', String(m.relatedArtifactCount)))
  meta.appendChild(metaItem('最近活动', formatTime(m.latestActivityAt)))
  row.appendChild(meta)

  // 缺失的下一项证据
  if (m.missingEvidenceTypes.length > 0 && m.status !== 'owned') {
    const gap = el('div', 'module-gap')
    gap.appendChild(el('span', 'gap-label', '下一步需要：'))
    const labels = m.missingEvidenceTypes
      .map(t => EVIDENCE_TYPE_LABEL[t] || t)
      .slice(0, 2)
      .join('、')
    gap.appendChild(el('span', 'gap-value', labels))
    row.appendChild(gap)
  }

  const enterBtn = el('button', 'btn btn-primary btn-sm', '查看详情')
  enterBtn.onclick = () => navigate({
    name: 'project-ownership-module',
    projectId,
    moduleId: m.workItemId
  })
  row.appendChild(enterBtn)

  return row
}

// ── 模块详情页 ──

export async function renderModuleDetailPage(
  root: HTMLElement,
  projectId: string,
  moduleId: string
): Promise<void> {
  const page = el('div', 'page page-module-detail')
  page.appendChild(loadingNode('正在加载模块详情…'))
  root.appendChild(page)

  let res
  try {
    res = await fetchModuleDetail(projectId, moduleId)
  } catch (err) {
    clear(page)
    page.appendChild(backToOwnershipBtn(projectId))
    page.appendChild(errorNode(err instanceof Error ? err.message : '加载模块详情失败'))
    return
  }

  const m = res.module
  const rec = res.recommendation
  clear(page)

  // 头部
  const header = el('header', 'page-header')
  const titleWrap = el('div', 'header-title-wrap')
  titleWrap.appendChild(el('h1', 'page-title', m.title))
  titleWrap.appendChild(el('p', 'page-subtitle', `状态：${MODULE_STATUS_LABEL[m.status] || m.status} · ${RISK_LABEL[m.riskLevel] || m.riskLevel}`))
  header.appendChild(titleWrap)
  const actions = el('div', 'header-actions')
  actions.appendChild(backToOwnershipBtn(projectId))
  header.appendChild(actions)
  page.appendChild(header)

  // 1. AI 做了什么
  page.appendChild(aiWorkSection(m))

  // 2. 用户目前能证明什么
  page.appendChild(userEvidenceSection(m))

  // 3. 仍然欠下什么
  page.appendChild(remainingDebtsSection(m))

  // 4. 下一步怎样证明掌握
  page.appendChild(nextStepSection(m, rec))

  // 5. 真实产出物
  page.appendChild(artifactsSection(m))

  root.appendChild(page)
}

function aiWorkSection(m: ModuleDetailView): HTMLElement {
  const section = el('section', 'detail-section')
  section.appendChild(el('h2', 'section-heading', 'AI 做了什么'))

  // Agent 会话
  if (m.aiWork.agentSessions.length === 0) {
    section.appendChild(emptyStateNode('未关联 Agent 会话。'))
  } else {
    for (const s of m.aiWork.agentSessions) {
      const card = el('div', 'ai-session-card')
      card.appendChild(el('div', 'ai-session-source', `来源：${s.source}`))
      card.appendChild(el('h3', 'ai-session-title', s.title))
      if (s.implementationSummary) {
        card.appendChild(el('p', 'ai-session-summary', s.implementationSummary))
      }
      section.appendChild(card)
    }
  }

  // 关键 AI 决策
  const decisionsHead = el('h3', 'subsection-heading', '关键 AI 决策')
  section.appendChild(decisionsHead)
  if (m.aiWork.decisions.length === 0) {
    section.appendChild(emptyStateNode('未记录关键决策。'))
  } else {
    for (const d of m.aiWork.decisions) {
      const card = el('div', `decision-card ${d.isImportant ? 'is-important' : ''}`)
      const head = el('div', 'decision-head')
      head.appendChild(el('h4', 'decision-title', d.title))
      if (d.isImportant) {
        head.appendChild(el('span', 'badge badge-important', '重要 AI 决策'))
      }
      const statusBadge = el('span', `status-badge ${statusClassForDecision(d.status)}`, decisionStatusLabel(d.status))
      head.appendChild(statusBadge)
      card.appendChild(head)

      card.appendChild(kvRow('决策内容', d.decision))
      if (d.rationale) card.appendChild(kvRow('采用原因', d.rationale))
      card.appendChild(kvRow('决策类型', DECISION_TYPE_LABEL[d.decisionType] || d.decisionType))
      card.appendChild(kvRow('重要性', importanceLabel(d.importance)))
      card.appendChild(kvRow('决策者', DECISION_MAKER_LABEL[d.decisionMaker] || d.decisionMaker))
      card.appendChild(kvRow('用户参与', USER_PARTICIPATION_LABEL[d.userParticipation] || d.userParticipation))
      card.appendChild(kvRow('当前证据', EVIDENCE_LEVEL_LABEL[d.evidenceLevel] || `E${d.evidenceLevel}`))

      // 关联产出物
      if (d.linkedArtifacts.length > 0) {
        const arts = el('div', 'decision-artifacts')
        arts.appendChild(el('span', 'sub-label', '关联文件/函数：'))
        for (const a of d.linkedArtifacts) {
          const desc = a.path || a.functionName || a.commitSha || a.artifactType
          arts.appendChild(el('span', 'sub-chip', desc))
        }
        card.appendChild(arts)
      }

      // 关联欠条
      if (d.linkedDebts.length > 0) {
        const debts = el('div', 'decision-debts')
        debts.appendChild(el('span', 'sub-label', '关联认知欠条：'))
        for (const debt of d.linkedDebts) {
          const chip = el('span', 'sub-chip', debt.gapText)
          if (debt.riskType && RISK_TYPE_LABEL[debt.riskType]) {
            chip.classList.add('is-risk')
            chip.title = RISK_TYPE_LABEL[debt.riskType]
          }
          debts.appendChild(chip)
        }
        card.appendChild(debts)
      }

      section.appendChild(card)
    }
  }

  return section
}

function userEvidenceSection(m: ModuleDetailView): HTMLElement {
  const section = el('section', 'detail-section')
  section.appendChild(el('h2', 'section-heading', '用户目前能证明什么'))

  const groups: Array<{ key: keyof UserEvidenceGroup; label: string }> = [
    { key: 'independentExplanation', label: '独立解释' },
    { key: 'delayedRecall', label: '延迟回忆' },
    { key: 'errorDetection', label: '错误检测' },
    { key: 'misconceptionCheck', label: '误区识别' },
    { key: 'scenarioTransfer', label: '场景迁移' },
    { key: 'realWorkModification', label: '独立修改' },
    { key: 'testPassed', label: '测试通过' },
    { key: 'manualReview', label: '人工评审' }
  ]

  const hasAny = groups.some(g => m.userEvidence[g.key].length > 0)
  if (!hasAny) {
    section.appendChild(emptyStateNode('尚无任何用户能力证据。'))
    return section
  }

  for (const g of groups) {
    const items = m.userEvidence[g.key]
    if (items.length === 0) continue
    const group = el('div', 'evidence-group')
    group.appendChild(el('h3', 'evidence-group-heading', `${g.label}（${items.length}）`))
    for (const item of items) {
      group.appendChild(evidenceItemNode(item))
    }
    section.appendChild(group)
  }

  // 最高证据等级汇总
  const summary = el('div', 'evidence-summary')
  summary.appendChild(el('span', 'meta-label', '最高证据等级'))
  summary.appendChild(el('span', `meta-value ${evidenceLevelClass(m.highestEvidenceLevel)}`,
    EVIDENCE_LEVEL_LABEL[m.highestEvidenceLevel] || `E${m.highestEvidenceLevel}`
  ))
  section.appendChild(summary)

  return section
}

function evidenceItemNode(item: UserEvidenceItem): HTMLElement {
  const node = el('div', 'evidence-item')
  if (item.description) {
    node.appendChild(el('p', 'evidence-desc', item.description))
  }
  const meta = el('div', 'evidence-meta')
  if (item.source) {
    meta.appendChild(el('span', 'meta-chip', `来源：${item.source}`))
  }
  if (item.trainingStage && TRAINING_STAGE_LABEL[item.trainingStage]) {
    meta.appendChild(el('span', 'meta-chip', `训练：${TRAINING_STAGE_LABEL[item.trainingStage]}`))
  }
  if (typeof item.hintDependency === 'number') {
    meta.appendChild(el('span', 'meta-chip', `提示依赖：${item.hintDependency}`))
  }
  if (typeof item.overallScore === 'number') {
    meta.appendChild(el('span', 'meta-chip', `评分：${item.overallScore}`))
  }
  if (item.createdAt) {
    meta.appendChild(el('span', 'meta-chip', formatTime(item.createdAt)))
  }
  if (meta.children.length > 0) node.appendChild(meta)
  return node
}

function remainingDebtsSection(m: ModuleDetailView): HTMLElement {
  const section = el('section', 'detail-section')
  section.appendChild(el('h2', 'section-heading', '仍然欠下什么'))

  const rd = m.remainingDebts
  const total = rd.openDebts.length + rd.relapsedDebts.length + rd.highRiskDebts.length
  if (total === 0) {
    section.appendChild(emptyStateNode('当前没有未处理的认知欠条。'))
    return section
  }

  if (rd.highRiskDebts.length > 0) {
    section.appendChild(el('h3', 'subsection-heading is-risk', `高风险欠条（${rd.highRiskDebts.length}）`))
    for (const d of rd.highRiskDebts) {
      section.appendChild(debtCard(d.gapText, d.status, d.riskType, true))
    }
  }

  if (rd.relapsedDebts.length > 0) {
    section.appendChild(el('h3', 'subsection-heading is-risk', `已复发欠条（${rd.relapsedDebts.length}）`))
    for (const d of rd.relapsedDebts) {
      section.appendChild(debtCard(d.gapText, 'relapsed', d.riskType, true))
    }
  }

  if (rd.openDebts.length > 0) {
    section.appendChild(el('h3', 'subsection-heading', `未处理欠条（${rd.openDebts.length}）`))
    for (const d of rd.openDebts) {
      section.appendChild(debtCard(d.gapText, d.status, d.riskType, false))
    }
  }

  return section
}

function debtCard(gapText: string, status: string, riskType: string | undefined, highlight: boolean): HTMLElement {
  const card = el('div', `debt-card ${highlight ? 'is-highlight' : ''}`)
  card.appendChild(el('p', 'debt-gap', gapText))
  const meta = el('div', 'debt-meta')
  meta.appendChild(el('span', 'meta-chip', `状态：${DEBT_STATUS_LABEL[status] || status}`))
  if (riskType && RISK_TYPE_LABEL[riskType]) {
    meta.appendChild(el('span', 'meta-chip is-risk', RISK_TYPE_LABEL[riskType]))
  }
  card.appendChild(meta)
  return card
}

function nextStepSection(
  m: ModuleDetailView,
  rec: ModuleDetailResponse['recommendation']
): HTMLElement {
  const section = el('section', 'detail-section')
  section.appendChild(el('h2', 'section-heading', '下一步怎样证明掌握'))

  if (m.status === 'owned') {
    section.appendChild(emptyStateNode('该模块已具备人类所有权。后续若再次完全依赖 AI 处理同类问题，系统会识别复发并降级。'))
    return section
  }

  if (!rec) {
    section.appendChild(emptyStateNode('暂无明确的下一步训练建议。'))
    return section
  }

  const card = el('div', 'recommendation-card')
  card.appendChild(el('h3', 'rec-heading', '推荐训练阶段'))
  card.appendChild(el('p', 'rec-stage', TRAINING_STAGE_LABEL[rec.recommendedStage] || rec.recommendedStage))
  card.appendChild(el('p', 'rec-desc', rec.description))

  if (rec.missingEvidenceTypes.length > 0) {
    const missing = el('div', 'rec-missing')
    missing.appendChild(el('span', 'sub-label', '尚缺证据：'))
    for (const t of rec.missingEvidenceTypes) {
      missing.appendChild(el('span', 'sub-chip', EVIDENCE_TYPE_LABEL[t] || t))
    }
    card.appendChild(missing)
  }

  card.appendChild(kvRow('当前证据', EVIDENCE_LEVEL_LABEL[rec.currentEvidenceLevel] || `E${rec.currentEvidenceLevel}`))

  // 进入现有训练流程的入口
  // 注意：不创建第二套训练提交页面，而是引导用户回到主工作区或对应会话。
  const startBtn = el('button', 'btn btn-primary', '进入训练流程')
  startBtn.onclick = () => {
    // 训练流程统一在主工作区发起，由 LearningOrchestrator 根据 ownershipGapType 路由。
    navigate({ name: 'app' })
  }
  card.appendChild(startBtn)

  section.appendChild(card)
  return section
}

function artifactsSection(m: ModuleDetailView): HTMLElement {
  const section = el('section', 'detail-section')
  section.appendChild(el('h2', 'section-heading', '真实产出物'))

  if (m.aiWork.artifacts.length === 0) {
    section.appendChild(emptyStateNode('未关联产出物（文件、函数、Commit、PR、API、数据库迁移、测试等）。'))
    return section
  }

  const list = el('div', 'artifact-list')
  for (const a of m.aiWork.artifacts) {
    const card = el('div', 'artifact-card')
    card.appendChild(el('span', `artifact-type-badge ${artifactTypeClass(a.artifactType)}`, artifactTypeLabel(a.artifactType)))
    if (a.path) card.appendChild(kvRow('路径', a.path))
    if (a.functionName) card.appendChild(kvRow('函数', a.functionName))
    if (a.commitSha) card.appendChild(kvRow('Commit', a.commitSha))
    if (a.prUrl) {
      const row = el('div', 'kv-row')
      row.appendChild(el('span', 'kv-label', 'PR'))
      const link = el('a', 'kv-link', a.prUrl) as HTMLAnchorElement
      link.href = a.prUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      row.appendChild(link)
      card.appendChild(row)
    }
    if (a.diffSummary) card.appendChild(el('p', 'artifact-diff', a.diffSummary))
    list.appendChild(card)
  }
  section.appendChild(list)
  return section
}

function artifactTypeLabel(t: string): string {
  const map: Record<string, string> = {
    file: '文件',
    function: '函数',
    commit: 'Commit',
    pr: 'PR',
    api: 'API',
    database_migration: '数据库迁移',
    test: '测试',
    code_modification: '代码修改',
    manual_review: '人工评审'
  }
  return map[t] || t
}

function artifactTypeClass(t: string): string {
  if (t === 'test') return 'is-test'
  if (t === 'manual_review') return 'is-review'
  if (t === 'database_migration') return 'is-migration'
  return ''
}

// ── 小工具 ──

function kvRow(label: string, value: string): HTMLElement {
  const row = el('div', 'kv-row')
  row.appendChild(el('span', 'kv-label', label))
  row.appendChild(el('span', 'kv-value', value))
  return row
}

function importanceLabel(s: string): string {
  const map: Record<string, string> = {
    low: '低',
    medium: '中',
    high: '高',
    critical: '关键'
  }
  return map[s] || s
}

function decisionStatusLabel(s: string): string {
  const map: Record<string, string> = {
    high_risk_unowned: '高风险无人负责',
    owned: '已具备人类所有权',
    missing_verification: '缺少验证',
    initial_understanding: '只有初步理解',
    unverified: '未验证'
  }
  return map[s] || s
}

function statusClassForDecision(s: string): string {
  const map: Record<string, string> = {
    high_risk_unowned: 'is-high-risk',
    owned: 'is-owned',
    missing_verification: 'is-needs-transfer',
    initial_understanding: 'is-needs-understanding',
    unverified: 'is-needs-understanding'
  }
  return map[s] || ''
}

function evidenceLevelClass(level: number): string {
  if (level >= 5) return 'is-evidence-5'
  if (level >= 4) return 'is-evidence-4'
  if (level >= 3) return 'is-evidence-3'
  if (level >= 2) return 'is-evidence-2'
  if (level >= 1) return 'is-evidence-1'
  return 'is-evidence-0'
}
