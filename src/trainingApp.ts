/**
 * ⚠️ DEPRECATED — 旧训练系统前端（training.html 入口）
 *
 * 该文件属于已废弃的旧多页前端，不再维护。当前产品前端是
 * web/src/ 下的 SPA（入口 https://demo.mindiou.top/mindiou/index.html#/app）。
 * 训练路由请前往 web/src/（router.ts 的 'training' 路由）。
 * 新功能不要加到这里。
 *
 * 训练系统前端应用
 * 今日复训入口 + 认知欠条详情 + 历史时间线
 */

interface ReviewTaskDTO {
  id: string
  cognitiveDebtId: string
  cardId: string
  trainingStage: string
  taskType: string
  prompt: string
  hintsAllowed: boolean
  maxHints: number
  createdAt: string
  dueAt: string
  status: string
}

interface MasteryProfileDTO {
  cognitiveDebtId: string
  conceptualUnderstanding: number
  independentRecall: number
  hintIndependence: number
  misconceptionResistance: number
  transferAbility: number
  retentionStrength: number
  overallMastery: number
  currentStage: number
  lastAttemptAt?: string
  nextReviewAt?: string
  successfulAttempts: number
  failedAttempts: number
  relapseCount: number
}

interface CognitiveDebtDTO {
  id: string
  gapText: string
  gapEvidence: string
  status: string
  recurrenceCount: number
  createdAt: string
  updatedAt: string
}

interface TrainingAttemptDTO {
  id: string
  trainingStage: string
  taskType: string
  originalPrompt: string
  finalAnswer: string
  hintEvents: Array<{ level: number; hintType: string; content: string }>
  evaluation: {
    overallScore: number
    passed: boolean
    hintDependency: number
    understandingLevel: string
    strengths: string[]
    missingPoints: string[]
    userFeedback: string
  }
  completedAt: string
}

interface DebtDetailResponse {
  ok: boolean
  debt: CognitiveDebtDTO
  profile: MasteryProfileDTO | null
  attempts: TrainingAttemptDTO[]
  reviews: ReviewTaskDTO[]
  understandingLevel: string
  masteryLabel: string
}

interface ReviewSubmitResponse {
  ok: boolean
  attempt: TrainingAttemptDTO
  evaluation: {
    passed: boolean
    overallScore: number
    hintDependency: number
    understandingLevel: string
    userFeedback: string
    nextTrainingGoal: string
  }
  profile: MasteryProfileDTO
  debtStatus: string
  nextReviewAt: string
}

const API_BASE = typeof location !== 'undefined'
  ? (location.pathname.startsWith('/mindiou/') ? '/mindiou-api' : (new URLSearchParams(location.search).get('api') || ''))
  : ''

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

function formatDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    initial_compensation: '首次补偿训练',
    delayed_recall: '延迟回忆',
    misconception_check: '误区识别',
    scenario_transfer: '场景迁移',
    error_detection: '错误识别',
    real_work_validation: '真实工作验证'
  }
  return labels[stage] || stage
}

function taskTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    feynman_explanation: '费曼解释',
    short_recall: '快速回忆',
    concept_comparison: '概念对比',
    scenario_judgment: '场景判断',
    error_detection: '错误识别',
    micro_practice: '微型练习'
  }
  return labels[type] || type
}

function debtStatusLabel(status: string): string {
  const labels: Record<string, string> = {
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
  return labels[status] || status
}

function statusBadgeClass(status: string): string {
  const classes: Record<string, string> = {
    new: 'badge-new',
    initial_training: 'badge-training',
    initially_understood: 'badge-initial',
    review_scheduled: 'badge-scheduled',
    review_due: 'badge-due',
    independently_explainable: 'badge-independent',
    transfer_training: 'badge-transfer',
    mastered: 'badge-mastered',
    relapsed: 'badge-relapsed',
    ignored: 'badge-ignored'
  }
  return classes[status] || 'badge-default'
}

function understandingLabel(level: string): string {
  const labels: Record<string, string> = {
    not_understood: '正在补偿',
    prompt_supported: '在提示帮助下能够解释',
    initially_understood: '已初步理解',
    independently_explainable: '能够独立解释',
    transferable: '能够迁移使用',
    stable_mastery: '已形成稳定掌握'
  }
  return labels[level] || '正在补偿'
}

function estimatedMinutes(taskType: string): number {
  const estimates: Record<string, number> = {
    feynman_explanation: 3,
    short_recall: 1,
    concept_comparison: 3,
    scenario_judgment: 5,
    error_detection: 3,
    micro_practice: 5
  }
  return estimates[taskType] || 3
}

export async function renderTodayReview(container: HTMLElement): Promise<void> {
  clear(container)
  const header = el('div', 'training-header')
  header.appendChild(el('h1', undefined, '今日复训'))
  header.appendChild(el('p', 'training-subtitle', '利用碎片时间，验证你是否真正掌握了认知欠条中的能力'))
  const loading = el('div', 'training-loading', '正在加载今日复训任务…')
  container.appendChild(header)
  container.appendChild(loading)

  try {
    const res = await apiFetch('/api/training/today')
    if (!res.ok) throw await readError(res)
    const data = await res.json()
    clear(container)
    container.appendChild(header)

    if (data.totalDue === 0) {
      const empty = el('div', 'training-empty')
      empty.appendChild(el('p', undefined, '今日没有到期的复训任务。'))
      empty.appendChild(el('p', 'training-hint', '完成新的认知欠条训练后，复训任务会自动出现在这里。'))
      container.appendChild(empty)
      return
    }

    const totalMinutes = data.tasks.reduce((sum: number, t: ReviewTaskDTO) => sum + estimatedMinutes(t.taskType), 0)
    const summary = el('div', 'training-summary')
    summary.appendChild(el('span', 'summary-count', `今日需要复训：${data.totalDue} 条`))
    summary.appendChild(el('span', 'summary-time', `预计需要：${totalMinutes} 分钟`))

    const typeGroups: Record<string, number> = {}
    for (const task of data.tasks) {
      const key = taskTypeLabel(task.taskType)
      typeGroups[key] = (typeGroups[key] || 0) + 1
    }
    const groupList = el('div', 'training-groups')
    for (const [typeName, count] of Object.entries(typeGroups)) {
      groupList.appendChild(el('p', 'group-label', `- ${count} 条${typeName}`))
    }
    summary.appendChild(groupList)
    container.appendChild(summary)

    const actions = el('div', 'training-actions')
    const startAllBtn = el('button', 'btn btn-primary', '开始全部')
    startAllBtn.onclick = () => startReview(container, data.tasks)
    actions.appendChild(startAllBtn)

    const quickBtn = el('button', 'btn btn-secondary', '只练3分钟')
    quickBtn.onclick = () => {
      const quickTasks = data.tasks.filter((t: ReviewTaskDTO) => estimatedMinutes(t.taskType) <= 3).slice(0, 1)
      if (quickTasks.length > 0) startReview(container, quickTasks)
      else alert('当前没有适合3分钟内完成的任务')
    }
    actions.appendChild(quickBtn)
    container.appendChild(actions)

    const taskList = el('div', 'task-list')
    for (const task of data.tasks) {
      const item = el('div', 'task-item')
      item.appendChild(el('span', 'task-stage badge ' + statusBadgeClass(task.trainingStage), stageLabel(task.trainingStage)))
      item.appendChild(el('span', 'task-type', taskTypeLabel(task.taskType)))
      item.appendChild(el('span', 'task-time', `${estimatedMinutes(task.taskType)}分钟`))
      item.appendChild(el('p', 'task-prompt', task.prompt))
      const taskActions = el('div', 'task-actions')
      const startBtn = el('button', 'btn btn-small', '开始训练')
      startBtn.onclick = () => startReview(container, [task])
      taskActions.appendChild(startBtn)
      item.appendChild(taskActions)
      taskList.appendChild(item)
    }
    container.appendChild(taskList)
  } catch (error) {
    clear(container)
    container.appendChild(header)
    const errBox = el('div', 'training-error')
    errBox.appendChild(el('p', undefined, `加载失败：${(error as Error).message}`))
    const retryBtn = el('button', 'btn btn-primary', '重试')
    retryBtn.onclick = () => renderTodayReview(container)
    errBox.appendChild(retryBtn)
    container.appendChild(errBox)
  }
}

async function startReview(container: HTMLElement, tasks: ReviewTaskDTO[]): Promise<void> {
  for (const task of tasks) {
    await doReviewTask(container, task)
  }
  await renderTodayReview(container)
}

async function doReviewTask(container: HTMLElement, task: ReviewTaskDTO): Promise<void> {
  clear(container)
  const header = el('div', 'review-header')
  header.appendChild(el('span', 'badge ' + statusBadgeClass(task.trainingStage), stageLabel(task.trainingStage)))
  header.appendChild(el('span', 'task-type', taskTypeLabel(task.taskType)))
  header.appendChild(el('span', 'task-time', `预计 ${estimatedMinutes(task.taskType)} 分钟`))
  container.appendChild(header)

  const promptBox = el('div', 'review-prompt-box')
  promptBox.appendChild(el('p', 'review-prompt-label', '训练问题'))
  promptBox.appendChild(el('p', 'review-prompt-text', task.prompt))
  if (!task.hintsAllowed) {
    promptBox.appendChild(el('p', 'review-hint-notice', '本次训练不提供提示，请独立完成。'))
  }
  container.appendChild(promptBox)

  const answerArea = el('textarea', 'review-answer')
  answerArea.placeholder = '请用你自己的话解释…'
  answerArea.rows = 8

  const submitBtn = el('button', 'btn btn-primary', '提交回答')
  const skipBtn = el('button', 'btn btn-secondary', '跳过')
  const actions = el('div', 'review-actions')
  actions.appendChild(submitBtn)
  actions.appendChild(skipBtn)
  container.appendChild(answerArea)
  container.appendChild(actions)

  return new Promise<void>((resolve) => {
    let resolved = false
    const finish = () => { if (!resolved) { resolved = true; resolve() } }

    submitBtn.onclick = async () => {
      const answer = answerArea.value.trim()
      if (!answer) { alert('请输入你的回答'); return }
      submitBtn.disabled = true
      submitBtn.textContent = '提交中…'
      try {
        await apiFetch(`/api/training/reviews/${encodeURIComponent(task.id)}/start`, { method: 'POST' })
        const res = await apiFetch(`/api/training/reviews/${encodeURIComponent(task.id)}/submit`, {
          method: 'POST', body: JSON.stringify({ answer })
        })
        if (!res.ok) throw await readError(res)
        const data: ReviewSubmitResponse = await res.json()
        clear(container)
        const resultBox = el('div', 'review-result')
        const statusText = data.evaluation.passed ? '通过' : '需要继续练习'
        const statusClass = data.evaluation.passed ? 'result-passed' : 'result-needs-practice'
        resultBox.appendChild(el('p', `result-status ${statusClass}`, statusText))
        resultBox.appendChild(el('p', 'result-score', `本次得分：${data.evaluation.overallScore}`))
        resultBox.appendChild(el('p', 'result-understanding', understandingLabel(data.evaluation.understandingLevel)))
        if (data.evaluation.userFeedback) {
          const fb = el('div', 'result-feedback')
          fb.appendChild(el('p', 'feedback-label', 'AI 反馈'))
          fb.appendChild(el('p', 'feedback-text', data.evaluation.userFeedback))
          resultBox.appendChild(fb)
        }
        resultBox.appendChild(el('p', 'result-next-goal', `下一次目标：${data.evaluation.nextTrainingGoal || '继续练习'}`))
        resultBox.appendChild(el('p', 'result-next-review', `下次复训：${formatDate(data.nextReviewAt)}`))
        const continueBtn = el('button', 'btn btn-primary', '继续')
        continueBtn.onclick = finish
        resultBox.appendChild(continueBtn)
        container.appendChild(resultBox)
      } catch (error) {
        submitBtn.disabled = false
        submitBtn.textContent = '提交回答'
        alert(`提交失败：${(error as Error).message}`)
      }
    }
    skipBtn.onclick = finish
  })
}

export async function renderDebtDetail(container: HTMLElement, debtId: string): Promise<void> {
  clear(container)
  container.appendChild(el('div', 'training-loading', '正在加载认知欠条详情…'))
  try {
    const res = await apiFetch(`/api/training/debts/${encodeURIComponent(debtId)}`)
    if (!res.ok) throw await readError(res)
    const data: DebtDetailResponse = await res.json()
    clear(container)

    const header = el('div', 'debt-header')
    header.appendChild(el('span', `badge ${statusBadgeClass(data.debt.status)}`, debtStatusLabel(data.debt.status)))
    header.appendChild(el('h1', undefined, data.debt.gapText))
    if (data.debt.recurrenceCount > 0) {
      header.appendChild(el('p', 'debt-recurrence', `复发次数：${data.debt.recurrenceCount}`))
    }
    container.appendChild(header)

    if (data.profile) {
      const masteryBox = el('div', 'mastery-panel')
      masteryBox.appendChild(el('h2', undefined, '当前掌握状态'))
      masteryBox.appendChild(el('p', 'mastery-label', data.masteryLabel))
      masteryBox.appendChild(el('p', 'mastery-score', `综合掌握度：${data.profile.overallMastery}`))
      const dims = el('div', 'mastery-dims')
      const dimsList: Array<[string, number]> = [
        ['概念理解', data.profile.conceptualUnderstanding],
        ['独立回忆', data.profile.independentRecall],
        ['提示独立性', data.profile.hintIndependence],
        ['误区抵抗力', data.profile.misconceptionResistance],
        ['迁移能力', data.profile.transferAbility],
        ['延迟保持', data.profile.retentionStrength]
      ]
      for (const [label, value] of dimsList) {
        const dim = el('div', 'dim-item')
        dim.appendChild(el('span', 'dim-label', label))
        const bar = el('div', 'dim-bar')
        const fill = el('div', 'dim-fill')
        fill.style.width = `${value}%`
        bar.appendChild(fill)
        dim.appendChild(bar)
        dim.appendChild(el('span', 'dim-value', String(value)))
        dims.appendChild(dim)
      }
      masteryBox.appendChild(dims)
      if (data.profile.nextReviewAt) {
        masteryBox.appendChild(el('p', 'next-review', `下次复训：${formatDate(data.profile.nextReviewAt)}`))
      }
      container.appendChild(masteryBox)
    }

    if (data.debt.gapEvidence) {
      const evBox = el('div', 'evidence-panel')
      evBox.appendChild(el('h2', undefined, '原始认知缺口'))
      evBox.appendChild(el('p', 'evidence-text', data.debt.gapEvidence))
      container.appendChild(evBox)
    }

    if (data.attempts.length > 0 || data.reviews.length > 0) {
      const timeline = el('div', 'timeline-panel')
      timeline.appendChild(el('h2', undefined, '训练历史'))
      type TimelineItem = { date: string; content: HTMLElement }
      const items: TimelineItem[] = []
      items.push({
        date: data.debt.createdAt,
        content: (() => {
          const c = el('div', 'timeline-item-content')
          c.appendChild(el('p', 'timeline-title', '在AI对话中识别出认知缺口'))
          return c
        })()
      })
      for (const attempt of data.attempts) {
        items.push({
          date: attempt.completedAt,
          content: (() => {
            const c = el('div', 'timeline-item-content')
            const hintCount = attempt.hintEvents?.length || 0
            const passed = attempt.evaluation?.passed
            c.appendChild(el('p', 'timeline-title', `${stageLabel(attempt.trainingStage)} ${passed ? '通过' : '未通过'}`))
            if (hintCount > 0) c.appendChild(el('p', 'timeline-detail', `使用 ${hintCount} 次提示`))
            c.appendChild(el('p', 'timeline-detail', `状态：${understandingLabel(attempt.evaluation?.understandingLevel || 'not_understood')}`))
            return c
          })()
        })
      }
      items.sort((a, b) => a.date.localeCompare(b.date))
      for (const item of items) {
        const entry = el('div', 'timeline-entry')
        entry.appendChild(el('p', 'timeline-date', formatDate(item.date)))
        entry.appendChild(item.content)
        timeline.appendChild(entry)
      }
      container.appendChild(timeline)
    }

    const backBtn = el('button', 'btn btn-secondary', '返回')
    backBtn.onclick = () => renderDebtList(container)
    container.appendChild(backBtn)
  } catch (error) {
    clear(container)
    const errBox = el('div', 'training-error')
    errBox.appendChild(el('p', undefined, `加载失败：${(error as Error).message}`))
    const retryBtn = el('button', 'btn btn-primary', '重试')
    retryBtn.onclick = () => renderDebtDetail(container, debtId)
    errBox.appendChild(retryBtn)
    container.appendChild(errBox)
  }
}

export async function renderDebtList(container: HTMLElement): Promise<void> {
  clear(container)
  const header = el('div', 'training-header')
  header.appendChild(el('h1', undefined, '认知欠条'))
  header.appendChild(el('p', 'training-subtitle', '所有被识别的认知缺口及其长期训练状态'))
  container.appendChild(header)
  container.appendChild(el('div', 'training-loading', '正在加载…'))
  try {
    const res = await apiFetch('/api/training/debts')
    if (!res.ok) throw await readError(res)
    const data = await res.json()
    clear(container)
    container.appendChild(header)
    if (!data.debts || data.debts.length === 0) {
      const empty = el('div', 'training-empty')
      empty.appendChild(el('p', undefined, '还没有认知欠条。'))
      empty.appendChild(el('p', 'training-hint', '导入AI对话并生成报告后，认知欠条会自动出现在这里。'))
      container.appendChild(empty)
      return
    }
    const list = el('div', 'debt-list')
    for (const debt of data.debts) {
      const item = el('div', 'debt-item')
      item.appendChild(el('span', `badge ${statusBadgeClass(debt.status)}`, debtStatusLabel(debt.status)))
      item.appendChild(el('p', 'debt-title', debt.gapText))
      if (debt.masteryLabel) item.appendChild(el('p', 'debt-mastery', debt.masteryLabel))
      if (debt.recurrenceCount > 0) item.appendChild(el('p', 'debt-recurrence', `复发 ${debt.recurrenceCount} 次`))
      item.onclick = () => renderDebtDetail(container, debt.id)
      item.style.cursor = 'pointer'
      list.appendChild(item)
    }
    container.appendChild(list)
  } catch (error) {
    clear(container)
    container.appendChild(header)
    const errBox = el('div', 'training-error')
    errBox.appendChild(el('p', undefined, `加载失败：${(error as Error).message}`))
    const retryBtn = el('button', 'btn btn-primary', '重试')
    retryBtn.onclick = () => renderDebtList(container)
    errBox.appendChild(retryBtn)
    container.appendChild(errBox)
  }
}

export function bootstrapTraining(): void {
  const root = document.getElementById('app')
  if (!root) return
  const params = new URLSearchParams(location.search)
  const view = params.get('view')
  if (view === 'debts') renderDebtList(root)
  else if (view === 'debt' && params.get('id')) renderDebtDetail(root, params.get('id')!)
  else renderTodayReview(root)
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', bootstrapTraining)
}
