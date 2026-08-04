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

  it('exposes the free assessment entry and the mascot asset', () => {
    const root = document.createElement('div')
    renderChallengePage(root)
    expect(root.querySelector('.challenge-header-link[href="#/assessment"]')).not.toBeNull()
    const mascot = root.querySelector('img.challenge-mascot') as HTMLImageElement
    expect(mascot).not.toBeNull()
    expect(mascot.getAttribute('src')).toBe('assets/challenge/cloud-mascot-hero.jpg')
  })

  it('keeps purchase and redemption disabled while Afdian is unconfigured, without fake functionality', () => {
    const root = document.createElement('div')
    renderChallengePage(root)
    const join = root.querySelector('#challenge-join') as HTMLElement
    const buttons = Array.from(join.querySelectorAll('button')) as HTMLButtonElement[]
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    buttons.forEach(btn => expect(btn.disabled).toBe(true))
    expect(join.textContent).toContain('即将开放')
  })
})
