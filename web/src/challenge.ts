// MindIOU 001 期｜7 天认知清债挑战 — 活动 Landing 单页
// 视觉：暖白纸张 + 手绘铅笔线 + 黑云 IP（区别于主站玻璃拟态，是活动独立视觉世界）。
// 边界：本页只做活动介绍与入口。购买跳转爱发电、激活码兑换、进度与完赛判定
// 依赖后续后端能力，未配置的部分在页面上明确标注，不伪造功能。

import { getLocale } from './i18n'
import { renderSiteFooter } from './navigation'
import { el, navigate } from './router'

// ── 活动配置（需要人工配置的内容集中在这里） ──
const CHALLENGE = {
  slug: '001',
  // 首期建议价，仅作展示，不涉交易
  priceDisplay: '¥29.9',
  // 爱发电商品链接：配置后购买按钮自动可用；留空则按钮显示「即将开放」
  afdianUrl: 'https://ifdian.net/item/2a561d748fe811f1a3b552540025c377',
  openDays: 20,
  personalDays: 7,
  statusText: { zh: '首期筹备中 · 可先免费体验', en: 'Cohort 001 in preparation · try the free test first' }
}

const label = (zh: string, en: string) => (getLocale() === 'en' ? en : zh)

function pencilNote(className: string): HTMLElement {
  return el('article', `challenge-note ${className}`.trim())
}

// ── 页面头（纸质，与主站玻璃头区分） ──
function renderChallengeHeader(page: HTMLElement): void {
  const header = el('header', 'challenge-header')
  const brand = el('a', 'challenge-brand', 'MindIOU') as HTMLAnchorElement
  brand.href = '#/'
  const brandTag = el('span', 'challenge-brand-tag', label('001 期挑战', 'Cohort 001'))
  brand.appendChild(brandTag)
  const nav = el('nav', 'challenge-header-nav')
  const home = el('a', 'challenge-header-link', label('首页', 'Home')) as HTMLAnchorElement
  home.href = '#/'
  const test = el('a', 'challenge-header-link', label('认知债务测试', 'AI collaboration test')) as HTMLAnchorElement
  test.href = '#/assessment'
  nav.append(home, test)
  header.append(brand, nav)
  page.appendChild(header)
}

// ── Hero ──
function renderHero(page: HTMLElement): void {
  const hero = el('section', 'challenge-hero')
  const copy = el('div', 'challenge-hero-copy')
  copy.appendChild(el('p', 'challenge-kicker', label('MindIOU 001 期 · 首期计划', 'MindIOU Cohort 001 · First program')))
  copy.appendChild(el('h1', 'challenge-title', label('7 天认知清债挑战', 'The 7-day cognitive-debt challenge')))
  const lead = el('p', 'challenge-lead')
  lead.appendChild(el('span', '', label('AI 帮你完成了工作，但这些知识真的变成你的了吗？', 'AI finished the work for you—but did the knowledge truly become yours?')))
  lead.appendChild(el('strong', 'challenge-lead-strong', label('用 7 天，把 AI 代劳，变成真正掌握。', 'In 7 days, turn AI delegation into real mastery.')))
  copy.appendChild(lead)

  const meta = el('div', 'challenge-meta')
  ;[
    label('7 天个人挑战', '7-day personal challenge'),
    label('20 天开放期 · 随报随学', '20-day open window · start anytime'),
    label('不限名额', 'No seat limit')
  ].forEach(text => meta.appendChild(el('span', 'challenge-chip', text)))
  meta.appendChild(el('span', 'challenge-chip challenge-chip-status', label(CHALLENGE.statusText.zh, CHALLENGE.statusText.en)))
  copy.appendChild(meta)

  const actions = el('div', 'challenge-actions')
  const primary = el('button', 'challenge-btn challenge-btn-primary', label('免费发现第一张认知欠条', 'Find my first cognitive debt—free'))
  primary.onclick = () => navigate({ name: 'login' })
  const secondary = el('button', 'challenge-btn challenge-btn-ghost', label('我已购买，兑换挑战密钥', 'I have purchased—redeem my key'))
  secondary.onclick = () => document.getElementById('challenge-join')?.scrollIntoView({ behavior: 'smooth' })
  actions.append(primary, secondary)
  copy.appendChild(actions)
  copy.appendChild(el('p', 'challenge-hero-note', label('先发现第一张欠条，再决定是否加入。', 'Find your first debt first, then decide.')))
  hero.appendChild(copy)

  const visual = el('figure', 'challenge-hero-visual')
  const img = el('img', 'challenge-mascot') as HTMLImageElement
  img.src = 'assets/challenge/cloud-mascot-hero.jpg'
  img.alt = label('黑云正在纸上写下一张认知欠条', 'The MindIOU cloud writing a cognitive-debt note on paper')
  img.width = 1024
  img.height = 1024
  img.loading = 'lazy'
  visual.appendChild(img)
  visual.appendChild(el('figcaption', 'challenge-mascot-caption', label('AI 可以替你完成工作，但理解不能永远外包。', 'AI can do the work for you, but understanding cannot be outsourced forever.')))
  hero.appendChild(visual)
  page.appendChild(hero)
}

// ── 问题说明 ──
function renderProblem(page: HTMLElement): void {
  const section = el('section', 'challenge-section')
  section.appendChild(el('p', 'challenge-section-index', label('为什么需要这场挑战', 'Why this challenge exists')))
  section.appendChild(el('h2', 'challenge-section-title', label('AI 完成了，不等于你掌握了', 'AI finished it. That does not mean you learned it.')))
  const grid = el('div', 'challenge-note-grid')
  ;[
    [label('你无法解释它', 'You cannot explain it'), label('方案能跑，但别人问「为什么这样做」时，你答不上来。', 'The solution works, but you cannot answer "why this way".')],
    [label('你无法验证它', 'You cannot verify it'), label('AI 给的答案看起来都对，你没有判断它对不对的依据。', 'AI answers all look right; you have no way to check them.')],
    [label('你无法迁移它', 'You cannot transfer it'), label('换一个场景就要重新求助 AI，同样的理解反复外包。', 'A new scenario means asking AI again—the same understanding stays outsourced.')]
  ].forEach(([title, desc]) => {
    const note = pencilNote('')
    note.appendChild(el('h3', 'challenge-note-title', title))
    note.appendChild(el('p', 'challenge-note-desc', desc))
    grid.appendChild(note)
  })
  section.appendChild(grid)
  section.appendChild(el('p', 'challenge-callout', label('这些被跳过的理解，就是「认知欠条」。欠条不会消失，只会在关键时刻到期。', 'These skipped pieces of understanding are cognitive debts. They never disappear—they just come due at critical moments.')))
  page.appendChild(section)
}

// ── 产品工作方式 ──
function renderMethod(page: HTMLElement): void {
  const section = el('section', 'challenge-section')
  section.appendChild(el('p', 'challenge-section-index', label('它如何工作', 'How it works')))
  section.appendChild(el('h2', 'challenge-section-title', label('把欠条一笔笔清偿成能力', 'Repay each debt into real ability')))
  const flow = el('ol', 'challenge-flow')
  const steps = [
    label('AI 输出', 'AI output'),
    label('发现欠条', 'Find the debt'),
    label('费曼解释', 'Feynman explanation'),
    label('延迟回忆', 'Delayed recall'),
    label('误区识别', 'Misconception check'),
    label('场景迁移', 'Scenario transfer'),
    label('真实掌握', 'Real mastery')
  ]
  steps.forEach((step, index) => {
    flow.appendChild(el('li', 'challenge-flow-step', step))
    if (index < steps.length - 1) flow.appendChild(el('li', 'challenge-flow-arrow', '→'))
  })
  section.appendChild(flow)
  section.appendChild(el('p', 'challenge-section-copy', label('我们不反对使用 AI。相反，我们希望你可以更大胆地使用 AI，同时知道哪些事情已经真正掌握，哪些理解只是暂时交给了 AI。', 'We are not against using AI. We want you to use it more boldly—while knowing what you truly master and what is only temporarily lent to AI.')))
  page.appendChild(section)
}

// ── 7 天流程 ──
function renderSevenDays(page: HTMLElement): void {
  const section = el('section', 'challenge-section')
  section.appendChild(el('p', 'challenge-section-index', label('7 天节奏', 'The 7-day rhythm')))
  section.appendChild(el('h2', 'challenge-section-title', label('每天一件真实的清债任务', 'One real repayment task per day')))
  const days: Array<[string, string, string]> = [
    ['Day 1', label('建立清债档案', 'Open your debt file'), label('导入一段真实 AI 对话，识别认知欠条，完成首次补偿训练。', 'Import a real AI conversation, identify debts, and complete your first repayment exercise.')],
    ['Day 2', label('第二张认知欠条', 'A second debt'), label('处理另一个高价值问题，记录你使用了多少提示。', 'Work through another high-value problem and record how many hints you needed.')],
    ['Day 3', label('延迟回忆', 'Delayed recall'), label('隐藏原始材料，凭自己的理解重新解释一遍。', 'Hide the source material and explain it again from your own understanding.')],
    ['Day 4', label('误区识别', 'Misconception check'), label('审阅一段有错误或边界问题的解释，把错误找出来。', 'Review an explanation that contains errors or boundary issues and find them.')],
    ['Day 5', label('场景迁移', 'Scenario transfer'), label('把这笔理解用到一个新的任务场景里。', 'Apply the understanding to a new task scenario.')],
    ['Day 6', label('真实工作验证', 'Real-work validation'), label('回到自己的代码、方案或项目，解释为什么这样做，提交真实证据。', 'Return to your own code, plan, or project; explain the reasoning and submit real evidence.')],
    ['Day 7', label('结营清算', 'Final settlement'), label('生成个人结营报告：掌握度变化、已清偿与待继续的欠条、完赛等级与奖励。', 'Generate your final report: mastery changes, repaid and outstanding debts, completion level, and rewards.')]
  ]
  const timeline = el('ol', 'challenge-days')
  days.forEach(([day, title, desc]) => {
    const item = el('li', 'challenge-day')
    item.appendChild(el('span', 'challenge-day-badge', day))
    const body = el('div', 'challenge-day-body')
    body.appendChild(el('h3', 'challenge-day-title', title))
    body.appendChild(el('p', 'challenge-day-desc', desc))
    item.appendChild(body)
    timeline.appendChild(item)
  })
  section.appendChild(timeline)
  section.appendChild(el('p', 'challenge-section-copy', label('激活后立即进入你的 Day 1。每个人的 7 天单独计算，不要求所有人同一天开始。', 'Your Day 1 starts the moment you activate. Every 7-day cycle is personal—no synchronized start.')))
  page.appendChild(section)
}

// ── 完赛条件 ──
function renderCompletion(page: HTMLElement): void {
  const section = el('section', 'challenge-section')
  section.appendChild(el('p', 'challenge-section-index', label('基础完赛条件', 'Base completion requirements')))
  section.appendChild(el('h2', 'challenge-section-title', label('不是签到，是真实训练', 'Real training—not a check-in streak')))
  const list = el('ul', 'challenge-check-list')
  ;[
    label('在自己的 7 天周期内，至少 5 个不同自然日完成有效训练', 'Complete valid training on at least 5 different days within your 7-day cycle'),
    label('完成至少 3 张认知欠条的有效训练', 'Complete valid training on at least 3 cognitive debts'),
    label('完成至少 1 次延迟回忆', 'Pass at least 1 delayed-recall exercise'),
    label('完成至少 1 次误区识别、场景迁移或错误识别', 'Pass at least 1 misconception-check, scenario-transfer, or error-detection exercise'),
    label('成功生成个人结营报告', 'Generate your personal final report'),
    label('没有明显无效回答或刷任务行为', 'No invalid answers or task farming')
  ].forEach(item => list.appendChild(el('li', '', item)))
  section.appendChild(list)
  section.appendChild(el('p', 'challenge-callout', label('这不是连续签到活动。允许漏掉最多 2 天，系统根据真实训练记录和掌握度变化判断完赛。', 'This is not a streak challenge. You may miss up to 2 days; completion is judged from real training records and mastery changes.')))
  page.appendChild(section)
}

// ── 优秀完赛条件 ──
function renderExcellence(page: HTMLElement): void {
  const section = el('section', 'challenge-section')
  section.appendChild(el('p', 'challenge-section-index', label('优秀完赛条件', 'Excellence requirements')))
  section.appendChild(el('h2', 'challenge-section-title', label('基础完赛之后，五项再达成两项', 'After base completion, meet any 2 of 5')))
  const grid = el('div', 'challenge-excel-grid')
  ;[
    [label('高完整度训练', 'High completeness'), label('至少 6 个自然日有效训练，完成不少于 4 张认知欠条。', 'Valid training on 6+ days and at least 4 cognitive debts.')],
    [label('独立回忆达标', 'Independent recall'), label('至少一张欠条在低提示等级下通过延迟回忆。', 'Pass delayed recall on at least one debt with minimal hints.')],
    [label('场景迁移达标', 'Transfer achieved'), label('至少一张欠条通过场景迁移或错误识别。', 'Pass scenario transfer or error detection on at least one debt.')],
    [label('掌握度明显提升', 'Visible mastery gain'), label('一张欠条综合掌握度提升 ≥ 15 分，或两个维度各提升 ≥ 15 分。', 'One debt gains ≥ 15 mastery points, or two dimensions each gain ≥ 15.')],
    [label('真实工作验证', 'Real-work validation'), label('在自己的项目中完成一次验证并提交真实证据。', 'Complete one validation in your own project with real evidence.')]
  ].forEach(([title, desc]) => {
    const note = pencilNote('challenge-note-small')
    note.appendChild(el('h3', 'challenge-note-title', title))
    note.appendChild(el('p', 'challenge-note-desc', desc))
    grid.appendChild(note)
  })
  section.appendChild(grid)
  page.appendChild(section)
}

// ── 奖励展示 ──
function renderRewards(page: HTMLElement): void {
  const section = el('section', 'challenge-section')
  section.appendChild(el('p', 'challenge-section-index', label('奖励', 'Rewards')))
  section.appendChild(el('h2', 'challenge-section-title', label('完成真实训练，领取对应奖励', 'Finish real training, unlock the matching rewards')))
  const grid = el('div', 'challenge-reward-grid')
  const groups: Array<[string, string[], string, string?]> = [
    [
      label('基础完赛奖励', 'Base completion rewards'),
      [
        label('001 期编号数字证书', 'Numbered Cohort 001 digital certificate'),
        label('个人认知清债结营报告', 'Personal final cognitive-debt report'),
        label('001 期完赛者数字标识', 'Cohort 001 finisher badge'),
        label('编号认知销账卡', 'Numbered debt-settlement card'),
        label('10 元 Vibe Coding 工具金', '¥10 Vibe-Coding tool credit'),
        label('后续会员抵扣权益', 'Future membership credit')
      ],
      label('完赛必得', 'Guaranteed on completion')
    ],
    [
      label('优秀完赛奖励', 'Excellence rewards'),
      [
        label('「优秀清偿者」数字标识', 'Distinguished Repayer badge'),
        label('额外 10 元工具金', 'Additional ¥10 tool credit'),
        label('优秀版数字证书', 'Excellence-edition certificate'),
        label('新功能优先体验', 'Early access to new features'),
        label('下一期活动折扣或免费资格', 'Discount or free seat for the next cohort')
      ],
      label('优秀必得', 'Guaranteed on excellence'),
      label('开发工具等实体奖品为抽奖资格，不是所有优秀者必得。', 'Physical dev-tool prizes are raffle entries, not guaranteed for every excellence finisher.')
    ],
    [
      label('自愿分享奖励', 'Voluntary sharing rewards'),
      [
        label('一条有效小红书或抖音分享：+5 元工具金（累计上限 10 元）', '+¥5 tool credit per valid Xiaohongshu or Douyin post (capped at ¥10)'),
        label('「001 期共创者」数字标识', 'Cohort 001 Co-creator badge'),
        label('官方共创档案收录与转发机会', 'Inclusion in the official archive and repost opportunities')
      ],
      label('完全自愿', 'Completely voluntary'),
      label('分享不影响完赛等级；我们不要求好评，也不要求复制统一文案。', 'Sharing never affects completion level. We do not ask for positive reviews or scripted copy.')
    ]
  ]
  groups.forEach(([title, items, tag, note]) => {
    const card = el('article', 'challenge-reward-card')
    card.appendChild(el('span', 'challenge-reward-tag', tag))
    card.appendChild(el('h3', 'challenge-reward-title', title))
    const list = el('ul', 'challenge-reward-list')
    items.forEach(item => list.appendChild(el('li', '', item)))
    card.appendChild(list)
    if (note) card.appendChild(el('p', 'challenge-reward-note', note))
    grid.appendChild(card)
  })
  section.appendChild(grid)
  page.appendChild(section)
}

// ── 报名费用与兑换 ──
function renderJoin(page: HTMLElement): void {
  const section = el('section', 'challenge-section challenge-join')
  section.id = 'challenge-join'
  section.appendChild(el('p', 'challenge-section-index', label('报名', 'Join')))
  section.appendChild(el('h2', 'challenge-section-title', label('001 期报名', 'Join Cohort 001')))

  const card = el('article', 'challenge-price-card')
  card.appendChild(el('span', 'challenge-price-label', label('首期价格', 'First-cohort price')))
  card.appendChild(el('strong', 'challenge-price-value', CHALLENGE.priceDisplay))
  card.appendChild(el('p', 'challenge-price-desc', label('包含：20 天开放期内任意时间激活 + 个人 7 天完整训练周期 + 结营报告与完赛奖励资格。', 'Includes: activate anytime within the 20-day window, a personal 7-day training cycle, final report, and reward eligibility.')))

  const actions = el('div', 'challenge-join-actions')
  if (CHALLENGE.afdianUrl) {
    const buy = el('a', 'challenge-btn challenge-btn-primary', label(`支付 ${CHALLENGE.priceDisplay}，获取挑战密钥`, `Pay ${CHALLENGE.priceDisplay} for your challenge key`)) as HTMLAnchorElement
    buy.href = CHALLENGE.afdianUrl
    buy.target = '_blank'
    buy.rel = 'noopener noreferrer'
    actions.appendChild(buy)
  } else {
    const buy = el('button', 'challenge-btn challenge-btn-primary', label(`支付 ${CHALLENGE.priceDisplay}，获取挑战密钥`, `Pay ${CHALLENGE.priceDisplay} for your challenge key`)) as HTMLButtonElement
    buy.disabled = true
    actions.appendChild(buy)
    actions.appendChild(el('p', 'challenge-join-note', label('爱发电购买通道即将开放。可先免费完成 AI 协作测试，开放后凭订单中的激活码兑换。', 'The Afdian checkout opens soon. Try the free AI collaboration test first; redeem the activation code from your order once open.')))
  }
  const redeem = el('button', 'challenge-btn challenge-btn-ghost', label('我已购买，兑换挑战密钥', 'I have purchased—redeem my key')) as HTMLButtonElement
  redeem.disabled = true
  actions.appendChild(redeem)
  actions.appendChild(el('p', 'challenge-join-note', label('激活码兑换功能即将开放，格式形如 MIOU-001-XXXX-XXXX-XXXX。请保留好爱发电订单中的激活码。', 'Code redemption opens soon. Codes look like MIOU-001-XXXX-XXXX-XXXX—keep the code from your Afdian order.')))
  card.appendChild(actions)

  const rules = el('ul', 'challenge-join-rules')
  ;[
    label('报名费不是押金，用于支持产品持续开发。', 'The fee is not a deposit—it supports continued product development.'),
    label('未完成挑战不退报名费，也不发完赛奖励。', 'No refund and no completion rewards if you do not finish.'),
    label('激活后 7 天挑战立即开始，不能主动重置 Day 1。', 'Your 7-day challenge starts immediately upon activation and cannot be reset.'),
    label('激活码只能成功兑换一次，首期退款由人工处理。', 'Each code redeems once only; refunds are handled manually in this first cohort.')
  ].forEach(rule => rules.appendChild(el('li', '', rule)))
  card.appendChild(rules)
  section.appendChild(card)
  page.appendChild(section)
}

// ── 常见问题 ──
function renderFaq(page: HTMLElement): void {
  const section = el('section', 'challenge-section')
  section.appendChild(el('p', 'challenge-section-index', label('常见问题', 'FAQ')))
  section.appendChild(el('h2', 'challenge-section-title', label('你可能想问', 'You might be wondering')))
  const faqs: Array<[string, string]> = [
    [label('需要每天连续训练吗？', 'Do I have to train every single day?'), label('不需要。7 天周期内累计 5 个自然日完成有效训练即可，允许漏掉最多 2 天。', 'No. You need valid training on 5 different days within your 7-day cycle—you may miss up to 2 days.')],
    [label('需要会编程吗？', 'Do I need to know how to code?'), label('不需要。任何你借助 AI 完成的工作材料都可以：代码、方案、研究、内容创作。', 'No. Any AI-assisted work counts: code, plans, research, or content creation.')],
    [label('可以使用什么 AI 对话？', 'Which AI conversations can I use?'), label('任何真实的 AI 协作内容，例如 ChatGPT、Claude 或其他工具的对话与产出。', 'Any real AI-assisted material—ChatGPT, Claude, or other tool conversations and outputs.')],
    [label('一定要公开分享吗？', 'Do I have to share publicly?'), label('完全自愿。分享不影响完赛等级，也不要求好评或统一文案。', 'Completely voluntary. Sharing never affects completion and we never require positive reviews or scripted copy.')],
    [label('实体奖励什么时候发？', 'When are physical rewards shipped?'), label('完赛审核通过后由运营人工发放，邮寄地址仅在奖励解锁后收集。', 'After completion review, rewards are issued manually. Shipping addresses are collected only after rewards unlock.')],
    [label('激活码在哪里看？', 'Where do I find my activation code?'), label('在爱发电完成购买后，系统会随订单自动发放唯一激活码。', 'After purchase on Afdian, a unique activation code is issued automatically with your order.')],
    [label('购买后没有收到码怎么办？', 'What if I paid but received no code?'), label('首期由人工处理订单异常，请联系客服并提供爱发电订单证明。', 'Order issues are handled manually in this cohort—contact support with your Afdian order proof.')],
    [label('能否退款？', 'Can I get a refund?'), label('首期退款由人工处理。未完成挑战不退报名费；系统故障导致的中断会补偿有效期。', 'Refunds are manual in this cohort. No refund for unfinished challenges; system-caused interruptions are compensated with time.')],
    [label('我的数据会被公开吗？', 'Will my data be made public?'), label('不会。原始对话与代码不公开展示；分享素材默认隐藏隐私字段，公开范围由你选择。', 'No. Original conversations and code are never shown publicly. Share materials hide private fields by default, and you choose what to publish.')]
  ]
  const list = el('div', 'challenge-faq-list')
  faqs.forEach(([q, a]) => {
    const item = el('details', 'challenge-faq')
    item.appendChild(el('summary', 'challenge-faq-q', q))
    item.appendChild(el('p', 'challenge-faq-a', a))
    list.appendChild(item)
  })
  section.appendChild(list)
  page.appendChild(section)
}

// ── 底部行动 ──
function renderFinalCta(page: HTMLElement): void {
  const section = el('section', 'challenge-section challenge-final')
  section.appendChild(el('h2', 'challenge-section-title', label('先看见自己的欠条，再决定要不要清。', 'See your debts first. Then decide whether to clear them.')))
  const primary = el('button', 'challenge-btn challenge-btn-primary', label('免费发现第一张认知欠条', 'Find my first cognitive debt—free'))
  primary.onclick = () => navigate({ name: 'login' })
  section.appendChild(primary)
  page.appendChild(section)
}

export function renderChallengePage(root: HTMLElement): void {
  root.replaceChildren()
  const page = el('div', 'page page-challenge')
  renderChallengeHeader(page)
  renderHero(page)
  renderProblem(page)
  renderMethod(page)
  renderSevenDays(page)
  renderCompletion(page)
  renderExcellence(page)
  renderRewards(page)
  renderJoin(page)
  renderFaq(page)
  renderFinalCta(page)
  page.appendChild(renderSiteFooter())
  root.appendChild(page)
}
