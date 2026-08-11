import { createOwnershipStore } from '../project-ownership-store.js'

const storePath = process.env.OWNERSHIP_STORE_PATH || '/var/lib/mindiou/ownership-store.json'
const userId = process.env.DEMO_USER_ID || '1d2ee548-df51-4e47-987e-1458ddc6df61'
const projectId = process.env.DEMO_PROJECT_ID || 'mindiou-web'
const store = createOwnershipStore(storePath)
await store.load()
const project = store.getProject(projectId, userId)
if (!project) throw new Error(`Demo project not found: ${projectId}/${userId}`)
const data = store.getProjectData(projectId)
const now = new Date().toISOString()
const cleanCodeX = value => String(value || '').replace(/\bcode\s*x\b/gi, 'code T')

// Repair labels in-place so the demo never exposes the old placeholder “code X”.
for (const item of data.agentSessions) await store.saveAgentSession({ ...item, title: cleanCodeX(item.title), implementationSummary: cleanCodeX(item.implementationSummary) })
for (const item of data.artifacts) await store.saveArtifact({ ...item, path: cleanCodeX(item.path), functionName: cleanCodeX(item.functionName), diffSummary: cleanCodeX(item.diffSummary) })
for (const item of data.decisionRecords) await store.saveDecisionRecord({ ...item, title: cleanCodeX(item.title), decision: cleanCodeX(item.decision), rationale: cleanCodeX(item.rationale) })

const refreshed = store.getProjectData(projectId)
const sessions = new Map(refreshed.agentSessions.map(item => [item.workItemId, item]))
const decisions = new Map(refreshed.decisionRecords.map(item => [item.workItemId, item]))
let added = 0
for (const work of refreshed.workItems.filter(item => item.projectId === projectId)) {
  let session = sessions.get(work.id)
  if (!session) {
    session = { id: `demo-session-${work.id}`, projectId, workItemId: work.id, userId, source: 'codex', title: `演示会话：${work.title}`, implementationSummary: `演示链路已完成：围绕“${work.title}”记录实现、验证和回滚边界。`, importedAt: now }
    await store.saveAgentSession(session)
    added++
  }
  const existingArtifacts = refreshed.artifacts.filter(item => item.workItemId === work.id)
  const artifactSpecs = [
    ['file', `src/features/${work.id}.ts`, undefined, undefined],
    ['function', `实现${work.title}`, `implement${work.id.replace(/[^a-zA-Z0-9]/g, '')}`, undefined],
    ['commit', `Commit ${work.id.slice(-7)}`, undefined, work.id.slice(-7)]
  ]
  for (const [artifactType, path, functionName, commitSha] of artifactSpecs) {
    const exists = existingArtifacts.some(item => item.artifactType === artifactType && (item.path === path || item.functionName === functionName || item.commitSha === commitSha))
    if (exists) continue
    const artifact = { id: `demo-artifact-${work.id}-${artifactType}`, projectId, workItemId: work.id, sessionId: session.id, artifactType, path, functionName, commitSha, diffSummary: `演示摘要：${work.title} 的${artifactType}证据，已脱敏保存。`, createdAt: now }
    await store.saveArtifact(artifact)
    const decision = decisions.get(work.id)
    if (decision) await store.saveDecisionArtifactLink({ decisionId: decision.id, artifactId: artifact.id })
    added++
  }
  if (!decisions.has(work.id)) {
    await store.saveDecisionRecord({ id: `demo-decision-${work.id}`, projectId, workItemId: work.id, sessionId: session.id, title: `关键决策：${work.title}`, decision: `围绕${work.title}保留可验证的实现路径、失败边界和回滚方案。`, rationale: '优先保证可追溯和可验证，再逐步优化实现。', decisionType: 'architecture', importance: 'high', decisionMaker: 'collaborative', userParticipation: 'accepted', createdAt: now })
    added++
  }
}
console.log(JSON.stringify({ ok: true, projectId, userId, added, workItems: store.listWorkItems(projectId).length, sessions: store.listAgentSessions(projectId).length, artifacts: store.listArtifacts(projectId).length, decisions: store.listDecisionRecords(projectId).length }))
