/**
 * 认知周报 / 月报（Phase 5：周期性认知报告）
 *
 * 五节内容：本周输入 / 本周训练 / 本周认知模式 / 本周进步 / 下周重点。
 * 所有数字来自后端确定性统计；本页面只做渲染，不做任何推断。
 * 数据不足的节由后端标记 insufficientData，这里显示"数据不足"提示。
 * 历史报告可回看，不覆盖。
 */

interface DomainCount {
  skillNodeKey: string
  displayName: string
  count: number
}

interface SourceCount {
  source: string
  count: number
}

interface InputsSection {
  insufficientData: boolean
  newDebtCount?: number
  domainDistribution?: DomainCount[]
  topSources?: SourceCount[]
  newDebtIds?: string[]
}

interface StagePassRate {
  attempts: number
  passed: number
  passRate: number
}

interface DebtRef {
  debtId: string
  gapText: string
}

interface TrainingSection {
  insufficientData: boolean
  totalAttempts?: number
  passedAttempts?: number
  stagePassRates?: Record<string, StagePassRate | null>
  averageHintsPerAttempt?: number | null
  hintDependencyTrend?: string
  relapsedDebtCount?: number
  relapsedDebts?: DebtRef[]
}

interface MechanismCount {
  key: string
  label: string
  count: number
  share?: number
}

interface ClusterRef {
  clusterId: string
  title: string
  memberCount: number
  newDebtIdsInPeriod: string[]
}

interface HighRiskDebt extends DebtRef {
  riskLabels: string[]
}

interface PatternsSection {
  insufficientData: boolean
  topMechanism?: MechanismCount | null
  mechanismDistribution?: MechanismCount[]
  recurringClusters?: ClusterRef[]
  highRiskDebts?: HighRiskDebt[]
  weakestDimension?: { dimension: string; label: string; value: number } | null
}

interface ProgressSection {
  insufficientData: boolean
  mastery?: {
    current: Record<string, number>
    previousOverallMastery: number | null
    overallDelta: number | null
  } | null
  masteredDebts?: Array<DebtRef & { masteredAt: string }>
  hintToIndependent?: DebtRef[]
  transferPassed?: Array<DebtRef & { stageLabel: string }>
}

interface FocusTask {
  recommendationId: string | null
  debtId: string
  gapText: string
  reason: string
  estimatedMinutes: number
  recommendedTrainingStage: string | null
}

interface NextFocusSection {
  insufficientData: boolean
  theme: { skillNodeId: string | null; displayName: string } | null
  tasks: FocusTask[]
  totalEstimatedMinutes: number
  reason: string | null
}

interface CognitiveReport {
  id: string
  userId: string
  reportType: 'weekly' | 'monthly'
  periodStart: string
  periodEnd: string
  inputsJson: InputsSection & { skillChanges?: SkillChange[] }
  trainingJson: TrainingSection & {
    attemptsBefore?: number
    attemptsAfter?: number
    transferPassRateBefore?: number | null
    transferPassRateAfter?: number | null
    transferDelta?: number | null
  }
  patternsJson: PatternsSection & {
    mechanismBefore?: Array<{ mechanism: string; label: string; count: number; share: number }>
    mechanismAfter?: Array<{ mechanism: string; label: string; count: number; share: number }>
  }
  progressJson: ProgressSection & {
    overallMasteryBefore?: number | null
    overallMasteryAfter?: number | null
    overallDelta?: number | null
    relapseRateBefore?: number | null
    relapseRateAfter?: number | null
  }
  nextFocusJson: NextFocusSection
  summaryText: string
  calculationVersion: string
  createdAt: string
}

interface SkillChange {
  skillNodeKey: string
  displayName: string
  relatedDebtCount: number
  masteredRatioBefore: number | null
  masteredRatioAfter: number | null
  delta: number | null
  trend: string
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

const TREND_LABELS: Record<string, string> = {
  improving: '上升',
  declining: '下降',
  stable: '平稳',
  insufficient_data: '数据不足'
}

const DIMENSION_LABELS: Record<string, string> = {
  conceptualUnderstanding: '概念理解',
  independentRecall: '独立回忆',
  hintIndependence: '提示独立性',
  misconceptionResistance: '误区抵抗力',
  transferAbility: '迁移能力',
  retentionStrength: '延迟保持'
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

function insufficientNote(text = '数据不足：积累更多欠条与训练记录后，这里会给出结论。'): HTMLElement {
  return el('p', 'profile-insufficient', text)
}

function bar(value: number): HTMLElement {
  const track = el('div', 'dim-bar profile-dist-bar')
  const fill = el('div', 'dim-fill')
  fill.style.width = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`
  track.appendChild(fill)
  return track
}

// ─── 可展开证据卡片（复用 Phase 3 证据展开模式） ───

function expandableList(title: string, items: string[], container: HTMLElement): void {
  if (items.length === 0) return
  const box = el('div', 'profile-evidence')
  box.style.display = 'none'
  const toggle = el('button', 'btn btn-small', title)
  toggle.type = 'button'
  let rendered = false
  toggle.addEventListener('click', () => {
    if (box.style.display !== 'none') {
      box.style.display = 'none'
      return
    }
    box.style.display = ''
    if (!rendered) {
      rendered = true
      const list = el('ul', 'profile-evidence-list')
      for (const item of items) list.appendChild(el('li', '', item))
      box.appendChild(list)
    }
  })
  container.appendChild(toggle)
  container.appendChild(box)
}

function debtLink(debtId: string, text: string): HTMLAnchorElement {
  const link = el('a', '', text || debtId) as HTMLAnchorElement
  link.href = `./training.html?view=debts&debt=${encodeURIComponent(debtId)}`
  return link
}

// ─── 周报五节 ───

function renderWeeklyInputs(inputs: InputsSection, section: HTMLElement): void {
  section.appendChild(el('h2', '', '本周输入'))
  if (inputs.insufficientData) {
    section.appendChild(insufficientNote('本周没有新增认知欠条。'))
    return
  }
  section.appendChild(el('p', 'profile-conclusion', `本周新增 ${inputs.newDebtCount} 张认知欠条。`))
  const distribution = inputs.domainDistribution || []
  if (distribution.length > 0) {
    section.appendChild(el('div', 'profile-evidence-label', '涉及领域'))
    const total = distribution.reduce((sum, item) => sum + item.count, 0)
    for (const item of distribution) {
      const row = el('div', 'profile-dist-row')
      row.appendChild(el('span', 'profile-dist-label', item.displayName))
      row.appendChild(bar(total > 0 ? item.count / total : 0))
      row.appendChild(el('span', 'profile-dist-value', `${item.count} 张`))
      section.appendChild(row)
    }
  }
  const sources = inputs.topSources || []
  if (sources.length > 0) {
    section.appendChild(el('div', 'profile-evidence-label', '产生欠条最多的来源'))
    const list = el('ul', 'profile-evidence-list')
    for (const source of sources) {
      list.appendChild(el('li', '', `${source.source}（${source.count} 张）`))
    }
    section.appendChild(list)
  }
}

function renderWeeklyTraining(training: TrainingSection, section: HTMLElement): void {
  section.appendChild(el('h2', '', '本周训练'))
  if (training.insufficientData) {
    section.appendChild(insufficientNote('本周没有完成训练。'))
    return
  }
  const grid = el('div', 'profile-stat-grid')
  const rows: Array<[string, string]> = []
  rows.push(['训练次数', `${training.totalAttempts} 次（通过 ${training.passedAttempts} 次）`])
  for (const [stage, value] of Object.entries(training.stagePassRates || {})) {
    if (!value) continue
    rows.push([STAGE_LABELS[stage] || stage, `${value.passed}/${value.attempts} 通过（${pct(value.passRate)}）`])
  }
  if (training.averageHintsPerAttempt !== null && training.averageHintsPerAttempt !== undefined) {
    rows.push(['平均提示使用', `${training.averageHintsPerAttempt} 次 / 次训练`])
  }
  rows.push(['提示依赖趋势', TREND_LABELS[training.hintDependencyTrend || 'insufficient_data'] || '数据不足'])
  rows.push(['复发情况', (training.relapsedDebtCount || 0) > 0 ? `${training.relapsedDebtCount} 张欠条复发` : '无复发'])
  for (const [label, value] of rows) {
    const row = el('div', 'profile-stat-row')
    row.appendChild(el('span', 'profile-stat-label', label))
    row.appendChild(el('span', 'profile-stat-value', value))
    grid.appendChild(row)
  }
  section.appendChild(grid)
}

function renderWeeklyPatterns(patterns: PatternsSection, section: HTMLElement): void {
  section.appendChild(el('h2', '', '本周认知模式'))
  if (patterns.insufficientData) {
    section.appendChild(insufficientNote())
    return
  }
  const distribution = patterns.mechanismDistribution || []
  if (patterns.topMechanism) {
    section.appendChild(el('p', 'profile-conclusion',
      `最高频机制是「${patterns.topMechanism.label}」（${patterns.topMechanism.count} 条独立证据）。`))
  }
  if (distribution.length > 0) {
    const total = distribution.reduce((sum, item) => sum + item.count, 0)
    for (const item of distribution) {
      const row = el('div', 'profile-dist-row')
      row.appendChild(el('span', 'profile-dist-label', item.label))
      row.appendChild(bar(total > 0 ? item.count / total : 0))
      row.appendChild(el('span', 'profile-dist-value', `${item.count} 条`))
      section.appendChild(row)
    }
  }
  const clusters = patterns.recurringClusters || []
  if (clusters.length > 0) {
    section.appendChild(el('div', 'profile-evidence-label', '重复出现的问题'))
    expandableList(
      `查看 ${clusters.length} 个问题簇`,
      clusters.map(cluster => `${cluster.title}（共 ${cluster.memberCount} 张欠条，本周新增 ${cluster.newDebtIdsInPeriod.length} 张）`),
      section
    )
  }
  const highRisk = patterns.highRiskDebts || []
  if (highRisk.length > 0) {
    section.appendChild(el('div', 'profile-evidence-label', '高风险问题'))
    const list = el('ul', 'profile-evidence-list')
    for (const debt of highRisk) {
      const li = el('li')
      li.appendChild(debtLink(debt.debtId, debt.gapText))
      li.appendChild(el('span', 'profile-evidence-meta', ` ${debt.riskLabels.join('、')}`))
      list.appendChild(li)
    }
    section.appendChild(list)
  }
  if (patterns.weakestDimension) {
    section.appendChild(el('div', 'profile-skill-weak',
      `最弱掌握维度：${patterns.weakestDimension.label} ${patterns.weakestDimension.value}`))
  }
}

function renderWeeklyProgress(progress: ProgressSection, section: HTMLElement): void {
  section.appendChild(el('h2', '', '本周进步'))
  if (progress.insufficientData) {
    section.appendChild(insufficientNote())
    return
  }
  if (progress.mastery) {
    const grid = el('div', 'profile-stat-grid')
    if (progress.mastery.overallDelta !== null && progress.mastery.overallDelta !== undefined) {
      const delta = progress.mastery.overallDelta
      const row = el('div', 'profile-stat-row')
      row.appendChild(el('span', 'profile-stat-label', '六维聚合掌握度'))
      row.appendChild(el('span', 'profile-stat-value',
        `${progress.mastery.previousOverallMastery} → ${progress.mastery.current.overallMastery}（${delta >= 0 ? '+' : ''}${delta}）`))
      grid.appendChild(row)
    } else {
      const row = el('div', 'profile-stat-row')
      row.appendChild(el('span', 'profile-stat-label', '六维聚合掌握度'))
      row.appendChild(el('span', 'profile-stat-value', `${progress.mastery.current.overallMastery}（暂无上周对比）`))
      grid.appendChild(row)
    }
    for (const [dimension, label] of Object.entries(DIMENSION_LABELS)) {
      const value = Number(progress.mastery.current[dimension])
      if (!Number.isFinite(value)) continue
      const row = el('div', 'profile-dist-row')
      row.appendChild(el('span', 'profile-dist-label', label))
      row.appendChild(bar(value / 100))
      row.appendChild(el('span', 'profile-dist-value', `${value}`))
      grid.appendChild(row)
    }
    section.appendChild(grid)
  }
  const mastered = progress.masteredDebts || []
  if (mastered.length > 0) {
    section.appendChild(el('div', 'profile-evidence-label', `进入已掌握（${mastered.length}）`))
    const timeline = el('ul', 'profile-evidence-list')
    for (const debt of mastered) {
      const li = el('li')
      li.appendChild(el('span', 'profile-evidence-meta', `${formatDate(debt.masteredAt)} `))
      li.appendChild(debtLink(debt.debtId, debt.gapText))
      timeline.appendChild(li)
    }
    section.appendChild(timeline)
  }
  const independent = progress.hintToIndependent || []
  if (independent.length > 0) {
    section.appendChild(el('div', 'profile-evidence-label', `从提示依赖到独立解释（${independent.length}）`))
    const list = el('ul', 'profile-evidence-list')
    for (const debt of independent) {
      const li = el('li')
      li.appendChild(debtLink(debt.debtId, debt.gapText))
      list.appendChild(li)
    }
    section.appendChild(list)
  }
  const transferred = progress.transferPassed || []
  if (transferred.length > 0) {
    section.appendChild(el('div', 'profile-evidence-label', `通过迁移训练（${transferred.length}）`))
    const list = el('ul', 'profile-evidence-list')
    for (const debt of transferred) {
      const li = el('li')
      li.appendChild(debtLink(debt.debtId, debt.gapText))
      li.appendChild(el('span', 'profile-evidence-meta', ` ${debt.stageLabel}`))
      list.appendChild(li)
    }
    section.appendChild(list)
  }
}

// ─── 下周重点 / 下月重点 ───

function renderNextFocus(focus: NextFocusSection, section: HTMLElement, reportType: 'weekly' | 'monthly'): void {
  const isMonthly = reportType === 'monthly'
  const focusTitle = isMonthly ? '下月重点' : '下周重点'
  const insufficientText = isMonthly ? '下月重点数据不足，完成更多训练后会出现。' : '下周重点数据不足，完成更多训练后会出现。'
  section.appendChild(el('h2', '', focusTitle))
  if (focus.insufficientData || !focus.theme) {
    section.appendChild(insufficientNote(insufficientText))
    return
  }
  const card = el('div', 'report-focus-card')
  card.appendChild(el('div', 'report-focus-theme', focus.theme.displayName))
  const focusReason = focus.reason ? (isMonthly ? focus.reason.replace(/本周/g, '本月') : focus.reason) : null
  if (focusReason) card.appendChild(el('p', 'profile-insight-desc', focusReason))
  const list = el('div', 'task-list')
  for (const task of focus.tasks) {
    const item = el('div', 'task-item')
    const head = el('div')
    if (task.recommendedTrainingStage) {
      head.appendChild(el('span', 'task-type', STAGE_LABELS[task.recommendedTrainingStage] || task.recommendedTrainingStage))
    }
    head.appendChild(el('span', 'task-time', `约 ${task.estimatedMinutes} 分钟`))
    item.appendChild(head)
    const link = el('a', 'task-prompt report-task-link', task.gapText || '认知欠条') as HTMLAnchorElement
    link.href = './training.html'
    link.title = '前往今日复训'
    item.appendChild(link)
    if (task.reason) item.appendChild(el('p', 'profile-insight-desc', task.reason))
    list.appendChild(item)
  }
  card.appendChild(list)
  card.appendChild(el('p', 'profile-evidence-meta', `共 ${focus.tasks.length} 个优先任务，预计 ${focus.totalEstimatedMinutes} 分钟。点击任务前往今日复训。`))
  section.appendChild(card)
}

// ─── 月报 ───

function renderMonthly(report: CognitiveReport, root: HTMLElement): void {
  const compared = (report as unknown as { comparedPeriods?: unknown }) // comparedPeriods 在 inputsJson 之外由后端放入各节；这里仅渲染五节字段
  void compared
  const inputs = report.inputsJson
  const training = report.trainingJson
  const patterns = report.patternsJson
  const progress = report.progressJson

  const inputsSection = el('section', 'profile-section')
  inputsSection.appendChild(el('h2', '', '能力领域变化'))
  if (inputs.insufficientData) {
    inputsSection.appendChild(insufficientNote('月度快照数据不足，至少需要两个月度画像快照。'))
  } else {
    for (const change of inputs.skillChanges || []) {
      const row = el('div', 'profile-dist-row')
      row.appendChild(el('span', 'profile-dist-label', change.displayName))
      row.appendChild(bar(change.masteredRatioAfter ?? 0))
      const deltaText = change.delta === null
        ? `${pct(change.masteredRatioAfter)}`
        : `${pct(change.masteredRatioBefore)} → ${pct(change.masteredRatioAfter)}（${change.delta >= 0 ? '+' : ''}${Math.round(change.delta * 100)}%）`
      row.appendChild(el('span', 'profile-dist-value', deltaText))
      inputsSection.appendChild(row)
    }
  }
  root.appendChild(inputsSection)

  const trainingSection = el('section', 'profile-section')
  trainingSection.appendChild(el('h2', '', '训练与迁移能力变化'))
  if (training.insufficientData) {
    trainingSection.appendChild(insufficientNote())
  } else {
    const grid = el('div', 'profile-stat-grid')
    const rows: Array<[string, string]> = [
      ['训练次数', `${training.attemptsBefore ?? 0} → ${training.attemptsAfter ?? 0} 次`],
      ['迁移训练通过率', training.transferDelta === null || training.transferDelta === undefined
        ? '数据不足'
        : `${pct(training.transferPassRateBefore)} → ${pct(training.transferPassRateAfter)}（${training.transferDelta >= 0 ? '+' : ''}${Math.round(training.transferDelta * 100)}%）`],
      ['提示依赖趋势', TREND_LABELS[(training as { hintDependencyTrendAfter?: string }).hintDependencyTrendAfter || 'insufficient_data'] || '数据不足']
    ]
    for (const [label, value] of rows) {
      const row = el('div', 'profile-stat-row')
      row.appendChild(el('span', 'profile-stat-label', label))
      row.appendChild(el('span', 'profile-stat-value', value))
      grid.appendChild(row)
    }
    trainingSection.appendChild(grid)
  }
  root.appendChild(trainingSection)

  const patternsSection = el('section', 'profile-section')
  patternsSection.appendChild(el('h2', '', '机制分布变化'))
  if (patterns.insufficientData) {
    patternsSection.appendChild(insufficientNote())
  } else {
    const after = patterns.mechanismAfter || []
    const before = patterns.mechanismBefore || []
    const keys = [...new Set([...before.map(item => item.mechanism), ...after.map(item => item.mechanism)])]
    for (const key of keys) {
      const b = before.find(item => item.mechanism === key)
      const a = after.find(item => item.mechanism === key)
      const row = el('div', 'profile-dist-row')
      row.appendChild(el('span', 'profile-dist-label', (a || b)?.label || key))
      row.appendChild(bar(a?.share ?? 0))
      row.appendChild(el('span', 'profile-dist-value', `${b?.count ?? 0} → ${a?.count ?? 0} 条`))
      patternsSection.appendChild(row)
    }
  }
  root.appendChild(patternsSection)

  const progressSection = el('section', 'profile-section')
  progressSection.appendChild(el('h2', '', '掌握度与复发变化'))
  if (progress.insufficientData) {
    progressSection.appendChild(insufficientNote())
  } else {
    const grid = el('div', 'profile-stat-grid')
    const rows: Array<[string, string]> = []
    if (progress.overallDelta !== null && progress.overallDelta !== undefined) {
      rows.push(['六维聚合掌握度', `${progress.overallMasteryBefore} → ${progress.overallMasteryAfter}（${progress.overallDelta >= 0 ? '+' : ''}${progress.overallDelta}）`])
    }
    if (progress.relapseRateBefore !== null && progress.relapseRateBefore !== undefined
      && progress.relapseRateAfter !== null && progress.relapseRateAfter !== undefined) {
      rows.push(['复发率', `${pct(progress.relapseRateBefore)} → ${pct(progress.relapseRateAfter)}`])
    }
    if (rows.length === 0) {
      progressSection.appendChild(insufficientNote())
    } else {
      for (const [label, value] of rows) {
        const row = el('div', 'profile-stat-row')
        row.appendChild(el('span', 'profile-stat-label', label))
        row.appendChild(el('span', 'profile-stat-value', value))
        grid.appendChild(row)
      }
      progressSection.appendChild(grid)
    }
  }
  root.appendChild(progressSection)

  const focusSection = el('section', 'profile-section')
  renderNextFocus(report.nextFocusJson, focusSection, report.reportType)
  root.appendChild(focusSection)
}

// ─── 周报渲染 ───

function renderWeekly(report: CognitiveReport, root: HTMLElement): void {
  const inputsSection = el('section', 'profile-section')
  renderWeeklyInputs(report.inputsJson, inputsSection)
  root.appendChild(inputsSection)

  const trainingSection = el('section', 'profile-section')
  renderWeeklyTraining(report.trainingJson, trainingSection)
  root.appendChild(trainingSection)

  const patternsSection = el('section', 'profile-section')
  renderWeeklyPatterns(report.patternsJson, patternsSection)
  root.appendChild(patternsSection)

  const progressSection = el('section', 'profile-section')
  renderWeeklyProgress(report.progressJson, progressSection)
  root.appendChild(progressSection)

  const focusSection = el('section', 'profile-section')
  renderNextFocus(report.nextFocusJson, focusSection, report.reportType)
  root.appendChild(focusSection)
}

// ─── 主渲染 ───

interface ReportPageState {
  type: 'weekly' | 'monthly'
  report: CognitiveReport | null
}

async function fetchLatest(type: 'weekly' | 'monthly'): Promise<CognitiveReport> {
  const res = await apiFetch(`/api/cognitive-reports/${type}/latest`)
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  return data.report as CognitiveReport
}

async function fetchHistory(type: 'weekly' | 'monthly'): Promise<CognitiveReport[]> {
  const res = await apiFetch(`/api/cognitive-reports/history?type=${type}&limit=12`)
  if (!res.ok) throw await readError(res)
  const data = await res.json()
  return (data.reports || []) as CognitiveReport[]
}

function renderReportShell(root: HTMLElement, state: ReportPageState, history: CognitiveReport[]): void {
  clear(root)
  const header = el('header', 'training-header')
  header.appendChild(el('h1', '', state.type === 'weekly' ? '认知周报' : '认知月报'))
  if (state.report) {
    header.appendChild(el('p', 'training-subtitle',
      `周期：${formatDate(state.report.periodStart)} ~ ${formatDate(state.report.periodEnd)} · 所有数字由确定性统计生成，可回看历史报告。`))
  }
  root.appendChild(header)

  const tabs = el('div', 'training-actions')
  const weeklyTab = el('a', 'btn btn-small', '周报') as HTMLAnchorElement
  weeklyTab.href = './cognitive-report.html'
  if (state.type === 'weekly') weeklyTab.classList.add('btn-primary')
  const monthlyTab = el('a', 'btn btn-small', '月报') as HTMLAnchorElement
  monthlyTab.href = './cognitive-report.html?type=monthly'
  if (state.type === 'monthly') monthlyTab.classList.add('btn-primary')
  tabs.appendChild(weeklyTab)
  tabs.appendChild(monthlyTab)
  if (state.type === 'weekly') {
    const generateBtn = el('button', 'btn btn-secondary btn-small', '重新生成本周周报')
    generateBtn.type = 'button'
    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true
      generateBtn.textContent = '生成中…'
      try {
        const res = await apiFetch('/api/cognitive-reports/weekly/generate', { method: 'POST', body: '{}' })
        if (!res.ok) throw await readError(res)
        await renderApp(root)
      } catch (error) {
        generateBtn.textContent = `生成失败：${(error as Error).message}`
        return
      }
    })
    tabs.appendChild(generateBtn)
  }
  root.appendChild(tabs)

  if (!state.report) {
    root.appendChild(insufficientNote('暂时没有报告。'))
    return
  }

  const summarySection = el('section', 'profile-section')
  summarySection.appendChild(el('h2', '', '本期摘要'))
  summarySection.appendChild(el('p', 'profile-conclusion', state.report.summaryText || '暂无摘要。'))
  root.appendChild(summarySection)

  if (state.report.reportType === 'monthly') {
    renderMonthly(state.report, root)
  } else {
    renderWeekly(state.report, root)
  }

  const historySection = el('section', 'profile-section')
  historySection.appendChild(el('h2', '', '历史报告'))
  if (history.length === 0) {
    historySection.appendChild(insufficientNote('还没有历史报告。'))
  } else {
    const list = el('ul', 'profile-evidence-list')
    for (const item of history) {
      const li = el('li')
      const link = el('a', '',
        `${formatDate(item.periodStart)} ~ ${formatDate(item.periodEnd)}${item.id === state.report.id ? '（当前）' : ''}`) as HTMLAnchorElement
      link.href = `./cognitive-report.html?type=${item.reportType}&report=${encodeURIComponent(item.id)}`
      list.appendChild(li)
      li.appendChild(link)
    }
    historySection.appendChild(list)
  }
  root.appendChild(historySection)
}

async function renderApp(root: HTMLElement): Promise<void> {
  clear(root)
  root.appendChild(el('div', 'training-loading', '正在加载认知报告…'))
  const params = new URLSearchParams(location.search)
  const type: 'weekly' | 'monthly' = params.get('type') === 'monthly' ? 'monthly' : 'weekly'
  const reportId = params.get('report') || ''
  try {
    const history = await fetchHistory(type)
    let report: CognitiveReport | null = null
    if (reportId) {
      report = history.find(item => item.id === reportId) || null
      if (!report) throw new Error('该报告不存在或不属于当前用户')
    } else {
      report = await fetchLatest(type)
    }
    renderReportShell(root, { type, report }, history)
  } catch (error) {
    clear(root)
    root.appendChild(el('div', 'training-error', `认知报告加载失败：${(error as Error).message}`))
  }
}

const app = document.getElementById('app')
if (app) {
  void renderApp(app)
}
