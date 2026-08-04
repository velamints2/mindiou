import type { AssessmentQuestion, AssessmentRole } from './assessment-bank'

export type AssessmentAnswers = Record<string, string | string[] | number | Record<string, number | string>>
export type AssessmentResult = {
  typeKey: keyof typeof TYPES
  type: string
  typeEn: string
  tagline: string
  taglineEn: string
  strength: string
  strengthEn: string
  risk: string
  riskEn: string
  evidence: string[]
  evidenceEn: string[]
  dimensions: Record<string, number>
}

const TYPES = {
  autopilot: ['全自动代驾员','Full-Auto Chauffeur','你不是没有驾驶证，你只是已经很久没碰方向盘了。','You name the destination, and AI quietly takes over the wheel and brakes.'],
  alchemist: ['复制粘贴炼金术士','Copy-Paste AI Alchemist','你能把 AI 输出炼成金子，但暂时解释不了炉子为什么会热。','You can turn AI raw material into deliverables, but the method has not fully become yours yet.'],
  blind: ['高自信盲飞员','Overconfident Blind Pilot','仪表盘已经亮红灯了，你以为那是氛围灯。','Your confidence has taken off, but the evidence still has not boarded.'],
  loop: ['无限追问永动机','Infinite Follow-up Machine','你没有停止思考，只是把思考变成了无限续杯的对话框。','You do not fully trust AI, so you ask AI to check AI one more time.'],
  auditor: ['AI 人肉审核器','AI Human Auditor','AI 写了五分钟，你审核了两个小时，并开始怀疑键盘也不可信。','You are great at spotting risks, but the cost of verification can spiral out of control.'],
  later: ['先干再懂型','Act First, Understand Later','你每次都说项目结束以后再补课，项目们已经排到了明年。','You can push tasks forward and finish the delivery, but the learning always disappears at the end.'],
  supervisor: ['AI 项目监工','AI Project Supervisor','你很清楚 AI 今天该干什么，但不一定知道它昨晚到底干了什么。','Good at assigning work and pushing progress, but the core judgment is not always on duty.'],
  codriver: ['人机双驾驶','Human-AI Co-Driver','方向盘在你手里，AI 负责看地图。','You hold the wheel, AI hits the gas, and both of you judge the key turns together.'],
  quantum: ['量子态协作者','Quantum State Collaborator','打开聊天记录之前，你既理解 AI，也完全不理解 AI。','Your performance swings wildly, like several collaboration personas stacked together.']
} as const

const clamp = (n:number) => Math.max(0, Math.min(100, Math.round(n)))
const txt = (value:unknown) => String(value || '').toLowerCase()
const hits = (value:unknown, patterns:RegExp[]) => patterns.filter(pattern => pattern.test(txt(value))).length

export function scoreAssessment(role: AssessmentRole, questions: AssessmentQuestion[], answers: AssessmentAnswers, reviews: Array<Record<string,number|string>> = []): AssessmentResult {
  const d = { independent: 50, ownership: 40, alertness: 40, calibration: 50, transfer: 40, learning: 35 }
  const evidence:string[] = []
  const evidenceEn:string[] = []

  const order = answers['core-2'] as string[] || []
  const pos = (id:string) => Math.max(0, order.indexOf(id))
  if (pos('define') < pos('ai')) d.independent += 22; else d.independent -= 22
  if (pos('criteria') < pos('ai')) d.independent += 14
  if (pos('verify') > pos('ai') && pos('verify') < pos('own')) d.alertness += 18
  if (pos('record') >= order.length - 2) d.learning += 12

  const allocation = answers['core-3'] as Record<string,number> || {}
  const ask = Number(allocation.ask)||0, verify = Number(allocation.verify)||0, understand = Number(allocation.understand)||0, modify = Number(allocation.modify)||0, record = Number(allocation.record)||0
  if (ask > 60) { d.independent -= 25; evidence.push(`你把 ${ask}% 的时间分配给 AI 提问。`); evidenceEn.push(`You allocated ${ask}% of your time to prompting AI.`) }
  if (verify < 5) { d.alertness -= 25; evidence.push(`你只给验证分配了 ${verify}% 的时间。`); evidenceEn.push(`You allocated only ${verify}% of your time to verification.`) }
  if (understand < 5) d.independent -= 20
  if (modify < 5) d.ownership -= 20
  if (record === 0) { d.learning -= 28; evidence.push('你没有为任务后的知识沉淀预留时间。'); evidenceEn.push('You reserved no time to retain reusable learning.') }

  const q4 = answers['core-4']
  const q4Independent = hits(q4,[/依据|evidence|source/,/风险|risk/,/不确定|uncertain/,/验收|criteria/,/独立|independent|其他工具|another tool/,/我.*判断|i would check/])
  d.alertness += q4Independent * 7; d.ownership += q4Independent * 5
  if (/^(好的|继续|发布|ok|proceed|ship)/i.test(txt(q4))) d.ownership -= 25
  if (/你确定|再检查|check again|are you sure/.test(txt(q4)) && q4Independent < 2) d.independent -= 10

  const selected = answers['core-5'] as string[] || []
  const correct = questions.find(q=>q.id==='core-5')?.options?.filter(o=>o.correct).map(o=>o.id) || []
  const found = selected.filter(id=>correct.includes(id)).length
  const falsePositives = selected.filter(id=>!correct.includes(id)).length
  const accuracy = Math.max(0,(found-falsePositives)/correct.length)
  d.alertness += accuracy*50-15
  const confidence = Number(answers['core-6'])||0
  const confidenceGap = confidence - accuracy*100
  d.calibration -= Math.abs(confidenceGap)*0.55
  evidence.push(`你在错误识别题中找出 ${correct.length} 项中的 ${found} 项，并给出 ${confidence} 分信心。`)
  evidenceEn.push(`You found ${found} of ${correct.length} key risks and reported ${confidence}/100 confidence.`)

  const q7 = answers['core-7']
  const wait = hits(q7,[/恢复|recover/,/减少.*请求|fewer requests|降低.*冲击|reduce.*load/,/拥堵|congestion/])
  const jitter = hits(q7,[/同时|同一时刻|same time|synchron/,/随机|random|jitter/])
  d.ownership += Math.min(30,(wait+jitter)*10)
  d.transfer += Math.min(12,jitter*6)

  const q8 = answers['core-8']
  const edit = hits(q8,[/试点|灰度|小范围|pilot|staged|limited rollout/,/观察|指标|monitor|metric/,/尚未|无法保证|cannot guarantee|not yet/,/风险|risk/,/测试范围|tested scope/])
  d.ownership += edit*7; d.alertness += edit*5
  const editConfidence = Number(answers['core-8-confidence']) || 0
  const editPerformance = Math.min(100, edit * 20)
  d.calibration -= Math.abs(editConfidence-editPerformance)*0.18

  const moduleText = questions.slice(8).map(q=>txt(answers[q.id])).join(' ')
  const riskSignals = hits(moduleText,[/样本|sample/,/对照|control/,/权限|authoriz/,/隐私|privacy/,/原始来源|doi|source/,/幂等|idempoten/,/唯一约束|unique/,/人工|human/,/审核|review/,/风险|risk/])
  d.alertness += Math.min(28,riskSignals*4)
  d.transfer += Math.min(35,hits(moduleText,[/幂等|idempoten/,/第三.*因素|third factor/,/试点|pilot/,/原始来源|original source/,/最终决定|final decision/])*7)
  d.ownership += Math.min(25,hits(moduleText,[/我会|必须|责任|i would|must|responsib/,/修改|rewrite|replace/,/验证|verify/])*4)

  if (reviews.length) {
    const average = (key:string) => reviews.reduce((sum,item)=>sum+Number(item[key]||0),0)/reviews.length
    d.ownership += (average('causal_explanation')-1.5)*8
    d.independent += (average('independent_judgment')-1.5)*8
    d.alertness += (average('risk_identification')-1.5)*8
    d.calibration += (average('uncertainty_awareness')-1.5)*6
    d.transfer += (average('transfer')-1.5)*10
    const cited = reviews.find(item=>String(item.evidence||'').trim())
    if (cited) { evidence.push(`开放回答证据：“${String(cited.evidence).slice(0,90)}”`); evidenceEn.push(`Open-response evidence: “${String(cited.evidence).slice(0,90)}”`) }
  }

  Object.keys(d).forEach(key => { d[key as keyof typeof d] = clamp(d[key as keyof typeof d]) })
  const variance = Math.max(...Object.values(d))-Math.min(...Object.values(d))
  let key:keyof typeof TYPES = 'supervisor'
  if (confidenceGap > 35 && accuracy < .55) key='blind'
  else if (variance > 75 && Math.abs(confidenceGap)>45) key='quantum'
  else if (d.independent < 30 && d.alertness < 40) key='autopilot'
  else if (d.ownership > 60 && d.transfer < 42) key='alchemist'
  else if (d.alertness > 82 && modify < 20) key='auditor'
  else if (d.learning < 28 && d.ownership > 55) key='later'
  else if (d.independent < 48 && d.alertness >= 50 && /你确定|再检查|check again|are you sure/.test(txt(q4))) key='loop'
  else if (Object.values(d).filter(v=>v>=60).length>=5) key='codriver'
  const type = TYPES[key]
  if (!evidence.length) { evidence.push('你的排序、解释和修改行为共同形成了当前结果。'); evidenceEn.push('Your ranking, explanation, and editing behavior jointly shaped this result.') }
  const strongAlertness = d.alertness >= d.ownership
  const lowLearning = d.learning < 45
  return {
    typeKey:key,
    type:type[0], typeEn:type[1], tagline:type[2], taglineEn:type[3],
    strength: strongAlertness ? '你会主动寻找风险和证据。' : '你愿意修改并承担最终成果。',
    strengthEn: strongAlertness ? 'You actively look for risk and evidence.' : 'You edit the output and take ownership of the final result.',
    risk: lowLearning ? '任务完成后的复盘与知识沉淀仍然偏少。' : '需要根据任务后果调整验证投入，避免固定使用同一种协作深度。',
    riskEn: lowLearning ? 'You retain too little reusable learning after delivery.' : 'Adjust verification effort to the consequences instead of using one fixed collaboration depth.',
    evidence:evidence.slice(0,3), evidenceEn:evidenceEn.slice(0,3), dimensions:d
  }
}
