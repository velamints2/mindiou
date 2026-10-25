// EXP-2 experiment workbench (web channel): read assigned debts with a
// minimum exposure time, then take blind E2 tests. Channel is never shown.
import { apiFetch } from './api'
import { t } from './i18n'
import { el } from './router'

type LocalizedText = { zh: string; en: string }
const copy = (text: LocalizedText): string => t(text.zh, text.en)

interface Exp2Debt {
  debtId: string
  channel: string
  gapText: string
  readSeconds: number
  exposed: boolean
  completed: boolean
}

interface BlindTest {
  debtId: string
  gapText: string
  prompt: { q1: string; q2: string }
}

// Median quiz seconds from the preregistration's fairness rule; the web
// channel must read at least this long before the item counts as exposed.
const MIN_READ_SECONDS = 45

export async function renderExp2Page(root: HTMLElement): Promise<void> {
  root.replaceChildren()
  const page = el('div', 'page exp2-page')
  page.append(el('h1', undefined, copy({ zh: 'EXP-2 实验台', en: 'EXP-2 Workbench' })))
  page.append(el('p', 'page-lede', copy({
    zh: '眼镜清偿 vs 网页阅读的预注册对照实验。本页承担网页通道：阅读分配的欠条（计满最短时长），以及 14 天后的盲测。',
    en: 'Preregistered glasses-vs-web clearance experiment. This page is the web channel: read assigned debts (minimum exposure) and take the blind test.'
  })))

  const status = await apiFetch<{ ok: boolean; sealed: boolean; assigned: number; distribution: { glasses: number; web: number }; blindTests: number } & Record<string, unknown>>('/api/experiments/exp2/status')
  const statusLine = el('p', 'exp2-status')
  statusLine.textContent = status.sealed
    ? copy({ zh: `已封存启动 · 分配 ${status.assigned} 条（眼镜 ${status.distribution.glasses} / 网页 ${status.distribution.web}）`, en: `Sealed · ${status.assigned} assigned (glasses ${status.distribution.glasses} / web ${status.distribution.web})` })
    : copy({ zh: '实验未启动：欠条池就绪后在服务端调用 assign 封存分组。', en: 'Not started: call assign server-side once the debt pool is ready.' })
  page.append(statusLine)

  // ── Web-channel reading list with exposure timer ──
  page.append(el('h4', undefined, copy({ zh: '网页通道阅读（B 组）', en: 'Web channel reading (B)' })))
  const listHost = el('div', 'exp2-list')
  page.append(listHost)
  let activeTimer: { debtId: string; startedAt: number } | null = null

  const debts = await apiFetch<{ ok: boolean; debts: Exp2Debt[] }>('/api/experiments/exp2/debts?channel=web')
  listHost.replaceChildren()
  if (!debts.debts.length) {
    listHost.append(el('p', 'exp2-empty', copy({ zh: '网页通道暂无分配欠条。', en: 'No debts assigned to the web channel.' })))
  }
  for (const debt of debts.debts) {
    const row = el('div', 'exp2-debt')
    const head = el('div', 'exp2-debt-head')
    head.append(el('span', 'exp2-gap', debt.gapText))
    const meta = el('span', 'exp2-meta', copy({ zh: `已读 ${debt.readSeconds}s`, en: `${debt.readSeconds}s read` }))
    head.append(meta)
    const body = el('div', 'exp2-debt-body')
    const openBtn = el('button', 'exp2-open', copy({ zh: '展开阅读', en: 'Read' }))
    const doneNote = el('span', 'exp2-done', debt.readSeconds >= MIN_READ_SECONDS ? copy({ zh: '已计满', en: 'Exposure met' }) : '')
    body.append(openBtn, doneNote)
    row.append(head, body)
    listHost.append(row)

    openBtn.addEventListener('click', async () => {
      activeTimer = { debtId: debt.debtId, startedAt: Date.now() }
      openBtn.disabled = true
      body.replaceChildren(el('p', undefined, copy({ zh: '阅读中……关闭前请保持页面打开。', en: 'Reading… keep this open.' })))
      const closeBtn = el('button', 'exp2-close', copy({ zh: '读完关闭（计时结束）', en: 'Done reading (stop timer)' }))
      body.append(closeBtn)
      closeBtn.addEventListener('click', async () => {
        const seconds = activeTimer ? Math.round((Date.now() - activeTimer.startedAt) / 1000) : 0
        activeTimer = null
        try {
          const result = await apiFetch<{ ok: boolean; totalReadSeconds: number }>(`/api/experiments/exp2/read-log`, {
            method: 'POST',
            body: JSON.stringify({ debtId: debt.debtId, seconds })
          })
          debt.readSeconds = result.totalReadSeconds
          meta.textContent = copy({ zh: `已读 ${debt.readSeconds}s`, en: `${debt.readSeconds}s read` })
          doneNote.textContent = debt.readSeconds >= MIN_READ_SECONDS ? copy({ zh: '已计满', en: 'Exposure met' }) : copy({ zh: `还差 ${MIN_READ_SECONDS - debt.readSeconds}s`, en: `${MIN_READ_SECONDS - debt.readSeconds}s to go` })
        } finally {
          body.replaceChildren(openBtn, doneNote)
          openBtn.disabled = false
        }
      })
    })
  }

  // ── Blind test ──
  page.append(el('h4', undefined, copy({ zh: '盲测（E2）', en: 'Blind test (E2)' })))
  const testHost = el('div', 'exp2-test')
  page.append(testHost)
  const loadTest = async (): Promise<void> => {
    const test = await apiFetch<{ ok: boolean; done?: boolean } & Partial<BlindTest>>('/api/experiments/exp2/blind-test')
    testHost.replaceChildren()
    if (test.done || !test.debtId) {
      testHost.append(el('p', 'exp2-empty', copy({ zh: '盲测已完成全部条目。', en: 'All items tested.' })))
      return
    }
    const item = test as BlindTest
    const box = el('div', 'exp2-test-item')
    box.append(el('p', 'exp2-gap', item.gapText))
    box.append(el('p', undefined, item.prompt.q1))
    const a1 = el('textarea', 'exp2-answer') as HTMLTextAreaElement
    box.append(a1)
    box.append(el('p', undefined, item.prompt.q2))
    const a2 = el('textarea', 'exp2-answer') as HTMLTextAreaElement
    box.append(a2)
    const prior = el('label', 'exp2-prior', copy({ zh: '实验前对这条内容的熟悉度（1-5）：', en: 'Prior familiarity before the experiment (1-5): ' })) as HTMLLabelElement
    const priorInput = el('input') as HTMLInputElement
    priorInput.type = 'number'
    priorInput.min = '1'
    priorInput.max = '5'
    prior.append(priorInput)
    box.append(prior)
    const submit = el('button', 'exp2-submit primary', copy({ zh: '提交（不可回改）', en: 'Submit (final)' }))
    const note = el('span', 'exp2-submit-note')
    box.append(submit, note)
    submit.addEventListener('click', async () => {
      if (!a1.value.trim()) { note.textContent = copy({ zh: '第一问需要作答', en: 'Answer question 1 first' }); return }
      submit.disabled = true
      try {
        const result = await apiFetch<{ ok: boolean; remaining: number }>('/api/experiments/exp2/blind-test', {
          method: 'POST',
          body: JSON.stringify({ debtId: item.debtId, answer1: a1.value, answer2: a2.value, priorKnowledge: Number(priorInput.value) || null })
        })
        note.textContent = copy({ zh: `已提交 · 剩 ${result.remaining}`, en: `Submitted · ${result.remaining} left` })
        setTimeout(loadTest, 800)
      } catch (error) {
        submit.disabled = false
        note.textContent = error instanceof Error ? error.message : String(error)
      }
    })
    testHost.append(box)
  }
  await loadTest()

  root.append(page)
}
