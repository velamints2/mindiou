import type { AssessmentQuestion, AssessmentRole } from './assessment-bank'

export type AssessmentAnswers = Record<string, string | string[] | number | Record<string, number | string>>
export type ResultKey = keyof typeof TYPES
export type AssessmentResult = {
  typeKey: ResultKey; type: string; typeEn: string; tagline: string; taglineEn: string
  strength: string; strengthEn: string; risk: string; riskEn: string
  evidence: string[]; evidenceEn: string[]; dimensions: Record<string, number>
  matchScores: Record<ResultKey, number>; stability: number; secondaryType: string; secondaryTypeEn: string
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
const txt = (v:unknown) => String(v || '').toLowerCase()
const hits = (v:unknown, ps:RegExp[]) => ps.filter(p=>p.test(txt(v))).length
const avg = (...v:number[]) => v.reduce((s,n)=>s+n,0)/v.length
const low = (v:number) => 100-v
const middle = (v:number, target=55) => clamp(100-Math.abs(v-target)*1.8)
const position = (order:string[], id:string) => { const p=order.indexOf(id); return p<0?order.length:p }
const rankScore = (actual:string[], ideal:string[]) => {
  let good=0,total=0
  for(let a=0;a<ideal.length;a++) for(let b=a+1;b<ideal.length;b++){total++;if(position(actual,ideal[a])<position(actual,ideal[b]))good++}
  return total?good/total:0
}
const multiScore = (q:AssessmentQuestion|undefined, answer:unknown) => {
  const chosen=Array.isArray(answer)?answer:[];const correct=q?.options?.filter(o=>o.correct).map(o=>o.id)||[]
  const found=chosen.filter(id=>correct.includes(id)).length;const wrong=chosen.filter(id=>!correct.includes(id)).length
  return {found,total:correct.length,score:correct.length?Math.max(0,(found-wrong)/correct.length):0}
}
const classScore = (answer:unknown, expected:Record<string,string[]>) => {
  const values=(answer||{}) as Record<string,string>;const rows=Object.entries(expected)
  return rows.length?rows.filter(([id,allowed])=>allowed.includes(values[id])).length/rows.length:0
}

export function scoreAssessment(_role: AssessmentRole, questions: AssessmentQuestion[], answers: AssessmentAnswers, reviews: Array<Record<string,number|string>> = []): AssessmentResult {
  const d={independent:45,ownership:45,alertness:40,calibration:55,transfer:40,learning:35}
  const evidence:string[]=[], evidenceEn:string[]=[]
  const order=(answers['core-2'] as string[])||[]
  const defineBeforeAi=position(order,'define')<position(order,'ai'), criteriaBeforeAi=position(order,'criteria')<position(order,'ai')
  const verifyBeforeOwn=position(order,'verify')<position(order,'own'), aiFirst=position(order,'ai')<=1
  d.independent+=defineBeforeAi?16:-18;d.independent+=criteriaBeforeAi?12:-12;d.alertness+=verifyBeforeOwn?12:-10
  d.learning+=position(order,'record')<order.length?8:-12

  const allocation=(answers['core-3']||{}) as Record<string,number>
  const ask=Number(allocation.ask)||0,verify=Number(allocation.verify)||0,understand=Number(allocation.understand)||0,modify=Number(allocation.modify)||0,record=Number(allocation.record)||0
  d.independent+=(understand-20)*.65-(Math.max(0,ask-35)*.8);d.alertness+=(verify-15)*.8;d.ownership+=(modify-20)*.65;d.learning+=(record-10)*1.4
  if(ask>55){evidence.push(`你把 ${ask}% 的时间用于向 AI 提问。`);evidenceEn.push(`You allocated ${ask}% of your time to prompting AI.`)}
  if(record===0){evidence.push('你没有为任务后的知识沉淀预留时间。');evidenceEn.push('You reserved no time to retain reusable learning.')}

  const q4=answers['core-4'];const q4Evidence=hits(q4,[/依据|证据|来源|evidence|source/,/风险|risk/,/不确定|uncertain/,/验收|criteria/,/独立|另一个来源|independent|another source/])
  const repeatOnly=/你确定|再检查|重新检查|check again|are you sure/.test(txt(q4))&&q4Evidence<2
  d.alertness+=q4Evidence*6;d.ownership+=q4Evidence*4;d.independent+=repeatOnly?-15:q4Evidence*2

  const core5=multiScore(questions.find(q=>q.id==='core-5'),answers['core-5']);d.alertness+=core5.score*45-18
  const confidence=Number(answers['core-6'])||0, confidenceGap=confidence-core5.score*100
  d.calibration-=Math.abs(confidenceGap)*.58
  evidence.push(`你识别出 ${core5.total} 个关键问题中的 ${core5.found} 个，信心为 ${confidence}/100。`);evidenceEn.push(`You found ${core5.found} of ${core5.total} key issues with ${confidence}/100 confidence.`)

  const q7=answers['core-7'];const independentCheck=hits(q7,[/独立|另一个|交叉|原始|independent|another|cross-check|original/,/改变.*判断|推翻|反例|change.*mind|falsif/])
  d.independent+=independentCheck*9;d.transfer+=independentCheck*7
  const q8=answers['core-8'];const rewrite=hits(q8,[/试点|小范围|pilot|limited/,/指标|观察|monitor|metric/,/不能保证|尚未|无法确认|cannot guarantee|not proven/,/来源|证据|source|evidence/,/扩大条件|再决定|expand|then decide/])
  d.ownership+=rewrite*6;d.alertness+=rewrite*4;d.transfer+=rewrite*3


  const structured:number[]=[]
  for(const id of ['dev-1','work-1']) if(questions.some(q=>q.id===id)){const s=multiScore(questions.find(q=>q.id===id),answers[id]).score;structured.push(s)}
  if(questions.some(q=>q.id==='dev-2')) structured.push(rankScore((answers['dev-2'] as string[])||[],['logs','locate','concurrency','test','fix','rewrite']))
  if(questions.some(q=>q.id==='pm-2')) structured.push(rankScore((answers['pm-2'] as string[])||[],['task','flow','risk','approval','mvp','data','prd']))
  if(questions.some(q=>q.id==='pm-4')) structured.push(classScore(answers['pm-4'],{titles:['ai','shared'],permission:['human'],interviews:['shared','human'],reward:['human'],tests:['shared','ai'],value:['human','shared']}))
  if(questions.some(q=>q.id==='work-2')) structured.push(classScore(answers['work-2'],{fact:['use'],subjective:['opinion'],number:['verify'],promise:['delete']}))
  if(questions.some(q=>q.id==='work-4')) structured.push(classScore(answers['work-4'],{notes:['review','direct'],headlines:['review'],fire:['human'],research:['review'],quote:['human'],brainstorm:['direct','review']}))
  const structuredScore=structured.length?structured.reduce((s,n)=>s+n,0)/structured.length:.5
  d.alertness+=(structuredScore-.5)*28;d.ownership+=(structuredScore-.5)*20;d.transfer+=(structuredScore-.5)*18
  if(structured.length){evidence.push(`你的角色场景判断正确度约为 ${Math.round(structuredScore*100)}%。`);evidenceEn.push(`Your role-specific decisions were about ${Math.round(structuredScore*100)}% aligned with the rubric.`)}

  if(reviews.length){const mean=(k:string)=>reviews.reduce((s,r)=>s+Number(r[k]||0),0)/reviews.length
    d.ownership+=(mean('causal_explanation')-1.5)*8;d.independent+=(mean('independent_judgment')-1.5)*8;d.alertness+=(mean('risk_identification')-1.5)*8;d.calibration+=(mean('uncertainty_awareness')-1.5)*6;d.transfer+=(mean('transfer')-1.5)*9
    const cited=reviews.find(r=>String(r.evidence||'').trim());if(cited){evidence.push(`开放回答证据：“${String(cited.evidence).slice(0,90)}”`);evidenceEn.push(`Open-response evidence: “${String(cited.evidence).slice(0,90)}”`)}
  }
  Object.keys(d).forEach(k=>d[k as keyof typeof d]=clamp(d[k as keyof typeof d]))
  const values=Object.values(d), spread=Math.max(...values)-Math.min(...values), balance=clamp(100-spread*1.35)
  const askIntensity=clamp(ask*1.65), verifyIntensity=clamp(verify*3), modifyIntensity=clamp(modify*3), recordIntensity=clamp(record*5)
  const contradictory=(structuredScore>.75&&core5.score<.35)||(d.independent>70&&confidenceGap>45)||(d.alertness>75&&d.ownership<30)
  const matchScores:Record<ResultKey,number>={
    autopilot:clamp(avg(low(d.independent),low(d.ownership),low(d.alertness),aiFirst?100:20,askIntensity)),
    alchemist:clamp(avg(d.ownership,modifyIntensity,low(d.transfer),middle(d.independent,48),structuredScore*100)),
    blind:clamp(avg(clamp(Math.max(0,confidenceGap)*2),low(core5.score*100),confidence,d.calibration<45?90:25)),
    loop:clamp(avg(repeatOnly?100:10,d.alertness,low(d.independent),askIntensity,low(independentCheck*35))),
    auditor:clamp(avg(d.alertness,verifyIntensity,d.independent,low(modifyIntensity),core5.score*100)*(verify>=35?1:.72)),
    later:clamp(avg(d.ownership,modifyIntensity,low(d.learning),low(recordIntensity),d.transfer)*(record===0?1:.78)),
    supervisor:clamp(avg(criteriaBeforeAi?90:30,d.ownership,middle(d.alertness,58),middle(d.independent,55),low(d.transfer*.72))),
    codriver:clamp(avg(...values,balance,structuredScore*100)),
    quantum:clamp(avg(clamp(spread*1.7),clamp(Math.abs(confidenceGap)*1.5),low(balance),contradictory?100:0)*(contradictory?1:.55)*(confidenceGap>60&&core5.score<.4?.72:1))
  }
  const ranked=(Object.entries(matchScores) as [ResultKey,number][]).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
  const key=ranked[0][0],secondary=ranked[1][0],coverage=clamp((Object.keys(answers).length/12)*100)
  const stability=clamp(38+(ranked[0][1]-ranked[1][1])*2+coverage*.24)
  const type=TYPES[key], second=TYPES[secondary]
  const strongAlertness=d.alertness>=d.ownership, lowLearning=d.learning<45
  return {typeKey:key,type:type[0],typeEn:type[1],tagline:type[2],taglineEn:type[3],
    strength:strongAlertness?'你会主动寻找风险和证据。':'你愿意修改并承担最终成果。',strengthEn:strongAlertness?'You actively look for risk and evidence.':'You edit the output and take ownership of the final result.',
    risk:lowLearning?'任务完成后的复盘与知识沉淀仍然偏少。':'需要根据任务后果调整验证投入，避免固定使用同一种协作深度。',riskEn:lowLearning?'You retain too little reusable learning after delivery.':'Adjust verification effort to consequences instead of using one fixed collaboration depth.',
    evidence:evidence.slice(0,3),evidenceEn:evidenceEn.slice(0,3),dimensions:d,matchScores,stability,secondaryType:second[0],secondaryTypeEn:second[1]}
}
