import { projectMemoryRequest } from './api'
import { el, navigate, type Route } from './router'
import { t } from './i18n'
import {
  buildProjectMemoryDemo,
  buildSessionDemo,
  buildWorkItemDemo,
  fillProjectMemory,
  friendlyProjectError
} from './projectMemoryDemo'

type Json = Record<string, any>

function pageShell(title: string, subtitle?: string): HTMLElement {
  const page = el('div', 'page page-project-memory')
  const header = el('header', 'page-header project-memory-header')
  const titleNode = el('div')
  titleNode.appendChild(el('p', 'dashboard-kicker', 'PROJECT MEMORY'))
  titleNode.appendChild(el('h1', 'page-title', title))
  if (subtitle) titleNode.appendChild(el('p', 'project-memory-subtitle', subtitle))
  header.appendChild(titleNode)
  // 使用原生 hash 链接，避免异步页面或点击事件被覆盖时出现“按钮无反应”。
  const back = el('a', 'btn btn-ghost btn-sm', '项目列表') as HTMLAnchorElement
  back.href = '#/projects'
  back.setAttribute('aria-label', '返回项目列表')
  header.appendChild(back)
  page.appendChild(header)
  return page
}

function text(value: unknown, fallback = '—'): string {
  const result = String(value ?? '').trim()
  return result || fallback
}

// 项目记忆页状态/类型中文映射，避免中英混杂
const WORK_STATUS_LABELS: Record<string, string> = {
  detected: '已识别', in_progress: '进行中', implemented: '已实现', verified: '已验证', archived: '已归档'
}
const PROJECT_TYPE_LABELS: Record<string, string> = {
  software: '软件项目', research: '研究', writing: '写作', design: '设计', other: '其他'
}
const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: '进行中', archived: '已归档'
}
function workStatusLabel(value: unknown): string {
  return WORK_STATUS_LABELS[String(value ?? '')] || text(value)
}
function projectTypeLabel(value: unknown): string {
  return PROJECT_TYPE_LABELS[String(value ?? '')] || text(value)
}
function projectStatusLabel(value: unknown): string {
  return PROJECT_STATUS_LABELS[String(value ?? '')] || text(value)
}
// 决策参与度与所有权确证状态中文映射
const PARTICIPATION_LABELS: Record<string, string> = {
  decided: '用户决定', approved: '已批准', accepted: '已接受', consulted: '已咨询', none: '未参与'
}
const OWNERSHIP_STATE_LABELS: Record<string, string> = {
  owned: '已确证', verified: '已验证', unverified: '未确证', partial: '部分确证', unknown: '未知'
}
function participationLabel(value: unknown): string {
  return PARTICIPATION_LABELS[String(value ?? '')] || text(value)
}
function ownershipStateLabel(value: unknown): string {
  return OWNERSHIP_STATE_LABELS[String(value ?? '')] || text(value)
}
// ISO 时间 → 本地短格式（2026-08-07T11:51:51.485Z → 8月7日 19:51）
function dateLabel(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function panel(title: string, body: HTMLElement): HTMLElement {
  const section = el('section', 'project-memory-panel')
  section.appendChild(el('h2', 'project-memory-panel-title', title))
  section.appendChild(body)
  return section
}

// ── ① Agent 会话时间线：竖轴 + 时间节点，按发生时间倒序 ──
function renderSessionTimeline(sessions: Json[]): HTMLElement {
  const wrap = el('div', 'pm-timeline')
  if (!sessions.length) {
    wrap.appendChild(el('p', 'project-memory-empty', '暂无会话记录'))
    return wrap
  }
  const sorted = [...sessions].sort((a, b) =>
    String(b.startedAt || b.createdAt || '').localeCompare(String(a.startedAt || a.createdAt || ''))
  )
  for (const session of sorted.slice(0, 12)) {
    const item = el('div', 'pm-timeline-item')
    item.appendChild(el('span', 'pm-timeline-dot'))
    const content = el('div', 'pm-timeline-content')
    content.appendChild(el('div', 'pm-timeline-date', dateLabel(session.startedAt || session.createdAt) + ' · ' + text(session.platform)))
    const title = link(text(session.title || session.userIntentSummary), '#/agent-sessions/' + encodeURIComponent(session.id))
    title.className = 'pm-timeline-title'
    content.appendChild(title)
    content.appendChild(el('p', 'pm-timeline-summary', text(session.implementationSummary)))
    item.appendChild(content)
    wrap.appendChild(item)
  }
  return wrap
}

// ── ② 项目结构树：项目 → 功能任务 → 会话/产出物/决策 层级缩进 ──
function renderProjectTree(memory: Json, projectId: string): HTMLElement {
  const wrap = el('div', 'pm-tree')
  const workItems: Json[] = memory.workItems || []
  const sessions: Json[] = memory.sessions || []
  const artifacts: Json[] = memory.artifacts || []
  const decisions: Json[] = memory.decisions || []
  const sessionLinks: Json[] = memory.sessionWorkItemLinks || []
  const artifactLinks: Json[] = memory.workItemArtifactLinks || []
  // ownership 里带证据等级，按 id 合并到产出物
  const ownershipByArtifactId = new Map<string, Json>()
  for (const o of memory.ownership?.artifacts || []) ownershipByArtifactId.set(String(o.id), o)

  if (!workItems.length && !sessions.length && !artifacts.length && !decisions.length) {
    wrap.appendChild(el('p', 'project-memory-empty', '暂无内容，先导入一段 Agent 对话。'))
    return wrap
  }

  const sessionIdsByWorkItem = new Map<string, Set<string>>()
  for (const l of sessionLinks) {
    if (!sessionIdsByWorkItem.has(String(l.workItemId))) sessionIdsByWorkItem.set(String(l.workItemId), new Set())
    sessionIdsByWorkItem.get(String(l.workItemId))!.add(String(l.sessionId))
  }
  const artifactIdsByWorkItem = new Map<string, Set<string>>()
  for (const l of artifactLinks) {
    if (!artifactIdsByWorkItem.has(String(l.workItemId))) artifactIdsByWorkItem.set(String(l.workItemId), new Set())
    artifactIdsByWorkItem.get(String(l.workItemId))!.add(String(l.artifactId))
  }

  const assignedSessionIds = new Set<string>()
  const assignedArtifactIds = new Set<string>()
  const assignedDecisionIds = new Set<string>()

  const leafGroup = (label: string, nodes: HTMLElement[]): HTMLElement | null => {
    if (!nodes.length) return null
    const group = el('div', 'pm-tree-group')
    group.appendChild(el('div', 'pm-tree-group-label', label + '（' + nodes.length + '）'))
    for (const n of nodes.slice(0, 6)) group.appendChild(n)
    if (nodes.length > 6) group.appendChild(el('div', 'pm-tree-more', `… 其余 ${nodes.length - 6} 条见功能任务详情`))
    return group
  }

  for (const work of workItems) {
    const itemSessions = sessions.filter(s => sessionIdsByWorkItem.get(String(work.id))?.has(String(s.id)))
    const itemArtifacts = artifacts.filter(a => artifactIdsByWorkItem.get(String(work.id))?.has(String(a.id)))
    const itemDecisions = decisions.filter(d => String(d.workItemId || '') === String(work.id))
    itemSessions.forEach(s => assignedSessionIds.add(String(s.id)))
    itemArtifacts.forEach(a => assignedArtifactIds.add(String(a.id)))
    itemDecisions.forEach(d => assignedDecisionIds.add(String(d.id)))

    const item = el('div', 'pm-tree-item')
    const row = el('div', 'pm-tree-row')
    const title = link(text(work.title), '#/projects/' + encodeURIComponent(projectId) + '/work-items/' + encodeURIComponent(work.id))
    title.className = 'pm-tree-title'
    row.appendChild(title)
    row.appendChild(el('span', 'pm-tree-badge', workStatusLabel(work.status)))
    row.appendChild(el('span', 'pm-tree-count', `${itemSessions.length} 会话 · ${itemArtifacts.length} 产出物 · ${itemDecisions.length} 决策`))
    item.appendChild(row)

    const children = el('div', 'pm-tree-children')
    const sessionGroup = leafGroup('Agent 会话', itemSessions.map(s => {
      const leaf = el('div', 'pm-tree-leaf')
      const a = link(text(s.title || s.userIntentSummary), '#/agent-sessions/' + encodeURIComponent(s.id))
      leaf.append(a, el('small', undefined, dateLabel(s.startedAt || s.createdAt)))
      return leaf
    }))
    const artifactGroup = leafGroup('产出物', itemArtifacts.map(a => {
      const leaf = el('div', 'pm-tree-leaf')
      leaf.append(el('span', undefined, text(a.repositoryRelativePath || a.name)))
      const own = ownershipByArtifactId.get(String(a.id))
      if (own) leaf.append(el('span', 'pm-tree-badge', text(own.evidenceLevel) + ' · ' + ownershipStateLabel(own.ownershipState)))
      return leaf
    }))
    const decisionGroup = leafGroup('技术决策', itemDecisions.map(d => {
      const leaf = el('div', 'pm-tree-leaf')
      leaf.append(el('span', undefined, text(d.title)), el('small', undefined, participationLabel(d.userParticipation)))
      return leaf
    }))
    for (const g of [sessionGroup, artifactGroup, decisionGroup]) if (g) children.appendChild(g)
    if (children.childElementCount) item.appendChild(children)
    wrap.appendChild(item)
  }

  // 未归属内容：没有关联到任何功能任务的会话/产出物/决策
  const orphanSessions = sessions.filter(s => !assignedSessionIds.has(String(s.id)))
  const orphanArtifacts = artifacts.filter(a => !assignedArtifactIds.has(String(a.id)))
  const orphanDecisions = decisions.filter(d => !assignedDecisionIds.has(String(d.id)))
  if (orphanSessions.length || orphanArtifacts.length || orphanDecisions.length) {
    const item = el('div', 'pm-tree-item pm-tree-orphan')
    const row = el('div', 'pm-tree-row')
    row.appendChild(el('span', 'pm-tree-title', '未归属内容'))
    row.appendChild(el('span', 'pm-tree-count', `${orphanSessions.length} 会话 · ${orphanArtifacts.length} 产出物 · ${orphanDecisions.length} 决策`))
    item.appendChild(row)
    const children = el('div', 'pm-tree-children')
    const sg = leafGroup('Agent 会话', orphanSessions.map(s => {
      const leaf = el('div', 'pm-tree-leaf')
      const a = link(text(s.title || s.userIntentSummary), '#/agent-sessions/' + encodeURIComponent(s.id))
      leaf.append(a, el('small', undefined, dateLabel(s.startedAt || s.createdAt)))
      return leaf
    }))
    const ag = leafGroup('产出物', orphanArtifacts.map(a => {
      const leaf = el('div', 'pm-tree-leaf')
      leaf.append(el('span', undefined, text(a.repositoryRelativePath || a.name)))
      return leaf
    }))
    const dg = leafGroup('技术决策', orphanDecisions.map(d => {
      const leaf = el('div', 'pm-tree-leaf')
      leaf.append(el('span', undefined, text(d.title)), el('small', undefined, participationLabel(d.userParticipation)))
      return leaf
    }))
    for (const g of [sg, ag, dg]) if (g) children.appendChild(g)
    item.appendChild(children)
    wrap.appendChild(item)
  }
  return wrap
}

function list(items: Json[], render: (item: Json, index: number) => HTMLElement): HTMLElement {
  const wrap = el('div', 'project-memory-list')
  if (!items.length) {
    wrap.appendChild(el('p', 'project-memory-empty', emptyText))
    return wrap
  }
  items.forEach((item, index) => wrap.appendChild(render(item, index)))
  return wrap
}

function demoBadge(): HTMLElement {
  return el('span', 'project-memory-badge', '示范内容 · 不写入真实数据')
}

function safeError(fallback: string): string {
  return friendlyProjectError(fallback)
}

function link(label: string, href: string): HTMLAnchorElement {
  const node = el('a', 'project-memory-card-link', label) as HTMLAnchorElement
  node.href = href
  return node
}

function searchResultHref(group: string, item: Json): string | null {
  const id = item.id
  if (!id) return null
  if (group === 'projects') return '#/projects/' + encodeURIComponent(id)
  if (group === 'workItems' && item.projectId) return '#/projects/' + encodeURIComponent(item.projectId) + '/work-items/' + encodeURIComponent(id)
  if (group === 'sessions') return '#/agent-sessions/' + encodeURIComponent(id)
  if (group === 'artifacts' && item.projectId) return '#/projects/' + encodeURIComponent(item.projectId)
  if (group === 'decisions') {
    if (item.workItemId && item.projectId) return '#/projects/' + encodeURIComponent(item.projectId) + '/work-items/' + encodeURIComponent(item.workItemId)
    if (item.sessionId) return '#/agent-sessions/' + encodeURIComponent(item.sessionId)
    if (item.projectId) return '#/projects/' + encodeURIComponent(item.projectId)
  }
  if (group === 'cognitiveDebts') return '#/training-debt/' + encodeURIComponent(id)
  return null
}

function renderSearchForm(projectId?: string): HTMLElement {
  const wrap = el('section', 'project-memory-panel')
  wrap.appendChild(el('h2', 'project-memory-panel-title', '搜索项目记忆'))
  const form = el('form', 'project-memory-search-form') as HTMLFormElement
  const input = el('input', 'project-memory-search-input') as HTMLInputElement
  input.type = 'search'
  input.placeholder = t('功能、文件、函数、Commit 或认知欠条…', 'Feature, file, function, commit, or cognitive debt…')
  input.required = true
  const submit = el('button', 'btn btn-primary', '搜索') as HTMLButtonElement
  const status = el('p', 'project-memory-status')
  const results = el('div', 'project-memory-list')
  form.append(input, submit, status)
  wrap.append(form, results)
  form.onsubmit = async event => {
    event.preventDefault()
    submit.disabled = true
    status.textContent = t('正在搜索…', 'Searching…')
    results.replaceChildren()
    try {
      const endpoint = projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/search?q=${encodeURIComponent(input.value.trim())}`
        : '/api/search?q=' + encodeURIComponent(input.value.trim())
      const response = await projectMemoryRequest<{ results: { total: number; groups: Record<string, Json[]> } }>(endpoint)
      status.textContent = t(`找到 ${response.results.total} 条关联记录；以下按记录类型分组。`, `Found ${response.results.total} related records, grouped by type below.`)
      const labels: Record<string, string> = { projects: '项目', workItems: '功能任务', sessions: 'Agent 会话', artifacts: '产出物', decisions: '技术决策', cognitiveDebts: '认知欠条' }
      Object.entries(response.results.groups || {}).forEach(([group, items]) => {
        if (!items.length) return
        const section = el('section', 'project-memory-search-group')
        section.appendChild(el('h3', 'project-memory-panel-title', `${labels[group] || group} · ${items.length}`))
        section.appendChild(list(items.slice(0, 8), item => {
          const card = el('article', 'project-memory-card')
          const label = item.title || item.name || item.repositoryRelativePath || item.gapText || item.id
          const href = searchResultHref(group, item)
          if (href) card.appendChild(link(text(label), href))
          else card.appendChild(el('strong', undefined, text(label)))
          card.appendChild(el('p', undefined, text(item.summary || item.implementationSummary || item.decision || item.repositoryRelativePath || item.gitCommitHash)))
          const contextParts = [
            item.projectId ? '项目已关联' : '',
            item.symbolName ? `函数：${item.symbolName}` : '',
            item.gitCommitHash ? `Commit：${item.gitCommitHash}` : '',
            item.context?.length ? `关联 ${item.context.length} 个产出物` : ''
          ].filter(Boolean)
          if (contextParts.length) card.appendChild(el('small', undefined, contextParts.join(' · ')))
          card.appendChild(el('span', 'project-memory-search-type', labels[group] || group))
          return card
        }))
        results.appendChild(section)
      })
      if (!response.results.total) results.appendChild(el('p', 'project-memory-empty', '没有找到匹配的项目记忆。'))
    } catch (error) {
      status.textContent = t('搜索暂时不可用，当前项目页面仍可继续查看。', 'Search is temporarily unavailable. You can still view the current project page.')
    } finally {
      submit.disabled = false
    }
  }
  return wrap
}

export async function renderProjectListPage(root: HTMLElement): Promise<void> {
  const page = pageShell('项目认知账本', '把 Agent 会话、真实任务、产出物、决策和认知证据放回同一条可追溯链路。')
  const actions = el('div', 'project-memory-actions')
  const create = el('button', 'btn btn-primary', '新建项目')
  create.onclick = () => {
    const name = window.prompt(t('项目名称', 'Project name'))
    if (!name?.trim()) return
    void projectMemoryRequest('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), projectType: 'software' })
    }).then(() => {
      root.replaceChildren()
      return renderProjectListPage(root)
    })
  }
  actions.appendChild(create)
  page.appendChild(actions)
  const body = el('main', 'project-memory-main')
  body.appendChild(renderSearchForm())
  body.appendChild(el('p', 'loading', '正在加载项目…'))
  page.appendChild(body)
  root.appendChild(page)
  try {
    const response = await projectMemoryRequest<{ projects: Json[] }>('/api/projects')
    body.replaceChildren(renderSearchForm())
    body.appendChild(panel('我的项目', list(response.projects || [], project => {
      const card = el('article', 'project-memory-card project-memory-project-card')
      card.appendChild(link(text(project.name), '#/projects/' + encodeURIComponent(project.id)))
      card.appendChild(el('p', undefined, projectTypeLabel(project.projectType) + ' · ' + projectStatusLabel(project.status)))
      card.appendChild(el('small', undefined, '最近更新：' + dateLabel(project.updatedAt)))
      return card
    })))
  } catch (error) {
    body.replaceChildren(el('div', 'error-box', safeError('项目列表暂时无法同步。')))
  }
}

function renderImportForm(projectId: string, onImported: () => void): HTMLElement {
  const form = el('form', 'project-memory-import-form') as HTMLFormElement
  const input = el('textarea', 'project-memory-textarea') as HTMLTextAreaElement
  input.placeholder = t('粘贴 AI 协作对话，或输入 JSON / JSONL / Markdown 文本…', 'Paste an AI collaboration transcript, or enter JSON / JSONL / Markdown…')
  input.required = true
  input.rows = 8
  const storage = el('select', 'project-memory-select') as HTMLSelectElement
  const noRaw = el('option', undefined, t('不保存原始内容（推荐）', 'Do not store raw content (recommended)')) as HTMLOptionElement
  noRaw.value = 'not_stored'
  const redacted = el('option', undefined, t('仅保存脱敏摘要片段', 'Store redacted summary excerpts only')) as HTMLOptionElement
  redacted.value = 'redacted'
  storage.append(noRaw, redacted)
  const submit = el('button', 'btn btn-primary', '导入并归纳') as HTMLButtonElement
  const status = el('p', 'project-memory-status')
  form.append(input, storage, submit, status)
  form.onsubmit = async event => {
    event.preventDefault()
    submit.disabled = true
    status.textContent = t('正在归纳会话…', 'Summarizing the session…')
    try {
      const result = await projectMemoryRequest<Json>('/api/agent-sessions/import', {
        method: 'POST',
        body: JSON.stringify({ projectId, text: input.value, platform: 'manual', rawContentStorage: storage.value, importMethod: 'manual_paste' })
      })
      status.textContent = result.workItemMatch?.action === 'pending_confirmation' ? t('已导入，WorkItem 等待确认。', 'Imported. The work item is waiting for confirmation.') : t('已导入并建立项目关联。', 'Imported and linked to the project.')
      input.value = ''
      onImported()
    } catch (error) {
      status.textContent = t('导入暂时不可用，当前项目示范内容仍可查看。', 'Import is temporarily unavailable. You can still view the project demo content.')
    } finally {
      submit.disabled = false
    }
  }
  return form
}

export async function renderProjectPage(root: HTMLElement, projectId: string): Promise<void> {
  const page = pageShell('项目认知账本', '正在加载…')
  const body = el('main', 'project-memory-main')
  body.appendChild(el('p', 'loading', '正在加载项目记忆…'))
  page.appendChild(body)
  root.appendChild(page)

  let memory: Json
  try {
    const response = await projectMemoryRequest<{ memory: Json }>('/api/projects/' + encodeURIComponent(projectId) + '/memory')
    const memory = response.memory
    page.querySelector('.project-memory-subtitle')!.textContent = text(memory.project.description, '长期追踪这个项目的 AI 协作和人类能力证据。')
    body.replaceChildren()
    const metrics = el('div', 'project-memory-metrics')
    const countLabels: Record<string, string> = {
      projects: '项目', workItems: '功能任务', sessions: 'Agent 会话',
      artifacts: '产出物', decisions: '技术决策', cognitiveDebts: '认知欠条',
      debts: '关联欠条', owned: '已确证模块', evidence: '证据', links: '关联'
    }
    Object.entries(memory.counts || {}).forEach(([label, value]) => {
      const metric = el('article', 'project-memory-metric')
      metric.appendChild(el('strong', undefined, String(value)))
      metric.appendChild(el('span', undefined, countLabels[label] || label))
      metrics.appendChild(metric)
    })
    body.appendChild(metrics)
    body.appendChild(panel('导入 Agent 对话', renderImportForm(projectId, () => {
      root.replaceChildren()
      void renderProjectPage(root, projectId)
    })))
    body.appendChild(panel('项目结构树', renderProjectTree(memory, projectId)))
    body.appendChild(panel('实现时间线', renderSessionTimeline(memory.sessions || [])))
  } catch (error) {
    let project: Json = { id: projectId, name: '项目示范视图', description: '项目历史记录正在同步。' }
    try {
      const projects = await projectMemoryRequest<{ projects: Json[] }>('/api/projects')
      project = (projects.projects || []).find(item => item.id === projectId) || project
    } catch {
      // 页面必须仍然可用；没有列表数据时使用路由 ID 生成最小示范上下文。
    }
    memory = buildProjectMemoryDemo(project as any)
  }
  await renderProjectMemoryContent(root, page, body, memory, projectId)
}

async function renderProjectMemoryContent(root: HTMLElement, page: HTMLElement, body: HTMLElement, rawMemory: Json, projectId: string): Promise<void> {
  const memory = fillProjectMemory(rawMemory, rawMemory?.project)
  const subtitle = page.querySelector('.project-memory-subtitle') as HTMLElement
  subtitle.textContent = text(memory.project.description, t('长期追踪这个项目的 AI 协作和人类能力证据。', 'Track this project’s AI collaboration and human capability evidence over time.'))
  if (memory.isDemoView) subtitle.append(' · ', demoBadge())
  body.replaceChildren()
  const metrics = el('div', 'project-memory-metrics')
  Object.entries(memory.counts || {}).forEach(([label, value]) => {
    const metric = el('article', 'project-memory-metric')
    metric.appendChild(el('strong', undefined, String(value)))
    metric.appendChild(el('span', undefined, MEMORY_COUNT_LABELS[label] || label))
    metrics.appendChild(metric)
  })
  body.appendChild(metrics)
  body.appendChild(renderSearchForm(projectId))
  body.appendChild(panel('导入 Agent 对话', renderImportForm(projectId, () => {
    root.replaceChildren()
    void renderProjectPage(root, projectId)
  })))
  const timelinePanel = el('section', 'project-memory-panel')
  timelinePanel.appendChild(el('h2', 'project-memory-panel-title', '最近事件'))
  const timelineList = el('div', 'project-memory-list')
  let timeline = memory.timeline || []
  try {
    const timelineResponse = await projectMemoryRequest<{ timeline: Json[] }>('/api/projects/' + encodeURIComponent(projectId) + '/timeline')
    timeline = timelineResponse.timeline?.length ? timelineResponse.timeline : timeline
  } catch {
    // 用上面由项目内容生成的示范时间线继续渲染，不暴露后端原始异常。
  }
  timeline.slice(0, 12).forEach((event: Json) => {
    const card = el('article', 'project-memory-card')
    const label = text(event.label || event.type)
    const isDemo = Boolean(event.demo)
    if (isDemo) {
      card.append(el('strong', undefined, label), demoBadge())
    } else {
      let href = '#/projects/' + encodeURIComponent(projectId)
      if (event.type === 'session') href = '#/agent-sessions/' + encodeURIComponent(event.referenceId || event.id)
      if (event.type === 'work_item') href = '#/projects/' + encodeURIComponent(projectId) + '/work-items/' + encodeURIComponent(event.referenceId || event.id)
      card.appendChild(link(label, href))
    }
    card.appendChild(el('small', undefined, text(event.type) + ' · ' + text(event.occurredAt)))
    timelineList.appendChild(card)
  })
  timelinePanel.appendChild(timelineList)
  body.appendChild(timelinePanel)
  body.appendChild(panel('最近实现', list(
    (memory.sessions || []).slice(0, 8),
    session => {
      const item = el('article', 'project-memory-card')
      if (session.demo) item.append(el('strong', undefined, text(session.title || session.userIntentSummary)), demoBadge())
      else item.appendChild(link(text(session.title || session.userIntentSummary), '#/agent-sessions/' + encodeURIComponent(session.id)))
      item.append(el('p', undefined, text(session.implementationSummary, '已完成一次项目协作记录。')), el('small', undefined, text(session.platform) + ' · ' + text(session.createdAt)))
      return item
    },
    '暂无真实会话；下面保留一条示范会话供查看。'
  )))
  body.appendChild(panel('功能任务', list(memory.workItems || [], work => {
    const item = el('article', 'project-memory-card')
    if (work.demo) item.append(el('strong', undefined, text(work.title)), demoBadge())
    else item.appendChild(link(text(work.title), '#/projects/' + encodeURIComponent(projectId) + '/work-items/' + encodeURIComponent(work.id)))
    item.appendChild(el('p', undefined, statusLabel(work.status) + ' · ' + text(work.summary)))
    return item
  })))
  body.appendChild(panel('关键决策', list((memory.decisions || []).slice(0, 8), decision => {
    const item = el('article', 'project-memory-card')
    item.append(el('strong', undefined, text(decision.title)), el('p', undefined, text(decision.decision)), el('small', undefined, '参与度：' + text(decision.userParticipation)))
    if (decision.demo) item.appendChild(demoBadge())
    return item
  })))
  body.appendChild(panel('项目所有权', list((memory.ownership?.artifacts || []).slice(0, 12), artifact => {
    const item = el('article', 'project-memory-card')
    item.append(el('strong', undefined, text(artifact.repositoryRelativePath || artifact.name)), el('span', 'project-memory-badge', text(artifact.evidenceLevel) + ' · ' + text(artifact.ownershipState)))
    if (artifact.demo) item.appendChild(demoBadge())
    return item
  })))
}

export async function renderWorkItemPage(root: HTMLElement, projectId: string, workItemId: string): Promise<void> {
  const page = pageShell('功能任务', '正在加载…')
  const body = el('main', 'project-memory-main')
  page.appendChild(body)
  root.appendChild(page)
  try {
    const response = await projectMemoryRequest<{ detail: Json }>('/api/work-items/' + encodeURIComponent(workItemId))
    const rawDetail = response.detail
    const detail = (rawDetail.sessions?.length && rawDetail.artifacts?.length && rawDetail.decisions?.length)
      ? rawDetail
      : {
          ...buildWorkItemDemo(rawDetail.workItem || { id: workItemId, title: '功能任务示范' }, projectId),
          ...rawDetail,
          sessions: rawDetail.sessions?.length ? rawDetail.sessions : buildWorkItemDemo(rawDetail.workItem || { id: workItemId }, projectId).sessions,
          artifacts: rawDetail.artifacts?.length ? rawDetail.artifacts : buildWorkItemDemo(rawDetail.workItem || { id: workItemId }, projectId).artifacts,
          decisions: rawDetail.decisions?.length ? rawDetail.decisions : buildWorkItemDemo(rawDetail.workItem || { id: workItemId }, projectId).decisions
        }
    page.querySelector('.page-title')!.textContent = text(detail.workItem.title)
    page.querySelector('.project-memory-subtitle')!.textContent = workStatusLabel(detail.workItem.status) + ' · ' + text(detail.workItem.summary)
    body.replaceChildren()
    body.appendChild(panel('相关 Agent 对话', list(detail.sessions || [], session => {
      const item = el('article', 'project-memory-card')
      item.append(link(text(session.title || session.userIntentSummary), '#/agent-sessions/' + encodeURIComponent(session.id)), el('p', undefined, text(session.implementationSummary)))
      return item
    })))
    body.appendChild(panel('文件、函数和 Commit', list(detail.artifacts || [], artifact => {
      const item = el('article', 'project-memory-card')
      item.append(el('strong', undefined, text(artifact.repositoryRelativePath || artifact.name)), el('p', undefined, text(artifact.type) + ' · ' + text(artifact.symbolName) + ' · ' + text(artifact.gitCommitHash)))
      return item
    })))
    body.appendChild(panel('关键决策', list(detail.decisions || [], decision => {
      const item = el('article', 'project-memory-card')
      item.append(el('strong', undefined, text(decision.title)), el('p', undefined, text(decision.decision)), el('small', undefined, '用户参与：' + participationLabel(decision.userParticipation)))
      return item
    })))
    const back = link('返回项目', '#/projects/' + encodeURIComponent(projectId))
    back.className = 'btn btn-ghost'
    body.appendChild(back)
  } catch (error) {
    const detail = buildWorkItemDemo({ id: workItemId, title: '功能任务示范' }, projectId)
    page.querySelector('.page-title')!.textContent = text(detail.workItem.title)
    page.querySelector('.project-memory-subtitle')!.textContent = '项目内容示范视图'
    body.replaceChildren()
    body.appendChild(demoBadge())
    body.appendChild(panel('相关 Agent 对话', list(detail.sessions, session => el('article', 'project-memory-card', text(session.title)))))
    body.appendChild(panel('文件、函数和 Commit', list(detail.artifacts, artifact => el('article', 'project-memory-card', text(artifact.name)))))
    body.appendChild(panel('关键决策', list(detail.decisions, decision => el('article', 'project-memory-card', text(decision.decision)))))
    body.appendChild(link('返回项目', '#/projects/' + encodeURIComponent(projectId)))
  }
}

export async function renderAgentSessionPage(root: HTMLElement, sessionId: string): Promise<void> {
  const page = pageShell('Agent 会话', '正在加载…')
  const body = el('main', 'project-memory-main')
  page.appendChild(body)
  root.appendChild(page)
  try {
    const response = await projectMemoryRequest<{ detail: Json }>('/api/agent-sessions/' + encodeURIComponent(sessionId))
    const rawDetail = response.detail
    const demoDetail = buildSessionDemo(rawDetail.session || { id: sessionId, title: 'Agent 会话示范' }, rawDetail.session?.projectId || 'project')
    const detail = {
      ...demoDetail,
      ...rawDetail,
      session: {
        ...demoDetail.session,
        ...(rawDetail.session || {}),
        userIntentSummary: rawDetail.session?.userIntentSummary || demoDetail.session.userIntentSummary,
        implementationSummary: rawDetail.session?.implementationSummary || demoDetail.session.implementationSummary
      },
      artifacts: rawDetail.artifacts?.length ? rawDetail.artifacts : demoDetail.artifacts
    }
    page.querySelector('.page-title')!.textContent = text(detail.session.title || detail.session.platform)
    page.querySelector('.project-memory-subtitle')!.textContent = text(detail.session.platform) + ' · ' + dateLabel(detail.session.createdAt)
    body.replaceChildren()
    body.appendChild(panel('用户想完成什么', el('p', undefined, text(detail.session.userIntentSummary))))
    body.appendChild(panel('Agent 实际做了什么', el('p', undefined, text(detail.session.implementationSummary))))
    body.appendChild(panel('产出物', list(detail.artifacts || [], artifact => {
      const item = el('article', 'project-memory-card')
      item.append(el('strong', undefined, text(artifact.repositoryRelativePath || artifact.name)), el('p', undefined, text(artifact.type) + ' · ' + text(artifact.symbolName) + ' · ' + text(artifact.gitCommitHash)))
      return item
    })))
    const candidates = detail.session.analysis?.cognitiveDebtCandidates || []
    body.appendChild(panel('认知欠条候选', list(candidates, (candidate, index) => {
      const item = el('article', 'project-memory-card')
      item.append(el('strong', undefined, text(candidate.title)), el('p', undefined, text(candidate.description)), el('small', undefined, '优先级：' + text(candidate.priority) + ' · 置信度：' + text(candidate.confidence)))
      const accept = el('button', 'btn btn-primary btn-sm', '确认生成欠条')
      accept.onclick = async () => {
        accept.disabled = true
        try {
          await projectMemoryRequest('/api/agent-sessions/' + encodeURIComponent(sessionId) + '/debt-candidates/' + index + '/accept', { method: 'POST', body: '{}' })
          accept.textContent = t('已关联现有训练系统', 'Linked to the existing training system')
        } catch {
          accept.disabled = false
          accept.textContent = t('稍后再试', 'Try again later')
        }
      }
      item.appendChild(accept)
      return item
    }, '本次会话未创建正式欠条；示范内容仅展示分析结果的呈现方式。')))
  } catch (error) {
    const detail = buildSessionDemo({ id: sessionId, title: 'Agent 会话示范' })
    page.querySelector('.page-title')!.textContent = text(detail.session.title)
    page.querySelector('.project-memory-subtitle')!.textContent = '项目内容示范视图'
    body.replaceChildren()
    body.appendChild(demoBadge())
    body.appendChild(panel('用户想完成什么', el('p', undefined, text(detail.session.userIntentSummary))))
    body.appendChild(panel('Agent 实际做了什么', el('p', undefined, text(detail.session.implementationSummary))))
    body.appendChild(panel('产出物', list(detail.artifacts, artifact => el('article', 'project-memory-card', text(artifact.name)))))
    body.appendChild(panel('认知欠条候选', el('p', 'project-memory-empty', '示范会话未创建正式欠条；真实分析结果会在会话归档后显示。')))
  }
}

export type ProjectMemoryRoute = Extract<Route, { name: 'projects' | 'project' | 'work-item' | 'agent-session' }>
