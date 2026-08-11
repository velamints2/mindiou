import { ApiError, getRepaymentProfile } from './api'
import type { RepaymentProfile, RepaymentProfileDimension } from './types'
import { el, navigate } from './router'
import { t } from './i18n'

const DIMENSION_LABELS: Record<string, string> = {
  conceptualUnderstanding: '概念理解',
  causalExplanation: '因果解释',
  practicalReproduction: '实践复现',
  boundariesAndRisks: '边界与风险',
  transferAbility: '迁移能力'
}

const LEVEL_LABELS: Record<string, string> = {
  L1: 'L1 · 起步：能够识别主题，但还不能稳定解释',
  L2: 'L2 · 基础：能够独立解释核心概念和因果',
  L3: 'L3 · 进阶：能够识别错误、边界和风险',
  L4: 'L4 · 迁移：能够把理解迁移到相近的新场景',
  L5: 'L5 · 负责：能够在真实项目中独立修改、验证并负责',
  E0: 'E0 · 只有 AI 产出',
  E1: 'E1 · 阅读或接受',
  E2: 'E2 · 能够解释',
  E3: 'E3 · 能够识别边界',
  E4: 'E4 · 能够迁移',
  E5: 'E5 · 能够独立负责'
}

const LEVEL_DESCRIPTIONS: [string, string][] = [
  ['L1', '知道这个主题存在，但需要提示才能说明它为什么成立。'],
  ['L2', '能够用自己的话解释主要概念和因果关系。'],
  ['L3', '能够指出错误实现、边界条件和潜在风险。'],
  ['L4', '能够把原来的理解迁移到新的问题或场景。'],
  ['L5', '能够在真实项目中独立修改、验证并承担结果；需要 E5 真实工作证据，不能由分数或自评直接生成。']
]

function levelLabel(level?: string): string {
  return LEVEL_LABELS[level || ''] || level || '尚未分级'
}

function message(error: unknown): string {
  if (error instanceof ApiError && [429, 503].includes(error.status)) {
    return '请求暂时受到保护，请稍后再试。系统保留了限流保护，避免重复点击造成更多失败。'
  }
  return error instanceof Error ? error.message : '用户画像加载失败，请稍后重试。'
}

function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function dimensionCard(name: string, dimension: RepaymentProfileDimension): HTMLElement {
  const card = el('article', 'profile-dimension-card')
  const score = Math.max(0, Math.min(100, Number(dimension.score || 0)))
  const head = el('div', 'profile-dimension-head')
  head.appendChild(el('h3', 'profile-dimension-title', DIMENSION_LABELS[name] || name))
  head.appendChild(el('strong', 'profile-dimension-score', `${score}${t(' 分', ' points')}`))
  card.appendChild(head)
  const meter = el('div', 'profile-meter')
  const fill = el('span', 'profile-meter-fill')
  fill.style.width = `${score}%`
  meter.appendChild(fill)
  card.appendChild(meter)
  const meta = el('div', 'profile-dimension-meta')
  meta.appendChild(el('span', 'profile-badge', levelLabel(dimension.level)))
  if (dimension.stability) meta.appendChild(el('span', 'profile-muted', `稳定性：${dimension.stability}`))
  card.appendChild(meta)
  card.appendChild(el('p', 'profile-dimension-updated', `最近更新：${formatDate(dimension.updatedAt)}`))
  return card
}

function profileCard(profile: RepaymentProfile): HTMLElement {
  const section = el('section', 'profile-domain-card')
  const header = el('div', 'profile-domain-head')
  header.appendChild(el('div', undefined, `能力领域 · ${profile.domain || '通用'}`))
  header.appendChild(el('small', 'profile-muted', `更新于 ${formatDate(profile.updatedAt)}`))
  section.appendChild(header)
  const grid = el('div', 'profile-dimension-grid')
  Object.entries(profile.dimensions || {}).forEach(([name, dimension]) => {
    grid.appendChild(dimensionCard(name, dimension))
  })
  if (!grid.childElementCount) grid.appendChild(el('p', 'profile-muted', '这个领域还没有足够的分维度证据。'))
  section.appendChild(grid)
  return section
}

export async function renderProfilePage(root: HTMLElement): Promise<void> {
  const page = el('div', 'page page-profile')
  const header = el('header', 'page-header profile-page-header')
  const heading = el('div')
  heading.appendChild(el('p', 'dashboard-kicker', 'HUMAN OWNERSHIP'))
  heading.appendChild(el('h1', 'page-title', '用户画像'))
  heading.appendChild(el('p', 'profile-subtitle', '这里记录你对认知欠条的真实能力证据，不把“测试通过”直接等同于掌握。'))
  header.appendChild(heading)
  const actions = el('div', 'header-actions')
  const repayment = el('button', 'btn btn-ghost btn-sm', '去做认知清偿')
  repayment.onclick = () => navigate({ name: 'repayment' })
  const back = el('button', 'btn btn-ghost btn-sm', '返回工作区')
  back.onclick = () => navigate({ name: 'app' })
  actions.append(repayment, back)
  header.appendChild(actions)
  page.appendChild(header)

  const content = el('main', 'profile-main')
  content.appendChild(el('p', 'loading', '正在加载用户画像…'))
  page.appendChild(content)
  root.appendChild(page)

  try {
    const result = await getRepaymentProfile()
    content.replaceChildren()
    const profiles = result.profiles || []
    const overview = el('section', 'profile-overview-card')
    const metrics = el('div', 'profile-metric-grid')
    const metric = (value: string, label: string): void => {
      const item = el('article', 'profile-metric-card')
      item.append(el('strong', 'profile-metric-value', value), el('span', 'profile-metric-label', label))
      metrics.appendChild(item)
    }
    metric(String(profiles.length), '已建立的能力领域')
    metric(String(profiles.reduce((total, profile) => total + Object.keys(profile.dimensions || {}).length, 0)), '已记录的能力维度')
    metric(profiles.length ? '持续更新' : '待开始', '画像状态')
    overview.appendChild(metrics)
    overview.appendChild(el('p', 'profile-explanation', '能力领域按认知报告中的主题归档；没有明确领域的记录会进入“通用”。每个领域最多记录 5 个固定维度，不是只能记录 5 种能力：新的技术主题会形成新的领域记录。分数由作答证据持续更新，测试通过不会直接变成真实项目所有权。'))
    const levelGuide = el('section', 'profile-level-guide')
    levelGuide.appendChild(el('h2', 'profile-section-title', '等级在能力路径中的位置'))
    const levelGrid = el('div', 'profile-level-grid')
    LEVEL_DESCRIPTIONS.forEach(([level, description]) => {
      const item = el('article', 'profile-level-card')
      item.appendChild(el('strong', undefined, levelLabel(level)))
      item.appendChild(el('p', undefined, description))
      levelGrid.appendChild(item)
    })
    levelGuide.appendChild(levelGrid)
    overview.appendChild(levelGuide)
    content.appendChild(overview)

    if (profiles.length === 0) {
      const empty = el('section', 'profile-empty-card')
      empty.appendChild(el('h2', 'profile-empty-title', '还没有形成能力画像'))
      empty.appendChild(el('p', 'profile-empty-desc', result.note || '完成一笔认知清偿作答后，系统会从实际证据开始建立你的能力变化记录。'))
      const action = el('button', 'btn btn-primary', '查看待清偿欠条')
      action.onclick = () => navigate({ name: 'repayment' })
      empty.appendChild(action)
      content.appendChild(empty)
      return
    }

    const title = el('div', 'profile-section-heading')
    title.appendChild(el('h2', undefined, '能力维度'))
    title.appendChild(el('p', undefined, '每一项都显示当前分数、证据等级和最近更新时间。'))
    content.appendChild(title)
    profiles.forEach(profile => content.appendChild(profileCard(profile)))
  } catch (error) {
    content.replaceChildren()
    const box = el('section', 'profile-error-card')
    box.appendChild(el('p', undefined, message(error)))
    const retry = el('button', 'btn btn-ghost btn-sm', '重试')
    retry.onclick = () => {
      root.replaceChildren()
      void renderProfilePage(root)
    }
    box.appendChild(retry)
    content.appendChild(box)
  }
}
