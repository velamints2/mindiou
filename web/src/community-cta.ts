// 社群入口组件：在 MBAI 测试结果页和 001 期报名页复用。
// 文案与图片保持一致：同一个飞书群，两种定位（交流群 / 活动群）。
import { getLocale } from './i18n'
import { el } from './router'

const label = (zh: string, en: string) => (getLocale() === 'en' ? en : zh)

export type CommunityCtaVariant = 'assessment' | 'challenge'

interface VariantCopy {
  title: string
  desc: string
  button: string
}

function copyFor(variant: CommunityCtaVariant): VariantCopy {
  if (variant === 'assessment') {
    return {
      title: label('加入 MBAI 测试交流群', 'Join the MBAI test community'),
      desc: label(
        '晒出你的测试结果，和其他 Vibe Coder 讨论 AI 协作方式，也可以直接反馈题目和结果。',
        'Share your result, discuss AI collaboration patterns with other Vibe Coders, and give feedback on the questions.'
      ),
      button: label('加入飞书群', 'Join Feishu group')
    }
  }
  return {
    title: label('进入 001 期活动群', 'Join the Cohort 001 group'),
    desc: label(
      '你已加入 MindIOU 001 期。加入活动群，接收每日任务、活动通知和共创进展。',
      'You are in MindIOU Cohort 001. Join the group to receive daily tasks, event updates, and co-build progress.'
    ),
    button: label('进入 001 期活动群', 'Enter Cohort 001 group')
  }
}

// 渲染社群入口板块。variant 决定文案定位。
// 二维码图片位于 public/assets/community/feishu-group.png，构建后映射到 ./assets/community/feishu-group.png。
export function renderCommunityCta(variant: CommunityCtaVariant): HTMLElement {
  const copy = copyFor(variant)
  const section = el('section', 'community-cta')

  const text = el('div', 'community-cta-text')
  text.appendChild(el('h2', 'community-cta-title', copy.title))
  text.appendChild(el('p', 'community-cta-desc', copy.desc))
  // 飞书群目前未配置公开邀请链接，按钮先引导扫码；配置后可改为 a 标签跳转。
  const button = el('button', 'btn btn-primary community-cta-button', copy.button)
  button.onclick = () => {
    const qr = section.querySelector('.community-cta-qr')
    if (qr) qr.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  text.appendChild(button)

  const qrWrap = el('figure', 'community-cta-qr')
  const img = el('img') as HTMLImageElement
  const assetUrl = new URL('./assets/community/feishu-group.png', document.baseURI)
  assetUrl.searchParams.set('v', '20260805')
  img.src = assetUrl.href
  img.alt = label('飞书群二维码', 'Feishu group QR code')
  img.width = 240
  img.height = 240
  img.loading = 'lazy'
  img.decoding = 'async'
  const caption = el('figcaption', 'community-cta-qr-caption', label('扫码加入飞书群', 'Scan to join the Feishu group'))
  qrWrap.append(img, caption)

  section.append(text, qrWrap)
  return section
}
