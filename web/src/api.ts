// MindIOU 面向用户 Web 端 — API 客户端封装
// 直接调用现有后端 server.js，不引入新依赖、不改后端。
// 鉴权：账户体系通过 HttpOnly Cookie 维持会话；前端仅保存"已登录"标记。

import type {
  ApiResult,
  ClearanceReport,
  ClearanceSession,
  Confusion,
  CreateSessionResponse,
  DebtDetailResponse,
  DebtsListResponse,
  Draft,
  EndSessionResponse,
  GenerateReportRequest,
  GenerateReportResponse,
  GenerateTimelineResponse,
  StartReviewResponse,
  SubmitAnswerResponse,
  SubmitCardAnswerResponse,
  SubmitReviewResponse,
  TodayTrainingResponse
} from './types'

// ── API 基址 ──
//   公网部署（路径以 /mindiou/ 开头）→ /mindiou-api 由 Nginx 反代
//   本地开发 → 可用 ?api=http://host:8793 覆盖，默认同源
const runtimeParams = new URLSearchParams(location.search)
const isPublicDeployment = location.pathname.startsWith('/mindiou/')
export const API_BASE = isPublicDeployment ? '/mindiou-api' : runtimeParams.get('api') || ''

// ── 登录标记 ──
// 仅作为"已登录"的本地标记，不存储任何敏感凭据。
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

function defaultErrorMessage(status: number): string {
  if ([502, 503, 504].includes(status)) {
    return '服务暂时不可用，请稍后重试'
  }
  if (status === 500) {
    return '服务处理失败，请稍后重试'
  }
  if (status === 429) {
    return '请求过于频繁，请稍后重试'
  }
  return `请求失败（${status}）`
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
  let isJson = false
  if (text) {
    try {
      data = JSON.parse(text)
      isJson = true
    } catch {
      // 网关可能返回 HTML/text 错误页，绝不能把原始正文暴露到用户界面。
      data = null
    }
  }

  if (!res.ok) {
    const body = isJson && data && typeof data === 'object'
      ? data as { error?: unknown; message?: unknown }
      : null
    const bodyMessage = typeof body?.error === 'string'
      ? body.error.trim()
      : typeof body?.message === 'string'
        ? body.message.trim()
        : ''
    const msg =
      bodyMessage ||
      defaultErrorMessage(res.status)
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

// ── 账户体系：注册/登录/登出/当前用户 ──
// 后端通过 HttpOnly Cookie (session=) 维持会话，前端不保存密码或 session ID。

export type AuthUser = {
  id: string
  email: string
  name?: string
}

export type DeviceTokenInfo = {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  // 列表接口不返回明文 token，只有创建时返回一次
  token?: string
}

/** 注册新账户 */
export async function register(email: string, password: string, name?: string): Promise<AuthUser> {
  const res = await apiFetch<{ ok: boolean; user: AuthUser }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name })
  })
  setAccessToken('auth-session')
  return res.user
}

/** 登录 */
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await apiFetch<{ ok: boolean; user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  })
  setAccessToken('auth-session')
  return res.user
}

/** 登出 */
export async function logoutAuth(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin'
    })
  } finally {
    clearAccessToken()
  }
}

/** 获取当前登录用户（通过 HttpOnly Cookie 自动鉴权） */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await apiFetch<{ ok: boolean; user: AuthUser }>('/api/auth/me')
    return res.user
  } catch {
    return null
  }
}

/** 检查是否已登录（先看本地标记，再用 /api/auth/me 验证） */
export async function checkAuthSession(): Promise<AuthUser | null> {
  if (!getAccessToken()) return null
  const user = await fetchCurrentUser()
  if (!user) {
    clearAccessToken()
  }
  return user
}

// ── 设备 Token 管理 ──

/** 创建设备 Token（明文仅返回一次） */
export async function createDeviceToken(name: string): Promise<DeviceTokenInfo> {
  const res = await apiFetch<{ ok: boolean; deviceToken: DeviceTokenInfo }>('/api/auth/device-token', {
    method: 'POST',
    body: JSON.stringify({ name })
  })
  return res.deviceToken
}

/** 列出当前用户所有设备 Token */
export async function listDeviceTokens(): Promise<DeviceTokenInfo[]> {
  const res = await apiFetch<{ ok: boolean; deviceTokens: DeviceTokenInfo[] }>('/api/auth/device-tokens')
  return res.deviceTokens
}

/** 撤销设备 Token */
export async function revokeDeviceToken(tokenId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/auth/device-token/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE'
  })
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

/** 三段式·第三段：生成认知债务报告（支持 draftId 三段式路径与直连路径） */
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

// ── 训练系统 API ──

export async function fetchTodayTraining(): Promise<ApiResult<TodayTrainingResponse>> {
  const res = await fetch(`${API_BASE}/api/training/today`, {
    credentials: 'include'
  })
  return res.json()
}

export async function fetchTrainingDebts(): Promise<ApiResult<DebtsListResponse>> {
  const res = await fetch(`${API_BASE}/api/training/debts`, {
    credentials: 'include'
  })
  return res.json()
}

export async function fetchTrainingDebtDetail(debtId: string): Promise<ApiResult<DebtDetailResponse>> {
  const res = await fetch(`${API_BASE}/api/training/debts/${encodeURIComponent(debtId)}`, {
    credentials: 'include'
  })
  return res.json()
}

export async function startReviewTask(taskId: string): Promise<ApiResult<StartReviewResponse>> {
  const res = await fetch(`${API_BASE}/api/training/reviews/${encodeURIComponent(taskId)}/start`, {
    method: 'POST',
    credentials: 'include'
  })
  return res.json()
}

export async function submitReviewAnswer(taskId: string, answer: string): Promise<ApiResult<SubmitReviewResponse>> {
  const res = await fetch(`${API_BASE}/api/training/reviews/${encodeURIComponent(taskId)}/submit`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer })
  })
  return res.json()
}
