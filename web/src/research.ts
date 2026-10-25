// Research portfolio page: groups the docs/research package into navigable
// sections for defense/review presentations. Files live on disk; the page
// only lists metadata.
import { apiFetch } from './api'
import { t } from './i18n'
import { el } from './router'

type LocalizedText = { zh: string; en: string }
const copy = (text: LocalizedText): string => t(text.zh, text.en)

interface Asset { file: string; bytes: number; modifiedAt: string }

interface Section { key: string; title: LocalizedText; hint: LocalizedText; match: (file: string) => boolean }

const SECTIONS: Section[] = [
  {
    key: 'program',
    title: { zh: '研究纲领', en: 'Program' },
    hint: { zh: 'RQ、构念操作化、实验设计', en: 'RQs, construct, designs' },
    match: file => file.startsWith('RESEARCH_PROGRAM') || file.startsWith('研究纲领')
  },
  {
    key: 'proposal',
    title: { zh: '开题材料', en: 'Proposal' },
    hint: { zh: '提交学校的八节版', en: 'School-format draft' },
    match: file => file.startsWith('PROPOSAL') || file.startsWith('开题报告')
  },
  {
    key: 'refs',
    title: { zh: '文献', en: 'References' },
    hint: { zh: '31 条三层结构，全部核实', en: '31 verified entries' },
    match: file => file.startsWith('REFERENCES')
  },
  {
    key: 'exp',
    title: { zh: '实验', en: 'Experiments' },
    hint: { zh: '预注册、标注、审计、分析', en: 'Prereg, labels, audits' },
    match: file => file.startsWith('EXP') || file.startsWith('EXP1') || file.startsWith('EXP2')
  },
  {
    key: 'governance',
    title: { zh: '治理', en: 'Governance' },
    hint: { zh: '数据管理与知情同意', en: 'DMP and consent' },
    match: file => file.startsWith('DATA_') || file.startsWith('INFORMED_')
  },
  {
    key: 'history',
    title: { zh: '研究历程', en: 'History' },
    hint: { zh: '编年史与前沿综述', en: 'Chronology and reviews' },
    match: file => file.startsWith('PROJECT_CHRONOLOGY') || file.startsWith('AI_')
  },
  {
    key: 'meta',
    title: { zh: '索引', en: 'Index' },
    hint: { zh: '资料全景', en: 'Map of everything' },
    match: file => file.startsWith('INDEX')
  }
]

function formatBytes(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export async function renderResearchPage(root: HTMLElement): Promise<void> {
  root.replaceChildren()
  const page = el('div', 'page research-page')
  page.append(el('h1', undefined, copy({ zh: '研究资料包', en: 'Research Portfolio' })))
  page.append(el('p', 'page-lede', copy({
    zh: '本项目的科研材料全景：纲领、文献、预注册实验、数据治理与编年史。文件在 docs/research/，本页提供导航与元数据。',
    en: 'The full research package: program, references, preregistered experiments, governance, and history. Files live in docs/research/.'
  })))

  // Subject action board: live go/no-go gate at the top of the page.
  const board = await apiFetch<{ ok: boolean; actions: Array<{ id: string; title: string; detail: string; url: string; done: boolean }>; goNoGo: string }>('/api/research/next-actions').catch(() => null)
  if (board?.ok) {
    const card = el('section', 'research-actions')
    const head = el('div', 'research-section-head')
    head.append(el('h4', undefined, copy({ zh: '下一步行动', en: 'Next Actions' })))
    const badge = el('span', `go-badge ${board.goNoGo === 'GO' ? 'go' : 'no-go'}`, board.goNoGo)
    head.append(badge)
    card.append(head)
    for (const action of board.actions) {
      const row = el('a', `action-row${action.done ? ' done' : ''}`)
      row.href = action.url
      row.append(el('span', 'action-mark', action.done ? '✓' : '○'))
      row.append(el('span', 'action-title', action.title))
      row.append(el('span', 'action-detail', action.detail))
      card.append(row)
    }
    page.append(card)
  }

  const data = await apiFetch<{ ok: boolean; count: number; assets: Asset[] }>('/api/research/assets')
  const unclaimed = new Set(data.assets.map(asset => asset.file))
  for (const section of SECTIONS) {
    const items = data.assets.filter(asset => section.match(asset.file))
    if (!items.length) continue
    for (const item of items) unclaimed.delete(item.file)
    const group = el('section', 'research-section')
    const head = el('div', 'research-section-head')
    head.append(el('h4', undefined, copy(section.title)))
    head.append(el('span', 'research-hint', copy(section.hint)))
    group.append(head)
    for (const item of items.sort((a, b) => a.file.localeCompare(b.file))) {
      const row = el('div', 'research-file')
      row.append(el('code', undefined, item.file))
      row.append(el('span', 'research-file-meta', `${formatBytes(item.bytes)} · ${item.modifiedAt.slice(0, 10)}`))
      group.append(row)
    }
    page.append(group)
  }
  if (unclaimed.size) {
    const group = el('section', 'research-section')
    group.append(el('h4', undefined, copy({ zh: '其他', en: 'Other' })))
    for (const file of [...unclaimed].sort()) {
      const row = el('div', 'research-file')
      row.append(el('code', undefined, file))
      group.append(row)
    }
    page.append(group)
  }
  const footer = el('p', 'research-footer', copy({ zh: `共 ${data.count} 件 · 导出访问已记录审计日志`, en: `${data.count} items · reads are audit-logged` }))
  page.append(footer)
  root.append(page)
}
