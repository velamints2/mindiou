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
    expect(result.typeKey).toMatch(/^(autopilot|alchemist|blind|loop|auditor|later|supervisor|codriver|quantum)$/)
    expect(Object.keys(result.dimensions)).toHaveLength(6)
    Object.values(result.dimensions).forEach(value => expect(value).toBeGreaterThanOrEqual(0))
    expect(Object.keys(result.matchScores)).toHaveLength(9)
    expect(result.stability).toBeGreaterThanOrEqual(0)
  })

  it('does not use AI Project Supervisor as a catch-all result', () => {
    const questions=questionsFor('developer')
    const common={
      'core-7':'用独立来源核对；如果出现反例就改变判断。','core-8':'不能保证，先小范围试点并观察指标。',
      'dev-1':['input','auth','fields','errors'],'dev-2':['logs','locate','concurrency','test','fix','rewrite'],
      'dev-3':'确认根因、边界、失败后果和替代方案。','dev-4':'使用幂等键和唯一约束。'
    }
    const autopilot=scoreAssessment('developer',questions,{...common,
      'core-2':['ai','direction','own','define','criteria','verify','record'],
      'core-3':{understand:0,ask:85,verify:0,modify:15,record:0},'core-4':'好的，直接提交。',
      'core-5':['grammar'],'core-6':20,'core-7':'因为这样更安全。','core-8':'直接使用。',
      'dev-1':['async'],'dev-2':['rewrite','fix','test','concurrency','locate','logs'],'dev-3':'听 AI 的。','dev-4':'让 AI 重写。'
    })
    const loop=scoreAssessment('developer',questions,{...common,
      'core-2':['define','criteria','ai','direction','verify','own','record'],
      'core-3':{understand:10,ask:60,verify:25,modify:5,record:0},'core-4':'你确定吗？再检查一遍。',
      'core-5':['causal','percent','source','sample','confound','rollout'],'core-6':90
    })
    const balanced=scoreAssessment('developer',questions,{...common,
      'core-2':['define','criteria','ai','direction','verify','own','record'],
      'core-3':{understand:20,ask:25,verify:20,modify:25,record:10},'core-4':'给出证据、风险和验收标准，我会用独立来源核对。',
      'core-5':['causal','percent','source','sample','confound','rollout'],'core-6':90
    })
    expect(autopilot.typeKey).toBe('autopilot')
    expect(loop.typeKey).toBe('loop')
    expect(balanced.typeKey).toBe('codriver')
  })

  it('keeps the shared questions role-neutral and role modules isolated',()=>{
    const shared=questionsFor('developer').slice(0,8)
    expect(shared.map(q=>`${q.title}${q.context||''}`).join(' ')).not.toMatch(/SaaS|Redis|代码|注册转化/)
    expect(questionsFor('product').some(q=>q.id.startsWith('dev-'))).toBe(false)
    expect(questionsFor('research').some(q=>q.id.startsWith('pm-'))).toBe(false)
  })

  it('loads result illustrations eagerly from a versioned asset URL',async()=>{
    localStorage.setItem('mindiou_ai_collaboration_test_v1_1',JSON.stringify({role:'developer',index:12,startedAt:new Date().toISOString(),reviewPending:false,reviews:[],reviewMode:'rule_fallback',answers:{
      'core-2':['define','criteria','ai','direction','verify','own','record'],'core-3':{understand:20,ask:25,verify:20,modify:25,record:10},'core-4':'核对证据和风险','core-5':['causal','percent','source','sample','confound','rollout'],'core-6':90,'core-7':'独立核对，反例会改变判断','core-8':'先试点并观察指标','core-8-confidence':80,'dev-1':['input','auth','fields','errors'],'dev-2':['logs','locate','concurrency','test','fix','rewrite'],'dev-3':'确认边界和失败后果','dev-4':'幂等键和唯一约束'
    }}))
    const root=document.createElement('div');renderAssessmentPage(root)
    const image=root.querySelector('.assessment-result-visual img') as HTMLImageElement
    expect(image).toBeTruthy();expect(image.loading).toBe('eager');expect(image.fetchPriority).toBe('high')
    expect(image.src).toContain('/assets/assessment-results/');expect(image.src).toContain('v=MIOU-ACT-V1.1')
  })
})
