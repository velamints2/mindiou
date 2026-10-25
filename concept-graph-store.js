import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function emptyState() {
  return {
    version: 1,
    conceptNodes: [],
    debtConceptLinks: [],
    debtRelations: [],
    debtClusters: [],
    debtClusterMembers: []
  };
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 概念图持久化 store（Phase 2：欠条关系与欠条簇）
 *
 * 保存 ConceptNode（全局概念节点，按 conceptKey 唯一）、DebtConceptLink
 * （欠条-概念关联）、DebtRelation（欠条-欠条关系）、DebtCluster 与
 * DebtClusterMember（欠条簇）。使用原子 JSON 文件写入，
 * 与 debt-intelligence-store.js / training-store.js 保持一致的模式。
 */
export function createConceptGraphStore(filePath) {
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
        conceptNodes: Array.isArray(parsed.conceptNodes) ? parsed.conceptNodes : [],
        debtConceptLinks: Array.isArray(parsed.debtConceptLinks) ? parsed.debtConceptLinks : [],
        debtRelations: Array.isArray(parsed.debtRelations) ? parsed.debtRelations : [],
        debtClusters: Array.isArray(parsed.debtClusters) ? parsed.debtClusters : [],
        debtClusterMembers: Array.isArray(parsed.debtClusterMembers) ? parsed.debtClusterMembers : []
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Concept graph store could not be loaded: ${error.message}`);
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

  // ─── ConceptNode（全局，conceptKey 唯一） ───

  async function saveConceptNode(node) {
    const id = clean(node?.id).slice(0, 100);
    if (!id) throw new Error("Concept node id is required");
    const conceptKey = clean(node?.conceptKey).toLowerCase().slice(0, 120);
    if (!conceptKey) throw new Error("conceptKey is required for concept node");
    const now = new Date().toISOString();
    const record = {
      ...node,
      id,
      conceptKey,
      displayName: clean(node.displayName).slice(0, 120),
      description: clean(node.description || "").slice(0, 500),
      parentId: clean(node.parentId || "") || null,
      domainPath: Array.isArray(node.domainPath) ? node.domainPath.map(seg => clean(seg).slice(0, 60)).filter(Boolean) : [],
      status: clean(node.status || "pending_review").slice(0, 40),
      createdAt: clean(node.createdAt) || now,
      updatedAt: clean(node.updatedAt) || now
    };
    const idx = state.conceptNodes.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.conceptNodes[idx] = record;
    } else {
      state.conceptNodes.unshift(record);
    }
    await persist();
    return record;
  }

  /** 按 conceptKey 查找可用节点（merged/deprecated 不再复用） */
  function findConceptNodeByKey(conceptKey) {
    const normalized = clean(conceptKey).toLowerCase();
    if (!normalized) return null;
    return state.conceptNodes.find(
      item => item.conceptKey === normalized && item.status !== "merged" && item.status !== "deprecated"
    ) || null;
  }

  function getConceptNode(id) {
    return state.conceptNodes.find(item => item.id === id) || null;
  }

  function listConceptNodes(status) {
    return status
      ? state.conceptNodes.filter(item => item.status === status)
      : [...state.conceptNodes];
  }

  // ─── DebtConceptLink（幂等：同 debt+concept+type 不重复） ───

  async function saveDebtConceptLink(link) {
    const debtId = clean(link?.cognitiveDebtId).slice(0, 100);
    const conceptNodeId = clean(link?.conceptNodeId).slice(0, 100);
    const relationType = clean(link?.relationType).slice(0, 40);
    if (!debtId || !conceptNodeId || !relationType) {
      throw new Error("cognitiveDebtId, conceptNodeId and relationType are required for debt concept link");
    }
    const existing = state.debtConceptLinks.find(
      item => item.cognitiveDebtId === debtId
        && item.conceptNodeId === conceptNodeId
        && item.relationType === relationType
    );
    if (existing) return existing;
    const record = {
      ...link,
      id: clean(link.id).slice(0, 100),
      cognitiveDebtId: debtId,
      conceptNodeId,
      relationType,
      confidence: Number.isFinite(Number(link.confidence)) ? Number(link.confidence) : 0,
      createdAt: clean(link.createdAt) || new Date().toISOString()
    };
    if (!record.id) throw new Error("Debt concept link id is required");
    state.debtConceptLinks.unshift(record);
    await persist();
    return record;
  }

  function listDebtConceptLinks(filters = {}) {
    let items = [...state.debtConceptLinks];
    if (filters.cognitiveDebtId) {
      items = items.filter(item => item.cognitiveDebtId === filters.cognitiveDebtId);
    }
    if (filters.conceptNodeId) {
      items = items.filter(item => item.conceptNodeId === filters.conceptNodeId);
    }
    if (Array.isArray(filters.cognitiveDebtIds)) {
      const allowed = new Set(filters.cognitiveDebtIds);
      items = items.filter(item => allowed.has(item.cognitiveDebtId));
    }
    return items;
  }

  // ─── DebtRelation（同一无序债务对 + relationType 幂等） ───

  /** 无序对匹配：A→B 与 B→A 视为同一对 */
  function findDebtRelation(debtIdA, debtIdB, relationType) {
    return state.debtRelations.find(item =>
      item.relationType === relationType && (
        (item.sourceDebtId === debtIdA && item.targetDebtId === debtIdB)
        || (item.sourceDebtId === debtIdB && item.targetDebtId === debtIdA)
      )
    ) || null;
  }

  function listRelationsForPair(debtIdA, debtIdB) {
    return state.debtRelations.filter(item =>
      (item.sourceDebtId === debtIdA && item.targetDebtId === debtIdB)
      || (item.sourceDebtId === debtIdB && item.targetDebtId === debtIdA)
    );
  }

  async function saveDebtRelation(relation) {
    const id = clean(relation?.id).slice(0, 100);
    if (!id) throw new Error("Debt relation id is required");
    const sourceDebtId = clean(relation?.sourceDebtId).slice(0, 100);
    const targetDebtId = clean(relation?.targetDebtId).slice(0, 100);
    if (!sourceDebtId || !targetDebtId || sourceDebtId === targetDebtId) {
      throw new Error("Distinct sourceDebtId and targetDebtId are required for debt relation");
    }
    const record = {
      ...relation,
      id,
      userId: clean(relation.userId || "demo-user").slice(0, 100),
      sourceDebtId,
      targetDebtId,
      relationType: clean(relation.relationType).slice(0, 40),
      similarityScore: Number.isFinite(Number(relation.similarityScore)) ? Number(relation.similarityScore) : 0,
      confidence: Number.isFinite(Number(relation.confidence)) ? Number(relation.confidence) : 0,
      reason: clean(relation.reason || "").slice(0, 300),
      status: clean(relation.status || "pending_confirmation").slice(0, 40),
      createdAt: clean(relation.createdAt) || new Date().toISOString()
    };
    const idx = state.debtRelations.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.debtRelations[idx] = record;
    } else {
      state.debtRelations.unshift(record);
    }
    await persist();
    return record;
  }

  function getDebtRelation(id) {
    return state.debtRelations.find(item => item.id === id) || null;
  }

  function listDebtRelations(filters = {}) {
    let items = [...state.debtRelations];
    if (filters.userId !== undefined) {
      items = items.filter(item => item.userId === filters.userId);
    }
    if (filters.cognitiveDebtId) {
      items = items.filter(
        item => item.sourceDebtId === filters.cognitiveDebtId || item.targetDebtId === filters.cognitiveDebtId
      );
    }
    if (filters.status) {
      const allowed = new Set(Array.isArray(filters.status) ? filters.status : [filters.status]);
      items = items.filter(item => allowed.has(item.status));
    }
    if (filters.relationType) {
      const allowed = new Set(Array.isArray(filters.relationType) ? filters.relationType : [filters.relationType]);
      items = items.filter(item => allowed.has(item.relationType));
    }
    return items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  }

  // ─── DebtCluster 与 DebtClusterMember ───

  async function saveDebtCluster(cluster) {
    const id = clean(cluster?.id).slice(0, 100);
    if (!id) throw new Error("Debt cluster id is required");
    const now = new Date().toISOString();
    const record = {
      ...cluster,
      id,
      userId: clean(cluster.userId || "demo-user").slice(0, 100),
      title: clean(cluster.title || "").slice(0, 120),
      description: clean(cluster.description || "").slice(0, 300),
      primaryConceptNodeId: clean(cluster.primaryConceptNodeId || "") || null,
      clusterType: clean(cluster.clusterType || "same_concept").slice(0, 40),
      createdAt: clean(cluster.createdAt) || now,
      updatedAt: clean(cluster.updatedAt) || now
    };
    const idx = state.debtClusters.findIndex(item => item.id === id);
    if (idx >= 0) {
      state.debtClusters[idx] = record;
    } else {
      state.debtClusters.unshift(record);
    }
    await persist();
    return record;
  }

  function getDebtCluster(id) {
    return state.debtClusters.find(item => item.id === id) || null;
  }

  function listDebtClusters(userId) {
    return userId !== undefined
      ? state.debtClusters.filter(item => item.userId === userId)
      : [...state.debtClusters];
  }

  async function deleteDebtCluster(id) {
    state.debtClusters = state.debtClusters.filter(item => item.id !== id);
    state.debtClusterMembers = state.debtClusterMembers.filter(item => item.clusterId !== id);
    await persist();
  }

  async function saveDebtClusterMember(member) {
    const clusterId = clean(member?.clusterId).slice(0, 100);
    const debtId = clean(member?.cognitiveDebtId).slice(0, 100);
    if (!clusterId || !debtId) throw new Error("clusterId and cognitiveDebtId are required for cluster member");
    const existing = state.debtClusterMembers.find(
      item => item.clusterId === clusterId && item.cognitiveDebtId === debtId
    );
    if (existing) return existing;
    const record = {
      clusterId,
      cognitiveDebtId: debtId,
      membershipConfidence: Number.isFinite(Number(member.membershipConfidence))
        ? Number(member.membershipConfidence)
        : 1,
      createdAt: clean(member.createdAt) || new Date().toISOString()
    };
    state.debtClusterMembers.unshift(record);
    await persist();
    return record;
  }

  function listDebtClusterMembers(filters = {}) {
    let items = [...state.debtClusterMembers];
    if (filters.clusterId) {
      items = items.filter(item => item.clusterId === filters.clusterId);
    }
    if (filters.cognitiveDebtId) {
      items = items.filter(item => item.cognitiveDebtId === filters.cognitiveDebtId);
    }
    return items;
  }

  function getState() {
    return state;
  }

  return {
    load,
    saveConceptNode,
    findConceptNodeByKey,
    getConceptNode,
    listConceptNodes,
    saveDebtConceptLink,
    listDebtConceptLinks,
    findDebtRelation,
    listRelationsForPair,
    saveDebtRelation,
    getDebtRelation,
    listDebtRelations,
    saveDebtCluster,
    getDebtCluster,
    listDebtClusters,
    deleteDebtCluster,
    saveDebtClusterMember,
    listDebtClusterMembers,
    getState
  };
}
