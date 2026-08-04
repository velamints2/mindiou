import { beforeEach, describe, expect, it } from 'vitest'
import { questionsFor, roles } from './assessment-bank'
import { scoreAssessment } from './assessment-score'
import { renderAssessmentPage } from './assessment'

describe('AI collaboration assessment V1', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = '' })

  it('has eight core questions plus four questions for every role', () => {
    expect(roles).toHaveLength(4)
    roles.forEach(role => {
      const questions = questionsFor(role.id)
      expect(questions).toHaveLength(12)
      expect(new Set(questions.map(question => question.id)).size).toBe(12)
    })
  })

  it('renders role selection as the public starting point', () => {
    const root = document.createElement('div')
    renderAssessmentPage(root)
    expect(root.textContent).toContain('AI 到底是你的副驾驶，还是代驾')
    expect(root.querySelectorAll('.assessment-role-card')).toHaveLength(4)
  })

  it('produces behavioral evidence and six bounded dimensions', () => {
    const questions = questionsFor('developer')
    const result = scoreAssessment('developer', questions, {
      'core-2': ['define','criteria','ai','direction','verify','own','record'],
      'core-3': { understand:20,ask:25,verify:20,modify:25,record:10 },
      'core-4': '先按验收标准检查，并给出独立证据和失败风险。',
      'core-5': ['causal','percent','source','sample','confound','rollout'],
      'core-6': 85,
      'core-7': '等待给系统恢复时间，随机变化避免所有请求同时再次冲击。',
      'core-8': '当前只验证了有限范围，建议灰度上线并观察数据丢失指标后再扩大。',
      'core-8-confidence': 80,
      'dev-1': ['input','auth','fields','errors'],
      'dev-2': ['logs','locate','concurrency','test','fix','rewrite'],
      'dev-3': '先确认根因、幂等键或唯一约束是否足够，以及锁失败和过期如何处理。',
      'dev-4': '使用后端幂等键和唯一约束，重复请求返回已有任务。'
    })
    expect(result.evidence.length).toBeGreaterThan(0)
    expect(Object.keys(result.dimensions)).toHaveLength(6)
    Object.values(result.dimensions).forEach(value => expect(value).toBeGreaterThanOrEqual(0))
  })
})
