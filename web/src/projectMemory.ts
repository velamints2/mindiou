import { projectMemoryRequest } from './api'
import { el, navigate, type Route } from './router'

type Json = Record<string, any>

function pageShell(title: string, subtitle?: string): HTMLElement {
  const page = el('div', 'page page-project-memory')
  const header = el('header', 'page-header project-memory-header')
  const titleNode = el('div')
  titleNode.appendChild(el('p', 'dashboard-kicker', 'PROJECT MEMORY'))
  titleNode.appendChild(el('h1', 'page-title', title))
  if (subtitle) titleNode.appendChild(el('p', 'project-memory-subtitle', subtitle))
  header.appendChild(titleNode)
  const back = el('button', 'btn btn-ghost btn-sm', '项目列表')
  back.onclick = () => navigate({ name: 'projects' })
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
    wrap.appendChild(el('p', 'project-memory-empty', '暂无记录'))
    return wrap
  }
  items.forEach((item, index) => wrap.appendChild(render(item, index)))
  return wrap
}

function link(label: string, href: string): HTMLAnchorElement {
  const node = el('a', 'project-memory-card-link', label) as HTMLAnchorElement
  node.href = href
  return node
}

function renderSearchForm(): HTMLElement {
  const wrap = el('section', 'project-memory-panel')
  wrap.appendChild(el('h2', 'project-memory-panel-title', '搜索项目记忆'))
  const form = el('form', 'project-memory-search-form') as HTMLFormElement
  const input = el('input', 'project-memory-search-input') as HTMLInputElement
  input.type = 'search'
  input.placeholder = '功能、文件、函数、Commit 或认知欠条…'
  input.required = true
  const submit = el('button', 'btn btn-primary', '搜索') as HTMLButtonElement
  const status = el('p', 'project-memory-status')
  const results = el('div', 'project-memory-list')
  form.append(input, submit, status)
  wrap.append(form, results)
  form.onsubmit = async event => {
    event.preventDefault()
    submit.disabled = true
    status.textContent = '正在搜索…'
    results.replaceChildren()
    try {
      const response = await projectMemoryRequest<{ results: { total: number; groups: Record<string, Json[]> } }>('/api/search?q=' + encodeURIComponent(input.value.trim()))
      status.textContent = `找到 ${response.results.total} 条关联记录`
      const labels: Record<string, string> = { projects: '项目', workItems: '功能任务', sessions: 'Agent 会话', artifacts: '产出物', decisions: '技术决策', cognitiveDebts: '认知欠条' }
      Object.entries(response.results.groups || {}).forEach(([group, items]) => {
        if (!items.length) return
        const section = el('section', 'project-memory-search-group')
        section.appendChild(el('h3', 'project-memory-panel-title', labels[group] || group))
        section.appendChild(list(items.slice(0, 8), item => {
          const card = el('article', 'project-memory-card')
          const label = item.title || item.name || item.repositoryRelativePath || item.gapText || item.id
          card.appendChild(el('strong', undefined, text(label)))
          card.appendChild(el('p', undefined, text(item.summary || item.implementationSummary || item.decision || item.repositoryRelativePath || item.gitCommitHash)))
          return card
        }))
        results.appendChild(section)
      })
      if (!response.results.total) results.appendChild(el('p', 'project-memory-empty', '没有找到匹配的项目记忆。'))
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '搜索失败'
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
    const name = window.prompt('项目名称')
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
    body.replaceChildren(panel('我的项目', list(response.projects || [], project => {
      const card = el('article', 'project-memory-card project-memory-project-card')
      card.appendChild(link(text(project.name), '#/projects/' + encodeURIComponent(project.id)))
      card.appendChild(el('p', undefined, projectTypeLabel(project.projectType) + ' · ' + projectStatusLabel(project.status)))
      card.appendChild(el('small', undefined, '最近更新：' + dateLabel(project.updatedAt)))
      return card
    })))
  } catch (error) {
    body.replaceChildren(el('div', 'error-box', error instanceof Error ? error.message : '加载失败'))
  }
}

function renderImportForm(projectId: string, onImported: () => void): HTMLElement {
  const form = el('form', 'project-memory-import-form') as HTMLFormElement
  const input = el('textarea', 'project-memory-textarea') as HTMLTextAreaElement
  input.placeholder = '粘贴 Codex / TRAE / Claude Code 对话，或输入 JSON / JSONL / Markdown 文本…'
  input.required = true
  input.rows = 8
  const storage = el('select', 'project-memory-select') as HTMLSelectElement
  storage.innerHTML = '<option value="not_stored">不保存原始内容（推荐）</option><option value="redacted">仅保存脱敏摘要片段</option>'
  const submit = el('button', 'btn btn-primary', '导入并归纳') as HTMLButtonElement
  const status = el('p', 'project-memory-status')
  form.append(input, storage, submit, status)
  form.onsubmit = async event => {
    event.preventDefault()
    submit.disabled = true
    status.textContent = '正在归纳会话…'
    try {
      const result = await projectMemoryRequest<Json>('/api/agent-sessions/import', {
        method: 'POST',
        body: JSON.stringify({ projectId, text: input.value, platform: 'manual', rawContentStorage: storage.value, importMethod: 'manual_paste' })
      })
      status.textContent = result.workItemMatch?.action === 'pending_confirmation' ? '已导入，WorkItem 等待确认。' : '已导入并建立项目关联。'
      input.value = ''
      onImported()
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '导入失败'
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
    body.replaceChildren(el('div', 'error-box', error instanceof Error ? error.message : '加载失败'))
  }
}

export async function renderWorkItemPage(root: HTMLElement, projectId: string, workItemId: string): Promise<void> {
  const page = pageShell('功能任务', '正在加载…')
  const body = el('main', 'project-memory-main')
  page.appendChild(body)
  root.appendChild(page)
  try {
    const response = await projectMemoryRequest<{ detail: Json }>('/api/work-items/' + encodeURIComponent(workItemId))
    const detail = response.detail
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
    body.appendChild(el('div', 'error-box', error instanceof Error ? error.message : '加载失败'))
  }
}

export async function renderAgentSessionPage(root: HTMLElement, sessionId: string): Promise<void> {
  const page = pageShell('Agent 会话', '正在加载…')
  const body = el('main', 'project-memory-main')
  page.appendChild(body)
  root.appendChild(page)
  try {
    const response = await projectMemoryRequest<{ detail: Json }>('/api/agent-sessions/' + encodeURIComponent(sessionId))
    const detail = response.detail
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
    body.appendChild(panel('认知欠条候选', list(detail.session.analysis?.cognitiveDebtCandidates || [], (candidate, index) => {
      const item = el('article', 'project-memory-card')
      item.append(el('strong', undefined, text(candidate.title)), el('p', undefined, text(candidate.description)), el('small', undefined, '优先级：' + text(candidate.priority) + ' · 置信度：' + text(candidate.confidence)))
      const accept = el('button', 'btn btn-primary btn-sm', '确认生成欠条')
      accept.onclick = async () => {
        accept.disabled = true
        await projectMemoryRequest('/api/agent-sessions/' + encodeURIComponent(sessionId) + '/debt-candidates/' + index + '/accept', { method: 'POST', body: '{}' })
        accept.textContent = '已关联现有训练系统'
      }
      item.appendChild(accept)
      return item
    })))
  } catch (error) {
    body.appendChild(el('div', 'error-box', error instanceof Error ? error.message : '加载失败'))
  }
}

export type ProjectMemoryRoute = Extract<Route, { name: 'projects' | 'project' | 'work-item' | 'agent-session' }>
