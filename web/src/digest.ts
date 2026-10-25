// Bilibili video digest page: paste a B 站 link, MindIOU reads the real
// subtitles/metadata, distills knowledge points, and turns them into
// cognitive-debt candidates plus plugin-importable cards.
import { apiFetch } from './api'
import { t } from './i18n'
import { el, navigate } from './router'

type LocalizedText = { zh: string; en: string }
const copy = (text: LocalizedText): string => t(text.zh, text.en)

interface DigestCard {
  id: string
  front: string
  back: string
  tags: string[]
  evidence?: { url?: string }
}

interface DigestInsight {
  timecode: string | null
  cue: string
  text: string
  terms?: string[]
  url?: string
}

interface DebtCandidateView {
  gapText: string
  reason: string
  risk?: string
  requiredEvidence?: string[]
}

interface DigestItem {
  id: string
  imported: string | null
  importedSessionId?: string
  subtitle: { lan: string | null; reason: string }
  digest: {
    mode: string
    note: string
    insights: DigestInsight[]
    cards: DigestCard[]
    debtCandidates: DebtCandidateView[]
    stats: Record<string, number>
  }
  video: {
    bvid: string
    title: string
    desc: string
    duration: number
    owner: string
    cover: string
    tags: string[]
  }
  generatedAt: string
}

function durationLabel(sec: number): string {
  if (!sec) return '-'
  const m = Math.floor(sec / 60)
  return `${m}min`
}

function renderInsightRow(insight: DigestInsight): HTMLElement {
  const row = el('div', 'digest-insight')
  const meta = el('div', 'digest-insight-meta')
  if (insight.timecode) {
    const link = el('a', 'digest-timecode', `${insight.timecode} ▸`) as HTMLAnchorElement
    link.href = insight.url || '#'
    link.target = '_blank'
    link.rel = 'noopener'
    meta.append(link)
  } else {
    meta.append(el('span', 'digest-timecode', '简介 ▸'))
  }
  meta.append(el('span', 'digest-cue', insight.cue))
  if (insight.terms?.length) {
    meta.append(el('span', 'digest-terms', insight.terms.join(' · ')))
  }
  const text = el('p', undefined, insight.text)
  row.append(meta, text)
  return row
}

function renderCard(card: DigestCard): HTMLElement {
  const box = el('div', 'digest-card')
  box.append(el('strong', undefined, card.front))
  box.append(el('p', undefined, card.back))
  return box
}

function renderDebtCandidate(candidate: DebtCandidateView): HTMLElement {
  const box = el('div', 'digest-debt')
  box.append(el('strong', undefined, candidate.gapText))
  box.append(el('p', undefined, candidate.reason))
  if (candidate.requiredEvidence?.length) {
    const list = el('ul')
    for (const item of candidate.requiredEvidence) list.append(el('li', undefined, item))
    box.append(list)
  }
  return box
}

function downloadCardsJson(cards: DigestCard[]): void {
  const payload = cards.map(card => ({ front: card.front, back: card.back, tags: card.tags }))
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'bilibili-cards.json'
  anchor.click()
  URL.revokeObjectURL(url)
}

function renderDigestResult(item: DigestItem, onImported: () => void): HTMLElement {
  const wrap = el('section', 'digest-result')

  const head = el('div', 'digest-video')
  const info = el('div', 'digest-video-info')
  info.append(el('h3', undefined, item.video.title))
  info.append(el('p', 'digest-video-meta', `${item.video.owner} · ${durationLabel(item.video.duration)} · ${item.video.bvid}`))
  if (item.video.tags.length) info.append(el('p', 'digest-video-tags', item.video.tags.slice(0, 6).join(' / ')))
  if (item.video.cover) {
    const img = el('img', 'digest-cover') as HTMLImageElement
    img.src = item.video.cover.startsWith('//') ? `https:${item.video.cover}` : item.video.cover
    img.alt = item.video.title
    img.loading = 'lazy'
    img.referrerPolicy = 'no-referrer'
    head.append(img)
  }
  head.append(info)
  wrap.append(head)

  const modeNote = el('p', 'digest-mode-note')
  modeNote.textContent = item.digest.mode === 'subtitle'
    ? copy({ zh: `字幕消化（${item.digest.stats.lines ?? 0} 行字幕 → ${item.digest.stats.segments ?? 0} 个重点段）`, en: `Subtitle digest (${item.digest.stats.lines ?? 0} lines → ${item.digest.stats.segments ?? 0} segments)` })
    : copy({ zh: '降级消化：该视频未取得字幕（未配置 SESSDATA 或视频无 CC），基于标题/简介/标签。配置 SESSDATA 后可读取完整字幕。', en: 'Fallback digest: no subtitle track (missing SESSDATA or no CC). Configure SESSDATA for full subtitles.' })
  wrap.append(modeNote)

  if (item.digest.insights.length) {
    wrap.append(el('h4', undefined, copy({ zh: '知识点时间轴', en: 'Knowledge timeline' })))
    const list = el('div', 'digest-insights')
    for (const insight of item.digest.insights) list.append(renderInsightRow(insight))
    wrap.append(list)
  }

  if (item.digest.debtCandidates.length) {
    wrap.append(el('h4', undefined, copy({ zh: '认知欠条候选', en: 'Cognitive debt candidates' })))
    const list = el('div', 'digest-debts')
    for (const candidate of item.digest.debtCandidates) list.append(renderDebtCandidate(candidate))
    const importBtn = el('button', 'digest-import-btn', copy({ zh: '导入欠条（进入清偿闭环）', en: 'Import as debts (clearance loop)' }))
    const status = el('span', 'digest-import-status')
    if (item.imported === 'debts') status.textContent = copy({ zh: `已导入 ${item.importedSessionId || ''}`, en: `Imported ${item.importedSessionId || ''}` })
    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true
      status.textContent = copy({ zh: '导入中…', en: 'Importing…' })
      try {
        const result = await apiFetch<{ ok: boolean; sessionId: string; candidates: number }>(`/api/bilibili/digests/${encodeURIComponent(item.id)}/import`, {
          method: 'POST',
          body: JSON.stringify({})
        })
        status.textContent = copy({ zh: `已导入 ${result.candidates} 条候选 → 会话 ${result.sessionId.slice(0, 18)}…`, en: `Imported ${result.candidates} candidates → session ${result.sessionId.slice(0, 18)}…` })
        onImported()
      } catch (error) {
        importBtn.disabled = false
        status.textContent = error instanceof Error ? error.message : String(error)
      }
    })
    const actions = el('div', 'digest-actions')
    actions.append(importBtn, status)
    wrap.append(list, actions)
  }

  if (item.digest.cards.length) {
    wrap.append(el('h4', undefined, copy({ zh: '学习卡片（可在插件导入）', en: 'Learning cards (plugin-importable)' })))
    const list = el('div', 'digest-cards')
    for (const card of item.digest.cards) list.append(renderCard(card))
    const exportBtn = el('button', 'digest-export-btn', copy({ zh: '下载卡片 JSON', en: 'Download cards JSON' }))
    exportBtn.addEventListener('click', () => downloadCardsJson(item.digest.cards))
    const actions = el('div', 'digest-actions')
    actions.append(exportBtn)
    wrap.append(list, actions)
  }

  return wrap
}

export async function renderDigestPage(root: HTMLElement): Promise<void> {
  root.replaceChildren()
  const page = el('div', 'page digest-page')
  page.append(el('h1', undefined, copy({ zh: 'B 站视频消化', en: 'Bilibili Digest' })))
  page.append(el('p', 'page-lede', copy({
    zh: '粘贴 B 站视频链接，MindIOU 读取真实字幕（无字幕时降级用简介），提炼知识点时间轴，生成认知欠条候选与学习卡片。',
    en: 'Paste a Bilibili link. MindIOU reads the real subtitles (or falls back to the description), distills a knowledge timeline, and generates debt candidates plus cards.'
  })))

  // SESSDATA settings row
  const settings = await apiFetch<{ ok: boolean; sessdataConfigured: boolean }>('/api/bilibili/settings')
  const sessRow = el('div', 'digest-sessdata')
  const sessInput = el('input', 'digest-sessdata-input') as HTMLInputElement
  sessInput.type = 'password'
  sessInput.placeholder = copy({ zh: 'SESSDATA（读取字幕必需，浏览器 Cookie 里复制）', en: 'SESSDATA (required for subtitles; copy from browser cookies)' })
  const sessBtn = el('button', 'digest-sessdata-btn', settings.sessdataConfigured ? copy({ zh: '已配置，更新', en: 'Configured, update' }) : copy({ zh: '保存', en: 'Save' }))
  const sessStatus = el('span', 'digest-sessdata-status', settings.sessdataConfigured ? copy({ zh: '字幕抓取已就绪', en: 'Subtitle fetching ready' }) : copy({ zh: '未配置：只能降级消化', en: 'Not configured: fallback digest only' }))
  sessBtn.addEventListener('click', async () => {
    const value = sessInput.value.trim()
    if (!value) { sessStatus.textContent = copy({ zh: '请先粘贴 SESSDATA', en: 'Paste SESSDATA first' }); return }
    sessBtn.disabled = true
    try {
      await apiFetch('/api/bilibili/settings', { method: 'PUT', body: JSON.stringify({ sessdata: value }) })
      sessStatus.textContent = copy({ zh: '字幕抓取已就绪', en: 'Subtitle fetching ready' })
      sessInput.value = ''
      sessBtn.textContent = copy({ zh: '已配置，更新', en: 'Configured, update' })
    } catch (error) {
      sessStatus.textContent = error instanceof Error ? error.message : String(error)
    } finally { sessBtn.disabled = false }
  })
  sessRow.append(sessInput, sessBtn, sessStatus)
  page.append(sessRow)

  // Digest input
  const form = el('div', 'digest-form')
  const input = el('input', 'digest-input') as HTMLInputElement
  input.placeholder = copy({ zh: 'https://www.bilibili.com/video/BV… 或直接粘贴 BV 号', en: 'https://www.bilibili.com/video/BV… or a raw BV id' })
  const button = el('button', 'digest-btn primary', copy({ zh: '消化', en: 'Digest' }))
  const error = el('p', 'digest-error')
  const resultHost = el('div')
  form.append(input, button)
  page.append(form, error, resultHost)

  button.addEventListener('click', async () => {
    const url = input.value.trim()
    if (!url) { error.textContent = copy({ zh: '请输入视频链接', en: 'Paste a video link first' }); return }
    button.disabled = true
    error.textContent = ''
    resultHost.replaceChildren(el('p', 'digest-loading', copy({ zh: '正在抓取视频与字幕并消化…', en: 'Fetching video + subtitles and digesting…' })))
    try {
      const item = await apiFetch<DigestItem>('/api/bilibili/digest', { method: 'POST', body: JSON.stringify({ url }) })
      resultHost.replaceChildren(renderDigestResult(item, () => { void 0 }))
      loadHistory()
    } catch (e) {
      resultHost.replaceChildren()
      error.textContent = e instanceof Error ? e.message : String(e)
    } finally { button.disabled = false }
  })

  // History
  const historyHost = el('div')
  page.append(el('h4', undefined, copy({ zh: '最近消化', en: 'Recent digests' })), historyHost)
  async function loadHistory(): Promise<void> {
    try {
      const data = await apiFetch<{ ok: boolean; items: DigestItem[] }>('/api/bilibili/digests')
      historyHost.replaceChildren()
      if (!data.items.length) {
        historyHost.append(el('p', 'digest-empty', copy({ zh: '还没有消化记录。', en: 'No digests yet.' })))
        return
      }
      for (const item of data.items.slice(0, 8)) {
        const row = el('button', 'digest-history-row')
        row.append(el('strong', undefined, item.video.title.slice(0, 44)))
        row.append(el('small', undefined, `${item.digest.mode === 'subtitle' ? '字幕' : '降级'} · ${item.digest.cards.length} 卡片 · ${item.digest.debtCandidates.length} 欠条${item.imported ? ' · 已导入' : ''}`))
        row.addEventListener('click', () => {
          resultHost.replaceChildren(renderDigestResult(item, () => { void 0 }))
          window.scrollTo({ top: 0, behavior: 'smooth' })
        })
        historyHost.append(row)
      }
    } catch { historyHost.replaceChildren() }
  }
  await loadHistory()

  root.append(page)
}
