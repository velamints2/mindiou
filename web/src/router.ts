// 极简 hash 路由器。
// 路由格式：#/path，支持参数段。
// 分公开区（landing/how-it-works/register）与产品区（app/report/session/devices）。

export type Route =
  | { name: 'landing' }              // 公开：落地首页
  | { name: 'how-it-works' }         // 公开：产品原理页
  | { name: 'login' }                // 产品区：登录
  | { name: 'register' }             // 公开：注册
  | { name: 'genesis' }              // 公开：001 期永久档案
  | { name: 'assessment' }           // 公开：AI 协作类型测试
  | { name: 'challenge'; slug: string }  // 公开：001 期活动 Landing 页
  | { name: 'app' }                  // 产品区：输入材料（三段式·第一段）
  | { name: 'timeline'; draftId: string }  // 产品区：时间线与困惑标注（三段式·第二段）
  | { name: 'report'; reportId: string }
  | { name: 'session'; sessionId: string }
  | { name: 'devices' }             // 产品区：设备 Token 管理
  | { name: 'admin' }               // 运营后台
  | { name: 'training' }            // 产品区：今日复训
  | { name: 'training-debt'; debtId: string }  // 产品区：认知欠条详情
  | { name: 'repayment' }            // 产品区：认知清偿 V1 列表
  | { name: 'repayment-detail'; gapId: string }  // 产品区：认知清偿欠条详情
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'work-item'; projectId: string; workItemId: string }
  | { name: 'agent-session'; sessionId: string }
  | { name: 'not-found' }

// 判断是否为公开路由（无需登录）
export function isPublicRoute(route: Route): boolean {
  return route.name === 'landing' || route.name === 'how-it-works' || route.name === 'register' || route.name === 'genesis' || route.name === 'assessment' || route.name === 'challenge'
}

export function parseRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '')
  const [path, ...rest] = hash.split('/')

  switch (path) {
    case '':
      return { name: 'landing' }
    case 'how-it-works':
      return { name: 'how-it-works' }
    case 'login':
      return { name: 'login' }
    case 'register':
      return { name: 'register' }
    case 'genesis':
      return { name: 'genesis' }
    case 'assessment':
      return { name: 'assessment' }
    case 'challenge':
      return { name: 'challenge', slug: rest[0] ? decodeURIComponent(rest[0]) : '001' }
    case 'app':
    case 'home':   // 兼容旧路径
      return { name: 'app' }
    case 'timeline':
      return rest[0] ? { name: 'timeline', draftId: decodeURIComponent(rest[0]) } : { name: 'not-found' }
    case 'devices':
      return { name: 'devices' }
    case 'admin':
      return { name: 'admin' }
    case 'report':
      return rest[0] ? { name: 'report', reportId: decodeURIComponent(rest[0]) } : { name: 'not-found' }
    case 'session':
      return rest[0] ? { name: 'session', sessionId: decodeURIComponent(rest[0]) } : { name: 'not-found' }
    case 'training':
      return { name: 'training' }
    case 'training-debt':
      return rest[0] ? { name: 'training-debt', debtId: decodeURIComponent(rest[0]) } : { name: 'not-found' }
    case 'repayment':
      return rest[0] ? { name: 'repayment-detail', gapId: decodeURIComponent(rest[0]) } : { name: 'repayment' }
    case 'projects':
      if (!rest[0]) return { name: 'projects' }
      if (rest[1] === 'work-items' && rest[2]) {
        return { name: 'work-item', projectId: decodeURIComponent(rest[0]), workItemId: decodeURIComponent(rest[2]) }
      }
      return { name: 'project', projectId: decodeURIComponent(rest[0]) }
    case 'agent-sessions':
      return rest[0] ? { name: 'agent-session', sessionId: decodeURIComponent(rest[0]) } : { name: 'not-found' }
    default:
      return { name: 'not-found' }
  }
}

export function navigate(route: Route): void {
  let path = ''
  switch (route.name) {
    case 'landing': path = ''; break
    case 'how-it-works': path = '/how-it-works'; break
    case 'login': path = '/login'; break
    case 'register': path = '/register'; break
    case 'genesis': path = '/genesis'; break
    case 'assessment': path = '/assessment'; break
    case 'challenge': path = `/challenge/${encodeURIComponent(route.slug)}`; break
    case 'app': path = '/app'; break
    case 'timeline': path = `/timeline/${encodeURIComponent(route.draftId)}`; break
    case 'devices': path = '/devices'; break
    case 'admin': path = '/admin'; break
    case 'report': path = `/report/${encodeURIComponent(route.reportId)}`; break
    case 'session': path = `/session/${encodeURIComponent(route.sessionId)}`; break
    case 'training': path = '/training'; break
    case 'training-debt': path = `/training-debt/${encodeURIComponent(route.debtId)}`; break
    case 'repayment': path = '/repayment'; break
    case 'projects': path = '/projects'; break
    case 'project': path = '/projects/' + encodeURIComponent(route.projectId); break
    case 'work-item': path = '/projects/' + encodeURIComponent(route.projectId) + '/work-items/' + encodeURIComponent(route.workItemId); break
    case 'agent-session': path = '/agent-sessions/' + encodeURIComponent(route.sessionId); break
    case 'repayment-detail': path = `/repayment/${encodeURIComponent(route.gapId)}`; break
    case 'not-found': path = '/not-found'; break
  }
  location.hash = path
}

// DOM 工具
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

// 状态持久化（sessionStorage，刷新可恢复）
const REPORT_ID_KEY = 'mindiou_report_id'
const SESSION_ID_KEY = 'mindiou_session_id'
const DRAFT_ID_KEY = 'mindiou_draft_id'

export function rememberReportId(id: string): void {
  sessionStorage.setItem(REPORT_ID_KEY, id)
}
export function recallReportId(): string | null {
  return sessionStorage.getItem(REPORT_ID_KEY)
}
export function rememberDraftId(id: string): void {
  sessionStorage.setItem(DRAFT_ID_KEY, id)
}
export function recallDraftId(): string | null {
  return sessionStorage.getItem(DRAFT_ID_KEY)
}
export function rememberSessionId(id: string): void {
  sessionStorage.setItem(SESSION_ID_KEY, id)
}
export function recallSessionId(): string | null {
  return sessionStorage.getItem(SESSION_ID_KEY)
}
export function forgetSessionId(): void {
  sessionStorage.removeItem(SESSION_ID_KEY)
}
