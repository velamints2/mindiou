import { getAccessToken } from './api'
import { t } from './i18n'
import { el, navigate, type Route } from './router'

const publicHeaderRoutes = new Set<Route['name']>(['landing', 'how-it-works', 'challenge'])

export function renderPersistentNavigation(route: Route): void {
  document.querySelector('.persistent-site-navigation')?.remove()
  document.body.classList.remove('has-persistent-navigation')
  if (route.name === 'admin' || publicHeaderRoutes.has(route.name)) return

  const shell = el('div', 'persistent-site-navigation')
  shell.setAttribute('aria-label', t('全站导航', 'Site navigation'))
  const controls = el('div', 'site-header-controls')
  const nav = el('nav', 'site-nav')

  const links: Array<[string, string, string, Route['name']]> = [
    ['#/', t('首页', 'Home'), 'landing', 'landing'],
    ['#/how-it-works', t('原理', 'How it works'), 'how-it-works', 'how-it-works'],
    ['#/genesis', t('创始档案', 'Genesis archive'), 'genesis', 'genesis'],
    ['#/projects', t('项目记忆', 'Project memory'), 'projects', 'projects'],
    ['#/profile', t('能力画像', 'Capability profile'), 'profile', 'profile']
  ]
  links.forEach(([href, label, _key, routeName]) => {
    const link = el('a', `site-nav-link ${route.name === routeName ? 'is-active' : ''}`, label) as HTMLAnchorElement
    link.href = href
    nav.appendChild(link)
  })

  const cta = el('button', 'btn btn-primary btn-sm persistent-site-cta', getAccessToken()
    ? t('进入工作区', 'Workspace')
    : t('开始体验', 'Get started'))
  cta.onclick = () => navigate(getAccessToken() ? { name: 'app' } : { name: 'login' })
  controls.append(nav, cta)
  shell.appendChild(controls)
  document.body.appendChild(shell)
  document.body.classList.add('has-persistent-navigation')
}

export function renderSiteFooter(): HTMLElement {
  const footer = el('footer', 'site-footer')
  footer.appendChild(el('div', 'footer-brand', 'MindIOU'))
  footer.appendChild(el('p', 'footer-tagline', t('把 AI 代劳转化为真实能力成长', 'Turn delegated AI work into real ability growth')))

  const links = el('nav', 'footer-links')
  links.setAttribute('aria-label', t('页脚导航', 'Footer navigation'))
  ;[
    ['#/', t('首页', 'Home')],
    ['#/how-it-works', t('原理', 'How it works')],
    ['#/genesis', t('创始档案', 'Genesis archive')],
    ['#/assessment', t('认知债务测试', 'AI collaboration test')],
    ['#/challenge/001', t('001 期挑战', 'Cohort 001 challenge')],
    ['#/app', getAccessToken() ? t('进入工作区', 'Open dashboard') : t('开始体验', 'Get started')]
  ].forEach(([href, label]) => {
    const link = el('a', 'footer-link', label) as HTMLAnchorElement
    link.href = href
    links.appendChild(link)
  })
  footer.appendChild(links)
  footer.appendChild(el('p', 'footer-copy', '© MindIOU'))
  return footer
}
