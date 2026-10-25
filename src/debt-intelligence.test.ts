// @ts-nocheck
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  TAXONOMY_VERSION,
  PROMPT_VERSION,
  validateDebtIntelligence,
  classifyDebt,
  classifyAndSave,
  applyUserCorrection,
  backfillDebtIntelligence
} from "../debt-intelligence.js";
import { createDebtIntelligenceStore } from "../debt-intelligence-store.js";

const tmpDir = path.join(os.tmpdir(), `mindiou-debt-intel-test-${process.pid}`);
const storePath = path.join(tmpDir, "debt-intelligence-store.json");

async function freshStore() {
  await mkdir(tmpDir, { recursive: true });
  const store = createDebtIntelligenceStore(storePath);
  await store.load();
  return store;
}

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function validModelOutput() {
  return {
    domainPath: ["software_engineering", "frontend"],
    primaryGapMechanism: "concept_gap",
    secondaryGapMechanisms: ["verification_gap"],
    taskStage: "execution",
    rootCauses: ["accepted_ai_output_directly"],
    riskTypes: ["quality_risk"],
    transferValue: 3,
    concepts: [{ key: "  CORS  Basics ", displayName: "CORS 跨域资源共享" }],
    prerequisiteConcepts: [{ key: "Same-Origin  Policy", displayName: "同源策略" }],
    classificationConfidence: 0.72,
    evidence: [{ note: "用户直接接受了 AI 给出的跨域配置", source: "gap_evidence" }]
  };
}

function validRecord(overrides = {}) {
  return {
    ...validModelOutput(),
    cognitiveDebtId: "debt-1",
    userId: "user-1",
    taxonomyVersion: TAXONOMY_VERSION,
    promptVersion: PROMPT_VERSION,
    modelName: "test-model",
    isUserCorrected: false,
    createdAt: "2026-08-04T10:00:00.000Z",
    updatedAt: "2026-08-04T10:00:00.000Z",
    ...overrides
  };
}

function makeDebt(id = "debt-1", userId = "user-1") {
  return {
    id,
    userId,
    gapText: "不理解 CORS 预检请求为什么失败",
    gapEvidence: "用户直接复制了 AI 给出的 Access-Control 配置，无法解释 405 预检失败原因",
    status: "new",
    recurrenceCount: 0,
    sourceReports: ["report-1"],
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:00:00.000Z"
  };
}

describe("validateDebtIntelligence — 合法与非法输出", () => {
  it("合法分类输出通过校验，概念 key 被规范化为小写", () => {
    const result = validateDebtIntelligence(validRecord());
    expect(result.ok).toBe(true);
    expect(result.value.concepts[0].key).toBe("cors basics");
    expect(result.value.prerequisiteConcepts[0].key).toBe("same-origin policy");
    expect(result.value.isCurrent).toBe(true);
  });

  it("非法枚举被拒绝", () => {
    expect(validateDebtIntelligence(validRecord({ primaryGapMechanism: "not_a_mechanism" })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ taskStage: "daydreaming" })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ domainPath: ["cooking"] })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ riskTypes: ["existential_risk"] })).ok).toBe(false);
  });

  it("缺少必填字段被拒绝", () => {
    const missing = validRecord();
    delete missing.taskStage;
    expect(validateDebtIntelligence(missing).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ taxonomyVersion: "" })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ rootCauses: [] })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ evidence: [{ note: "只有 note 没有 source" }] })).ok).toBe(false);
  });

  it("transferValue 越界或非整数被拒绝", () => {
    expect(validateDebtIntelligence(validRecord({ transferValue: 0 })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ transferValue: 6 })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ transferValue: 2.5 })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ transferValue: 5 })).ok).toBe(true);
  });

  it("心理诊断词被拒绝", () => {
    const result = validateDebtIntelligence(validRecord({ rootCauses: ["lazy"] }));
    expect(result.ok).toBe(false);
    expect(result.errors.join("; ")).toMatch(/prohibited|invalid/i);
    expect(validateDebtIntelligence(validRecord({ rootCauses: ["low_intelligence"] })).ok).toBe(false);
  });

  it("domainPath 长度越界与 no_material_risk 混用被拒绝", () => {
    expect(validateDebtIntelligence(validRecord({
      domainPath: ["software_engineering", "a", "b", "c", "d"]
    })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({
      riskTypes: ["no_material_risk", "security_risk"]
    })).ok).toBe(false);
  });

  it("置信度越界被拒绝", () => {
    expect(validateDebtIntelligence(validRecord({ classificationConfidence: 1.5 })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ classificationConfidence: -0.1 })).ok).toBe(false);
    expect(validateDebtIntelligence(validRecord({ classificationConfidence: "high" })).ok).toBe(false);
  });
});

describe("classifyDebt — 模型输出校验", () => {
  it("模型输出合法时返回带元信息的分析记录", async () => {
    const chatFn = async () => validModelOutput();
    const analysis = await classifyDebt({ debt: makeDebt(), chatFn, modelName: "test-model" });
    expect(analysis.cognitiveDebtId).toBe("debt-1");
    expect(analysis.taxonomyVersion).toBe(TAXONOMY_VERSION);
    expect(analysis.promptVersion).toBe(PROMPT_VERSION);
    expect(analysis.isUserCorrected).toBe(false);
  });

  it("模型返回缺失字段时 classifyDebt 抛错，classifyAndSave 不落分析记录", async () => {
    const store = await freshStore();
    const chatFn = async () => ({ domainPath: ["software_engineering"] });
    await expect(classifyDebt({ debt: makeDebt(), chatFn, modelName: "m" })).rejects.toThrow(/failed validation/i);

    const result = await classifyAndSave({ store, debt: makeDebt(), chatFn, modelName: "m", trigger: "auto" });
    expect(result.ok).toBe(false);
    expect(store.countAnalyses("debt-1")).toBe(0);
    const runs = store.listAnalysisRuns("debt-1");
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].attemptCount).toBe(3);
    expect(runs[0].errorMessage).toMatch(/failed validation/i);
  });

  it("chatFn 返回 __fallback 时抛错（谨慎降级，不写分析）", async () => {
    const store = await freshStore();
    const chatFn = async () => ({ __fallback: true, __fallbackError: "AI_API_KEY is not set" });
    const result = await classifyAndSave({ store, debt: makeDebt(), chatFn, modelName: "m" });
    expect(result.ok).toBe(false);
    expect(store.countAnalyses("debt-1")).toBe(0);
  });
});

describe("人工纠正保护", () => {
  it("纠正后生成 isUserCorrected=true 的新版本，旧版本不再生效", async () => {
    const store = await freshStore();
    const chatFn = async () => validModelOutput();
    const first = await classifyAndSave({ store, debt: makeDebt(), chatFn, modelName: "m" });
    expect(first.ok).toBe(true);

    const corrected = await applyUserCorrection({
      store,
      debt: makeDebt(),
      patch: { primaryGapMechanism: "mechanism_gap", riskTypes: ["security_risk"], transferValue: 5 }
    });
    expect(corrected.isUserCorrected).toBe(true);
    expect(corrected.isCurrent).toBe(true);
    expect(corrected.version).toBe(2);
    expect(corrected.primaryGapMechanism).toBe("mechanism_gap");
    expect(corrected.domainPath).toEqual(["software_engineering", "frontend"]);

    const current = store.getCurrentAnalysis("debt-1");
    expect(current.id).toBe(corrected.id);
    expect(store.countAnalyses("debt-1")).toBe(2);
  });

  it("人工纠正后自动 reanalyze 被拒绝且不覆盖", async () => {
    const store = await freshStore();
    const chatFn = async () => validModelOutput();
    await classifyAndSave({ store, debt: makeDebt(), chatFn, modelName: "m" });
    await applyUserCorrection({
      store,
      debt: makeDebt(),
      patch: { transferValue: 4 }
    });

    const result = await classifyAndSave({ store, debt: makeDebt(), chatFn, modelName: "m", trigger: "reanalyze" });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("user_corrected");

    const current = store.getCurrentAnalysis("debt-1");
    expect(current.isUserCorrected).toBe(true);
    expect(current.transferValue).toBe(4);
    expect(store.countAnalyses("debt-1")).toBe(2);
  });

  it("纠正 patch 越权字段或非法值被拒绝", async () => {
    const store = await freshStore();
    const chatFn = async () => validModelOutput();
    await classifyAndSave({ store, debt: makeDebt(), chatFn, modelName: "m" });
    await expect(applyUserCorrection({
      store, debt: makeDebt(), patch: { gapText: "改写欠条" }
    })).rejects.toThrow(/not correctable/i);
    await expect(applyUserCorrection({
      store, debt: makeDebt(), patch: { transferValue: 9 }
    })).rejects.toThrow(/failed validation/i);
    expect(store.countAnalyses("debt-1")).toBe(1);
  });
});

describe("backfillDebtIntelligence — 幂等与失败记录", () => {
  it("二次运行 processed=0、skipped 增加，不产生重复当前版本", async () => {
    const store = await freshStore();
    const debts = [makeDebt("debt-1"), makeDebt("debt-2")];
    const chatFn = async () => validModelOutput();

    const first = await backfillDebtIntelligence({ store, debts, chatFn, modelName: "m", batchSize: 10 });
    expect(first.processed).toBe(2);
    expect(first.skipped).toBe(0);
    expect(first.failed).toBe(0);

    const second = await backfillDebtIntelligence({ store, debts, chatFn, modelName: "m", batchSize: 10 });
    expect(second.processed).toBe(0);
    expect(second.skipped).toBe(2);

    for (const id of ["debt-1", "debt-2"]) {
      expect(store.countAnalyses(id)).toBe(1);
      expect(store.listAnalyses(id).filter(a => a.isCurrent)).toHaveLength(1);
    }
  });

  it("batchSize 与 offset 支持分批，失败原因逐条记录", async () => {
    const store = await freshStore();
    const debts = [makeDebt("debt-1"), makeDebt("debt-2"), makeDebt("debt-3")];
    const chatFn = async () => {
      throw new Error("model timeout");
    };
    const first = await backfillDebtIntelligence({ store, debts, chatFn, modelName: "m", batchSize: 2 });
    expect(first.failed).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextOffset).toBe(2);
    expect(first.failures[0].debtId).toBe("debt-1");
    expect(first.failures[0].error).toMatch(/model timeout/i);

    const second = await backfillDebtIntelligence({
      store, debts, chatFn: async () => validModelOutput(), modelName: "m", batchSize: 2, offset: first.nextOffset
    });
    expect(second.processed).toBe(1);
    expect(second.hasMore).toBe(false);

    const runs = store.listAnalysisRuns("debt-1");
    expect(runs.some(run => run.status === "failed" && /model timeout/i.test(run.errorMessage))).toBe(true);
  });

  it("人工纠正的欠条在回填中被跳过", async () => {
    const store = await freshStore();
    const debts = [makeDebt("debt-1")];
    const chatFn = async () => validModelOutput();
    await backfillDebtIntelligence({ store, debts, chatFn, modelName: "m" });
    await applyUserCorrection({ store, debt: makeDebt(), patch: { transferValue: 2 } });

    const result = await backfillDebtIntelligence({ store, debts, chatFn, modelName: "m" });
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(store.getCurrentAnalysis("debt-1").isUserCorrected).toBe(true);
  });
});

describe("debt-intelligence-store — 读写与任务记录", () => {
  it("分析记录持久化并可在重载后恢复", async () => {
    const store = await freshStore();
    const validated = validateDebtIntelligence(validRecord({ id: "analysis-1" }));
    await store.saveAnalysis({ ...validated.value, version: 1, isCurrent: true });

    const store2 = createDebtIntelligenceStore(storePath);
    await store2.load();
    const recovered = store2.getCurrentAnalysis("debt-1");
    expect(recovered).toBeTruthy();
    expect(recovered.primaryGapMechanism).toBe("concept_gap");
    expect(recovered.concepts[0].key).toBe("cors basics");
  });

  it("新版本生效时旧版本 isCurrent 被清除，version 自动递增", async () => {
    const store = await freshStore();
    const v1 = validateDebtIntelligence(validRecord({ id: "a1" })).value;
    const v2 = validateDebtIntelligence(validRecord({ id: "a2", transferValue: 5 })).value;
    await store.saveAnalysis({ ...v1, isCurrent: true });
    await store.saveAnalysis({ ...v2, isCurrent: true });

    const all = store.listAnalyses("debt-1");
    expect(all).toHaveLength(2);
    expect(all.filter(a => a.isCurrent)).toHaveLength(1);
    expect(store.getCurrentAnalysis("debt-1").id).toBe("a2");
    expect(store.getCurrentAnalysis("debt-1").version).toBe(2);
  });

  it("analysisRuns 记录失败原因并按欠条查询", async () => {
    const store = await freshStore();
    await store.saveAnalysisRun({
      id: "run-1",
      cognitiveDebtId: "debt-1",
      userId: "user-1",
      trigger: "auto",
      status: "failed",
      attemptCount: 3,
      errorMessage: "classification output failed validation: taskStage missing",
      startedAt: "2026-08-04T10:00:00.000Z",
      finishedAt: "2026-08-04T10:00:05.000Z"
    });
    const runs = store.listAnalysisRuns("debt-1");
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].attemptCount).toBe(3);
    expect(runs[0].errorMessage).toMatch(/taskStage missing/i);
    expect(store.listAnalysisRuns("other-debt")).toHaveLength(0);
  });

  it("损坏的存储文件容错为空状态", async () => {
    await mkdir(tmpDir, { recursive: true });
    const fs = await import("node:fs/promises");
    await fs.writeFile(storePath, "{broken json");
    const store = createDebtIntelligenceStore(storePath);
    const state = await store.load();
    expect(state.debtIntelligenceAnalyses).toEqual([]);
    expect(state.analysisRuns).toEqual([]);
  });
});
