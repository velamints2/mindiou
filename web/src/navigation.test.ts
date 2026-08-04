import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderPersistentNavigation } from './navigation'

vi.mock('./api', () => ({ getAccessToken: vi.fn(() => 'active') }))
vi.mock('./router', async () => {
  const actual = await vi.importActual('./router')
  return { ...actual as object, navigate: vi.fn() }
})

describe('persistent site navigation', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('stays available in a clearance session and links back to public pages', () => {
    renderPersistentNavigation({ name: 'session', sessionId: 'session-1' })
    const navigation = document.querySelector('.persistent-site-navigation')
    expect(navigation).not.toBeNull()
    expect(navigation?.querySelector('a[href="#/"]')?.textContent).toContain('首页')
    expect(navigation?.querySelector('a[href="#/how-it-works"]')).not.toBeNull()
    expect(navigation?.querySelector('a[href="#/genesis"]')).not.toBeNull()
    expect(navigation?.textContent).toContain('进入工作区')
  })

  it('does not duplicate the header owned by landing and how-it-works pages', () => {
    renderPersistentNavigation({ name: 'landing' })
    expect(document.querySelector('.persistent-site-navigation')).toBeNull()
    renderPersistentNavigation({ name: 'how-it-works' })
    expect(document.querySelector('.persistent-site-navigation')).toBeNull()
  })

  it('keeps the operational admin surface free of public navigation', () => {
    renderPersistentNavigation({ name: 'admin' })
    expect(document.querySelector('.persistent-site-navigation')).toBeNull()
  })
})
