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

    expect(text).toContain('AI 协作循环')
    expect(text).toContain('委派')
    expect(text).toContain('评估依据')
    expect(text).not.toContain('Feature Preview')
    expect(text).not.toContain('Delegation')
    expect(text).not.toContain('Acceptance criteria')
  })

  it('switches the same preview to English', () => {
    setLocale('en')
    const root = document.createElement('div')
    renderFluencyLoopPreviewPage(root)
    const text = root.textContent || ''

    expect(text).toContain('Fluency Loop')
    expect(text).toContain('Delegation')
    expect(text).toContain('EVALUATION EVIDENCE')
    expect(text).not.toContain('AI 协作循环')
    expect(text).not.toContain('你的 AI 一直在进化')
  })
})
