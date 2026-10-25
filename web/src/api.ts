// MindIOU 面向用户 Web 端 — API 客户端封装
// 直接调用现有后端 server.js，不引入新依赖、不改后端。
// 鉴权：账户体系通过 HttpOnly Cookie 维持会话；前端仅保存"已登录"标记。

import type {
  ApiResult,
  ClearanceReport,
  ClearanceSession,
  CognitiveLoopActivityInput,
  CognitiveLoopContentCandidateInput,
  CognitiveLoopFeedback,
  CognitiveLoopRun,
  UserCognitiveProfile,
  Confusion,
  CreateSessionResponse,
  DebtDetailResponse,
  DebtsListResponse,
  Draft,
  EndSessionResponse,
  GenerateReportRequest,
  GenerateReportResponse,
  GenerateTimelineResponse,
  RepaymentAttempt,
  RepaymentGap,
  RepaymentProfile,
  RepaymentReviewItem,
  RepaymentStatusResponse,
  StartReviewResponse,
  SubmitAnswerResponse,
  SubmitCardAnswerResponse,
  SubmitReviewResponse,
  TodayTrainingResponse
} from './types'
import { getLocale, t } from './i18n'

// ── API 基址 ──
//   公网部署（路径以 /mindiou/ 开头）→ /mindiou-api 由 Nginx 反代
//   本地开发 → 可用 ?api=http://host:8793 覆盖，默认同源走 vite proxy
const runtimeParams = new URLSearchParams(location.search)
const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname)
const isPublicDeployment = !isLocalDev && location.pathname.startsWith('/mindiou/')
export const API_BASE = runtimeParams.get('api') || (isPublicDeployment ? '/mindiou-api' : '')

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
  retryAfterSeconds?: number
  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export async function projectMemoryRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  return apiFetch<T>(path, options)
}

function defaultErrorMessage(status: number): string {
  if (status === 401) {
    return t('登录状态已失效，请重新登录', 'Your session has expired. Please sign in again.')
  }
  if ([502, 503, 504].includes(status)) {
    return t('服务暂时不可用，请稍后重试')
  }
  if (status === 500) {
    return t('服务处理失败，请稍后重试')
  }
  if (status === 429) {
    return t('请求过于频繁，请稍后重试')
  }
  return t(`请求失败（${status}）`, `Request failed (${status})`)
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-mindiou-locale': getLocale(),
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
    throw new ApiError(0, t('网络连接失败，请检查网络或后端服务是否可用'))
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
    const retryAfterHeader = res.headers.get('retry-after')
    const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader)
      ? Number(retryAfterHeader)
      : undefined
    const baseMessage = res.status === 401
      ? defaultErrorMessage(401)
      : bodyMessage ? t(bodyMessage) : defaultErrorMessage(res.status)
    const msg = retryAfterSeconds && [429, 503].includes(res.status)
      ? `${baseMessage}（约 ${retryAfterSeconds} 秒后重试）`
      : baseMessage
    throw new ApiError(res.status, msg, retryAfterSeconds)
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
  emailVerified: boolean
  genesisIdentity?: GenesisIdentity
}

export type GenesisIdentity = {
  number: string
  reservedAt: string
  activatedAt: string | null
  visibility: 'public' | 'anonymous' | 'private'
  avatarUrl?: string
}

export type GenesisArchive = {
  cohort: string
  status: 'recruiting' | 'in_progress' | 'archived'
  stage: string
  stageEn?: string
  dates: { start: string | null; end: string | null }
  capacity: number
  estimates: { completed: number }
  actual: { registered: number; joined: number; completedFirstClearance: number; adoptedSuggestions: number }
  adoptedSuggestions: string[]
  productImprovements: string[]
  members: Array<{ number: string; activatedAt: string | null; visibility: 'public' | 'anonymous'; nickname?: string; avatarUrl?: string }>
  participant: null | {
    registered: boolean
    officiallyJoined: boolean
    reportCount: number
    completedClearanceCount: number
    activeSessionId: string | null
    identity: GenesisIdentity | null
  }
}

export type DeviceTokenInfo = {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  // 列表接口不返回明文 token，只有创建时返回一次
  token?: string
}

export type ProjectHookTokenInfo = {
  id: string
  projectId: string
  name: string
  createdAt: string
  revokedAt: string | null
  // Hook token 明文只在创建响应中返回一次，列表接口不会返回。
  token?: string
}

/** 注册新账户 */
export async function register(email: string, password: string, name?: string): Promise<AuthUser> {
  const res = await apiFetch<{ ok: boolean; user: AuthUser; requiresEmailVerification?: boolean }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name })
  })
  // Registration intentionally does not create an authenticated session.
  // Keep only the non-sensitive address so the verification page can resend.
  if (res.requiresEmailVerification) sessionStorage.setItem('mindiou_pending_verification_email', email)
  return res.user
}

export async function verifyEmail(token: string): Promise<{ ok: boolean; message?: string }> {
  return apiFetch('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
}

export async function resendVerificationEmail(email?: string): Promise<{ ok: boolean; message?: string }> {
  const pendingEmail = email || sessionStorage.getItem('mindiou_pending_verification_email') || undefined
  return apiFetch('/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify({ email: pendingEmail })
  })
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
  // Clear the local marker before the request so the UI cannot keep offering
  // a workspace while the server is clearing the HttpOnly session cookie.
  clearAccessToken()
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
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

/**
 * 检查是否已登录。
 *
 * localStorage 里的值只是页面状态标记，不能证明 HttpOnly session Cookie
 * 仍然有效。因此每次受保护页面需要恢复/确认会话时，都以 /api/auth/me
 * 的服务端结果为准；服务端会话失效时同时清掉过期的本地标记。
 */
export async function checkAuthSession(): Promise<AuthUser | null> {
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

// ── 项目 MCP / Hook Token 管理 ──

/** 列出当前用户在指定项目下的 Hook Token；列表不含明文。 */
export async function listProjectHookTokens(projectId: string): Promise<ProjectHookTokenInfo[]> {
  const res = await apiFetch<{ ok: boolean; tokens: ProjectHookTokenInfo[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/hook-token`
  )
  return res.tokens
}

/** 创建项目 Hook Token；明文仅在创建响应中返回一次。 */
export async function createProjectHookToken(projectId: string, name: string): Promise<ProjectHookTokenInfo> {
  const res = await apiFetch<{ ok: boolean; hook: ProjectHookTokenInfo }>(
    `/api/projects/${encodeURIComponent(projectId)}/hook-token`,
    { method: 'POST', body: JSON.stringify({ name }) }
  )
  return res.hook
}

/** 撤销项目 Hook Token。 */
export async function revokeProjectHookToken(projectId: string, tokenId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/hook-token/${encodeURIComponent(tokenId)}`,
    { method: 'DELETE' }
  )
}

// ── 核心闭环接口 ──

/** 三段式·第一段进入第二段：生成协作时间线草稿 */
export async function generateTimeline(
  artifactText: string,
  artifactType?: string
): Promise<GenerateTimelineResponse> {
  return apiFetch<GenerateTimelineResponse>('/api/mvp0/timelines', {
    method: 'POST',
    body: JSON.stringify({ artifactText, artifactType, locale: getLocale() })
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
    body: JSON.stringify({ ...req, locale: getLocale() })
  })
}

/** 获取报告详情 */
export async function fetchReport(reportId: string): Promise<ApiResult<{ report: ClearanceReport }>> {
  return apiFetch(`/api/mvp0/reports/${encodeURIComponent(reportId)}`)
}

/** 将已经生成的认知欠条报告归入项目记忆；服务端按报告+项目幂等处理。 */
export async function linkReportToProjectMemory(
  reportId: string,
  projectId: string
): Promise<{ ok: boolean; project: { id: string; name: string }; session: { id: string }; workItem?: { id: string; title: string }; linkedDebtIds: string[]; idempotent?: boolean }> {
  return projectMemoryRequest(`/api/mvp0/reports/${encodeURIComponent(reportId)}/project-memory`, {
    method: 'POST',
    body: JSON.stringify({ projectId })
  })
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
    body: JSON.stringify({ reportId, cardId, locale: getLocale() })
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
  return apiFetch<ApiResult<TodayTrainingResponse>>('/api/training/today')
}

export async function fetchTrainingDebts(): Promise<ApiResult<DebtsListResponse>> {
  return apiFetch<ApiResult<DebtsListResponse>>('/api/training/debts')
}

export async function fetchTrainingDebtDetail(debtId: string): Promise<ApiResult<DebtDetailResponse>> {
  return apiFetch<ApiResult<DebtDetailResponse>>(`/api/training/debts/${encodeURIComponent(debtId)}`)
}

export async function startReviewTask(taskId: string): Promise<ApiResult<StartReviewResponse>> {
  return apiFetch<ApiResult<StartReviewResponse>>(`/api/training/reviews/${encodeURIComponent(taskId)}/start`, {
    method: 'POST',
  })
}

export async function submitReviewAnswer(taskId: string, answer: string): Promise<ApiResult<SubmitReviewResponse>> {
  return apiFetch<ApiResult<SubmitReviewResponse>>(`/api/training/reviews/${encodeURIComponent(taskId)}/submit`, {
    method: 'POST',
    body: JSON.stringify({ answer })
  })
}

// ── 认知清偿 V1 API ──
// 对应后端 /api/repayment/*（COGNITIVE_REPAYMENT_V1=1 时启用）。

/** 功能开关与版本信息（公开接口，无需登录） */
export async function repaymentStatus(): Promise<RepaymentStatusResponse> {
  return apiFetch<RepaymentStatusResponse>('/api/repayment/status')
}

/** 从认知债务报告导入一笔欠条进入清偿流程 */
export async function importRepaymentGap(
  reportId: string,
  gapRank: number
): Promise<ApiResult<{ gap: RepaymentGap; deduplicated?: boolean }>> {
  return apiFetch<ApiResult<{ gap: RepaymentGap; deduplicated?: boolean }>>(
    '/api/repayment/gaps/import',
    { method: 'POST', body: JSON.stringify({ reportId, gapRank }) }
  )
}

/** 列出当前用户的认知欠条（可按状态过滤），每条附 latestAttempt 与 nextReviewAt */
export async function listRepaymentGaps(status?: string): Promise<ApiResult<{ gaps: RepaymentGap[] }>> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : ''
  return apiFetch<ApiResult<{ gaps: RepaymentGap[] }>>(`/api/repayment/gaps${qs}`)
}

/** 欠条详情：附完整作答历史与复习项 */
export async function getRepaymentGap(
  gapId: string
): Promise<ApiResult<{ gap: RepaymentGap; attempts: RepaymentAttempt[]; reviewItems: RepaymentReviewItem[] }>> {
  return apiFetch<ApiResult<{ gap: RepaymentGap; attempts: RepaymentAttempt[]; reviewItems: RepaymentReviewItem[] }>>(
    `/api/repayment/gaps/${encodeURIComponent(gapId)}`
  )
}

/** 提交一次清偿作答。clientAttemptId 用于双击/重试去重 */
export async function submitRepaymentAttempt(
  gapId: string,
  payload: { answer: string; selfConfidence?: number; clientAttemptId?: string }
): Promise<ApiResult<{ attempt: RepaymentAttempt; gap: RepaymentGap; deduplicated?: boolean }>> {
  return apiFetch<ApiResult<{ attempt: RepaymentAttempt; gap: RepaymentGap; deduplicated?: boolean }>>(
    `/api/repayment/gaps/${encodeURIComponent(gapId)}/attempts`,
    { method: 'POST', body: JSON.stringify(payload) }
  )
}

/** 待处理复习队列（每项附 gapTitle/gapStatus） */
export async function getRepaymentReviewQueue(): Promise<ApiResult<{ items: RepaymentReviewItem[] }>> {
  return apiFetch<ApiResult<{ items: RepaymentReviewItem[] }>>('/api/repayment/review-queue')
}

/** 忽略一条复习项 */
export async function dismissRepaymentReviewItem(
  reviewItemId: string
): Promise<ApiResult<{ item: RepaymentReviewItem }>> {
  return apiFetch<ApiResult<{ item: RepaymentReviewItem }>>(
    `/api/repayment/review-queue/${encodeURIComponent(reviewItemId)}/dismiss`,
    { method: 'POST', body: JSON.stringify({}) }
  )
}

/** 能力画像（无数据时返回 degraded 标记） */
export async function getRepaymentProfile(): Promise<
  ApiResult<{ profiles: RepaymentProfile[]; degraded?: boolean; note?: string }>
> {
  return apiFetch<ApiResult<{ profiles: RepaymentProfile[]; degraded?: boolean; note?: string }>>(
    '/api/repayment/profile'
  )
}

/** 当前用户的认知债务报告列表（导入欠条入口用） */
export async function listMvp0Reports(): Promise<ApiResult<{ reports: ClearanceReport[] }>> {
  return apiFetch<ApiResult<{ reports: ClearanceReport[] }>>('/api/mvp0/reports')
}

export type DashboardSummary = {
  reportCount: number
  latestReport: ClearanceReport | null
  outstandingDebts: Array<{
    reportId: string
    cardId: string
    gapId?: string
    title: string
    status: string
    locale?: string
  }>
  latestSession: (ClearanceSession & {
    reportDisplay?: { title: string; domain: string } | null
    cardTitle?: string
    lastActivityAt?: string
  }) | null
  continuable: { sessionId: string; reportId: string; cardId: string; title: string } | null
}

export async function fetchDashboard(): Promise<ApiResult<{ dashboard: DashboardSummary }>> {
  return apiFetch<ApiResult<{ dashboard: DashboardSummary }>>('/api/dashboard')
}

export async function fetchGenesis(): Promise<ApiResult<{ genesis: GenesisArchive }>> {
  return apiFetch<ApiResult<{ genesis: GenesisArchive }>>('/api/genesis')
}

export async function fetchGenesisIdentity(): Promise<ApiResult<{ identity: GenesisIdentity | null }>> {
  return apiFetch<ApiResult<{ identity: GenesisIdentity | null }>>('/api/genesis/identity')
}

export type AssessmentOpenReview = {
  questionId: string
  causal_explanation: number
  independent_judgment: number
  risk_identification: number
  uncertainty_awareness: number
  transfer: number
  evidence: string
  reason: string
}

export async function reviewAssessment(payload: { version: string; role: string; locale: string; completionId?: string; answers: Record<string,string>; questions: Array<{ id:string; title:string; context?:string; rubric?:string }> }): Promise<ApiResult<{ reviews: AssessmentOpenReview[]; mode: 'model_structured'|'rule_fallback' }>> {
  return apiFetch('/api/assessment/review', { method: 'POST', body: JSON.stringify(payload) })
}

export async function updateGenesisIdentity(payload: {
  visibility: GenesisIdentity['visibility']; displayName?: string; avatarUrl?: string
}): Promise<ApiResult<{ identity: GenesisIdentity }>> {
  return apiFetch<ApiResult<{ identity: GenesisIdentity }>>('/api/genesis/identity', {
    method: 'PATCH', body: JSON.stringify(payload)
  })
}
// ── 项目认知所有权地图 ──
// 与 server.js 中 /api/projects/* 路由对应。
// 所有权状态由后端确定性代码计算，前端只负责展示。

export type EvidenceLevel = 0 | 1 | 2 | 3 | 4 | 5

export type ModuleOwnershipStatus =
  | 'high_risk_unowned'
  | 'needs_initial_understanding'
  | 'needs_error_boundary_validation'
  | 'needs_transfer_validation'
  | 'needs_real_work_validation'
  | 'owned'

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type OwnershipGapType =
  | 'needs_initial_understanding'
  | 'needs_error_boundary_validation'
  | 'needs_transfer_validation'
  | 'needs_real_work_validation'
  | null

export type TrainingStage =
  | 'initial_compensation'
  | 'delayed_recall'
  | 'misconception_check'
  | 'scenario_transfer'
  | 'error_detection'
  | 'real_work_validation'

export type ProjectSummary = {
  projectId: string
  importantDecisionCount: number
  ownedDecisionCount: number
  initialUnderstandingCount: number
  missingVerificationCount: number
  highRiskUnownedCount: number
  moduleCount: number
  ownedModuleCount: number
  highRiskModuleCount: number
  needsRealWorkModuleCount: number
  ownershipCoverage: number
  calculatedAt: string
  calculationVersion: string
}

export type ProjectInfo = {
  id: string
  name: string
  description?: string
  repositoryUrl?: string
  createdAt: string
  updatedAt?: string
}

export type ModuleOwnershipView = {
  workItemId: string
  title: string
  status: ModuleOwnershipStatus
  statusLabel: string
  riskLevel: RiskLevel
  importantDecisionCount: number
  highestEvidenceLevel: EvidenceLevel
  highestEvidenceLevelLabel: string
  relatedSessionCount: number
  relatedArtifactCount: number
  openDebtCount: number
  highRiskDebtCount: number
  missingEvidenceTypes: string[]
  ownershipGapType: OwnershipGapType
  latestActivityAt?: string
}

export type ProjectOwnershipView = {
  ok: boolean
  project: ProjectInfo
  summary: ProjectSummary
  modules: ModuleOwnershipView[]
  decisions: Array<{
    decisionId: string
    workItemId?: string
    title: string
    importance: string
    decisionMaker: string
    isImportant: boolean
    status: string
    evidenceLevel: EvidenceLevel
    evidenceLevelLabel: string
  }>
}

export type AgentSessionView = {
  id: string
  source: string
  title: string
  implementationSummary?: string
}

export type ArtifactView = {
  id: string
  artifactType: string
  path?: string
  functionName?: string
  commitSha?: string
  prUrl?: string
  diffSummary?: string
}

export type DecisionView = {
  decisionId: string
  title: string
  decision: string
  rationale?: string
  decisionType: string
  importance: string
  decisionMaker: string
  userParticipation: string
  isImportant: boolean
  status: string
  evidenceLevel: EvidenceLevel
  evidenceLevelLabel: string
  linkedArtifacts: ArtifactView[]
  linkedDebts: Array<{
    id: string
    gapText: string
    status: string
    riskType?: string
  }>
}

export type UserEvidenceItem = {
  id: string
  description?: string
  source?: string
  sourceId?: string
  evidenceLevel?: EvidenceLevel
  evidenceLevelLabel?: string
  trainingStage?: TrainingStage
  hintDependency?: number
  overallScore?: number
  artifactType?: string
  createdAt?: string
}

export type UserEvidenceGroup = {
  independentExplanation: UserEvidenceItem[]
  delayedRecall: UserEvidenceItem[]
  errorDetection: UserEvidenceItem[]
  misconceptionCheck: UserEvidenceItem[]
  scenarioTransfer: UserEvidenceItem[]
  realWorkModification: UserEvidenceItem[]
  testPassed: UserEvidenceItem[]
  manualReview: UserEvidenceItem[]
}

export type ModuleDetailView = {
  workItemId: string
  title: string
  status: ModuleOwnershipStatus
  statusLabel: string
  riskLevel: RiskLevel
  importantDecisionCount: number
  highestEvidenceLevel: EvidenceLevel
  highestEvidenceLevelLabel: string
  relatedSessionCount: number
  relatedArtifactCount: number
  openDebtCount: number
  highRiskDebtCount: number
  missingEvidenceTypes: string[]
  nextRecommendedStage?: TrainingStage
  ownershipGapType: OwnershipGapType
  latestActivityAt?: string
  aiWork: {
    agentSessions: AgentSessionView[]
    decisions: DecisionView[]
    artifacts: ArtifactView[]
  }
  userEvidence: UserEvidenceGroup
  remainingDebts: {
    openDebts: Array<{ id: string; gapText: string; status: string; riskType?: string }>
    relapsedDebts: Array<{ id: string; gapText: string; riskType?: string }>
    highRiskDebts: Array<{ id: string; gapText: string; status: string; riskType?: string }>
  }
}

export type ModuleDetailResponse = {
  ok: boolean
  module: ModuleDetailView
  recommendation: {
    projectId: string
    workItemId: string
    decisionId?: string
    artifactId?: string
    ownershipGapType: OwnershipGapType
    recommendedStage: TrainingStage
    currentEvidenceLevel: EvidenceLevel
    currentEvidenceLevelLabel: string
    missingEvidenceTypes: string[]
    description: string
    createdAt: string
  } | null
}

/** 列出当前用户的项目 */
export async function listProjects(): Promise<ProjectInfo[]> {
  const res = await apiFetch<{ ok: boolean; projects: ProjectInfo[] }>('/api/projects')
  return res.projects
}

export type CognitiveLoopRunResponse = {
  ok: boolean
  run: CognitiveLoopRun | null
  feedback: CognitiveLoopFeedback[]
  idempotent?: boolean
  cognitiveProfile?: UserCognitiveProfile | null
}

export async function fetchUserCognitiveProfile(): Promise<{ ok: boolean; profile: UserCognitiveProfile | null }> {
  return projectMemoryRequest<{ ok: boolean; profile: UserCognitiveProfile | null }>('/api/cognitive-profile')
}

export async function fetchLatestCognitiveLoop(projectId: string): Promise<CognitiveLoopRunResponse> {
  return projectMemoryRequest<CognitiveLoopRunResponse>(
    '/api/cognitive-loop/latest?projectId=' + encodeURIComponent(projectId)
  )
}

export async function runCognitiveLoop(input: {
  projectId: string
  projectContext: string
  domain?: string
  activities: CognitiveLoopActivityInput[]
  contentCandidates?: CognitiveLoopContentCandidateInput[]
  windowDays?: number
  clientRunId: string
}): Promise<CognitiveLoopRunResponse & { activitySessionId?: string }> {
  return projectMemoryRequest<CognitiveLoopRunResponse & { activitySessionId?: string }>(
    '/api/cognitive-loop/runs',
    { method: 'POST', body: JSON.stringify(input) }
  )
}

export async function submitCognitiveLoopFeedback(
  runId: string,
  input: {
    kind: CognitiveLoopFeedback['kind']
    targetId?: string
    payload: Record<string, unknown>
  }
): Promise<{ ok: boolean; feedback: CognitiveLoopFeedback; run: CognitiveLoopRun; feedbackHistory: CognitiveLoopFeedback[] }> {
  return projectMemoryRequest(
    '/api/cognitive-loop/runs/' + encodeURIComponent(runId) + '/feedback',
    { method: 'POST', body: JSON.stringify(input) }
  )
}

/** 获取项目详情 */
export async function fetchProject(projectId: string): Promise<{
  project: ProjectInfo
  workItems: Array<{ id: string; projectId: string; title: string; description?: string; moduleType?: string }>
}> {
  const res = await apiFetch<{ ok: boolean; project: ProjectInfo; workItems: Array<{ id: string; projectId: string; title: string; description?: string; moduleType?: string }> }>(`/api/projects/${encodeURIComponent(projectId)}`)
  return { project: res.project, workItems: res.workItems }
}

/** 获取项目所有权地图视图（摘要 + 模块列表 + 决策列表） */
export async function fetchProjectOwnership(projectId: string): Promise<ProjectOwnershipView> {
  return apiFetch<ProjectOwnershipView>(`/api/projects/${encodeURIComponent(projectId)}/ownership`)
}

/** 获取模块详情 */
export async function fetchModuleDetail(projectId: string, moduleId: string): Promise<ModuleDetailResponse> {
  return apiFetch<ModuleDetailResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/ownership/modules/${encodeURIComponent(moduleId)}`
  )
}

/** 获取高风险模块列表 */
export async function fetchHighRiskModules(projectId: string): Promise<ModuleOwnershipView[]> {
  const res = await apiFetch<{ ok: boolean; highRiskModules: ModuleOwnershipView[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/ownership/high-risk`
  )
  return res.highRiskModules
}

/** 获取所有权快照历史 */
export async function fetchOwnershipHistory(projectId: string): Promise<Array<{
  id: string
  projectId: string
  summary: ProjectSummary
  moduleSummary: Array<{
    workItemId: string
    title: string
    status: ModuleOwnershipStatus
    riskLevel: RiskLevel
    importantDecisionCount: number
    highestEvidenceLevel: EvidenceLevel
  }>
  calculationVersion: string
  createdAt: string
}>> {
  const res = await apiFetch<{ ok: boolean; snapshots: Array<any> }>(
    `/api/projects/${encodeURIComponent(projectId)}/ownership/history`
  )
  return res.snapshots
}

/** 触发重新计算并保存快照 */
export async function recalculateOwnership(projectId: string): Promise<ProjectOwnershipView & { snapshotSaved: boolean }> {
  return apiFetch<ProjectOwnershipView & { snapshotSaved: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/ownership/recalculate`,
    { method: 'POST', body: JSON.stringify({}) }
  )
}
