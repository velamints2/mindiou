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
  gap: string
  whyDangerous: string
  evidence: string
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
  createdAt: string
  input: {
    artifactText: string
    artifactType: string
    charCount?: number
    confusions?: { stepId: string; text: string }[]
  }
  analysis?: {
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
  id: string
  reportId: string
  cardId: string
  createdAt: string
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
  currentStage: TrainingStage
  overallMastery: number
  dimensionScores?: Record<string, number>
  attemptCount: number
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
