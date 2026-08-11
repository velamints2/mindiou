export type DemoProjectSeed = {
  id: string
  name?: string
  description?: string
  createdAt?: string
  updatedAt?: string
}

export type DemoProjectMemory = {
  project: DemoProjectSeed
  sessions: any[]
  workItems: any[]
  artifacts: any[]
  decisions: any[]
  ownership: { artifacts: any[]; workItems: any[]; debts: any[]; summary: Record<string, number> }
  counts: Record<string, number>
  timeline: any[]
  isDemoView: boolean
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'project'
}

function topicFor(project: DemoProjectSeed): {
  workTitle: string
  intent: string
  implementation: string
  artifactName: string
  decision: string
  rationale: string
} {
  const source = `${project.name || ''} ${project.description || ''}`
  if (/3d|打印|建模|结构|硬件|眼镜/i.test(source)) {
    return {
      workTitle: '3D 打印结构验证',
      intent: '围绕项目结构方案建立从概念、建模到首板验证的协作闭环。',
      implementation: '示范记录：Agent 拆解了建模、尺寸冻结、干涉检查和首板验证几个阶段。',
      artifactName: '结构验证流程与尺寸冻结清单',
      decision: '先冻结关键包络和接口，再安排首板验证。',
      rationale: '先锁定跨团队交付物，能降低后续返工和结构干涉风险。'
    }
  }
  if (/激活|兑换|并发|幂等|支付|订单/i.test(source)) {
    return {
      workTitle: '兑换流程并发安全验证',
      intent: '验证同一业务凭证在重复请求和并发请求下只产生一次有效结果。',
      implementation: '示范记录：Agent 识别了条件更新、唯一约束、错误码和并发回归测试几个关键点。',
      artifactName: '并发安全实现与回归测试',
      decision: '将业务条件放进单条更新语句，并用 changes===1 判定唯一成功者。',
      rationale: '让数据库在写入时完成资格判断，避免先读后写产生竞态窗口。'
    }
  }
  return {
    workTitle: `${project.name || '项目'}最小闭环验证`,
    intent: `围绕“${project.name || '当前项目'}”的目标拆解一次可验证的真实协作任务。`,
    implementation: '示范记录：Agent 将目标拆成实现、关键决策、产出物和验证结果四个部分。',
    artifactName: '项目目标与验证记录',
    decision: '先完成一个可验证的最小闭环，再根据结果扩展范围。',
    rationale: '小范围闭环能让关键假设、风险和下一步动作保持可追踪。'
  }
}

export function buildProjectMemoryDemo(project: DemoProjectSeed): DemoProjectMemory {
  const topic = topicFor(project)
  const base = safeId(project.id)
  const at = project.updatedAt || project.createdAt || new Date().toISOString()
  const sessionId = `demo-session-${base}`
  const workItemId = `demo-work-item-${base}`
  const artifactId = `demo-artifact-${base}`
  const decisionId = `demo-decision-${base}`
  const session = {
    id: sessionId,
    projectId: project.id,
    title: `${topic.workTitle}（示范会话）`,
    platform: '项目示范',
    userIntentSummary: topic.intent,
    implementationSummary: topic.implementation,
    outcomeSummary: '示范结果：已形成一条可以继续补充真实证据的项目记忆链路。',
    createdAt: at,
    updatedAt: at,
    demo: true
  }
  const workItem = {
    id: workItemId,
    projectId: project.id,
    title: topic.workTitle,
    summary: topic.intent,
    status: 'in_progress',
    demo: true
  }
  const artifact = {
    id: artifactId,
    projectId: project.id,
    name: topic.artifactName,
    repositoryRelativePath: 'docs/project-memory-demo.md',
    type: 'document',
    artifactType: 'document',
    diffSummary: '示范产出物：用于说明该项目如何把协作过程、交付物和验证点串成可追溯记录。',
    demo: true
  }
  const decision = {
    id: decisionId,
    projectId: project.id,
    workItemId,
    sessionId,
    title: '先锁定关键边界，再推进实现',
    decision: topic.decision,
    rationale: topic.rationale,
    decisionType: 'architecture',
    decisionMaker: 'collaborative',
    userParticipation: 'selected',
    importance: 'high',
    demo: true
  }
  return {
    project,
    sessions: [session],
    workItems: [workItem],
    artifacts: [artifact],
    decisions: [decision],
    ownership: {
      artifacts: [{ ...artifact, evidenceLevel: 'E0', ownershipState: 'unverified' }],
      workItems: [{ ...workItem, evidenceLevel: 'E0', ownershipState: 'unverified' }],
      debts: [],
      summary: { owned: 0, explainable: 0, transferable: 0, unverified: 1 }
    },
    counts: { sessions: 1, workItems: 1, artifacts: 1, decisions: 1, debts: 0, owned: 0 },
    timeline: [
      { id: sessionId, type: 'session', label: session.title, referenceId: sessionId, occurredAt: at, demo: true },
      { id: workItemId, type: 'work_item', label: workItem.title, referenceId: workItemId, occurredAt: at, demo: true },
      { id: artifactId, type: 'artifact', label: artifact.name, referenceId: artifactId, occurredAt: at, demo: true },
      { id: decisionId, type: 'decision', label: decision.title, referenceId: decisionId, occurredAt: at, demo: true }
    ],
    isDemoView: true
  }
}

export function fillProjectMemory(memory: any, seed?: DemoProjectSeed): any {
  const project = memory?.project || seed || { id: 'project', name: '项目示范视图' }
  const demo = buildProjectMemoryDemo(project)
  const has = (value: unknown): value is any[] => Array.isArray(value) && value.length > 0
  const result = {
    ...demo,
    ...memory,
    project,
    sessions: has(memory?.sessions) ? memory.sessions : demo.sessions,
    workItems: has(memory?.workItems) ? memory.workItems : demo.workItems,
    artifacts: has(memory?.artifacts) ? memory.artifacts : demo.artifacts,
    decisions: has(memory?.decisions) ? memory.decisions : demo.decisions,
    ownership: {
      ...demo.ownership,
      ...(memory?.ownership || {}),
      artifacts: has(memory?.ownership?.artifacts) ? memory.ownership.artifacts : demo.ownership.artifacts,
      workItems: has(memory?.ownership?.workItems) ? memory.ownership.workItems : demo.ownership.workItems
    },
    timeline: has(memory?.timeline) ? memory.timeline : demo.timeline,
    counts: {
      ...demo.counts,
      ...(memory?.counts || {})
    },
    isDemoView: !has(memory?.sessions) || !has(memory?.workItems) || !has(memory?.artifacts) || !has(memory?.decisions)
  }
  if (result.isDemoView) {
    result.counts = {
      ...result.counts,
      sessions: result.sessions.length,
      workItems: result.workItems.length,
      artifacts: result.artifacts.length,
      decisions: result.decisions.length
    }
  }
  return result
}

export function buildSessionDemo(session: any, projectId = 'project'): any {
  const seed = { id: projectId, name: session?.projectName || '当前项目' }
  const demo = buildProjectMemoryDemo(seed)
  return {
    session: {
      ...demo.sessions[0],
      ...session,
      userIntentSummary: session?.userIntentSummary || demo.sessions[0].userIntentSummary,
      implementationSummary: session?.implementationSummary || demo.sessions[0].implementationSummary,
      outcomeSummary: session?.outcomeSummary || demo.sessions[0].outcomeSummary
    },
    workItems: demo.workItems,
    artifacts: demo.artifacts,
    decisions: demo.decisions,
    recurrences: [],
    isDemoView: true
  }
}

export function buildWorkItemDemo(workItem: any, projectId = 'project'): any {
  const seed = { id: projectId, name: workItem?.projectName || workItem?.title || '当前项目' }
  const demo = buildProjectMemoryDemo(seed)
  return {
    workItem: { ...demo.workItems[0], ...workItem, summary: workItem?.summary || demo.workItems[0].summary },
    sessions: demo.sessions,
    artifacts: demo.artifacts,
    decisions: demo.decisions,
    debtLinks: [],
    isDemoView: true
  }
}

export function friendlyProjectError(fallback: string): string {
  return `${fallback} 已显示项目示范内容，真实记录恢复后会自动替换。`
}
