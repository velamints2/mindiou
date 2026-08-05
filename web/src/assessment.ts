import { reviewAssessment, type AssessmentOpenReview } from './api'
import { getLocale, t } from './i18n'
import { el, navigate } from './router'
import { ASSESSMENT_VERSION, questionsFor, roles, type AssessmentQuestion, type AssessmentRole } from './assessment-bank'
import { scoreAssessment, type AssessmentAnswers } from './assessment-score'

const STATE_KEY = 'mindiou_ai_collaboration_test_v1_1'
type State = { role: AssessmentRole | null; index: number; answers: AssessmentAnswers; startedAt: string; reviews?: AssessmentOpenReview[]; reviewMode?: string; reviewPending?: boolean }
const fresh = ():State => ({role:null,index:0,answers:{},startedAt:new Date().toISOString()})
function load():State { try { return {...fresh(),...JSON.parse(localStorage.getItem(STATE_KEY)||'{}'),reviewPending:false} } catch { return fresh() } }
function save(state:State) { localStorage.setItem(STATE_KEY,JSON.stringify(state)) }
const label = (zh:string,en:string) => getLocale()==='en'?en:zh
const optionLabel = (o:{label:string;labelEn:string}) => label(o.label,o.labelEn)

function questionAnswerIsValid(q:AssessmentQuestion, answer:unknown):boolean {
  if (q.type==='text') return String(answer||'').trim().length>=3
  if (q.type==='choice') return Boolean(answer)
  if (q.type==='confidence') return typeof answer==='number'
  if (q.type==='multi') return Array.isArray(answer) && answer.length>0
  if (q.type==='ranking') return Array.isArray(answer) && answer.length===q.options?.length
  if (q.type==='allocation') return Object.values((answer||{}) as Record<string,number>).reduce((sum,n)=>sum+Number(n||0),0)===100
  if (q.type==='classification') return q.options?.every(o=>Boolean((answer as Record<string,string>||{})[o.id]))||false
  return false
}

function renderInput(q:AssessmentQuestion,state:State,onChange:()=>void,onRerender:()=>void):HTMLElement {
  const box=el('div','assessment-answer')
  if(q.context) box.appendChild(el('blockquote','assessment-context',label(q.context,q.contextEn||q.context)))
  if(q.type==='text') {
    const input=el('textarea','assessment-text') as HTMLTextAreaElement; input.maxLength=3000; input.placeholder=label(q.placeholder||'',q.placeholderEn||''); input.value=String(state.answers[q.id]||'')
    input.oninput=()=>{state.answers[q.id]=input.value;save(state);onChange()}; box.appendChild(input)
    if(q.id==='core-8') {const confidenceKey='core-8-confidence';const value=typeof state.answers[confidenceKey]==='number'?Number(state.answers[confidenceKey]):50;state.answers[confidenceKey]=value;const caption=el('label','assessment-confidence-label',label('你对这次修改的把握有多大？','How confident are you in this rewrite?'));const output=el('strong','assessment-confidence-value',String(value));const range=el('input','assessment-range') as HTMLInputElement;range.type='range';range.min='0';range.max='100';range.value=String(value);range.oninput=()=>{state.answers[confidenceKey]=Number(range.value);output.textContent=range.value;save(state)};caption.append(output,range);box.appendChild(caption)}
    return box
  }
  if(q.type==='confidence') {
    const value=typeof state.answers[q.id]==='number'?Number(state.answers[q.id]):50; state.answers[q.id]=value
    const output=el('strong','assessment-confidence-value',String(value)); const range=el('input','assessment-range') as HTMLInputElement; range.type='range';range.min='0';range.max='100';range.value=String(value)
    range.oninput=()=>{state.answers[q.id]=Number(range.value);output.textContent=range.value;save(state);onChange()}; box.append(output,range); return box
  }
  if(q.type==='choice'||q.type==='multi') {
    const selected=q.type==='multi'?(state.answers[q.id] as string[]||[]):[]
    q.options?.forEach(o=>{const row=el('label','assessment-option');const input=el('input') as HTMLInputElement;input.type=q.type==='choice'?'radio':'checkbox';input.name=q.id;input.checked=q.type==='choice'?state.answers[q.id]===o.id:selected.includes(o.id)
      input.onchange=()=>{if(q.type==='choice')state.answers[q.id]=o.id;else {const current=state.answers[q.id] as string[]||[];state.answers[q.id]=input.checked?[...current.filter(id=>id!==o.id),o.id]:current.filter(id=>id!==o.id)}save(state);onChange()};row.append(input,el('span','',optionLabel(o)));box.appendChild(row)});return box
  }
  if(q.type==='ranking') {
    const order=(state.answers[q.id] as string[]||q.options?.map(o=>o.id)||[]);state.answers[q.id]=order
    order.forEach((id,idx)=>{const o=q.options?.find(item=>item.id===id)!;const row=el('div','assessment-rank-row');row.appendChild(el('span','assessment-rank-number',String(idx+1)));row.appendChild(el('span','assessment-rank-label',optionLabel(o)));const controls=el('div','assessment-rank-controls');
      const up=el('button','assessment-move','↑');up.type='button';up.disabled=idx===0;up.onclick=()=>{[order[idx-1],order[idx]]=[order[idx],order[idx-1]];save(state);onRerender()};const down=el('button','assessment-move','↓');down.type='button';down.disabled=idx===order.length-1;down.onclick=()=>{[order[idx+1],order[idx]]=[order[idx],order[idx+1]];save(state);onRerender()};controls.append(up,down);row.appendChild(controls);box.appendChild(row)});return box
  }
  if(q.type==='allocation') {
    const values=(state.answers[q.id] as Record<string,number>||Object.fromEntries(q.options?.map(o=>[o.id,0])||[]));state.answers[q.id]=values
    const total=el('strong','assessment-total','');const refresh=()=>{const n=Object.values(values).reduce((s,v)=>s+Number(v||0),0);total.textContent=label(`当前合计：${n} / 100`,`Total: ${n} / 100`);total.classList.toggle('is-error',n!==100)}
    q.options?.forEach(o=>{const row=el('label','assessment-allocation');row.appendChild(el('span','',optionLabel(o)));const input=el('input') as HTMLInputElement;input.type='number';input.min='0';input.max='100';input.value=String(values[o.id]||0);input.oninput=()=>{values[o.id]=Math.max(0,Math.min(100,Number(input.value)||0));save(state);refresh();onChange()};row.appendChild(input);box.appendChild(row)});refresh();box.appendChild(total);return box
  }
  if(q.type==='classification') {
    const values=(state.answers[q.id] as Record<string,string>||{});state.answers[q.id]=values
    q.options?.forEach(o=>{const row=el('label','assessment-classify');row.appendChild(el('span','',optionLabel(o)));const select=el('select') as HTMLSelectElement;select.appendChild(new Option(label('请选择','Choose'),'') );q.groups?.forEach(g=>select.appendChild(new Option(optionLabel(g),g.id)));select.value=values[o.id]||'';select.onchange=()=>{values[o.id]=select.value;save(state);onChange()};row.appendChild(select);box.appendChild(row)});return box
  }
  return box
}

function renderResult(root:HTMLElement,state:State,questions:AssessmentQuestion[]) {
  const result=scoreAssessment(state.role!,questions,state.answers,state.reviews);const page=el('div','page page-assessment assessment-result')
  window.scrollTo({top:0,left:0,behavior:'auto'})
  page.appendChild(el('p','assessment-kicker',`${ASSESSMENT_VERSION} · ${label('研究启发的 AI 协作行为测试','Research-informed AI collaboration behavior test')}`))
  page.appendChild(el('p','assessment-result-label',label('你当前更接近','Your current pattern')));page.appendChild(el('h1','assessment-result-title',label(result.type,result.typeEn)));page.appendChild(el('p','assessment-tagline',label(result.tagline,result.taglineEn)))
  page.appendChild(el('p','assessment-result-stability',label(`结果稳定度 ${result.stability}/100 · 次接近：${result.secondaryType}`,`Result stability ${result.stability}/100 · Next closest: ${result.secondaryTypeEn}`)))
  const visual=el('figure','assessment-result-visual is-loading');const image=el('img') as HTMLImageElement;const imageLocale=getLocale()==='en'?'-en':'';const assetPath=`./assets/assessment-results/${result.typeKey}${imageLocale}.webp`;const assetUrl=new URL(assetPath,document.baseURI);assetUrl.searchParams.set('v',ASSESSMENT_VERSION);image.src=assetUrl.href;image.alt=label(`${result.type}结果插画`,`${result.typeEn} result illustration`);image.width=900;image.height=900;image.loading='eager';image.decoding='async';image.fetchPriority='high';const imageStatus=el('figcaption','assessment-result-visual-status',label('正在加载结果插画…','Loading result illustration…'));let retried=false;image.onload=()=>{visual.classList.remove('is-loading','is-error');imageStatus.remove()};image.onerror=()=>{if(!retried){retried=true;const retryUrl=new URL(assetUrl.href);retryUrl.searchParams.set('retry',String(Date.now()));image.src=retryUrl.href;return}visual.classList.remove('is-loading');visual.classList.add('is-error');imageStatus.textContent=label('结果插画加载失败，请刷新页面重试。','The result illustration failed to load. Refresh the page to try again.')};visual.append(image,imageStatus);page.appendChild(visual)
  const cards=el('div','assessment-result-grid');[['主要优势','Primary strength',label(result.strength,result.strengthEn)],['当前风险','Current risk',label(result.risk,result.riskEn)]].forEach(([zh,en,body])=>{const card=el('article','assessment-result-card');card.append(el('h2','',label(zh,en)),el('p','',body));cards.appendChild(card)});page.appendChild(cards)
  const evidence=el('section','assessment-evidence');evidence.appendChild(el('h2','',label('这不是一句空泛标签','Evidence behind the result')));(getLocale()==='en'?result.evidenceEn:result.evidence).forEach(item=>evidence.appendChild(el('p','assessment-evidence-item',item)));page.appendChild(evidence)
  evidence.appendChild(el('small','assessment-review-mode',state.reviewMode==='model_structured'?label('开放题：结构化模型评审','Open responses: structured model review'):label('开放题：规则降级评审，结果为暂定','Open responses: provisional rule-based fallback')))
  const dimensionNames:Record<string,[string,string]>={independent:['独立起步','Independent start'],ownership:['解释所有权','Explanatory ownership'],alertness:['错误警觉','Error alertness'],calibration:['信心校准','Confidence calibration'],transfer:['能力迁移','Transfer'],learning:['学习闭环','Learning loop']};const dims=el('section','assessment-dimensions');dims.appendChild(el('h2','',label('六个行为维度','Six behavior dimensions')));Object.entries(result.dimensions).forEach(([key,value])=>{const row=el('div','assessment-dimension');const names=dimensionNames[key]||[key,key];row.append(el('span','',label(names[0],names[1])),el('progress','assessment-progress') as HTMLProgressElement,el('strong','',String(value)));(row.children[1] as HTMLProgressElement).max=100;(row.children[1] as HTMLProgressElement).value=value;dims.appendChild(row)});page.appendChild(dims)
  const activation=el('section','assessment-activation');activation.append(el('h2','',label('下一步：加入首期计划','Next: join Cohort 001')),el('p','',label('7 天认知清债挑战：用一段真实的 AI 协作材料开始，发现欠条、亲自解释、延迟回忆、场景迁移，把被代劳的理解一笔笔清回来。20 天开放期随报随学，个人 7 天周期，不限名额。','The 7-day cognitive-debt challenge: start from one real AI-assisted artifact—find debts, explain them yourself, recall later, transfer to new scenarios. A 20-day open window, a personal 7-day cycle, no seat limit.')));const action=el('button','btn btn-primary',label('加入首期计划','Join Cohort 001'));action.onclick=()=>navigate({name:'challenge',slug:'001'});activation.appendChild(action);page.appendChild(activation)
  page.appendChild(el('p','assessment-disclaimer',label('本测试参考公开 AI 素养、元认知和情境判断测量研究进行设计。它不是临床心理测验，也不能用于招聘、升学或能力资格认定。结果反映当前行为模式，并会随习惯和训练变化。','This research-informed test is not a clinical assessment and must not be used for hiring, admissions, or credentialing. It reflects current behavior and can change with practice.')))
  const retry=el('button','btn btn-ghost',label('重新测试','Retake'));retry.onclick=()=>{localStorage.removeItem(STATE_KEY);renderAssessmentPage(root)};page.appendChild(retry);root.appendChild(page)
}

export function renderAssessmentPage(root:HTMLElement):void {
  root.replaceChildren();const state=load();const rerender=()=>renderAssessmentPage(root)
  if(!state.role){const page=el('div','page page-assessment');page.append(el('p','assessment-kicker',`${ASSESSMENT_VERSION} · 5–7 MIN`),el('h1','assessment-title',label('AI 到底是你的副驾驶，还是代驾？','Is AI your co-driver—or driving for you?')),el('p','assessment-lead',label('这不是心理人格测试。12 个真实任务判断你当前与 AI 协作时更接近哪种行为模式。','This is not a personality test. Twelve task-based questions examine your current AI collaboration pattern.')),el('h2','assessment-role-title',label('先选择最接近你的主要任务','Choose your main work context')));const grid=el('div','assessment-role-grid');roles.forEach(role=>{const button=el('button','assessment-role-card');button.append(el('strong','',label(role.label,role.labelEn)),el('span','',label(role.desc,role.descEn)));button.onclick=()=>{state.role=role.id;state.index=0;save(state);rerender()};grid.appendChild(button)});page.appendChild(grid);root.appendChild(page);return}
  const questions=questionsFor(state.role);if(state.index>=questions.length){
    if(!state.reviews&&!state.reviewPending){state.reviewPending=true;save(state);const openQuestions=questions.filter(q=>q.type==='text');const openAnswers=Object.fromEntries(openQuestions.map(q=>[q.id,String(state.answers[q.id]||'')]));void reviewAssessment({version:ASSESSMENT_VERSION,role:state.role,locale:getLocale(),answers:openAnswers,questions:openQuestions.map(q=>({id:q.id,title:label(q.title,q.titleEn),context:label(q.context||'',q.contextEn||q.context||''),rubric:label(q.rubric||'',q.rubricEn||q.rubric||'')}))}).then(response=>{state.reviews=response.reviews;state.reviewMode=response.mode;state.reviewPending=false;save(state);rerender()}).catch(()=>{state.reviews=[];state.reviewMode='rule_fallback';state.reviewPending=false;save(state);rerender()})}
    if(state.reviewPending){const loading=el('div','page page-assessment assessment-review-loading');loading.append(el('p','assessment-kicker',ASSESSMENT_VERSION),el('h1','assessment-question-title',label('正在核对你的开放回答…','Reviewing your open responses…')),el('p','assessment-lead',label('结构题已确定性计分；开放题正在进行结构化证据评审。','Structured questions are scored deterministically; open responses are being reviewed for evidence.')));root.appendChild(loading);return}
    renderResult(root,state,questions);return
  }const q=questions[state.index];const page=el('div','page page-assessment');page.appendChild(el('p','assessment-kicker',`${label('第','Question ')} ${state.index+1} / ${questions.length}`));const progress=el('progress','assessment-main-progress') as HTMLProgressElement;progress.max=questions.length;progress.value=state.index+1;page.appendChild(progress);page.appendChild(el('h1','assessment-question-title',label(q.title,q.titleEn)));const actions=el('div','assessment-actions');const previous=el('button','btn btn-ghost',label('上一题','Back'));previous.disabled=state.index===0;previous.onclick=()=>{state.index--;save(state);rerender()};const next=el('button','btn btn-primary',state.index===questions.length-1?label('查看结果','See result'):label('下一题','Next'));const refresh=()=>{next.disabled=!questionAnswerIsValid(q,state.answers[q.id])};next.onclick=()=>{if(!questionAnswerIsValid(q,state.answers[q.id]))return;state.index++;save(state);rerender()};page.appendChild(renderInput(q,state,refresh,rerender));actions.append(previous,next);page.appendChild(actions);root.appendChild(page);refresh()
}
