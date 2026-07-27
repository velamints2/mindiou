// MindIOU 落地页 + 原理页
// 文案为产品口径，设计师 agent 可在此基础上重构视觉层，但请勿改动关键措辞口径。
// 费曼口径说明：对外用"费曼式"（致敬精神，非学术引用），原理页锚定 retrieval practice 等认知科学出处。

import { getAccessToken } from './api'
import { el, navigate } from './router'

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
  nav.appendChild(navHome)
  nav.appendChild(navHow)
  header.appendChild(nav)

  // 右侧 CTA：已登录显示进入产品，未登录显示开始体验
  const ctaWrap = el('div', 'site-header-cta')
  const cta = el('button', 'btn btn-primary btn-sm', getAccessToken() ? '进入工作区' : '开始体验')
  cta.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  ctaWrap.appendChild(cta)
  header.appendChild(ctaWrap)

  parent.appendChild(header)
}

// ── 落地首页 ──

export function renderLandingPage(root: HTMLElement): void {
  const page = el('div', 'page page-landing')
  renderPublicHeader(page, 'landing')

  // Hero
  const hero = el('section', 'landing-hero')
  hero.appendChild(el('h1', 'hero-title', '把 AI 帮你跳过的理解，变成真实的能力'))
  hero.appendChild(el('p', 'hero-subtitle', 'MindIOU 识别 AI 代劳的认知工作，生成一份「认知债务报告」，再用费曼式清偿帮你真正掌握——而不是让理解停留在 AI 那一侧。'))

  const heroCta = el('div', 'hero-cta')
  const primaryBtn = el('button', 'btn btn-primary btn-lg', '开始体验')
  primaryBtn.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  const secondaryBtn = el('button', 'btn btn-ghost btn-lg', '了解原理')
  secondaryBtn.onclick = () => navigate({ name: 'how-it-works' })
  heroCta.appendChild(primaryBtn)
  heroCta.appendChild(secondaryBtn)
  hero.appendChild(heroCta)
  page.appendChild(hero)

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

  // 工作原理缩影
  const how = el('section', 'landing-section how-overview')
  how.appendChild(el('h2', 'section-heading', '三步，把债务变成能力'))
  const steps = el('div', 'how-steps')

  const step1 = el('div', 'how-step')
  step1.appendChild(el('div', 'step-number', '1'))
  step1.appendChild(el('h3', 'step-title', '粘贴 AI 辅助材料'))
  step1.appendChild(el('p', 'step-desc', 'ChatGPT 对话、AI 生成的方案、黑客松记录……任何一段 AI 帮你完成的工作。'))
  steps.appendChild(step1)

  const step2 = el('div', 'how-step')
  step2.appendChild(el('div', 'step-number', '2'))
  step2.appendChild(el('h3', 'step-title', '生成认知债务报告'))
  step2.appendChild(el('p', 'step-desc', '六部分报告揭示：AI 完成了什么、你真正贡献了什么、最危险的缺口在哪里。'))
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

  // 底部 CTA
  const bottomCta = el('section', 'landing-section bottom-cta')
  bottomCta.appendChild(el('h2', 'cta-heading', '别让理解停留在 AI 那一侧'))
  const ctaBtn = el('button', 'btn btn-primary btn-lg', '开始体验')
  ctaBtn.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  bottomCta.appendChild(ctaBtn)
  page.appendChild(bottomCta)

  // 页脚
  page.appendChild(renderFooter())

  root.appendChild(page)
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

  page.appendChild(renderFooter())
  root.appendChild(page)
}

// ── 页脚 ──

function renderFooter(): HTMLElement {
  const footer = el('footer', 'site-footer')
  footer.appendChild(el('div', 'footer-brand', 'MindIOU'))
  footer.appendChild(el('p', 'footer-tagline', '把 AI 代劳转化为真实能力成长'))
  const links = el('div', 'footer-links')
  const a1 = el('a', 'footer-link', '首页')
  ;(a1 as HTMLAnchorElement).href = '#'
  const a2 = el('a', 'footer-link', '原理')
  ;(a2 as HTMLAnchorElement).href = '#/how-it-works'
  links.appendChild(a1); links.appendChild(a2)
  footer.appendChild(links)
  footer.appendChild(el('p', 'footer-copy', '© MindIOU'))
  return footer
}
