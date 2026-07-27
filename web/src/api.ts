// MindIOU 面向用户 Web 端 — API 客户端封装
// 直接调用现有后端 server.js，不引入新依赖、不改后端。
// 鉴权：用户输入邀请码后，由后端签发 HttpOnly Cookie。
// 浏览器只保存“已建立会话”的本地标记，不保存邀请码或服务端会话内容。

import type {
  ApiResult,
  ClearanceReport,
  ClearanceSession,
  Confusion,
  CreateSessionResponse,
  Draft,
  EndSessionResponse,
  GenerateReportRequest,
  GenerateReportResponse,
  GenerateTimelineResponse,
  SubmitAnswerResponse,
  SubmitCardAnswerResponse
} from './types'

// ── API 基址 ──
// 与现有 reportApp.ts / mvp1App.ts 一致：
//   公网部署（路径以 /mindiou/ 开头）→ /mindiou-api 由 Nginx 反代
//   本地开发 → 可用 ?api=http://host:8793 覆盖，默认同源
const runtimeParams = new URLSearchParams(location.search)
const isPublicDeployment = location.pathname.startsWith('/mindiou/')
export const API_BASE = isPublicDeployment ? '/mindiou-api' : runtimeParams.get('api') || ''

// ── 访问会话标记 ──
const SESSION_MARKER_KEY = 'mindiou_access_session'
const LEGACY_TOKEN_KEY = 'mindiou_access_token'

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(SESSION_MARKER_KEY)
  } catch {
    return null
  }
}

export function setAccessToken(_token: string): void {
  try {
    localStorage.setItem(SESSION_MARKER_KEY, 'active')
    // 清除旧版曾保存的邀请码，避免敏感信息继续留在浏览器。
    localStorage.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

export function clearAccessToken(): void {
  try {
    localStorage.removeItem(SESSION_MARKER_KEY)
    localStorage.removeItem(LEGACY_TOKEN_KEY)
  } catch {
    /* 同上 */
  }
}

// ── 请求封装 ──

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(options.headers as Record<string, string> | undefined)
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'same-origin'
    })
  } catch (e) {
    throw new ApiError(0, '网络连接失败，请检查网络或后端服务是否可用')
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { ok: false, error: text }
    }
  }

  if (!res.ok) {
    const msg =
      (data as { error?: string })?.error ||
      (data as { message?: string })?.message ||
      `请求失败（${res.status}）`
    throw new ApiError(res.status, msg)
  }

  return data as T
}

// ── 健康检查 ──

export async function checkHealth(): Promise<boolean> {
  try {
    await apiFetch<{ ok?: boolean }>(`/health`)
    return true
  } catch {
    return false
  }
}

// ── 邀请码校验 ──
// 当前 Web 鉴权使用服务端签名的 HttpOnly Cookie；设备端 Bearer Token 不进入 Web。
export async function checkAccessSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/access/session`, {
      credentials: 'same-origin'
    })
    return res.ok
  } catch {
    return false
  }
}

export async function validateAccessToken(token: string): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/access/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ code: token })
    })
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络或后端服务是否可用')
  }

  if (res.ok) return true
  if (res.status === 401) return false

  // 后端未启用邀请码时，受保护接口会直接开放；用会话接口确认，而不是伪造登录。
  if ([404, 405, 503].includes(res.status) && await checkAccessSession()) return true

  const data = await res.json().catch(() => null) as { error?: string } | null
  throw new ApiError(res.status, data?.error || `登录失败（${res.status}）`)
}

export async function logoutAccess(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/access/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({})
    })
  } finally {
    clearAccessToken()
  }
}

// ── 核心闭环接口 ──

/** 三段式·第一段进入第二段：生成协作时间线草稿 */
export async function generateTimeline(
  artifactText: string,
  artifactType?: string
): Promise<GenerateTimelineResponse> {
  return apiFetch<GenerateTimelineResponse>('/api/mvp0/timelines', {
    method: 'POST',
    body: JSON.stringify({ artifactText, artifactType })
  })
}

/** 三段式·第二段：保存用户在步骤上标注的困惑 */
export async function saveDraftConfusions(
  draftId: string,
  confusions: Confusion[]
): Promise<ApiResult<{ draft: Draft }>> {
  return apiFetch<ApiResult<{ draft: Draft }>>(
    `/api/mvp0/drafts/${encodeURIComponent(draftId)}`,
    { method: 'PATCH', body: JSON.stringify({ confusions }) }
  )
}

/** 三段式·草稿恢复：获取草稿详情 */
export async function fetchDraft(draftId: string): Promise<ApiResult<{ draft: Draft }>> {
  return apiFetch<ApiResult<{ draft: Draft }>>(
    `/api/mvp0/drafts/${encodeURIComponent(draftId)}`
  )
}

/** 三段式·第三段：生成六部分认知债务报告（支持 draftId 三段式路径与直连路径） */
export async function generateReport(
  req: GenerateReportRequest
): Promise<GenerateReportResponse> {
  return apiFetch<GenerateReportResponse>('/api/mvp0/report', {
    method: 'POST',
    body: JSON.stringify(req)
  })
}

/** 获取报告详情 */
export async function fetchReport(reportId: string): Promise<ApiResult<{ report: ClearanceReport }>> {
  return apiFetch(`/api/mvp0/reports/${encodeURIComponent(reportId)}`)
}

/** MVP-0 卡片轻量追问（可选路径） */
export async function submitCardAnswer(
  reportId: string,
  cardId: string,
  answer: string
): Promise<SubmitCardAnswerResponse> {
  return apiFetch<SubmitCardAnswerResponse>(
    `/api/mvp0/reports/${encodeURIComponent(reportId)}/cards/${encodeURIComponent(cardId)}/answer`,
    { method: 'POST', body: JSON.stringify({ answer }) }
  )
}

/** 启动 MVP-1 深度清偿会话 */
export async function createSession(
  reportId: string,
  cardId: string
): Promise<CreateSessionResponse> {
  return apiFetch<CreateSessionResponse>('/api/mvp1/sessions', {
    method: 'POST',
    body: JSON.stringify({ reportId, cardId })
  })
}

/** 获取会话最新状态（首次回答前 scaffold 被后端剥离） */
export async function fetchSession(sessionId: string): Promise<ApiResult<{ session: ClearanceSession }>> {
  return apiFetch(`/api/mvp1/sessions/${encodeURIComponent(sessionId)}`)
}

/** 提交用户解释 + 获取 AI 反馈 */
export async function submitAnswer(
  sessionId: string,
  answer: string
): Promise<SubmitAnswerResponse> {
  return apiFetch<SubmitAnswerResponse>(
    `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/answers`,
    { method: 'POST', body: JSON.stringify({ answer }) }
  )
}

/** 结束会话 + 获取最终清偿状态（暴露 scaffold） */
export async function endSession(sessionId: string): Promise<EndSessionResponse> {
  return apiFetch<EndSessionResponse>(
    `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/end`,
    { method: 'POST', body: JSON.stringify({}) }
  )
}
