import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dismissRepaymentReviewItem,
  fetchReport,
  getRepaymentGap,
  getRepaymentReviewQueue,
  importRepaymentGap,
  listMvp0Reports,
  listRepaymentGaps,
  repaymentStatus,
  submitRepaymentAttempt
} from "./api";
import { renderRepaymentDetailPage, renderRepaymentPage } from "./repayment";
import { el, navigate, parseRoute } from "./router";

// Mock API 模块：覆盖 repayment.ts 的全部导入，避免真实网络请求
vi.mock("./api", () => ({
  dismissRepaymentReviewItem: vi.fn(),
  fetchReport: vi.fn(),
  getRepaymentGap: vi.fn(),
  getRepaymentReviewQueue: vi.fn(),
  importRepaymentGap: vi.fn(),
  listMvp0Reports: vi.fn(),
  listRepaymentGaps: vi.fn(),
  repaymentStatus: vi.fn(),
  submitRepaymentAttempt: vi.fn()
}));

// Mock router：保留真实 el/clear/parseRoute，仅拦截 navigate
vi.mock("./router", async () => {
  const actual = await vi.importActual("./router");
  return {
    ...(actual as object),
    navigate: vi.fn()
  };
});

const VERSIONS = {
  evaluatorVersion: "repayment-eval-v1",
  promptSchemaVersion: "repayment-eval-schema-1",
  dataSchemaVersion: "repayment-data-1"
};

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function makeGap(overrides: Record<string, unknown> = {}) {
  return {
    gapId: "gap-1",
    userId: "u-1",
    reportId: "r-1",
    cardId: null,
    gapRank: 1,
    title: "磁盘 I/O 瓶颈根因分析",
    whyItMatters: "不理解根因只会掩盖症状，问题会复发",
    evidence: [
      {
        excerpt: "iostat 显示 %iowait 超过 60%",
        evidenceType: "direct_quote",
        sourceLocation: { kind: "artifact", start: 10, end: 30 }
      },
      {
        excerpt: "用户可能不理解 D 状态进程的含义",
        evidenceType: "inferred",
        sourceLocation: { kind: "unlocated" }
      }
    ],
    systemReasoningSummary: "用户直接接受了 AI 的根因判断，未亲自验证",
    confidence: 0.82,
    userCapabilityLevel: "intermediate",
    verificationMethod: "用自己的话解释 iowait 升高的完整因果链",
    status: "identified",
    statusHistory: [],
    createdAt: "2026-07-29T08:00:00.000Z",
    updatedAt: "2026-07-29T08:00:00.000Z",
    dataSchemaVersion: "repayment-data-1",
    latestAttempt: null,
    nextReviewAt: null,
    ...overrides
  };
}

function makeEvaluation(overrides: Record<string, unknown> = {}) {
  return {
    dimensions: {
      conceptualUnderstanding: { score: 80, evidence: "磁盘写入慢", feedback: "概念基本正确", uncertainty: "low" },
      causalExplanation: { score: 60, evidence: "导致进程阻塞", feedback: "因果链不完整", uncertainty: "medium" },
      practicalReproduction: { score: 55, evidence: "", feedback: "缺少复现步骤", uncertainty: "high" },
      boundariesAndRisks: { score: 40, evidence: "", feedback: "未说明边界", uncertainty: "high" },
      transferAbility: { score: 50, evidence: "", feedback: "未做迁移", uncertainty: "medium" }
    },
    overallScore: 57,
    passed: false,
    overallFeedback: "整体反馈",
    nextQuestion: "如果磁盘本身没有故障呢？",
    ...overrides
  };
}

function makeAttempt(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: "at-1",
    gapId: "gap-1",
    userId: "u-1",
    answer: "因为磁盘写入慢导致进程阻塞",
    submittedAt: "2026-07-29T09:00:00.000Z",
    selfConfidence: 3,
    evaluation: makeEvaluation(),
    feedback: "概念方向正确，但因果链不完整，需要补充验证步骤。",
    nextQuestion: "如果磁盘本身没有故障，还可能是什么原因？",
    repaymentStatus: "attempting",
    evaluatorVersion: "repayment-eval-v1",
    promptSchemaVersion: "repayment-eval-schema-1",
    dataSchemaVersion: "repayment-data-1",
    modelProvider: "openai",
    modelName: "gpt-x",
    fallbackUsed: false,
    errorCategory: null,
    clientAttemptId: "c-1",
    ...overrides
  };
}

function makeReviewItem(overrides: Record<string, unknown> = {}) {
  return {
    reviewItemId: "ri-1",
    gapId: "gap-1",
    userId: "u-1",
    dueAt: "2026-07-30T09:00:00.000Z",
    priority: "high",
    reason: "回答未通过，需要针对遗漏点重新解释",
    attemptCount: 1,
    lastResult: "failed",
    nextQuestionType: "boundary_probe",
    status: "pending",
    createdAt: "2026-07-29T09:00:00.000Z",
    updatedAt: "2026-07-29T09:00:00.000Z",
    gapTitle: "磁盘 I/O 瓶颈根因分析",
    gapStatus: "attempting",
    ...overrides
  };
}

function makeReport() {
  return {
    id: "r-1",
    createdAt: "2026-07-29T08:00:00.000Z",
    input: { artifactText: "材料", artifactType: "AI 对话" },
    sections: {
      dangerousGaps: [
        { rank: 1, gap: "不理解 iowait 升高的因果链", whyDangerous: "会误判根因", evidence: "证据" }
      ]
    },
    corrections: [],
    status: "done"
  };
}

describe("renderRepaymentPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    root = el("div");
    document.body.appendChild(root);
    vi.mocked(repaymentStatus).mockResolvedValue({ ok: true, enabled: true, versions: VERSIONS });
    vi.mocked(listRepaymentGaps).mockResolvedValue({ ok: true, gaps: [] } as never);
    vi.mocked(getRepaymentReviewQueue).mockResolvedValue({ ok: true, items: [] } as never);
    vi.mocked(listMvp0Reports).mockResolvedValue({ ok: true, reports: [] } as never);
  });

  it("renders three sections with badges and next review time", async () => {
    const active = makeGap({ nextReviewAt: "2026-07-31T09:00:00.000Z" });
    const repaid = makeGap({
      gapId: "gap-2",
      status: "repaid",
      latestAttempt: makeAttempt({ evaluation: makeEvaluation({ overallScore: 88 }) })
    });
    vi.mocked(listRepaymentGaps).mockResolvedValue({ ok: true, gaps: [active, repaid] } as never);
    vi.mocked(getRepaymentReviewQueue).mockResolvedValue({ ok: true, items: [makeReviewItem()] } as never);

    await renderRepaymentPage(root);

    expect(root.textContent).toContain("待清偿");
    expect(root.textContent).toContain("复习队列");
    expect(root.textContent).toContain("清偿记录");
    expect(root.textContent).toContain("历史报告");
    // 状态徽章
    expect(root.querySelector(".status-identified")?.textContent).toBe("已识别");
    expect(root.querySelector(".status-repaid")?.textContent).toBe("已清偿");
    // 置信度与下次复习时间
    expect(root.textContent).toContain("置信度 82%");
    expect(root.textContent).toContain("下次复习：");
    // 复习队列：优先级中文、原因、到期
    expect(root.querySelector(".priority-high")?.textContent).toContain("高");
    expect(root.textContent).toContain("回答未通过，需要针对遗漏点重新解释");
    expect(root.textContent).toContain("到期：");
    expect(root.textContent).toContain("边界追问");
    // 清偿记录：最近评估得分
    expect(root.textContent).toContain("最近评估 88 分");
  });

  it("shows specific empty states when nothing exists", async () => {
    await renderRepaymentPage(root);
    expect(root.textContent).toContain("暂无待清偿的认知欠条");
    expect(root.textContent).toContain("暂时没有到期复习");
    expect(root.textContent).toContain("还没有已清偿的欠条");
    expect(root.textContent).toContain("还没有认知债务报告");
  });

  it("shows disabled notice and skips data loading when flag is off", async () => {
    vi.mocked(repaymentStatus).mockResolvedValue({ ok: true, enabled: false, versions: VERSIONS });

    await renderRepaymentPage(root);

    expect(root.textContent).toContain("认知清偿 V1 未启用");
    expect(root.querySelectorAll(".gap-row").length).toBe(0);
    expect(listRepaymentGaps).not.toHaveBeenCalled();
    expect(getRepaymentReviewQueue).not.toHaveBeenCalled();
  });

  it("imports a gap from a report and navigates to its detail", async () => {
    vi.mocked(listMvp0Reports).mockResolvedValue({ ok: true, reports: [makeReport()] } as never);
    vi.mocked(fetchReport).mockResolvedValue({ ok: true, report: makeReport() } as never);
    vi.mocked(importRepaymentGap).mockResolvedValue({ ok: true, gap: makeGap() } as never);

    await renderRepaymentPage(root);

    const head = root.querySelector(".report-import-head") as HTMLButtonElement;
    expect(head.textContent).toContain("AI 对话");
    head.click();
    await flush();

    const importBtn = root.querySelector(".import-gap-row .btn-primary") as HTMLButtonElement;
    expect(importBtn).not.toBeNull();
    expect(root.textContent).toContain("#1 不理解 iowait 升高的因果链");
    importBtn.click();
    await flush();

    expect(importRepaymentGap).toHaveBeenCalledWith("r-1", 1);
    expect(navigate).toHaveBeenCalledWith({ name: "repayment-detail", gapId: "gap-1" });
  });

  it("dismisses a review item and reloads", async () => {
    vi.mocked(getRepaymentReviewQueue).mockResolvedValue({ ok: true, items: [makeReviewItem()] } as never);
    vi.mocked(dismissRepaymentReviewItem).mockResolvedValue({ ok: true, item: makeReviewItem({ status: "dismissed" }) } as never);

    await renderRepaymentPage(root);
    const dismissBtn = [...root.querySelectorAll(".review-row-actions button")]
      .find(btn => btn.textContent === "忽略") as HTMLButtonElement;
    expect(dismissBtn).not.toBeUndefined();
    dismissBtn.click();
    await flush();

    expect(dismissRepaymentReviewItem).toHaveBeenCalledWith("ri-1");
    // 重新加载列表
    expect(getRepaymentReviewQueue).toHaveBeenCalledTimes(2);
  });
});

describe("renderRepaymentDetailPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    root = el("div");
    document.body.appendChild(root);
    vi.mocked(getRepaymentGap).mockResolvedValue({
      ok: true,
      gap: makeGap({ status: "attempting" }),
      attempts: [makeAttempt()],
      reviewItems: [makeReviewItem()]
    } as never);
  });

  it("renders five dimension bars, feedback and review info", async () => {
    await renderRepaymentDetailPage(root, "gap-1");

    expect(root.querySelectorAll(".dim-row").length).toBe(5);
    expect(root.textContent).toContain("概念理解");
    expect(root.textContent).toContain("因果解释");
    expect(root.textContent).toContain("实践复现");
    expect(root.textContent).toContain("边界与风险");
    expect(root.textContent).toContain("迁移能力");
    // 反馈与下一问醒目展示
    expect(root.textContent).toContain("概念方向正确，但因果链不完整，需要补充验证步骤。");
    expect(root.textContent).toContain("如果磁盘本身没有故障，还可能是什么原因？");
    // 证据：原文徽章与推断说明
    expect(root.querySelector(".evidence-direct")?.textContent).toContain("原文证据");
    expect(root.textContent).toContain("未能定位到输入材料原文，置信度已下调");
    // 复习信息
    expect(root.textContent).toContain("复习信息");
    expect(root.textContent).toContain("边界追问");
  });

  it("shows yellow fallback notice when latest attempt used fallback", async () => {
    vi.mocked(getRepaymentGap).mockResolvedValue({
      ok: true,
      gap: makeGap({ status: "attempting" }),
      attempts: [makeAttempt({ fallbackUsed: true, errorCategory: "unavailable" })],
      reviewItems: []
    } as never);

    await renderRepaymentDetailPage(root, "gap-1");

    const notice = root.querySelector(".notice-fallback");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("AI 评价暂不可用，本次为本地评价结果，可稍后重试");
  });

  it("renders injected markup as inert text, never as HTML", async () => {
    const xssAttempt = makeAttempt({
      feedback: "<img src=x onerror=alert(1)>",
      nextQuestion: "{{placeholder}}"
    });
    const xssGap = makeGap({
      status: "attempting",
      evidence: [
        {
          excerpt: "<script>alert(2)</script>",
          evidenceType: "direct_quote",
          sourceLocation: { kind: "artifact", start: 0, end: 5 }
        }
      ]
    });
    vi.mocked(getRepaymentGap).mockResolvedValue({
      ok: true,
      gap: xssGap,
      attempts: [xssAttempt],
      reviewItems: []
    } as never);

    await renderRepaymentDetailPage(root, "gap-1");

    // 不生成任何可执行节点
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
    // 原文作为纯文本保留（textContent 上屏）
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(root.textContent).toContain("{{placeholder}}");
  });

  it("submits answer with clientAttemptId and disables button while pending", async () => {
    vi.mocked(getRepaymentGap).mockResolvedValue({
      ok: true,
      gap: makeGap({ status: "attempting" }),
      attempts: [],
      reviewItems: []
    } as never);
    let resolveSubmit!: (value: unknown) => void;
    vi.mocked(submitRepaymentAttempt).mockImplementation(
      () => new Promise(resolve => { resolveSubmit = resolve as (value: unknown) => void; })
    );

    await renderRepaymentDetailPage(root, "gap-1");

    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "我的解释：磁盘写入队列堆积导致 iowait 升高，进程进入 D 状态";
    textarea.dispatchEvent(new Event("input"));
    const submit = root.querySelector(".repayment-answer .btn-primary") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    submit.click();
    // 提交中禁用，防止双击
    expect(submit.disabled).toBe(true);
    expect(submitRepaymentAttempt).toHaveBeenCalledTimes(1);
    const [gapIdArg, payload] = vi.mocked(submitRepaymentAttempt).mock.calls[0] as unknown as [
      string,
      { answer: string; clientAttemptId: string }
    ];
    expect(gapIdArg).toBe("gap-1");
    expect(payload.answer).toContain("磁盘写入队列堆积");
    expect(typeof payload.clientAttemptId).toBe("string");
    expect(payload.clientAttemptId.length).toBeGreaterThan(0);

    resolveSubmit({ ok: true, attempt: makeAttempt(), gap: makeGap({ status: "attempting" }) });
    await flush();
    await flush();
    // 成功后整体重载详情
    expect(getRepaymentGap).toHaveBeenCalledTimes(2);
  });
});

describe("repayment routes", () => {
  it("parses repayment list and detail routes", () => {
    location.hash = "#/repayment";
    expect(parseRoute()).toEqual({ name: "repayment" });
    location.hash = "#/repayment/gap-9";
    expect(parseRoute()).toEqual({ name: "repayment-detail", gapId: "gap-9" });
  });
});
