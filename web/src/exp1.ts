// EXP-1 review workbench: label candidate gaps as real_debt / not_debt /
// unsure, with pre-label and rationale visible. A-layer aggregates duplicate
// candidate rows; template gaps are deferred per protocol.
import { apiFetch } from './api'
import { t } from './i18n'
import { el } from './router'

type LocalizedText = { zh: string; en: string }
const copy = (text: LocalizedText): string => t(text.zh, text.en)

interface CandidateRow {
  session_id: string
  candidate_index: number
  title: string
  description: string
  reason: string
  pre_label?: string
  pre_label_reason?: string
  annotation?: string
  notes?: string
}

interface LegacyRow {
  debt_id: string
  gap_text: string
  template_generated?: boolean
  pre_label?: string
  annotation?: string
  notes?: string
}

interface SheetData {
  rows: CandidateRow[]
  legacy_debts: LegacyRow[]
  annotation_protocol?: Record<string, unknown>
}

type LabelValue = 'real_debt' | 'not_debt' | 'unsure'

function labelButtonClass(label: LabelValue): string {
  return label === 'real_debt' ? 'exp1-real' : label === 'not_debt' ? 'exp1-not' : 'exp1-unsure'
}

function makeRow(
  rowId: string,
  heading: string,
  body: string,
  rationale: string,
  existing: { label: string; note: string } | undefined,
  onSubmit: (label: LabelValue, note: string) => Promise<void>
): HTMLElement {
  const box = el('div', 'exp1-row')
  box.append(el('strong', undefined, heading))
  box.append(el('p', 'exp1-body', body))
  if (rationale) box.append(el('p', 'exp1-rationale', copy({ zh: `初标依据：${rationale}`, en: `Pre-label: ${rationale}` })))
  const noteInput = el('input', 'exp1-note') as HTMLInputElement
  noteInput.placeholder = copy({ zh: '复核理由（可选）', en: 'Note (optional)' })
  noteInput.value = existing?.note || ''
  const actions = el('div', 'exp1-actions')
  const status = el('span', 'exp1-status', existing ? copy({ zh: `已标：${existing.label}`, en: `Labeled: ${existing.label}` }) : '')
  const buttons: HTMLButtonElement[] = []
  for (const label of ['real_debt', 'not_debt', 'unsure'] as LabelValue[]) {
    const btn = el('button', `exp1-btn ${labelButtonClass(label)}`, label) as HTMLButtonElement
    if (existing?.label === label) btn.classList.add('is-selected')
    btn.addEventListener('click', async () => {
      for (const b of buttons) { b.disabled = true; b.classList.remove('is-selected') }
      btn.classList.add('is-selected')
      try {
        await onSubmit(label, noteInput.value.trim())
        status.textContent = copy({ zh: '已保存', en: 'Saved' })
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error)
      } finally {
        for (const b of buttons) b.disabled = false
      }
    })
    buttons.push(btn)
    actions.append(btn)
  }
  actions.append(status)
  box.append(noteInput, actions)
  return box
}

export async function renderExp1Page(root: HTMLElement): Promise<void> {
  root.replaceChildren()
  const page = el('div', 'page exp1-page')
  page.append(el('h1', undefined, copy({ zh: 'EXP-1 候选复核', en: 'EXP-1 Candidate Review' })))
  page.append(el('p', 'page-lede', copy({
    zh: '逐条判定候选欠条：real_debt = 对应一次可指认的未理解事件（材料里有接触证据）；not_debt = 泛化/重复/系统臆测；unsure = 证据不足。',
    en: 'Label each candidate gap: real_debt maps to an identifiable un-understood event with exposure evidence; not_debt is generic, duplicated, or system speculation; unsure otherwise.'
  })))

  const [labelsResponse, exportResponse] = await Promise.all([
    apiFetch<{ ok: boolean; labels: Record<string, { label: string; note: string }> }>('/api/experiments/exp1/sheet'),
    apiFetch<{ ok: boolean; sheet: SheetData }>('/api/experiments/exp1/export')
  ])
  const labels = labelsResponse.labels
  const sheet = exportResponse.sheet
  const submit = (rowId: string) => async (label: LabelValue, note: string): Promise<void> => {
    await apiFetch('/api/experiments/exp1/label', { method: 'POST', body: JSON.stringify({ rowId, label, note }) })
  }

  // A-layer: aggregate duplicate candidate rows by gap text
  page.append(el('h4', undefined, copy({ zh: 'A 层 · 会话候选（按 gap 聚合）', en: 'A-layer · session candidates (aggregated)' })))
  const aHost = el('div', 'exp1-list')
  page.append(aHost)
  const groups = new Map<string, { rows: CandidateRow[]; key: string }>()
  for (const row of sheet.rows) {
    const key = (row.description || row.title).slice(0, 40)
    if (!groups.has(key)) groups.set(key, { rows: [], key })
    groups.get(key)!.rows.push(row)
  }
  const total = groups.size
  let labeledA = 0
  for (const group of groups.values()) {
    const first = group.rows[0]
    const rowId = `candidate:${first.session_id}:${first.candidate_index}`
    const existing = labels[rowId]
    if (existing) labeledA++
    const dup = group.rows.length > 1 ? copy({ zh: `（${group.rows.length} 条重复候选行）`, en: ` (${group.rows.length} duplicate rows)` }) : ''
    aHost.append(makeRow(
      rowId,
      (first.description || first.title).slice(0, 110) + dup,
      first.reason || '',
      first.pre_label_reason || '',
      existing,
      submit(rowId)
    ))
  }
  const progress = el('p', 'exp1-progress', copy({ zh: `A 层进度：${labeledA}/${total}`, en: `A-layer: ${labeledA}/${total}` }))
  page.append(progress)

  // B-layer: content-specific legacy gaps (reviewable now); template deferred
  page.append(el('h4', undefined, copy({ zh: 'B 层 · 内容特定历史欠条', en: 'B-layer · content-specific legacy debts' })))
  const bHost = el('div', 'exp1-list')
  page.append(bHost)
  const contentSpecific = sheet.legacy_debts.filter(d => !d.template_generated)
  const templateCount = sheet.legacy_debts.length - contentSpecific.length
  for (const debt of contentSpecific) {
    const rowId = `legacy:${debt.debt_id}`
    bHost.append(makeRow(rowId, debt.gap_text.slice(0, 110), '', '', labels[rowId], submit(rowId)))
  }
  page.append(el('p', 'exp1-deferred', copy({
    zh: `模板化 gap ${templateCount} 条按协议暂缓（需报告材料回查）。`,
    en: `${templateCount} template gaps deferred per protocol (material lookup pending).`
  })))

  root.append(page)
}
