// @ts-nocheck
import { describe, expect, it } from 'vitest'
import {
  analyzeNormalizedSession,
  normalizeSessionImport,
  sanitizeRepositoryPath
} from '../project-memory-analysis.js'

describe('Project Memory session analysis', () => {
  it('normalizes a manual conversation and extracts structured project links', () => {
    const session = normalizeSessionImport({
      platform: 'codex',
      externalSessionId: 'codex-1',
      text: '用户：实现激活码兑换接口，确保一张激活码只能使用一次。\nAgent：随后修复并发条件，改为数据库条件更新和唯一约束。\n修改 src/services/activationCode.ts 和 src/api/redeem.ts，函数 redeemActivationCode，commit 8f3a2d1。'
    })
    const result = analyzeNormalizedSession(session)
    expect(result.workItemCandidates[0]).toMatchObject({
      title: '激活码兑换与防重复使用',
      type: 'feature'
    })
    expect(result.artifactCandidates.filter(item => item.type === 'file').map(item => item.path)).toEqual([
      'src/services/activationCode.ts',
      'src/api/redeem.ts'
    ])
    expect(result.artifactCandidates.some(item => item.type === 'commit' && item.gitCommitHash === '8f3a2d1')).toBe(true)
    expect(result.decisionCandidates[0]).toMatchObject({
      title: '使用条件更新和唯一约束控制重复写入',
      userParticipation: 'accepted'
    })
    expect(result.cognitiveDebtCandidates[0]).toMatchObject({
      title: '尚未掌握并发控制中的竞态条件',
      priority: 'high'
    })
  })

  it('supports JSONL messages without retaining absolute paths', () => {
    const session = normalizeSessionImport({
      platform: 'manual',
      fileContent: '{"role":"user","content":"请查看 /Users/alice/private/src/app.ts"}\n{"role":"assistant","content":"已完成"}'
    })
    const result = analyzeNormalizedSession(session)
    expect(result.messages).toHaveLength(2)
    expect(sanitizeRepositoryPath('/Users/alice/private/src/app.ts')).toBe('src/app.ts')
    expect(sanitizeRepositoryPath('/Users/alice/private/secret.txt')).not.toContain('/Users/')
  })

  it('turns an explicit hook debt candidate into a structured candidate even without chat text', () => {
    const session = normalizeSessionImport({
      platform: 'trae',
      events: [
        { type: 'file_changed', payload: { path: 'src/redeem.ts' } },
        { type: 'debt_candidate', payload: { gapText: '尚未掌握并发窗口', reason: '关键方案由 Agent 完成', risk: '可能重复发放权益' } }
      ]
    })
    const result = analyzeNormalizedSession(session)
    expect(result.cognitiveDebtCandidates).toContainEqual(expect.objectContaining({
      description: '尚未掌握并发窗口',
      reason: '关键方案由 Agent 完成',
      priority: 'high'
    }))
  })
})
