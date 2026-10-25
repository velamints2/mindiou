/**
 * 认知地图（Phase 3：用户长期认知画像）
 *
 * 四个区块：能力领域 / 认知模式 / 学习模式 / 风险画像，
 * 外加可追溯的画像结论列表：每条结论可展开查看证据欠条、训练记录与欠条簇。
 * 所有数字来自后端确定性聚合；本页面只做渲染，不做任何推断。
 */

interface SkillItem {
  skillNodeKey: string
  displayName: string
  relatedDebtCount: number
  masteredDebtCount: number
  masteredRatio: number
  relapsedDebtCount: number
  averageMastery: { overallMastery: number } | null
  weakestDimensions: Array<{ dimension: string; label: string; value: number }>
  independentEvidenceCount: number
  confidence: number
  trend: string
  evidenceDebtIds: string[]
}

interface DistributionItem {
  key?: string
  riskType?: string
  label: string
  count: number
  debtCount: number
  share?: number
  evidenceDebtIds: string[]
}

interface InsightDTO {
  id: string
  insightType: string
  title: string
  description: string
  metricValue?: number
  metricUnit?: string
  confidence: number
  aiEnhanced?: boolean
  createdAt: string
  evidenceDebtIds: string[]
  evidenceAttemptIds: string[]
  evidenceClusterIds: string[]
}

interface StagePassRate {
  attempts: number
  passed: number
  passRate: number
}

interface ProfileSummary {
  ok: boolean
  periodDays: number
  skills: {
    skills: SkillItem[]
    unclassifiedDebtCount: number
    insufficientData: boolean
  }
  patterns: {
    periodDays: number
    totalIndependentEvidence: number
    distribution: DistributionItem[]
    rootCauseDistribution: DistributionItem[]
    conclusion: string | null
    confidence: number
    insufficientData: boolean
  }
  learning: {
    totalAttempts: number
    stagePassRates: Record<string, StagePassRate | null>
    averageHintsPerAttempt: number | null
    answerRevisionRate: { total: number; revised: number; rate: number } | null
    transferPassRate: (StagePassRate & { evidenceAttemptIds: string[] }) | null
    relapseRate: { trainedDebtCount: number; relapsedDebtCount: number; rate: number } | null
    averageDurationSeconds: number | null
    hintDependencyTrend: string
    insufficientData: boolean
  }
  risks: {
    totalRiskDebts: number
    distribution: DistributionItem[]
    insufficientData: boolean
  }
  insights: InsightDTO[]
  aiEnhanced: boolean
}

interface EvidenceResponse {
  ok: boolean
  insight: InsightDTO
  evidence: {
    debts: Array<{ id: string; gapText: string; status: string; recurrenceCount: number; createdAt: string }>
    attempts: Array<{
      id: string
      cognitiveDebtId: string
      trainingStage: string
      passed: boolean
      overallScore: number | null
      completedAt: string | null
    }>
    clusters: Array<{ id: string; title: string; clusterType: string }>
  }
}

interface SnapshotDTO {
  id: string
  snapshotType: string
  periodStart: string
  periodEnd: string
  createdAt: string
}

const API_BASE = typeof location !== 'undefined'
  ? (location.pathname.startsWith('/mindiou/') ? '/mindiou-api' : (new URLSearchParams(location.search).get('api') || ''))
  : ''

const STAGE_LABELS: Record<string, string> = {
  initial_compensation: '首次补偿训练',
  delayed_recall: '延迟回忆',
  misconception_check: '误区识别',
  scenario_transfer: '场景迁移',
  error_detection: '错误识别',
  real_work_validation: '真实工作验证'
}

const INSIGHT_TYPE_LABELS: Record<string, string> = {
  skill_strength: '优势领域',
  skill_gap: '待加强领域',
  recurring_pattern: '高频模式',
  ai_collaboration_pattern: '协作模式',
  learning_pattern: '学习模式',
  risk_pattern: '风险模式',
  growth_trend: '成长趋势'
}

const TREND_LABELS: Record<string, string> = {
  improving: '上升',
  declining: '下降',
  stable: '平稳',
  insufficient_data: '数据不足'
}

const DEBT_STATUS_LABELS: Record<string, string> = {
  new: '新识别',
  initial_training: '正在训练',
  initially_understood: '初步理解',
  review_scheduled: '已安排复训',
  review_due: '复训到期',
  independently_explainable: '独立解释',
  transfer_training: '迁移训练',
  mastered: '已掌握',
  relapsed: '已复发',
  ignored: '已忽略'
}

const SNAPSHOT_TYPE_LABELS: Record<string, string> = {
  weekly: '每周快照',
  monthly: '每月快照',
  manual: '手动快照'
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text) node.textContent = text
  return node
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  })
}

async function readError(res: Response): Promise<Error> {
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
  return new Error(data.error || `HTTP ${res.status}`)
}

function pct(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return '—'
  return `${Math.round(Number(value) * 100)}%`
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return '稳定模式'
  if (confidence >= 0.7) return '中等置信'
  if (confidence > 0) return '初步观察'
  return '数据不足'
}

function trendBadge(trend: string): HTMLElement {
  const badge = el('span', 'badge', TREND_LABELS[trend] || trend)
  if (trend === 'improving') badge.classList.add('badge-mastered')
  else if (trend === 'declining') badge.classList.add('badge-due')
  else badge.classList.add('badge-default')
  return badge
}

function insufficientNote(text = '证据不足：积累更多欠条与训练记录后，这里会给出结论。'): HTMLElement {
  return el('p', 'profile-insufficient', text)
}

// ─── 画像结论（可展开证据） ───

function renderInsightItem(insight: InsightDTO, container: HTMLElement): void {
  const item = el('div', 'profile-insight')
  const head = el('div', 'profile-insight-head')
  head.appendChild(el('span', 'badge badge-scheduled', INSIGHT_TYPE_LABELS[insight.insightType] || insight.insightType))
  head.appendChild(el('span', 'profile-insight-confidence', confidenceLabel(insight.confidence)))
  if (insight.aiEnhanced) head.appendChild(el('span', 'profile-ai-mark', 'AI 润色'))
  item.appendChild(head)
  item.appendChild(el('div', 'profile-insight-title', insight.title))
  item.appendChild(el('p', 'profile-insight-desc', insight.description))
  if (insight.metricValue !== undefined && insight.metricUnit) {
    item.appendChild(el('div', 'profile-insight-metric', `${insight.metricValue}${insight.metricUnit}`))
  }

  const evidenceBox = el('div', 'profile-evidence')
  evidenceBox.style.display = 'none'
  const toggle = el('button', 'btn btn-small', '查看证据')
  toggle.type = 'button'
  let loaded = false
  toggle.addEventListener('click', async () => {
    if (evidenceBox.style.display !== 'none') {
      evidenceBox.style.display = 'none'
      toggle.textContent = '查看证据'
      return
    }
    evidenceBox.style.display = ''
    toggle.textContent = '收起证据'
    if (loaded) return
    clear(evidenceBox)
    evidenceBox.appendChild(el('p', 'profile-insufficient', '加载证据中…'))
    try {
      const res = await apiFetch(`/api/cognitive-profile/insights/${encodeURIComponent(insight.id)}/evidence`)
      if (!res.ok) throw await readError(res)
      const data: EvidenceResponse = await res.json()
      loaded = true
      clear(evidenceBox)
      renderEvidence(data, evidenceBox)
    } catch (error) {
      clear(evidenceBox)
      evidenceBox.appendChild(el('p', 'training-error', `证据加载失败：${(error as Error).message}`))
    }
  })
  item.appendChild(toggle)
  item.appendChild(evidenceBox)
  container.appendChild(item)
}

function renderEvidence(data: EvidenceResponse, box: HTMLElement): void {
  const { debts, attempts, clusters } = data.evidence
  if (debts.length === 0 && attempts.length === 0 && clusters.length === 0) {
    box.appendChild(insufficientNote('关联证据已被删除或为空，结论保留用于追溯。'))
    return
  }
  if (debts.length > 0) {
    box.appendChild(el('div', 'profile-evidence-label', `证据欠条（${debts.length}）`))
    const list = el('ul', 'profile-evidence-list')
    for (const debt of debts) {
      const li = el('li')
      const link = el('a', '', debt.gapText || debt.id) as HTMLAnchorElement
      link.href = `./training.html?view=debts&debt=${encodeURIComponent(debt.id)}`
      li.appendChild(link)
      li.appendChild(el('span', 'profile-evidence-meta',
        ` ${DEBT_STATUS_LABELS[debt.status] || debt.status}${debt.recurrenceCount > 0 ? ` · 复发 ${debt.recurrenceCount} 次` : ''} · ${formatDate(debt.createdAt)}`))
      list.appendChild(li)
    }
    box.appendChild(list)
  }
  if (attempts.length > 0) {
    box.appendChild(el('div', 'profile-evidence-label', `训练记录（${attempts.length}）`))
    const list = el('ul', 'profile-evidence-list')
    for (const attempt of attempts) {
      const li = el('li')
      li.appendChild(el('span', '', STAGE_LABELS[attempt.trainingStage] || attempt.trainingStage))
      li.appendChild(el('span', 'profile-evidence-meta',
        ` ${attempt.passed ? '通过' : '未通过'}${attempt.overallScore !== null ? ` · ${attempt.overallScore} 分` : ''} · ${formatDate(attempt.completedAt)}`))
      list.appendChild(li)
    }
    box.appendChild(list)
  }
  if (clusters.length > 0) {
    box.appendChild(el('div', 'profile-evidence-label', `相关欠条簇（${clusters.length}）`))
    const list = el('ul', 'profile-evidence-list')
    for (const cluster of clusters) {
      list.appendChild(el('li', '', cluster.title))
    }
    box.appendChild(list)
  }
}

// ─── 四个区块 ───

function renderSkills(skills: ProfileSummary['skills'], container: HTMLElement): void {
  const section = el('section', 'profile-section')
  section.appendChild(el('h2', '', '我的能力领域'))
  if (skills.insufficientData) {
    section.appendChild(insufficientNote('至少 2 条独立证据（不同报告 / 会话产生的欠条）才能形成领域画像。'))
  }
  if (skills.skills.length === 0) {
    if (!skills.insufficientData) section.appendChild(insufficientNote('暂无已分类的认知欠条。'))
  } else {
    for (const skill of skills.skills) {
      const card = el('div', 'profile-skill')
      const head = el('div', 'profile-skill-head')
      head.appendChild(el('span', 'profile-skill-name', skill.displayName))
      head.appendChild(trendBadge(skill.trend))
      card.appendChild(head)
      const stats = el('div', 'profile-skill-stats',
        `欠条 ${skill.relatedDebtCount} 张 · 已掌握 ${skill.masteredDebtCount} 张（${pct(skill.masteredRatio)}）` +
        `${skill.relapsedDebtCount > 0 ? ` · 复发 ${skill.relapsedDebtCount} 张` : ''}` +
        `${skill.averageMastery ? ` · 六维均值 ${skill.averageMastery.overallMastery}` : ''}`)
      card.appendChild(stats)
      const bar = el('div', 'dim-bar')
      const fill = el('div', 'dim-fill')
      fill.style.width = `${Math.round((skill.masteredRatio || 0) * 100)}%`
      bar.appendChild(fill)
      card.appendChild(bar)
      if (skill.weakestDimensions.length > 0) {
        card.appendChild(el('div', 'profile-skill-weak',
          `最弱维度：${skill.weakestDimensions.map(d => `${d.label} ${d.value}`).join('、')}`))
      }
      section.appendChild(card)
    }
  }
  if (skills.unclassifiedDebtCount > 0) {
    section.appendChild(el('p', 'profile-insufficient', `另有 ${skills.unclassifiedDebtCount} 张欠条尚未完成智能分类，未计入领域画像。`))
  }
  container.appendChild(section)
}

function renderDistribution(items: DistributionItem[], container: HTMLElement, unit: string): void {
  for (const item of items) {
    const row = el('div', 'profile-dist-row')
    row.appendChild(el('span', 'profile-dist-label', item.label))
    const bar = el('div', 'dim-bar profile-dist-bar')
    const fill = el('div', 'dim-fill')
    fill.style.width = `${Math.round((item.share ?? 0) * 100)}%`
    bar.appendChild(fill)
    row.appendChild(bar)
    row.appendChild(el('span', 'profile-dist-value', `${item.count} ${unit}${item.share !== undefined ? ` · ${pct(item.share)}` : ''}`))
    container.appendChild(row)
  }
}

function renderPatterns(patterns: ProfileSummary['patterns'], container: HTMLElement): void {
  const section = el('section', 'profile-section')
  section.appendChild(el('h2', '', `认知模式（近 ${patterns.periodDays} 天）`))
  if (patterns.insufficientData) {
    section.appendChild(insufficientNote())
  } else {
    if (patterns.conclusion) section.appendChild(el('p', 'profile-conclusion', patterns.conclusion))
    renderDistribution(patterns.distribution, section, '条独立证据')
    if (patterns.rootCauseDistribution.length > 0) {
      section.appendChild(el('div', 'profile-evidence-label', '高频根因'))
      renderDistribution(patterns.rootCauseDistribution.slice(0, 5), section, '次')
    }
  }
  container.appendChild(section)
}

function renderLearning(learning: ProfileSummary['learning'], container: HTMLElement): void {
  const section = el('section', 'profile-section')
  section.appendChild(el('h2', '', '学习模式'))
  if (learning.insufficientData) {
    section.appendChild(insufficientNote('完成更多训练后，这里会展示各阶段通过率与提示依赖趋势。'))
  }
  if (learning.totalAttempts > 0) {
    const grid = el('div', 'profile-stat-grid')
    const rows: Array<[string, string]> = []
    for (const [stage, value] of Object.entries(learning.stagePassRates)) {
      if (!value) continue
      rows.push([STAGE_LABELS[stage] || stage, `${value.passed}/${value.attempts} 通过（${pct(value.passRate)}）`])
    }
    if (learning.transferPassRate) {
      rows.push(['迁移训练通过率', pct(learning.transferPassRate.passRate)])
    }
    if (learning.averageHintsPerAttempt !== null) {
      rows.push(['平均提示使用', `${learning.averageHintsPerAttempt} 次 / 次训练`])
    }
    if (learning.answerRevisionRate) {
      rows.push(['答案修改率', pct(learning.answerRevisionRate.rate)])
    }
    if (learning.relapseRate) {
      rows.push(['复发率', `${pct(learning.relapseRate.rate)}（${learning.relapseRate.relapsedDebtCount}/${learning.relapseRate.trainedDebtCount} 张已训练欠条）`])
    }
    if (learning.averageDurationSeconds !== null) {
      rows.push(['平均训练时长', `${Math.round(learning.averageDurationSeconds / 60)} 分钟`])
    }
    rows.push(['提示依赖趋势', TREND_LABELS[learning.hintDependencyTrend] || learning.hintDependencyTrend])
    for (const [label, value] of rows) {
      const row = el('div', 'profile-stat-row')
      row.appendChild(el('span', 'profile-stat-label', label))
      row.appendChild(el('span', 'profile-stat-value', value))
      grid.appendChild(row)
    }
    section.appendChild(grid)
  }
  container.appendChild(section)
}

function renderRisks(risks: ProfileSummary['risks'], container: HTMLElement): void {
  const section = el('section', 'profile-section')
  section.appendChild(el('h2', '', '风险画像'))
  if (risks.distribution.length === 0) {
    section.appendChild(insufficientNote(
      risks.totalRiskDebts === 0 ? '当前没有涉及实质风险的欠条。' : '风险证据不足，暂不下结论。'
    ))
  } else {
    section.appendChild(el('p', 'profile-conclusion',
      `共 ${risks.totalRiskDebts} 张欠条涉及实质风险（已排除「无实质风险」）。`))
    renderDistribution(risks.distribution, section, '条独立证据')
  }
  container.appendChild(section)
}

// ─── 主渲染 ───

async function loadSnapshots(container: HTMLElement): Promise<void> {
  clear(container)
  try {
    const res = await apiFetch('/api/cognitive-profile/snapshots')
    if (!res.ok) throw await readError(res)
    const data: { ok: boolean; snapshots: SnapshotDTO[] } = await res.json()
    if (data.snapshots.length === 0) {
      container.appendChild(insufficientNote('还没有画像快照。点击上方按钮生成第一份手动快照。'))
      return
    }
    const list = el('ul', 'profile-evidence-list')
    for (const snapshot of data.snapshots.slice(0, 12)) {
      list.appendChild(el('li', '',
        `${SNAPSHOT_TYPE_LABELS[snapshot.snapshotType] || snapshot.snapshotType} · ${formatDate(snapshot.periodStart)} ~ ${formatDate(snapshot.periodEnd)}`))
    }
    container.appendChild(list)
  } catch (error) {
    container.appendChild(el('p', 'training-error', `快照加载失败：${(error as Error).message}`))
  }
}

async function renderApp(root: HTMLElement): Promise<void> {
  clear(root)
  root.appendChild(el('div', 'training-loading', '正在加载认知地图…'))
  let summary: ProfileSummary
  try {
    const res = await apiFetch('/api/cognitive-profile/summary')
    if (!res.ok) throw await readError(res)
    summary = await res.json()
  } catch (error) {
    clear(root)
    root.appendChild(el('div', 'training-error', `认知地图加载失败：${(error as Error).message}`))
    return
  }

  clear(root)
  const header = el('header', 'training-header')
  header.appendChild(el('h1', '', '认知地图'))
  header.appendChild(el('p', 'training-subtitle',
    `基于你的认知欠条与训练记录的长期画像（统计窗口：近 ${summary.periodDays} 天）。所有结论由确定性规则计算，可展开查看证据。`))
  root.appendChild(header)

  const actions = el('div', 'training-actions')
  const snapshotBtn = el('button', 'btn btn-secondary', '生成画像快照')
  snapshotBtn.type = 'button'
  const snapshotStatus = el('span', 'profile-snapshot-status')
  snapshotBtn.addEventListener('click', async () => {
    snapshotBtn.disabled = true
    snapshotStatus.textContent = '生成中…'
    try {
      const res = await apiFetch('/api/cognitive-profile/snapshots', { method: 'POST', body: '{}' })
      if (!res.ok) throw await readError(res)
      const data = await res.json()
      snapshotStatus.textContent = data.created
        ? `快照已生成（${data.insightCount} 条结论）`
        : '今天已生成过快照，结论已刷新'
      await renderApp(root)
    } catch (error) {
      snapshotStatus.textContent = `生成失败：${(error as Error).message}`
    } finally {
      snapshotBtn.disabled = false
    }
  })
  actions.appendChild(snapshotBtn)
  actions.appendChild(snapshotStatus)
  root.appendChild(actions)

  const insightsSection = el('section', 'profile-section')
  insightsSection.appendChild(el('h2', '', '画像结论'))
  if (summary.insights.length === 0) {
    insightsSection.appendChild(insufficientNote('暂无可生成的结论。最低证据规则：至少 2 条独立证据才会形成初步观察。'))
  } else {
    if (summary.aiEnhanced) {
      insightsSection.appendChild(el('p', 'profile-ai-mark', '部分结论措辞经 AI 润色；数字与事实均由确定性规则计算。'))
    }
    for (const insight of summary.insights) {
      renderInsightItem(insight, insightsSection)
    }
  }
  root.appendChild(insightsSection)

  renderSkills(summary.skills, root)
  renderPatterns(summary.patterns, root)
  renderLearning(summary.learning, root)
  renderRisks(summary.risks, root)

  const snapshotSection = el('section', 'profile-section')
  snapshotSection.appendChild(el('h2', '', '历史快照'))
  const snapshotList = el('div')
  snapshotSection.appendChild(snapshotList)
  root.appendChild(snapshotSection)
  await loadSnapshots(snapshotList)
}

const app = document.getElementById('app')
if (app) {
  void renderApp(app)
}
