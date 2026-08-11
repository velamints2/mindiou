import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectMemoryRequest } from './api'
import { renderProjectPage } from './projectMemory'
import { el } from './router'

vi.mock('./api', () => ({
  projectMemoryRequest: vi.fn()
}))

describe('Project Memory detail page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(projectMemoryRequest).mockImplementation(async (path: string) => {
      if (path.includes('/search?')) return { results: { total: 1, groups: { workItems: [{ title: '激活码兑换' }] } } }
      return {
        memory: {
          project: { id: 'project-1', name: 'MindIOU', description: '' },
          counts: { sessions: 0, workItems: 0, artifacts: 0, decisions: 0, debts: 0, owned: 0 },
          sessions: [],
          workItems: [],
          decisions: [],
          ownership: { artifacts: [] }
        }
      }
    })
  })

  it('shows project-scoped search on the project detail page', async () => {
    const root = el('div')
    await renderProjectPage(root, 'project-1')

    const form = root.querySelector('.project-memory-search-form') as HTMLFormElement
    const input = root.querySelector('.project-memory-search-input') as HTMLInputElement
    expect(form).not.toBeNull()
    expect(input.placeholder).toContain('功能、文件、函数、Commit')

    input.value = '激活码'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(vi.mocked(projectMemoryRequest)).toHaveBeenCalledWith('/api/projects/project-1/search?q=%E6%BF%80%E6%B4%BB%E7%A0%81')
    expect(root.textContent).toContain('找到 1 条关联记录')
  })

  it('fills empty project sections with labeled content instead of raw errors', async () => {
    const root = el('div')
    await renderProjectPage(root, 'project-1')

    expect(root.textContent).toContain('示范内容')
    expect(root.textContent).toContain('示范记录：Agent 将目标拆成实现')
    expect(root.textContent).not.toContain('Project not found')
    expect(root.textContent).not.toContain('加载失败')
  })
})
