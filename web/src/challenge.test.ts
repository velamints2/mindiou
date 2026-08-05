import { beforeEach, describe, expect, it } from 'vitest'
import { renderChallengePage } from './challenge'

describe('001 期挑战活动 Landing 页', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('renders hero, seven-day plan, join section and site footer', () => {
    const root = document.createElement('div')
    renderChallengePage(root)
    expect(root.textContent).toContain('7 天认知清债挑战')
    expect(root.textContent).toContain('Day 1')
    expect(root.textContent).toContain('Day 7')
    expect(root.querySelector('#challenge-join')).not.toBeNull()
    expect(root.querySelector('.site-footer')).not.toBeNull()
  })

  it('exposes the free assessment entry and mascot image', () => {
    const root = document.createElement('div')
    renderChallengePage(root)
    expect(root.querySelector('.challenge-header-link[href="#/assessment"]')).not.toBeNull()
    const mascot = root.querySelector('img.challenge-mascot') as HTMLImageElement
    expect(mascot).not.toBeNull()
    expect(mascot.getAttribute('src')).toBe('assets/challenge/cloud-mascot-hero.jpg')
  })

  it('renders purchase link with configured Afdian URL', () => {
    const root = document.createElement('div')
    renderChallengePage(root)
    const join = root.querySelector('#challenge-join') as HTMLElement
    const link = join.querySelector('a[href*="ifdian.net"]') as HTMLAnchorElement
    expect(link).not.toBeNull()
    expect(link.href).toContain('ifdian.net/item/2a561d748fe811f1a3b552540025c377')
    expect(link.target).toBe('_blank')
  })
})