// MindIOU 面向用户 Web 端 — 数据结构定义
// 与后端 mvp0-store.js / mvp1-clearance.js 契约对齐。

// ── 报告相关 ──

export type EvidenceItem = {
  item: string
  evidence: string
  isInference?: boolean
}

export type DangerousGap = {
  rank: number
  title?: string
  gap: string
  whyDangerous: string
  evidence: string
  surfaceSignals?: string[]
}

export type CognitiveStructure = {
  facts: EvidenceItem[]
  hypotheses: EvidenceItem[]
  questions: EvidenceItem[]
  decisions: EvidenceItem[]
  tradeoffs: EvidenceItem[]
}

export type FeynmanCard = {
  id: string
  target: string
  prompt: string
  targetLevel?: string
  difficulty?: 'foundation' | 'intermediate' | 'advanced'
  cardType?: string
  evaluationCriteria?: string[]
  userAnswer: string
  aiFollowUp: string
  answeredAt: string | null
  clearance?: {
    sessionId: string
    status: string
    sourceReviewRequired?: boolean
    endedAt?: string
    nextRecommendation?: string
    remainingGaps?: string[]
  }
}

export type NextAction = {
  item: string
  route: 'verify' | 'note' | 'task' | 'ask'
  reason: string
}

export type UserCapability = {
  overall?: string
  dimensions?: Record<string, {
    level?: string
    evidenceStatus?: string
    evidence?: string[]
    confidence?: number
  }>
  currentDomain?: string
  evidenceSignals?: string[]
  confidence?: number
  recommendedCardLevel?: string
}

export type ClearanceReport = {
  id: string
  locale?: 'zh-CN' | 'en'
  createdAt: string
  display?: { title: string; domain: string }
  input: {
    artifactText: string
    artifactType: string
    charCount?: number
    confusions?: { stepId: string; text: string }[]
  }
  analysis?: {
    artifactTitle?: string
    artifactKind: string
    userCapability: UserCapability
  }
  sections: {
    aiCompleted: EvidenceItem[]
    userContributed: EvidenceItem[]
    cognitiveProcessesOutsourced?: EvidenceItem[]
    dangerousGaps: DangerousGap[]
    cognitiveStructure: CognitiveStructure
    feynmanCards: FeynmanCard[]
    nextActions: NextAction[]
  }
  research?: {
    summary?: string
    sources?: SourceRecord[]
    mode?: string
  }
  corrections: unknown[]
  confusionResolutions?: ConfusionResolution[]
  status: string
  generation?: {
    fallback?: boolean
    error?: string
    failedStep?: string
  }
  priorProfile?: CapabilitySnapshot
}

// ── 三层能力快照（报告生成时聚合的历史能力先验）──

export type CapabilitySnapshot = {
  schemaVersion: string
  collectedAt: string
  userId: string | null
  source: string
  rules: string[]
  layers: {
    L1_ai_collaboration: {
      available: boolean
      dimensions: Record<string, {
        inferredLevel: string
        commonEvidenceStatus: string
        avgConfidence: number
        observationCount: number
      }>
      overallMode?: Record<string, number>
      reportCount?: number
      note?: string
    }
    L2_domain: {
      available: boolean
      domains: Array<{
        domain: string
        overallScore: number
        stability: string
        userVerifiedEvidenceCount: number
        updatedAt: string | null
      }>
    }
    L3_knowledge_points: {
      available: boolean
      domains: Array<{
        domain: string
        dimensions: Record<string, {
          score: number
          level: string
          stability: string
          evidenceCount: number
        }>
        updatedAt: string | null
      }>
    }
  }
}

// ── 时间线草稿相关（三段式第二段） ──

export type TimelineStep = {
  id: string
  title: string
  aiDid: string
  keyActions: string[]
  keyConcepts: string[]
  userConfusion: string
}

export type Draft = {
  id: string
  locale?: 'zh-CN' | 'en'
  createdAt: string
  updatedAt: string
  reportId: string
  input: { artifactText: string; artifactType: string; charCount?: number }
  timeline: { steps: TimelineStep[]; note?: string }
  generation: { fallback: boolean; error?: string; [k: string]: unknown }
  status: string
}

export type Confusion = { stepId: string; text: string }

export type ConfusionResolution = {
  stepId: string
  confusion: string
  resolution: 'gap' | 'not_capability_gap'
  gapRank: number
  reason: string
}

export type GenerateTimelineResponse = {
  ok: boolean
  draft: Draft
  timeline: { steps: TimelineStep[]; note?: string }
  fallback: boolean
  error?: string
  detectedType: string
}

export type GenerateReportRequest =
  | { draftId: string }
  | { artifactText: string; artifactType?: string }

// ── 清偿会话相关 ──

export type SourceRecord = {
  id?: string
  type?: string
  title?: string
  url?: string
  credibility?: string
  snippet?: string
}

export type ScaffoldPoint = {
  point: string
  detail?: string
}

export type AttemptAnalysis = {
  status: ClearanceStatus
  coverage: number
  demonstrated: string[]
  missing: string[]
  misconceptions: string[]
  evidence: string[]
  materialSourceIds?: string[]
  feedback: string
  teaching?: string
  nextQuestion?: string
  recommendation?: 'continue' | 'end'
}

export type Attempt = {
  answer: string
  analysis: AttemptAnalysis
  createdAt: string
}

export type FinalResult = {
  status: ClearanceStatus
  sourceReviewRequired?: boolean
  evidence: string[]
  demonstrated: string[]
  remainingGaps: string[]
  materialSourceIds?: string[]
  nextRecommendation: string
  referenceAnswer?: string
  scaffold?: ScaffoldPoint[]
}

export type ClearanceSession = {
  locale?: 'zh-CN' | 'en'
  id: string
  reportId: string
  cardId: string
  createdAt: string
  updatedAt?: string
  endedAt: string | null
  state: 'awaiting_answer' | 'teaching' | 'ready_to_end' | 'ended'
  originalCard: {
    id: string
    target: string
    prompt: string
    targetLevel?: string
    difficulty?: string
  }
  clearanceQuestion: string
  // 追问被采纳后，学习者实际正在回答的问题（缺省时等于 clearanceQuestion）
  currentQuestion?: string
  teachingMode?: 'coach' | 'direct'
  researchSummary?: string
  researchMode?: string
  sources?: SourceRecord[]
  scaffold?: ScaffoldPoint[]
  attempts: Attempt[]
  finalResult: FinalResult | null
}

// 后端实际产出 no_valid_attempt，前端兼容旧值 invalid_attempt
export type ClearanceStatus =
  | 'provisionally_cleared'
  | 'needs_practice'
  | 'needs_verification'
  | 'no_valid_attempt'
  | 'invalid_attempt'

// ── API 响应包装 ──

export type ApiResult<T> = {
  ok: boolean
  error?: string
} & T

export type GenerateReportResponse = {
  report: ClearanceReport
  fallback: boolean
  detectedType?: string
  error?: string
}

export type CreateSessionResponse = {
  session: ClearanceSession
}

export type SubmitAnswerResponse = {
  attempt: Attempt
  session: ClearanceSession
}

export type EndSessionResponse = {
  result: FinalResult
  session: ClearanceSession
  genesisIdentity?: {
    number: string
    activatedAt: string | null
    visibility: 'public' | 'anonymous' | 'private'
  } | null
}

export type SubmitCardAnswerResponse = {
  card: FeynmanCard
  shouldFollowUp: boolean
  fallback?: boolean
}

// ── 训练系统相关 ──

export type UnderstandingLevel =
  | 'not_understood'
  | 'prompt_supported'
  | 'initially_understood'
  | 'independently_explainable'
  | 'transferable'
  | 'stable_mastery'

export type TrainingStage =
  | 'initial_compensation'
  | 'delayed_recall'
  | 'misconception_check'
  | 'scenario_transfer'
  | 'error_detection'
  | 'real_work_validation'

export type CognitiveDebt = {
  id: string
  userId: string
  reportId?: string
  cardId?: string
  gapText: string
  gapEvidence?: string
  status: string
  sourceReports?: string[]
  createdAt?: string
  updatedAt?: string
  // enriched 字段（来自 /api/training/debts）
  mastery?: MasteryProfile | null
  understandingLevel?: UnderstandingLevel
  masteryLabel?: string
}

export type MasteryProfile = {
  cognitiveDebtId: string
  userId: string
  // 后端存储为 1-5 数字（review-scheduler.stageFromNumber）
  currentStage: TrainingStage | number
  overallMastery: number
  dimensionScores?: Record<string, number>
  // 后端按成功/失败分别计数，无 attemptCount 字段
  successfulAttempts?: number
  failedAttempts?: number
  lastAttemptAt?: string
  nextReviewAt?: string
  relapseCount?: number
}

export type ReviewTask = {
  id: string
  userId: string
  cognitiveDebtId: string
  cardId?: string
  trainingStage: TrainingStage
  taskType?: string
  prompt: string
  hintsAllowed?: boolean
  maxHints?: number
  status: 'pending' | 'in_progress' | 'completed'
  dueAt: string
  createdAt: string
  attemptId?: string
}

export type TrainingEvaluation = {
  overallScore: number
  passed: boolean
  conceptualAccuracy: number
  completeness: number
  independentRecall: number
  hintDependency: number
  transferAbility: number
  retentionStrength?: number
  understandingLevel: UnderstandingLevel
  strengths: string[]
  missingPoints: string[]
  misconceptions: string[]
  nextTrainingGoal: string
  recommendedNextStage: TrainingStage
  userFeedback: string
}

export type TrainingAttempt = {
  id: string
  userId: string
  cardId?: string
  cognitiveDebtId: string
  trainingStage: TrainingStage
  taskType?: string
  originalPrompt: string
  initialAnswer: string
  finalAnswer: string
  hintEvents?: unknown[]
  evaluation: TrainingEvaluation
  startedAt?: string
  completedAt: string
  durationSeconds?: number
}

export type TodayTrainingResponse = {
  totalDue: number
  tasks: ReviewTask[]
  profiles: MasteryProfile[]
}

export type DebtsListResponse = {
  debts: CognitiveDebt[]
}

export type DebtDetailResponse = {
  debt: CognitiveDebt
  profile: MasteryProfile | null
  attempts: TrainingAttempt[]
  reviews: ReviewTask[]
  understandingLevel: UnderstandingLevel
  masteryLabel: string
  projectMemory?: {
    links: Array<{
      id: string
      relation: string
      relevance: string
      artifact: { id: string; name: string; repositoryRelativePath?: string; symbolName?: string; gitCommitHash?: string; projectId: string }
      workItemId?: string
      workItemTitle?: string
      sessionId?: string
      sessionTitle?: string
      decisionId?: string
      decisionTitle?: string
    }>
    recurrences: Array<{ id: string; projectId: string; projectName?: string; sessionId?: string; reason: string; confidence: number }>
    evidence: Array<{ id: string; evidenceLevel: string; evidenceType: string; result: string; evidenceSummary?: string; occurredAt: string }>
  }
}

export type StartReviewResponse = {
  task: ReviewTask
}

export type SubmitReviewResponse = {
  attempt: TrainingAttempt
  evaluation: TrainingEvaluation
  profile: MasteryProfile
  debtStatus: string
  nextReviewAt: string
}

// ── 认知清偿 V1 相关（与后端 cognitive-repayment.js 契约对齐） ──

export type RepaymentSourceLocation =
  | { kind: 'artifact'; start: number; end: number }
  | { kind: 'unlocated' }

export type RepaymentEvidence = {
  excerpt: string
  evidenceType: 'direct_quote' | 'inferred'
  sourceLocation: RepaymentSourceLocation
}

export type RepaymentGapStatus =
  | 'identified'
  | 'queued'
  | 'attempting'
  | 'partiallyRepaid'
  | 'repaid'
  | 'reviewDue'
  | 'archived'

export type RepaymentGap = {
  gapId: string
  userId: string
  reportId: string
  cardId: string | null
  gapRank: number | null
  title: string
  whyItMatters: string
  evidence: RepaymentEvidence[]
  systemReasoningSummary: string
  confidence: number
  userCapabilityLevel: string
  verificationMethod: string
  status: RepaymentGapStatus
  statusHistory: { from: string; to: string; at: string; reason: string }[]
  createdAt: string
  updatedAt: string
  dataSchemaVersion: string
  // 列表接口附加字段
  latestAttempt?: RepaymentAttempt | null
  nextReviewAt?: string | null
}

export type RepaymentDimensionScore = {
  score: number
  evidence: string
  feedback: string
  uncertainty: 'low' | 'medium' | 'high'
}

export type RepaymentEvaluation = {
  dimensions: {
    conceptualUnderstanding: RepaymentDimensionScore
    causalExplanation: RepaymentDimensionScore
    practicalReproduction: RepaymentDimensionScore
    boundariesAndRisks: RepaymentDimensionScore
    transferAbility: RepaymentDimensionScore
  }
  overallScore: number
  passed: boolean
  overallFeedback: string
  nextQuestion: string
}

export type RepaymentErrorCategory =
  | 'timeout'
  | 'rate_limited'
  | 'http'
  | 'parse'
  | 'schema'
  | 'placeholder'
  | 'unavailable'

export type RepaymentAttempt = {
  attemptId: string
  gapId: string
  userId: string
  answer: string
  submittedAt: string
  selfConfidence: number | null
  evaluation: RepaymentEvaluation
  feedback: string
  nextQuestion: string
  repaymentStatus: string
  evaluatorVersion: string
  promptSchemaVersion: string
  dataSchemaVersion: string
  modelProvider: string
  modelName: string
  fallbackUsed: boolean
  errorCategory: RepaymentErrorCategory | null
  clientAttemptId: string | null
}

export type RepaymentReviewItem = {
  reviewItemId: string
  gapId: string
  userId: string
  dueAt: string
  priority: 'high' | 'medium' | 'low'
  reason: string
  attemptCount: number
  lastResult: 'passed' | 'failed'
  nextQuestionType: 'feynman_reexplain' | 'boundary_probe' | 'transfer_scenario' | 'verification_plan'
  status: 'pending' | 'done' | 'dismissed'
  createdAt: string
  updatedAt: string
  // 复习队列接口附加字段
  gapTitle?: string | null
  gapStatus?: string | null
}

export type RepaymentStatusResponse = {
  ok: boolean
  enabled: boolean
  versions: {
    evaluatorVersion: string
    promptSchemaVersion: string
    dataSchemaVersion: string
  }
}

export type RepaymentProfileDimension = {
  score: number
  level: string
  stability: string
  evidence: { attemptId: string; source: string; at: string }[]
  updatedAt?: string
}

export type RepaymentProfile = {
  userId: string
  domain: string
  dimensions: Record<string, RepaymentProfileDimension>
  createdAt: string
  updatedAt: string
  dataSchemaVersion: string
}
