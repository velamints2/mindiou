import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderLandingPage } from './marketing'
import { setLocale } from './i18n'

vi.mock('./api', () => ({ getAccessToken: vi.fn(() => null) }))

describe('landing challenge promotion localization', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setLocale('zh-CN')
  })

  it('renders the floating challenge banner in English', () => {
    setLocale('en')
    const root = document.createElement('div')
    renderLandingPage(root)

    const banner = root.querySelector('.challenge-floating-banner') as HTMLElement
    expect(banner?.querySelector('.challenge-floating-kicker')?.textContent).toBe('Cohort 001 · First program')
    expect(banner?.querySelector('.challenge-floating-title')?.textContent).toBe('7-day cognitive-debt challenge')
    expect(banner?.querySelector('.challenge-floating-price')?.textContent).toBe('¥29.9')
    expect(banner?.querySelector('.challenge-floating-btn')?.textContent).toBe('Learn more')
    expect(banner?.textContent).not.toContain('首期计划')
    expect(banner?.textContent).not.toContain('认知清债挑战')
  })

  it('shows the Fluency Loop preview entry on the landing header', () => {
    const root = document.createElement('div')
    renderLandingPage(root)

    const entry = root.querySelector('.site-fluency-entry') as HTMLAnchorElement
    expect(entry?.getAttribute('href')).toBe('#/fluency-loop-preview')
    expect(entry?.textContent).toBe('AI 协作循环预告')
    expect(entry?.getAttribute('aria-label')).toBe('查看 AI 协作循环功能预告')
  })

  it('localizes the Fluency Loop preview entry', () => {
    setLocale('en')
    const root = document.createElement('div')
    renderLandingPage(root)

    const entry = root.querySelector('.site-fluency-entry') as HTMLAnchorElement
    expect(entry?.textContent).toBe('Fluency Loop preview')
    expect(entry?.getAttribute('aria-label')).toBe('View the Fluency Loop feature preview')
  })
})
