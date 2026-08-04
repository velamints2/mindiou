/**
 * 项目所有权地图 — 数据存储
 *
 * 存储实体：Project, WorkItem, AgentSession, Artifact,
 * DecisionRecord, EvidenceRecord, DecisionDebtLink,
 * DecisionArtifactLink, ProjectOwnershipSnapshot
 *
 * 使用原子 JSON 文件写入，与 training-store.js / mvp0-store.js / mvp1-store.js 保持一致。
 * 所有实体按 userId 隔离，跨用户访问返回 404。
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    projects: [],
    workItems: [],
    agentSessions: [],
    artifacts: [],
    decisionRecords: [],
    evidenceRecords: [],
    decisionDebtLinks: [],
    decisionArtifactLinks: [],
    ownershipSnapshots: [],
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function createOwnershipStore(filePath) {
  const resolvedPath = path.resolve(filePath);
  let state = emptyState();
  let writeQueue = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await readFile(resolvedPath, "utf8"));
      state = {
        ...emptyState(),
        ...parsed,
        version: 1,
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        workItems: Array.isArray(parsed.workItems) ? parsed.workItems : [],
        agentSessions: Array.isArray(parsed.agentSessions) ? parsed.agentSessions : [],
        artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
        decisionRecords: Array.isArray(parsed.decisionRecords) ? parsed.decisionRecords : [],
        evidenceRecords: Array.isArray(parsed.evidenceRecords) ? parsed.evidenceRecords : [],
        decisionDebtLinks: Array.isArray(parsed.decisionDebtLinks) ? parsed.decisionDebtLinks : [],
        decisionArtifactLinks: Array.isArray(parsed.decisionArtifactLinks) ? parsed.decisionArtifactLinks : [],
        ownershipSnapshots: Array.isArray(parsed.ownershipSnapshots) ? parsed.ownershipSnapshots : [],
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Ownership store could not be loaded: ${error.message}`);
      }
    }
    return state;
  }

  function persist() {
    const snapshot = JSON.stringify(state, null, 2);
    writeQueue = writeQueue.then(async () => {
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      const temporaryPath = `${resolvedPath}.tmp`;
      await writeFile(temporaryPath, snapshot);
      await rename(temporaryPath, resolvedPath);
    });
    return writeQueue;
  }

  // ─── Project ───

  async function saveProject(project) {
    const id = clean(project?.id).slice(0, 100);
    if (!id) throw new Error("Project id is required");
    const record = {
      ...project,
      id,
      userId: clean(project.userId || "demo-user").slice(0, 100),
    };
    const idx = state.projects.findIndex((p) => p.id === id);
    if (idx >= 0) {
      state.projects[idx] = record;
    } else {
      state.projects.unshift(record);
    }
    await persist();
    return record;
  }

  function getProject(id, userId) {
    const project = state.projects.find((p) => p.id === id);
    if (!project || (userId !== undefined && project.userId !== userId)) {
      return null;
    }
    return project;
  }

  function listProjects(userId) {
    return userId !== undefined
      ? state.projects.filter((p) => p.userId === userId)
      : [...state.projects];
  }

  async function deleteProject(id, userId) {
    const project = getProject(id, userId);
    if (!project) return false;
    state.projects = state.projects.filter((p) => p.id !== id);
    // 级联删除关联数据
    state.workItems = state.workItems.filter((w) => w.projectId !== id);
    state.agentSessions = state.agentSessions.filter((s) => s.projectId !== id);
    state.artifacts = state.artifacts.filter((a) => a.projectId !== id);
    state.decisionRecords = state.decisionRecords.filter((d) => d.projectId !== id);
    state.evidenceRecords = state.evidenceRecords.filter((e) => e.projectId !== id);
    state.ownershipSnapshots = state.ownershipSnapshots.filter((s) => s.projectId !== id);
    await persist();
    return true;
  }

  // ─── WorkItem ───

  async function saveWorkItem(workItem) {
    const id = clean(workItem?.id).slice(0, 100);
    if (!id) throw new Error("WorkItem id is required");
    const record = { ...workItem, id };
    const idx = state.workItems.findIndex((w) => w.id === id);
    if (idx >= 0) {
      state.workItems[idx] = record;
    } else {
      state.workItems.unshift(record);
    }
    await persist();
    return record;
  }

  function getWorkItem(id) {
    return state.workItems.find((w) => w.id === id) || null;
  }

  function listWorkItems(projectId) {
    return projectId !== undefined
      ? state.workItems.filter((w) => w.projectId === projectId)
      : [...state.workItems];
  }

  // ─── AgentSession ───

  async function saveAgentSession(session) {
    const id = clean(session?.id).slice(0, 100);
    if (!id) throw new Error("AgentSession id is required");
    const record = { ...session, id };
    const idx = state.agentSessions.findIndex((s) => s.id === id);
    if (idx >= 0) {
      state.agentSessions[idx] = record;
    } else {
      state.agentSessions.unshift(record);
    }
    await persist();
    return record;
  }

  function listAgentSessions(projectId, workItemId) {
    let items = projectId !== undefined
      ? state.agentSessions.filter((s) => s.projectId === projectId)
      : [...state.agentSessions];
    if (workItemId) {
      items = items.filter((s) => s.workItemId === workItemId);
    }
    return items;
  }

  // ─── Artifact ───

  async function saveArtifact(artifact) {
    const id = clean(artifact?.id).slice(0, 100);
    if (!id) throw new Error("Artifact id is required");
    const record = { ...artifact, id };
    const idx = state.artifacts.findIndex((a) => a.id === id);
    if (idx >= 0) {
      state.artifacts[idx] = record;
    } else {
      state.artifacts.unshift(record);
    }
    await persist();
    return record;
  }

  function listArtifacts(projectId, workItemId) {
    let items = projectId !== undefined
      ? state.artifacts.filter((a) => a.projectId === projectId)
      : [...state.artifacts];
    if (workItemId) {
      items = items.filter((a) => a.workItemId === workItemId);
    }
    return items;
  }

  // ─── DecisionRecord ───

  async function saveDecisionRecord(decision) {
    const id = clean(decision?.id).slice(0, 100);
    if (!id) throw new Error("DecisionRecord id is required");
    const record = { ...decision, id };
    const idx = state.decisionRecords.findIndex((d) => d.id === id);
    if (idx >= 0) {
      state.decisionRecords[idx] = record;
    } else {
      state.decisionRecords.unshift(record);
    }
    await persist();
    return record;
  }

  function getDecisionRecord(id) {
    return state.decisionRecords.find((d) => d.id === id) || null;
  }

  function listDecisionRecords(projectId, workItemId) {
    let items = projectId !== undefined
      ? state.decisionRecords.filter((d) => d.projectId === projectId)
      : [...state.decisionRecords];
    if (workItemId) {
      items = items.filter((d) => d.workItemId === workItemId);
    }
    return items;
  }

  async function deleteDecisionRecord(id) {
    const existed = state.decisionRecords.some((d) => d.id === id);
    if (!existed) return false;
    state.decisionRecords = state.decisionRecords.filter((d) => d.id !== id);
    state.decisionDebtLinks = state.decisionDebtLinks.filter((l) => l.decisionId !== id);
    state.decisionArtifactLinks = state.decisionArtifactLinks.filter((l) => l.decisionId !== id);
    await persist();
    return true;
  }

  // ─── EvidenceRecord ───

  async function saveEvidenceRecord(evidence) {
    const id = clean(evidence?.id).slice(0, 100);
    if (!id) throw new Error("EvidenceRecord id is required");
    const record = {
      ...evidence,
      id,
      userId: clean(evidence.userId || "demo-user").slice(0, 100),
    };
    const idx = state.evidenceRecords.findIndex((e) => e.id === id);
    if (idx >= 0) {
      state.evidenceRecords[idx] = record;
    } else {
      state.evidenceRecords.unshift(record);
    }
    await persist();
    return record;
  }

  function listEvidenceRecords(projectId, workItemId, decisionId) {
    let items = projectId !== undefined
      ? state.evidenceRecords.filter((e) => e.projectId === projectId)
      : [...state.evidenceRecords];
    if (workItemId) {
      items = items.filter((e) => e.workItemId === workItemId);
    }
    if (decisionId) {
      items = items.filter((e) => e.decisionId === decisionId);
    }
    return items;
  }

  async function deleteEvidenceRecord(id) {
    const existed = state.evidenceRecords.some((e) => e.id === id);
    if (!existed) return false;
    state.evidenceRecords = state.evidenceRecords.filter((e) => e.id !== id);
    await persist();
    return true;
  }

  // ─── DecisionDebtLink ───

  async function saveDecisionDebtLink(link) {
    const record = { ...link, id: link.id || crypto.randomUUID() };
    state.decisionDebtLinks.unshift(record);
    await persist();
    return record;
  }

  function listDecisionDebtLinks(decisionId) {
    return decisionId !== undefined
      ? state.decisionDebtLinks.filter((l) => l.decisionId === decisionId)
      : [...state.decisionDebtLinks];
  }

  // ─── DecisionArtifactLink ───

  async function saveDecisionArtifactLink(link) {
    const record = { ...link, id: link.id || crypto.randomUUID() };
    state.decisionArtifactLinks.unshift(record);
    await persist();
    return record;
  }

  function listDecisionArtifactLinks(decisionId) {
    return decisionId !== undefined
      ? state.decisionArtifactLinks.filter((l) => l.decisionId === decisionId)
      : [...state.decisionArtifactLinks];
  }

  // ─── OwnershipSnapshot ───

  async function saveSnapshot(snapshot) {
    const record = { ...snapshot, id: snapshot.id || crypto.randomUUID() };
    state.ownershipSnapshots.unshift(record);
    // 保留最近 100 条快照
    if (state.ownershipSnapshots.length > 100) {
      state.ownershipSnapshots = state.ownershipSnapshots.slice(0, 100);
    }
    await persist();
    return record;
  }

  function listSnapshots(projectId, limit = 20) {
    return state.ownershipSnapshots
      .filter((s) => s.projectId === projectId)
      .slice(0, limit);
  }

  // ─── 汇总查询 ───

  function getProjectData(projectId) {
    return {
      project: getProject(projectId),
      workItems: listWorkItems(projectId),
      agentSessions: listAgentSessions(projectId),
      artifacts: listArtifacts(projectId),
      decisionRecords: listDecisionRecords(projectId),
      evidenceRecords: listEvidenceRecords(projectId),
      decisionDebtLinks: state.decisionDebtLinks.filter((l) => {
        const decision = state.decisionRecords.find((d) => d.id === l.decisionId);
        return decision && decision.projectId === projectId;
      }),
      decisionArtifactLinks: state.decisionArtifactLinks.filter((l) => {
        const decision = state.decisionRecords.find((d) => d.id === l.decisionId);
        return decision && decision.projectId === projectId;
      }),
    };
  }

  function getState() {
    return state;
  }

  /**
   * 用于测试：替换内存状态
   */
  function _setState(newState) {
    state = { ...emptyState(), ...newState };
  }

  return {
    load,
    saveProject,
    getProject,
    listProjects,
    deleteProject,
    saveWorkItem,
    getWorkItem,
    listWorkItems,
    saveAgentSession,
    listAgentSessions,
    saveArtifact,
    listArtifacts,
    saveDecisionRecord,
    getDecisionRecord,
    listDecisionRecords,
    deleteDecisionRecord,
    saveEvidenceRecord,
    listEvidenceRecords,
    deleteEvidenceRecord,
    saveDecisionDebtLink,
    listDecisionDebtLinks,
    saveDecisionArtifactLink,
    listDecisionArtifactLinks,
    saveSnapshot,
    listSnapshots,
    getProjectData,
    getState,
    _setState,
  };
}
