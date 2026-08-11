import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRepaymentProfile } from './api'
import { setLocale } from './i18n'
import { renderProfilePage } from './profile'

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  getRepaymentProfile: vi.fn()
}))

describe('profile localization', () => {
  beforeEach(() => {
    setLocale('zh-CN')
    vi.clearAllMocks()
  })

  it('renders score units in English', async () => {
    setLocale('en')
    vi.mocked(getRepaymentProfile).mockResolvedValue({
      ok: true,
      profiles: [{
        userId: 'user-1',
        domain: 'Concurrency',
        dimensions: {
          causalExplanation: {
            score: 58,
            level: 'E2',
            stability: 'stable',
            evidence: [],
            updatedAt: '2026-08-11T00:00:00.000Z'
          }
        },
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
        dataSchemaVersion: '1'
      }]
    })

    const root = document.createElement('div')
    await renderProfilePage(root)

    expect(root.querySelector('.profile-dimension-score')?.textContent).toBe('58 points')
    expect(root.textContent).not.toContain('58 分')
  })
})
