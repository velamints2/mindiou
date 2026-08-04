// MindIOU 面向用户 Web 端 — API 客户端封装
// 直接调用现有后端 server.js，不引入新依赖、不改后端。
// 鉴权：账户体系通过 HttpOnly Cookie 维持会话；前端仅保存"已登录"标记。

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
