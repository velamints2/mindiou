import crypto from 'node:crypto'
import { createMvp0Store } from '../mvp0-store.js'
import { createTrainingStore } from '../training-store.js'
import { createCognitiveRepaymentStore } from '../cognitive-repayment-store.js'
import { createProjectMemoryStore } from '../project-memory-store.js'
import { createGapFromReport, createFallbackEvaluation, buildAttemptRecord } from '../cognitive-repayment.js'
import { createCognitiveDebt } from '../mastery.js'
import { generateRuleBasedReviewTask } from '../review-generator.js'

const dbPath = process.env.DATA_DB_PATH || '/var/lib/mindiou/mindiou.sqlite'
const legacyMvp0 = process.env.MVP0_STORE_PATH || '/var/lib/mindiou/mvp0-store.json'
const legacyRepayment = process.env.COGNITIVE_REPAYMENT_STORE_PATH || '/var/lib/mindiou/cognitive-repayment-store.json'
const userId = process.env.DEMO_USER_ID || 'aa75e2aa-1c20-454d-add5-9d873ac979a8'
const now = new Date()
const iso = now.toISOString()
const before = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

const mvp0 = createMvp0Store(dbPath, { legacyJsonPath: legacyMvp0 })
const training = createTrainingStore(dbPath)
const repayment = createCognitiveRepaymentStore(dbPath, { legacyJsonPath: legacyRepayment })
const memory = createProjectMemoryStore(dbPath)
await Promise.all([mvp0.load(), training.load(), repayment.load()])

function reportFor(id, title, gap, gapEvidence, cardId, domain) {
  return {
    id,
    userId,
    locale: 'zh-CN',
    createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    input: {
      artifactText: `演示项目需求：${title}。用户要求 AI 协助实现，并希望能够回看技术决策和自己尚未掌握的风险。`,
      artifactType: 'software_task',
      charCount: 68
    },
    analysis: {
      artifactKind: 'software_task',
      artifactTitle: title,
      userCapability: {
        overall: 'mixed',
        currentDomain: domain,
        dimensions: {
          technicalDecisionComprehension: { level: 'L2', evidenceStatus: 'model_inferred', evidence: ['关键方案由 Agent 主导'], confidence: 0.84 },
          validationAndQualityJudgment: { level: 'L2', evidenceStatus: 'partially_observed', evidence: ['能够描述目标，但尚缺独立验证'], confidence: 0.72 }
        },
        evidenceSignals: ['Agent 修改多个文件', '用户接受关键技术方案'],
        recommendedCardLevel: 'intermediate'
      }
    },
    sections: {
      aiCompleted: [{ item: '实现接口、条件更新和唯一约束', evidence: 'Agent 会话中的实现摘要' }],
      userContributed: [{ item: '提出一张激活码只能使用一次的业务规则', evidence: '用户任务描述' }],
      cognitiveProcessesOutsourced: [{ item: '并发安全方案选择', evidence: '关键技术决策由 Agent 主导' }],
      dangerousGaps: [{ rank: 1, title: gap, gap, whyDangerous: '如果不理解并发窗口，可能在高并发下重复发放权益。', evidence: gapEvidence }],
      cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
      feynmanCards: [{ id: cardId, target: gap, prompt: `请解释${gap}，并说明它如何避免并发重复执行。`, evaluationCriteria: ['解释竞态窗口', '说明条件更新或唯一约束的作用'], userAnswer: '', aiFollowUp: '', answeredAt: null }],
      nextActions: [{ item: '完成延迟回忆并迁移到支付幂等场景', route: 'task', reason: '补足独立解释和迁移证据' }]
    },
    research: { mode: 'not_requested', sources: [] },
    corrections: [],
    status: 'generated'
  }
}

const cases = [
  {
    reportId: 'demo-report-activation', debtId: 'demo-debt-activation', cardId: 'demo-card-activation',
    title: '激活码兑换与防重复使用',
    gap: '尚未掌握并发兑换中的竞态条件',
    evidence: '用户知道激活码只能使用一次，但未能说明先查询 used=false 再更新为什么会形成并发窗口。',
    domain: '软件并发与数据一致性',
    prompt: '不看之前的材料，用自己的话解释：为什么数据库条件更新和唯一约束可以避免并发重复兑换？'
  },
  {
    reportId: 'demo-report-reconnect', debtId: 'demo-debt-reconnect', cardId: 'demo-card-reconnect',
    title: 'WebSocket 断线重连与指数退避',
    gap: '尚未掌握重连风暴与随机抖动的边界',
    evidence: '用户接受了固定间隔重试实现，但没有独立说明大量客户端同时重连会造成什么问题。',
    domain: '网络可靠性与服务稳定性',
    prompt: '在设备连接恢复的新场景中，如何选择指数退避、随机抖动和最大重试次数？'
  },
  {
    reportId: 'demo-report-payment', debtId: 'demo-debt-payment', cardId: 'demo-card-payment',
    title: '支付回调幂等与状态机',
    gap: '尚未完全掌握支付回调的幂等状态流转',
    evidence: '用户能够描述支付成功，但还没有验证重复回调、乱序回调和失败重试的处理。',
    domain: '支付可靠性与状态机',
    prompt: '请判断一个重复支付回调的错误实现，并说明如何在真实项目中验证修复。'
  }
]

const reports = new Map()
for (const item of cases) {
  const report = await mvp0.saveReport(reportFor(item.reportId, item.title, item.gap, item.evidence, item.cardId, item.domain))
  reports.set(item.reportId, report)
  let debt = training.listCognitiveDebts(userId).find(entry => entry.id === item.debtId)
  if (!debt) {
    debt = createCognitiveDebt({ userId, reportId: report.id, cardId: item.cardId, gapText: item.gap, gapEvidence: item.evidence })
    debt.id = item.debtId
    debt.status = item.debtId === 'demo-debt-activation' ? 'initially_understood' : 'new'
    await training.saveCognitiveDebt(debt)
  }
  if (!training.getMasteryProfile(debt.id)) {
    await training.saveMasteryProfile({
      cognitiveDebtId: debt.id, userId, currentStage: item.debtId === 'demo-debt-activation' ? 2 : 1,
      overallMastery: item.debtId === 'demo-debt-activation' ? 56 : 18,
      conceptualUnderstanding: item.debtId === 'demo-debt-activation' ? 68 : 22,
      independentRecall: item.debtId === 'demo-debt-activation' ? 46 : 10,
      hintIndependence: 35, misconceptionResistance: 26, transferAbility: item.debtId === 'demo-debt-activation' ? 34 : 8,
      retentionStrength: 30, attemptCount: item.debtId === 'demo-debt-activation' ? 1 : 0,
      lastAttemptAt: item.debtId === 'demo-debt-activation' ? before : undefined, nextReviewAt: before,
      successfulAttempts: item.debtId === 'demo-debt-activation' ? 1 : 0, failedAttempts: 0, relapseCount: 0
    })
  }
  if (!training.listReviewTasks(userId, { cognitiveDebtId: debt.id }).some(task => task.status === 'pending')) {
    const task = generateRuleBasedReviewTask({ debt, card: { id: item.cardId, target: item.gap, prompt: item.prompt }, firstAttempt: null, mastery: training.getMasteryProfile(debt.id), trainingStage: item.debtId === 'demo-debt-activation' ? 'delayed_recall' : 'initial_compensation', dueAt: before, userId })
    task.id = `demo-review-${item.debtId.replace('demo-debt-', '')}`
    task.prompt = item.prompt
    await training.saveReviewTask(task)
  }
  const existingGap = repayment.listGaps(userId).find(gap => gap.reportId === report.id && gap.gapRank === 1)
  if (!existingGap) await repayment.saveGap(createGapFromReport({ report, gapRef: { gapRank: 1 }, userId, now: iso }))
}

const activationDebt = training.getCognitiveDebt('demo-debt-activation', userId)
const activationAttemptId = 'demo-training-attempt-activation'
if (!training.listAttempts(userId, { cognitiveDebtId: activationDebt.id }).some(attempt => attempt.id === activationAttemptId)) {
  await training.saveAttempt({
    id: activationAttemptId, userId, cardId: 'demo-card-activation', cognitiveDebtId: activationDebt.id,
    trainingStage: 'initial_compensation', taskType: 'feynman_explanation',
    originalPrompt: '请解释并发兑换中的竞态条件。', initialAnswer: '我知道要保证一次兑换，但还不能完整说明两个请求同时读到未使用状态的窗口。',
    finalAnswer: '我知道要保证一次兑换，但还不能完整说明两个请求同时读到未使用状态的窗口。', hintEvents: [],
    evaluation: { overallScore: 56, passed: true, conceptualAccuracy: 62, completeness: 48, independentRecall: 44, hintDependency: 0, transferAbility: 20, understandingLevel: 'initially_understood', strengths: ['能识别一次性兑换规则'], missingPoints: ['条件更新如何关闭并发窗口'], misconceptions: [], nextTrainingGoal: '完成延迟回忆并迁移到支付幂等', recommendedNextStage: 'delayed_recall', userFeedback: '你已经识别业务规则，下一步需要把竞态窗口和数据库原子操作讲清楚。' },
    startedAt: before, completedAt: before
  })
}

const project = memory.ensureProject({ name: 'MindIOU 演示项目 · AI 协作与能力证据', description: '评委演示用的可追溯项目：从 Agent 会话一路查看功能、文件、Commit、决策、认知欠条和训练证据。', projectType: 'software', repositoryUrl: 'https://demo.mindiou.top/mindiou', localWorkspaceFingerprint: 'demo-mindiou-project-memory-v1', defaultBranch: 'main' }, userId)
const dimension = (score, level, source = 'model_inferred') => ({ score, level, stability: source === 'user_verified' ? 'verified' : 'one_shot', evidence: [{ attemptId: `demo-profile-${level}`, source, at: before }], updatedAt: before })
for (const profile of [
  {
    domain: '软件并发与数据一致性',
    dimensions: {
      conceptualUnderstanding: dimension(68, 'L2'), causalExplanation: dimension(54, 'L2'), practicalReproduction: dimension(42, 'L2'), boundariesAndRisks: dimension(38, 'L1'), transferAbility: dimension(24, 'L1')
    }
  },
  {
    domain: '网络可靠性与服务稳定性',
    dimensions: {
      conceptualUnderstanding: dimension(76, 'L3'), causalExplanation: dimension(72, 'L3'), practicalReproduction: dimension(64, 'L2'), boundariesAndRisks: dimension(58, 'L2'), transferAbility: dimension(46, 'L2')
    }
  }
]) {
  await repayment.saveCapabilityProfile({ userId, domain: profile.domain, dimensions: profile.dimensions, createdAt: before, updatedAt: iso, dataSchemaVersion: 'repayment-data-1' })
}
const workItems = new Map()
for (const item of cases) {
  const existing = memory.listWorkItems(project.id, userId).find(work => work.title === item.title)
  const workSummary = `演示链路：${item.gap}，包含项目认知账本、Agent 协作、技术决策、真实产出和训练证据。`
  workItems.set(item.debtId, existing ? memory.updateWorkItem(existing.id, { summary: workSummary }, userId) : memory.createWorkItem({ projectId: project.id, title: item.title, summary: workSummary, type: 'feature', status: item.debtId === 'demo-debt-payment' ? 'in_progress' : 'implemented', source: 'session_import', confidence: 0.97 }, userId))
}

const sessionSpecs = [
  { key: 'activation', debtId: 'demo-debt-activation', title: 'Codex：实现激活码兑换接口并修复并发问题', intent: '实现一张激活码只能兑换一次的接口。', implementation: 'Agent 创建兑换接口，先发现查询加更新存在并发窗口，随后改为数据库条件更新和唯一约束。', paths: [['file', 'src/services/activationCode.ts'], ['file', 'src/api/redeem.ts'], ['function', 'redeemActivationCode'], ['commit', '8f3a2d1']] },
  { key: 'reconnect', debtId: 'demo-debt-reconnect', title: 'Claude Code：处理 WebSocket 断线重连', intent: '让设备连接在网络抖动后能够恢复。', implementation: 'Agent 加入指数退避、随机抖动和最大重试次数，并补充断线测试。', paths: [['file', 'src/network/reconnect.ts'], ['function', 'retryWithJitter'], ['commit', 'c42e91a']] },
  { key: 'payment', debtId: 'demo-debt-payment', title: 'TRAE：补齐支付回调幂等状态机', intent: '避免支付平台重复回调导致权益重复发放。', implementation: 'Agent 增加事件幂等键、状态机和重复回调测试，用户在反馈后完成一次独立修改。', paths: [['file', 'src/payments/webhook.ts'], ['function', 'handlePaymentWebhook'], ['commit', 'b7d118c']] }
]
for (const spec of sessionSpecs) {
  const work = workItems.get(spec.debtId)
  const session = memory.saveAgentSession({ projectId: project.id, platform: spec.key === 'activation' ? 'codex' : spec.key === 'reconnect' ? 'claude_code' : 'trae', sourceFingerprint: `demo-session-${spec.key}-v1`, title: spec.title, rawTitle: spec.title, startedAt: before, endedAt: iso, userIntentSummary: spec.intent, implementationSummary: spec.implementation, outcomeSummary: '演示数据：实现链路已归档，关键证据等待用户继续验证。', keyTopics: [work.title, '项目认知账本', 'AI 协作', '人类能力证据'], technologies: ['TypeScript', 'SQLite', 'Git'], importMethod: 'adapter', rawContentStorage: 'not_stored', processingStatus: 'completed', analysis: { userIntent: spec.intent, implementationSummary: spec.implementation, outcomeSummary: '演示数据', cognitiveDebtCandidates: [{ title: cases.find(item => item.debtId === spec.debtId).gap, description: cases.find(item => item.debtId === spec.debtId).evidence, reason: '关键方案由 Agent 主导，用户需要通过复训和真实项目验证补足证据。', priority: 'high', confidence: 0.92 }] } }, userId)
  memory.linkSessionWorkItem(session.id, work.id, { relation: 'created', confidence: 0.98, source: 'automatic' }, userId)
  const artifacts = []
  for (const [type, name] of spec.paths) {
    const artifact = memory.upsertArtifact({ projectId: project.id, type, name, repositoryRelativePath: type === 'file' ? name : undefined, symbolName: type === 'function' ? name : undefined, gitCommitHash: type === 'commit' ? name : undefined, diffSummary: '演示摘要：仅保存路径、符号、Commit 和脱敏 Diff 说明。', language: 'TypeScript', sensitivity: 'metadata_only' }, userId)
    artifacts.push(artifact)
    memory.linkSessionArtifact(session.id, artifact.id, { relation: type === 'commit' ? 'created' : 'modified' }, userId)
    memory.linkWorkItemArtifact(work.id, artifact.id, { relation: type === 'commit' ? 'created' : 'modified', sourceSessionId: session.id }, userId)
  }
  const decisionTitle = spec.key === 'activation' ? '认知账本：使用数据库条件更新和唯一约束避免并发重复兑换' : spec.key === 'reconnect' ? '认知账本：使用指数退避和随机抖动降低重连风暴' : '认知账本：使用幂等键和状态机处理重复支付回调'
  const existingDecision = memory.listDecisions(project.id, userId).find(item => item.workItemId === work.id)
  const decision = existingDecision
    ? memory.updateDecision(existingDecision.id, { title: decisionTitle, rationale: '优先关闭真实风险，同时保留可验证的边界和失败路径。' }, userId)
    : memory.createDecision({ projectId: project.id, workItemId: work.id, sessionId: session.id, title: decisionTitle, decision: spec.implementation, rationale: '优先关闭真实风险，同时保留可验证的边界和失败路径。', alternatives: ['仅在应用层先查询再更新'], tradeoffs: ['需要数据库约束和额外测试'], assumptions: ['数据库事务和唯一约束可用'], risks: ['迁移或旧数据不一致时需要回滚方案'], decisionType: spec.key === 'activation' ? 'database' : spec.key === 'payment' ? 'product' : 'architecture', decisionMaker: 'agent', userParticipation: 'accepted', importance: 'high' }, userId)
  const debt = training.getCognitiveDebt(spec.debtId, userId)
  for (const artifact of artifacts.slice(0, 3)) {
    memory.linkDebtArtifact({ debtId: debt.id, artifactId: artifact.id, workItemId: work.id, sessionId: session.id, decisionId: decision.id, relation: 'implemented_in', relevance: artifact.type === 'file' ? 'primary' : 'secondary' }, userId)
  }
  if (!memory.listEvidenceForDebt(debt.id, userId).length) {
    memory.createEvidence({ debtId: debt.id, projectId: project.id, workItemId: work.id, artifactId: artifacts[0]?.id, trainingAttemptId: spec.debtId === 'demo-debt-activation' ? activationAttemptId : undefined, evidenceType: spec.debtId === 'demo-debt-payment' ? 'real_work_validation' : spec.debtId === 'demo-debt-reconnect' ? 'scenario_transfer' : 'independent_explanation', evidenceLevel: spec.debtId === 'demo-debt-payment' ? 'E5' : spec.debtId === 'demo-debt-reconnect' ? 'E4' : 'E2', result: 'passed', evidenceSummary: spec.debtId === 'demo-debt-payment' ? '演示数据：用户完成一次真实项目修改、验证和回滚说明。' : spec.debtId === 'demo-debt-reconnect' ? '演示数据：用户将退避策略迁移到设备连接恢复场景。' : '演示数据：用户完成一次独立解释，但还需要继续验证。', externalReference: 'demo-seed-v1', occurredAt: before }, userId)
  }
}

const activationGap = repayment.listGaps(userId).find(item => item.reportId === 'demo-report-activation' && item.gapRank === 1)
if (activationGap && !repayment.listAttemptsForGap(activationGap.gapId).length) {
  const evaluation = createFallbackEvaluation({ gap: activationGap, answer: '我知道要防止重复兑换，但还需要进一步解释数据库条件更新如何保证只有一个请求成功。' })
  const attempt = buildAttemptRecord({ gap: activationGap, answer: '我知道要防止重复兑换，但还需要进一步解释数据库条件更新如何保证只有一个请求成功。', evaluation, feedback: evaluation.overallFeedback, nextQuestion: evaluation.nextQuestion, repaymentStatus: 'partiallyRepaid', fallbackUsed: true, errorCategory: 'demo_seed', modelProvider: 'demo', modelName: 'demo', clientAttemptId: 'demo-repayment-attempt-activation' })
  attempt.attemptId = 'demo-repayment-attempt-activation'
  await repayment.saveAttempt(attempt)
  await repayment.saveReviewItem({ reviewItemId: 'demo-repayment-review-activation', gapId: activationGap.gapId, userId, dueAt: before, priority: 'high', reason: '演示数据：首次作答后需要间隔复习并完成边界追问。', attemptCount: 1, lastResult: 'passed', nextQuestionType: 'boundary_probe', status: 'pending', createdAt: before, updatedAt: iso })
}

console.log(JSON.stringify({ ok: true, userId, projectId: project.id, reports: mvp0.listReports(userId).filter(item => item.id.startsWith('demo-report-')).length, debts: training.listCognitiveDebts(userId).filter(item => item.id.startsWith('demo-debt-')).length, reviewTasks: training.listDueReviews(userId).filter(item => item.id.startsWith('demo-review-')).length, repaymentGaps: repayment.listGaps(userId).filter(item => item.reportId?.startsWith('demo-report-')).length, projectCounts: memory.memory(project.id, userId, training.listCognitiveDebts(userId)).counts }))
