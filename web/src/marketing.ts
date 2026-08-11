// MindIOU 落地页 + 原理页
// 文案为产品口径，设计师 agent 可在此基础上重构视觉层，但请勿改动关键措辞口径。
// 费曼口径说明：对外用"费曼式"（致敬精神，非学术引用），原理页锚定 retrieval practice 等认知科学出处。

import { getAccessToken } from './api'
import { el, navigate } from './router'
import { renderSiteFooter } from './navigation'
import { t } from './i18n'

// ── 公共顶栏 ──

function renderPublicHeader(parent: HTMLElement, active: 'landing' | 'how-it-works'): void {
  const header = el('header', 'site-header')
  const brand = el('a', 'site-brand', 'MindIOU')
  ;(brand as HTMLAnchorElement).href = '#'
  header.appendChild(brand)

  const nav = el('nav', 'site-nav')
  const navHome = el('a', `site-nav-link ${active === 'landing' ? 'is-active' : ''}`, '首页')
  ;(navHome as HTMLAnchorElement).href = '#'
  const navHow = el('a', `site-nav-link ${active === 'how-it-works' ? 'is-active' : ''}`, '原理')
  ;(navHow as HTMLAnchorElement).href = '#/how-it-works'
  const navGenesis = el('a', 'site-nav-link', '创始档案')
  ;(navGenesis as HTMLAnchorElement).href = '#/genesis'
  const navTest = el('a', 'site-nav-link', '协作测试')
  ;(navTest as HTMLAnchorElement).href = '#/assessment'
  const navProjects = el('a', 'site-nav-link', '项目记忆')
  ;(navProjects as HTMLAnchorElement).href = '#/projects'
  nav.appendChild(navHome)
  nav.appendChild(navHow)
  nav.appendChild(navGenesis)
  nav.appendChild(navTest)
  nav.appendChild(navProjects)

  // 右侧 CTA：已登录显示进入产品，未登录显示开始体验
  const ctaWrap = el('div', 'site-header-cta')
  const cta = el('button', 'btn btn-primary btn-sm', getAccessToken() ? '进入工作区' : '开始体验')
  cta.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  ctaWrap.appendChild(cta)
  const controls = el('div', 'site-header-controls')
  controls.appendChild(nav)
  controls.appendChild(ctaWrap)
  header.appendChild(controls)

  parent.appendChild(header)
}

// ── 落地首页 ──

export function renderLandingPage(root: HTMLElement): void {
  const page = el('div', 'page page-landing')
  renderPublicHeader(page, 'landing')

  // Hero
  const hero = el('section', 'landing-hero')
  const heroCopy = el('div', 'hero-copy')
  heroCopy.appendChild(el('p', 'hero-eyebrow', 'AI 完成任务，不等于你获得能力'))
  heroCopy.appendChild(el('h1', 'hero-title', '看见 AI 替你跳过的那段理解'))
  heroCopy.appendChild(el('p', 'hero-subtitle', '识别被代劳的推理，生成一笔可解释、可验证、可清偿的认知欠条。'))

  const heroCta = el('div', 'hero-cta')
  const primaryBtn = el('button', 'btn btn-primary btn-lg glass-button glass-button-dark', '生成我的认知欠条')
  primaryBtn.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  const secondaryBtn = el('button', 'btn btn-ghost btn-lg glass-button', '看看它如何工作')
  secondaryBtn.onclick = () => navigate({ name: 'how-it-works' })
  heroCta.appendChild(primaryBtn)
  heroCta.appendChild(secondaryBtn)
  heroCopy.appendChild(heroCta)
  hero.appendChild(heroCopy)

  const heroVisual = el('div', 'hero-visual')
  heroVisual.setAttribute('aria-label', '一段 AI 推理路径中，被跳过的理解生成了一笔认知欠条')
  const pathLabelTop = el('div', 'trajectory-label trajectory-label-top')
  pathLabelTop.appendChild(el('span', 'trajectory-label-title', '拆解问题'))
  pathLabelTop.appendChild(el('span', 'trajectory-label-meta', '识别所需能力与边界'))
  const pathLabelGap = el('div', 'trajectory-label trajectory-label-gap glass-chip')
  pathLabelGap.appendChild(el('span', 'trajectory-label-title', '被跳过的推理'))
  pathLabelGap.appendChild(el('span', 'trajectory-label-meta', 'AI 已为你跨越'))
  const pathLabelBottom = el('div', 'trajectory-label trajectory-label-bottom')
  pathLabelBottom.appendChild(el('span', 'trajectory-label-title', '形成方案'))
  pathLabelBottom.appendChild(el('span', 'trajectory-label-meta', '整合策略与取舍'))
  heroVisual.appendChild(pathLabelTop)
  heroVisual.appendChild(pathLabelGap)
  heroVisual.appendChild(pathLabelBottom)

  const debtCard = el('article', 'hero-debt-card liquid-glass')
  const debtHeader = el('div', 'hero-debt-header')
  debtHeader.appendChild(el('span', 'hero-debt-id', '认知欠条 01'))
  debtHeader.appendChild(el('span', 'hero-debt-status', '待解释'))
  debtCard.appendChild(debtHeader)
  debtCard.appendChild(el('p', 'hero-debt-kicker', '被跳过的推理'))
  debtCard.appendChild(el('h2', 'hero-debt-question', '为什么这个方案在高并发下仍然安全？'))
  const debtFooter = el('div', 'hero-debt-footer')
  debtFooter.appendChild(el('span', undefined, '欠条生成于 10:42'))
  debtFooter.appendChild(el('span', 'hero-debt-open', '打开欠条'))
  debtCard.appendChild(debtFooter)
  debtCard.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  debtCard.tabIndex = 0
  debtCard.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      debtCard.click()
    }
  }
  heroVisual.appendChild(debtCard)
  hero.appendChild(heroVisual)
  page.appendChild(hero)

  // 研究信号：先建立问题，再进入产品解释
  const evidence = el('section', 'landing-section landing-evidence')
  const evidenceIntro = el('div', 'landing-evidence-intro')
  evidenceIntro.appendChild(el('p', 'landing-kicker', '一个正在发生的问题'))
  evidenceIntro.appendChild(el('h2', 'section-heading', '产出越来越好，能力却未必同步增长'))
  evidenceIntro.appendChild(el('p', 'landing-lead', 'AI 可以显著提高当下表现，但一旦代劳的推理没有被重新取回，结果就可能留在工具这一侧。'))
  evidence.appendChild(evidenceIntro)

  const evidenceStats = el('div', 'landing-stat-grid')
  const assistedStat = el('article', 'landing-stat')
  assistedStat.appendChild(el('span', 'landing-stat-value', '+48%'))
  assistedStat.appendChild(el('h3', 'landing-stat-title', '有 AI 辅助时，练习表现更好'))
  assistedStat.appendChild(el('p', 'landing-stat-desc', '在一项高中数学随机对照研究中，定制 AI 辅导显著提高了练习阶段的成绩。'))
  evidenceStats.appendChild(assistedStat)

  const independentStat = el('article', 'landing-stat landing-stat-risk')
  independentStat.appendChild(el('span', 'landing-stat-value', '−17%'))
  independentStat.appendChild(el('h3', 'landing-stat-title', '撤去 AI 后，独立表现反而下降'))
  independentStat.appendChild(el('p', 'landing-stat-desc', '同一研究提示：即时完成得更好，不等于已经形成可以独立调用的能力。'))
  evidenceStats.appendChild(independentStat)
  evidence.appendChild(evidenceStats)

  const evidenceBoundary = el('div', 'landing-evidence-boundary')
  evidenceBoundary.appendChild(el('span', 'landing-evidence-mark', '研究边界'))
  evidenceBoundary.appendChild(el('p', 'landing-evidence-note', '这不意味着所有 AI 使用都会伤害学习。它说明的是一种风险：如果认知工作被持续代劳，产出提升与能力增长可能彼此分离。'))
  evidenceBoundary.appendChild(el('p', 'landing-evidence-source', '数据来源：Bastani 等，PNAS，2025。'))
  evidence.appendChild(evidenceBoundary)
  page.appendChild(evidence)

  // 痛点区
  const pains = el('section', 'landing-section pains')
  pains.appendChild(el('h2', 'section-heading', '你以为你会了，其实只是 AI 会'))
  const painList = el('div', 'pain-list')

  const pain1 = el('div', 'pain-card')
  pain1.appendChild(el('h3', 'pain-title', '你交付了方案，但能复述出推理过程吗？'))
  pain1.appendChild(el('p', 'pain-desc', 'AI 帮你跳过了拆解、判断、权衡——这些被跳过的理解，会在你需要独立决策时暴露。'))
  painList.appendChild(pain1)

  const pain2 = el('div', 'pain-card')
  pain2.appendChild(el('h3', 'pain-title', '你跳过的每个理解，都是一笔会到期的欠条'))
  pain2.appendChild(el('p', 'pain-desc', '认知债务不像知识盲区，它是你已经「透支」过的能力：你以为你会，其实只是 AI 会。'))
  painList.appendChild(pain2)

  const pain3 = el('div', 'pain-card')
  pain3.appendChild(el('h3', 'pain-title', 'AI 给了答案，但你没法验证它对不对'))
  pain3.appendChild(el('p', 'pain-desc', '没有验证能力的答案，在关键场合等于没有答案。'))
  painList.appendChild(pain3)

  pains.appendChild(painList)
  page.appendChild(pains)

  // 概念区：解释认知债务与普通知识盲区的差异
  const definition = el('section', 'landing-section debt-definition')
  const definitionIntro = el('div', 'debt-definition-intro')
  definitionIntro.appendChild(el('p', 'landing-kicker', '先看清债务是什么'))
  definitionIntro.appendChild(el('h2', 'section-heading', '认知债务，不是普通的知识盲区'))
  definitionIntro.appendChild(el('p', 'landing-lead', '真正危险的不是“我不会”，而是借助 AI 完成交付后，把一份可用的结果误认为自己的能力。'))
  definition.appendChild(definitionIntro)

  const definitionGrid = el('div', 'definition-grid')
  const blindSpot = el('article', 'definition-item')
  blindSpot.appendChild(el('span', 'definition-index', '01'))
  blindSpot.appendChild(el('p', 'definition-label', '知识盲区'))
  blindSpot.appendChild(el('h3', 'definition-title', '我没有学过，也知道自己不会'))
  blindSpot.appendChild(el('p', 'definition-desc', '边界清楚，因此更容易主动学习、询问或补足。'))
  definitionGrid.appendChild(blindSpot)

  const debt = el('article', 'definition-item definition-item-debt liquid-glass')
  debt.appendChild(el('span', 'definition-index', '02'))
  debt.appendChild(el('p', 'definition-label', '认知债务'))
  debt.appendChild(el('h3', 'definition-title', '我借助 AI 做完了，因此误以为自己掌握'))
  debt.appendChild(el('p', 'definition-desc', '它会在需要解释、判断、验证或独立决策的时刻暴露。'))
  definitionGrid.appendChild(debt)
  definition.appendChild(definitionGrid)

  definition.appendChild(el('blockquote', 'definition-quote', '“知识盲区是我不知道；认知债务是我不知道自己不知道。”'))

  const productivityNote = el('div', 'productivity-note')
  productivityNote.appendChild(el('span', 'productivity-value', '+15%'))
  const productivityCopy = el('div', 'productivity-copy')
  productivityCopy.appendChild(el('h3', 'productivity-title', 'MindIOU 不是让你少用 AI'))
  productivityCopy.appendChild(el('p', 'productivity-desc', '真实工作研究已经证明 AI 可以提升生产率。问题不在于代劳本身，而在于你是否知道交出了什么、哪些能力必须拿回来。'))
  productivityNote.appendChild(productivityCopy)
  definition.appendChild(productivityNote)
  page.appendChild(definition)

  // 工作原理缩影
  const how = el('section', 'landing-section how-overview')
  how.appendChild(el('h2', 'section-heading', '三步，把债务变成能力'))
  const steps = el('div', 'how-steps')

  const step1 = el('div', 'how-step')
  step1.appendChild(el('div', 'step-number', '1'))
  step1.appendChild(el('h3', 'step-title', '粘贴 AI 辅助材料'))
  step1.appendChild(el('p', 'step-desc', 'AI 协作对话、AI 生成的方案、黑客松记录……任何一段 AI 帮你完成的工作。'))
  steps.appendChild(step1)

  const step2 = el('div', 'how-step')
  step2.appendChild(el('div', 'step-number', '2'))
  step2.appendChild(el('h3', 'step-title', '生成认知债务报告'))
  step2.appendChild(el('p', 'step-desc', '七部分报告揭示：AI 完成了什么、你真正贡献了什么、最危险的缺口在哪里。'))
  steps.appendChild(step2)

  const step3 = el('div', 'how-step')
  step3.appendChild(el('div', 'step-number', '3'))
  step3.appendChild(el('h3', 'step-title', '费曼式清偿'))
  step3.appendChild(el('p', 'step-desc', '选一笔欠条，用自己的话解释清楚。AI 基于来源给出反馈，告诉你漏了什么、该怎么补。'))
  steps.appendChild(step3)

  how.appendChild(steps)

  const howMore = el('p', 'how-more')
  const howLink = el('a', 'text-link', '深入了解每个环节 →')
  ;(howLink as HTMLAnchorElement).href = '#/how-it-works'
  howMore.appendChild(howLink)
  how.appendChild(howMore)
  page.appendChild(how)

  // 报告价值：将长文档中的六部分能力诊断与困惑回执压缩成可扫读的七项
  const reportPreview = el('section', 'landing-section report-preview')
  const reportPreviewHeader = el('div', 'report-preview-header')
  const reportPreviewCopy = el('div')
  reportPreviewCopy.appendChild(el('p', 'landing-kicker', '一份报告，不是一份总结'))
  reportPreviewCopy.appendChild(el('h2', 'section-heading', '它要回答的，是你究竟欠下了什么'))
  reportPreviewHeader.appendChild(reportPreviewCopy)
  reportPreviewHeader.appendChild(el('p', 'landing-lead', 'MindIOU 把真实协作拆成七个视角，让“我好像会了”变成一组可以验证和行动的具体问题。'))
  reportPreview.appendChild(reportPreviewHeader)

  const reportParts = [
    ['AI 完成了什么', '哪些拆解、推理、判断与权衡被代劳'],
    ['你真正贡献了什么', '保留你已经做出的理解与决定'],
    ['最危险的理解缺口', '优先识别高风险、可复用的根能力'],
    ['事实与推断', '区分证据、假设、待验证问题与取舍'],
    ['费曼补偿卡', '把缺口变成需要你亲自解释的任务'],
    ['下一步行动', '验证、记录、请教或安排再次练习'],
    ['困惑处理回执', '看见你提出的问题如何进入报告']
  ]
  const reportPartList = el('div', 'report-part-list')
  reportParts.forEach(([title, desc], index) => {
    const item = el('article', 'report-part')
    item.appendChild(el('span', 'report-part-index', String(index + 1).padStart(2, '0')))
    const copy = el('div', 'report-part-copy')
    copy.appendChild(el('h3', 'report-part-title', title))
    copy.appendChild(el('p', 'report-part-desc', desc))
    item.appendChild(copy)
    reportPartList.appendChild(item)
  })
  reportPreview.appendChild(reportPartList)
  page.appendChild(reportPreview)

  // 清偿节奏：把大块工作与碎片时间连接起来
  const microtime = el('section', 'landing-section microtime-section')
  microtime.appendChild(el('p', 'landing-kicker', '大块工作产生欠条，小块时间完成清偿'))
  microtime.appendChild(el('h2', 'section-heading', '工作时拿到结果，碎片时间把能力拿回来'))
  microtime.appendChild(el('p', 'landing-lead', '无需重新学习整份材料。MindIOU 把最值得清偿的一笔债务，变成几分钟内可以完成的解释、反馈与再回答。'))

  const microtimeFlow = el('div', 'microtime-flow')
  const microtimeItems = [
    ['工作时', '借助 AI 完成真实任务', '留下认知欠条'],
    ['碎片时间', '选一张卡，用自己的话解释', '收到基于来源的反馈'],
    ['之后复盘', '再次回答同一笔债务', '谨慎更新清偿状态']
  ]
  microtimeItems.forEach(([time, title, desc], index) => {
    const item = el('article', 'microtime-item')
    item.appendChild(el('span', 'microtime-index', String(index + 1).padStart(2, '0')))
    item.appendChild(el('p', 'microtime-label', time))
    item.appendChild(el('h3', 'microtime-title', title))
    item.appendChild(el('p', 'microtime-desc', desc))
    microtimeFlow.appendChild(item)
  })
  microtime.appendChild(microtimeFlow)
  microtime.appendChild(el('p', 'microtime-belief', '目标不是减少 AI 代劳，而是让代劳变得可见、可控、可清偿。'))
  page.appendChild(microtime)

  // 首期计划宣传入口：001 期 7 天认知清债挑战
  const promo = el('section', 'landing-section landing-challenge-promo')
  const promoCopy = el('div', 'landing-challenge-copy')
  promoCopy.appendChild(el('p', 'landing-kicker', t('001 期 · 首期计划', 'Cohort 001 · First program')))
  promoCopy.appendChild(el('h2', 'section-heading', t('7 天认知清债挑战', '7-day cognitive-debt challenge')))
  promoCopy.appendChild(el('p', 'landing-lead', t('用一段真实的 AI 协作材料开始：发现欠条、亲自解释、延迟回忆、场景迁移。7 天，把 AI 代劳变成真正掌握。', 'Start with one real AI-assisted artifact: find the debt, explain it yourself, recall it later, and transfer it to a new scenario. In 7 days, turn delegated work into real mastery.')))
  const promoActions = el('div', 'landing-challenge-actions')
  const joinBtn = el('button', 'btn btn-primary btn-lg', t('了解 001 期挑战', 'Learn about Cohort 001'))
  joinBtn.onclick = () => navigate({ name: 'challenge', slug: '001' })
  const testBtn = el('button', 'btn btn-ghost btn-lg', t('先做免费协作测试', 'Try the free collaboration assessment'))
  testBtn.onclick = () => navigate({ name: 'assessment' })
  promoActions.appendChild(joinBtn)
  promoActions.appendChild(testBtn)
  promoCopy.appendChild(promoActions)
  promoCopy.appendChild(el('p', 'landing-challenge-note', t('首期筹备中 · 20 天开放期随报随学 · 个人 7 天周期 · 不限名额', 'Preparing for launch · 20-day enrollment window · 7-day personal cycle · no seat limit')))
  promo.appendChild(promoCopy)
  page.appendChild(promo)

  // 底部 CTA
  const bottomCta = el('section', 'landing-section bottom-cta')
  bottomCta.appendChild(el('h2', 'cta-heading', '别让理解停留在 AI 那一侧'))
  bottomCta.appendChild(el('p', 'cta-copy', '粘贴一段真实的 AI 协作材料，生成你的第一笔认知欠条。'))
  const ctaBtn = el('button', 'btn btn-primary btn-lg', '生成我的第一笔认知欠条')
  ctaBtn.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  bottomCta.appendChild(ctaBtn)
  bottomCta.appendChild(el('p', 'cta-note', '无需配置 · 固定样本可直接体验 · 先看见，再决定清偿什么'))
  page.appendChild(bottomCta)

  // 页脚
  page.appendChild(renderSiteFooter())

  root.appendChild(page)

  // ── 首期计划浮窗宣传 ──
  var banner = el("aside", "challenge-floating-banner")
  var bannerBody = el("div", "challenge-floating-body")
  var bannerText = el("div", "challenge-floating-text")
  bannerText.appendChild(el("span", "challenge-floating-kicker", t('001 期 · 首期计划', 'Cohort 001 · First program')))
  bannerText.appendChild(el("strong", "challenge-floating-title", t('7 天认知清债挑战', '7-day cognitive-debt challenge')))
  bannerBody.appendChild(bannerText)
  bannerBody.appendChild(el("span", "challenge-floating-price", "¥29.9"))
  var bannerBtn = el("a", "challenge-floating-btn", t('了解详情', 'Learn more'))
  bannerBtn.href = "#/challenge/001"
  bannerBody.appendChild(bannerBtn)
  banner.appendChild(bannerBody)
  var closeBtn = el("button", "challenge-floating-close", "×")
  closeBtn.onclick = function() { banner.style.display = "none" }
  banner.appendChild(closeBtn)
  root.appendChild(banner)



}

// ── 原理页 ──

export function renderHowItWorksPage(root: HTMLElement): void {
  const page = el('div', 'page page-how')
  renderPublicHeader(page, 'how-it-works')

  // 一、什么是认知债务
  const s1 = el('section', 'doc-section')
  s1.appendChild(el('h1', 'doc-title', 'MindIOU 的原理'))
  s1.appendChild(el('h2', 'doc-heading', '一、什么是认知债务'))
  s1.appendChild(el('p', 'doc-text', '当 AI 替你完成拆解、判断、权衡、验证时，这些认知工作并没有消失——它只是从你这里「外包」给了 AI。这笔被透支的理解，就是认知债务。'))
  s1.appendChild(el('p', 'doc-text', '它和知识盲区不同：知识盲区是你没学过，认知债务是你以为自己会，其实只是 AI 会。'))
  page.appendChild(s1)

  // 二、为什么它很危险
  const s2 = el('section', 'doc-section')
  s2.appendChild(el('h2', 'doc-heading', '二、为什么它很危险'))
  const dangers = el('ul', 'doc-list')
  const d1 = el('li', undefined, '它会累积：每一次 AI 代劳都在加深债务。')
  const d2 = el('li', undefined, '它会伪装：因为有 AI 产出，你以为自己掌握了。')
  const d3 = el('li', undefined, '它在关键时刻暴露：脱离 AI、需要独立判断或验证时，你无能为力。')
  dangers.appendChild(d1); dangers.appendChild(d2); dangers.appendChild(d3)
  s2.appendChild(dangers)
  page.appendChild(s2)

  // 三、识别 → 清偿 → 谨慎确认
  const s3 = el('section', 'doc-section')
  s3.appendChild(el('h2', 'doc-heading', '三、识别 → 清偿 → 谨慎确认'))
  const flow = el('pre', 'doc-flow', `AI 辅助材料
  → 六部分认知债务报告（识别欠条）
  → 选定一笔欠条
  → 用自己的话解释（费曼式清偿）
  → 来源支撑的反馈（指出你漏了什么）
  → 追问（可选）
  → 谨慎的清偿状态 + 下一步行动`)
  s3.appendChild(flow)
  page.appendChild(s3)

  // 四、六部分报告说明
  const s4 = el('section', 'doc-section')
  s4.appendChild(el('h2', 'doc-heading', '四、六部分报告各自揭示什么'))
  const reportParts = [
    ['AI 完成了什么', '哪些认知工作被 AI 代劳了——拆解、推理、判断、权衡。'],
    ['你真正贡献了什么', '在这段协作里，哪些是你自己真实的理解和决策。'],
    ['最危险的理解缺口', '2-4 个会在关键时刻暴露的根能力缺口，按危险程度排序。'],
    ['事实与推断', '把内容拆成事实、假设、待验证问题、决定、取舍，区分哪些有依据、哪些是推测。'],
    ['费曼补偿卡', '3-5 张卡片，每张对应一个被跳过的理解过程，请你用自己的话解释它。'],
    ['下一步行动', '把每个缺口路由到具体动作：验证、记录、作为任务、或请教他人。']
  ]
  for (const [title, desc] of reportParts) {
    const item = el('div', 'doc-item')
    item.appendChild(el('h3', 'doc-item-title', title))
    item.appendChild(el('p', 'doc-item-desc', desc))
    s4.appendChild(item)
  }
  page.appendChild(s4)

  // 五、清偿会话与费曼式解释
  const s5 = el('section', 'doc-section')
  s5.appendChild(el('h2', 'doc-heading', '五、清偿会话：为什么是「用自己的话解释」'))
  s5.appendChild(el('p', 'doc-text', '能讲清楚，才是真懂。清偿会话让你对着一笔欠条，用自己的话解释它——不是复述 AI 的输出，而是重建你的理解。'))
  s5.appendChild(el('p', 'doc-text', 'AI 会基于外部来源给出反馈，指出你漏了什么、误解了什么，并在必要时追问。结束后给出参考要点，供你对照。'))

  // 费曼口径说明（关键）
  const feynmanNote = el('div', 'doc-note note-feynman')
  feynmanNote.appendChild(el('p', 'doc-note-title', '关于「费曼式」'))
  feynmanNote.appendChild(el('p', 'doc-note-text', 'MindIOU 借鉴了费曼「用自己的话讲清楚复杂概念」的精神。需要说明的是，「费曼技巧」并非费曼本人提出的学术术语，而是从其学习习惯归纳而来。'))
  feynmanNote.appendChild(el('p', 'doc-note-text', '其底层机制有认知科学支撑：主动回忆（Retrieval Practice）、生成效应（Generation Effect）、元认知监控（Metacognitive Monitoring）——这些是教育心理学同行评审文献中经过验证的机制。'))
  s5.appendChild(feynmanNote)
  page.appendChild(s5)

  // 六、四种谨慎状态
  const s6 = el('section', 'doc-section')
  s6.appendChild(el('h2', 'doc-heading', '六、四种谨慎的清偿状态'))
  s6.appendChild(el('p', 'doc-text', '清偿结束后，MindIOU 给出四种状态之一。它们描述的是本次会话的证据，不证明你已永久掌握。'))

  const statuses = el('div', 'status-explained-list')
  const statusData = [
    { cls: 'status-provisionally_cleared', label: '初步清偿', desc: '你的解释覆盖了关键要点，有来源支撑。但这仅限本次会话，不等于永久掌握。' },
    { cls: 'status-needs_practice', label: '需要练习', desc: '你掌握了部分内容，但有关键遗漏或误解，需要再次解释补全。' },
    { cls: 'status-needs_verification', label: '需要验证', desc: '你的解释依据了不够可信的来源，建议查证后再确认。' },
    { cls: 'status-no_valid_attempt', label: '无有效回答', desc: '你的回答与问题不匹配，或未触及核心内容。' }
  ]
  for (const s of statusData) {
    const item = el('div', `status-explained ${s.cls}`)
    item.appendChild(el('span', `result-status ${s.cls}`, s.label))
    item.appendChild(el('p', 'status-explained-desc', s.desc))
    statuses.appendChild(item)
  }
  s6.appendChild(statuses)
  page.appendChild(s6)

  // 底部 CTA
  const cta = el('section', 'doc-cta')
  cta.appendChild(el('h2', 'cta-heading', '准备好清偿第一笔欠条了吗？'))
  const ctaBtn = el('button', 'btn btn-primary btn-lg', '开始体验')
  ctaBtn.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  cta.appendChild(ctaBtn)
  page.appendChild(cta)

  page.appendChild(renderSiteFooter())
  root.appendChild(page)




}
