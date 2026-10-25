import { beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from './i18n'
import { renderFluencyLoopPreviewPage } from './cognitiveLoop'

describe('Fluency Loop preview localization', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setLocale('zh-CN')
  })

  it('uses Chinese copy without English-only labels in the Chinese preview', () => {
    const root = document.createElement('div')
    renderFluencyLoopPreviewPage(root)
    const text = root.textContent || ''

    expect(text).toContain('一个一直在后台工作的认知助理')
    expect(text).toContain('我现在会什么')
    expect(text).toContain('我还有哪些认知欠条')
    expect(text).toContain('最近有什么真正值得我看')
    expect(text).toContain('MindIOU 在后台一直做这件事')
    expect(text).toContain('Loop 也在替你照看还没补完的东西')
    expect(text).toContain('你不用自己刷完这些东西')
    expect(text).toContain('为什么推荐给你')
    expect(text).toContain('预计 8 月下旬上线第一版')
    expect(root.querySelectorAll('.fluency-preview > .fluency-section')).toHaveLength(6)
    expect(root.querySelectorAll('.fluency-dimension-card')).toHaveLength(0)
    expect(text).not.toContain('Feature Preview')
    expect(text).not.toContain('Delegation')
    expect(text).not.toContain('EVALUATION EVIDENCE')
  })

  it('switches the same preview to English', () => {
    setLocale('en')
    const root = document.createElement('div')
    renderFluencyLoopPreviewPage(root)
    const text = root.textContent || ''

    expect(text).toContain('MindIOU Loop')
    expect(text).toContain('A cognitive assistant that always works in the background.')
    expect(text).toContain('What I know now')
    expect(text).toContain('What I still owe')
    expect(text).toContain('What is worth my attention')
    expect(text).toContain('This is what MindIOU keeps doing in the background')
    expect(text).toContain('You do not have to read through all of this yourself.')
    expect(text).toContain('Why are we showing this to you?')
    expect(text).toContain('Always learning with you.')
    expect(root.querySelectorAll('.fluency-preview > .fluency-section')).toHaveLength(6)
    expect(text).not.toContain('一个一直在后台工作的认知助理')
    expect(text).not.toContain('你的 AI 一直在进化')
  })
})
