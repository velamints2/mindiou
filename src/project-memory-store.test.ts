// @ts-nocheck
import { afterAll, describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createProjectMemoryStore } from '../project-memory-store.js'

const tmpDir = path.join(os.tmpdir(), 'mindiou-project-memory-' + Date.now())
const dbPath = path.join(tmpDir, 'memory.sqlite')
const store = createProjectMemoryStore(dbPath)

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('Project Memory relational store', () => {
  it('isolates projects and deduplicates artifacts by project/path/symbol/commit', () => {
    const alice = store.createProject({ name: 'Alice project' }, 'alice')
    const bob = store.createProject({ name: 'Bob project' }, 'bob')
    const first = store.upsertArtifact({
      projectId: alice.id,
      type: 'file',
      name: 'activationCode.ts',
      repositoryRelativePath: 'src/services/activationCode.ts'
    }, 'alice')
    const duplicate = store.upsertArtifact({
      projectId: alice.id,
      type: 'file',
      name: 'same file',
      repositoryRelativePath: 'src/services/activationCode.ts'
    }, 'alice')
    expect(duplicate.id).toBe(first.id)
    expect(store.listArtifacts(alice.id, 'alice')).toHaveLength(1)
    expect(() => store.getProject(alice.id, 'bob')).toThrow('Project not found')
    expect(() => store.getArtifact(first.id, 'bob')).toThrow('Artifact not found')
    expect(store.listProjects('bob')).toHaveLength(1)
    expect(bob.userId).toBe('bob')
  })

  it('binds one session to multiple artifacts and one work item', () => {
    const project = store.createProject({ name: 'Graph project' }, 'graph-user')
    const workItem = store.createWorkItem({
      projectId: project.id,
      title: '激活码兑换与防重复使用',
      source: 'user_created'
    }, 'graph-user')
    const session = store.saveAgentSession({
      projectId: project.id,
      platform: 'codex',
      sourceFingerprint: 'session-fingerprint-1',
      title: '实现激活码兑换',
      userIntentSummary: '实现接口',
      processingStatus: 'completed'
    }, 'graph-user')
    const file = store.upsertArtifact({
      projectId: project.id,
      type: 'file',
      name: 'redeem.ts',
      repositoryRelativePath: 'src/api/redeem.ts'
    }, 'graph-user')
    const commit = store.upsertArtifact({
      projectId: project.id,
      type: 'commit',
      name: 'Commit 8f3a2d1',
      gitCommitHash: '8f3a2d1'
    }, 'graph-user')
    store.linkSessionWorkItem(session.id, workItem.id, { relation: 'created' }, 'graph-user')
    store.linkSessionArtifact(session.id, file.id, { relation: 'modified' }, 'graph-user')
    store.linkWorkItemArtifact(workItem.id, file.id, { relation: 'modified', sourceSessionId: session.id }, 'graph-user')
    store.linkWorkItemArtifact(workItem.id, commit.id, { relation: 'created', sourceSessionId: session.id }, 'graph-user')
    store.linkDebtArtifact({
      debtId: 'debt-graph',
      artifactId: file.id,
      workItemId: workItem.id,
      sessionId: session.id,
      relation: 'implemented_in'
    }, 'graph-user')
    store.createEvidence({
      debtId: 'debt-graph',
      projectId: project.id,
      workItemId: workItem.id,
      artifactId: file.id,
      trainingAttemptId: 'attempt-e2',
      evidenceType: 'independent_explanation',
      evidenceLevel: 'E2',
      result: 'passed',
      evidenceSummary: '用户独立解释了条件更新'
    }, 'graph-user')
    const decision = store.createDecision({
      projectId: project.id,
      workItemId: workItem.id,
      sessionId: session.id,
      title: '使用条件更新',
      decision: '避免并发重复兑换',
      decisionType: 'database',
      userParticipation: 'accepted'
    }, 'graph-user')
    const detail = store.getWorkItemDetail(workItem.id, 'graph-user')
    expect(detail.sessions).toHaveLength(1)
    expect(detail.artifacts).toHaveLength(2)
    expect(detail.decisions[0].id).toBe(decision.id)
    expect(store.getSessionDetail(session.id, 'graph-user').artifacts).toHaveLength(2)
    expect(store.getOwnership(project.id, 'graph-user', [{ id: 'debt-graph', gapText: '并发控制' }]).workItems[0]).toMatchObject({
      evidenceLevel: 'E2',
      ownershipState: 'explainable'
    })
  })

  it('keeps the same session idempotent and stores hook tokens as revocable hashes', () => {
    const project = store.createProject({ name: 'Hook project' }, 'hook-user')
    const session = store.saveAgentSession({
      projectId: project.id,
      platform: 'manual',
      sourceFingerprint: 'same-fingerprint',
      title: 'first'
    }, 'hook-user')
    const same = store.findAgentSessionByFingerprint('same-fingerprint', 'hook-user')
    expect(same.id).toBe(session.id)
    const hook = store.createHookToken(project.id, 'hook-user', 'Codex hook')
    expect(store.validateHookToken(hook.token)).toMatchObject({ userId: 'hook-user', projectId: project.id })
    store.revokeHookToken(store.listHookTokens(project.id, 'hook-user')[0].id, 'hook-user')
    expect(store.validateHookToken(hook.token)).toBe(null)
  })
})
