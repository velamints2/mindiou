import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSession, fetchDashboard, fetchReport, fetchSession } from "./api";
import { renderAppPage, renderGenesisPage, renderReportPage, renderSessionPage } from "./pages";
import { el } from "./router";

// Mock API module to avoid network calls
vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  generateTimeline: vi.fn().mockResolvedValue({ draft: { id: "d-1" } }),
  checkHealth: vi.fn().mockResolvedValue({ ok: true }),
  createSession: vi.fn(),
  fetchReport: vi.fn(),
  logoutAccess: vi.fn(),
  getAccessToken: vi.fn().mockReturnValue("fake-token"),
  setAccessToken: vi.fn(),
  validateAccessToken: vi.fn().mockResolvedValue(true),
  checkAccessSession: vi.fn().mockResolvedValue(true),
  fetchCurrentUser: vi.fn().mockResolvedValue(null),
  fetchGenesis: vi.fn().mockResolvedValue({
    ok: true,
    genesis: {
      cohort: "001",
      status: "recruiting",
      stage: "MVP-1.x 首发体验阶段",
      dates: { start: null, end: null },
      capacity: 300,
      estimates: { completed: 87 },
      actual: { registered: 12, joined: 3, completedFirstClearance: 1, adoptedSuggestions: 0 },
      adoptedSuggestions: [],
      productImprovements: [],
      members: [],
      participant: null
    }
  }),
  fetchDashboard: vi.fn().mockResolvedValue({
    ok: true,
    dashboard: {
      reportCount: 0,
      latestReport: null,
      outstandingDebts: [],
      latestSession: null,
      continuable: null
    }
  }),
  fetchSession: vi.fn()
}));

// Mock router navigate
vi.mock("./router", async () => {
  const actual = await vi.importActual("./router");
  return {
    ...actual as object,
    navigate: vi.fn(),
    rememberDraftId: vi.fn()
  };
});

describe("renderAppPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    root = el("div");
    document.body.appendChild(root);
  });

  it("renders input form with textarea", async () => {
    await renderAppPage(root);
    const textarea = root.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.placeholder).toContain("粘贴");
    expect(textarea?.maxLength).toBe(-1);
    expect(root.querySelector(".input-limits")?.textContent).toContain("30,000");
    expect(root.querySelector(".input-limits")?.textContent).toContain("每天最多进行 3 次");
  });

  it("renders demo sample button", async () => {
    await renderAppPage(root);
    const demoBtn = root.querySelector(".btn-demo-sample");
    expect(demoBtn).not.toBeNull();
    expect(demoBtn?.textContent).toContain("演示样本");
  });

  it("demo button fills textarea with sample text", async () => {
    await renderAppPage(root);
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    const demoBtn = root.querySelector(".btn-demo-sample") as HTMLButtonElement;
    expect(textarea.value).toBe("");
    demoBtn.click();
    expect(textarea.value.length).toBeGreaterThan(100);
    expect(textarea.value).toContain("服务器");
  });

  it("submit button starts disabled", async () => {
    await renderAppPage(root);
    const submit = root.querySelector(".btn-primary") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("submit button enables when textarea has content", async () => {
    await renderAppPage(root);
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    const submit = root.querySelector(".btn-primary") as HTMLButtonElement;
    textarea.value = "这是一段足够长的测试文本内容";
    textarea.dispatchEvent(new Event("input"));
    expect(submit.disabled).toBe(false);
  });

  it("keeps overlong text visible but blocks submission with a clear message", async () => {
    await renderAppPage(root);
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    const submit = root.querySelector(".btn-primary") as HTMLButtonElement;
    textarea.value = "长".repeat(30_001);
    textarea.dispatchEvent(new Event("input"));
    expect(textarea.value).toHaveLength(30_001);
    expect(submit.disabled).toBe(true);
    expect(root.querySelector(".form-status")?.textContent).toContain("超过 30,000 字符");
    expect(root.querySelector(".input-counter")?.classList.contains("is-error")).toBe(true);
  });

  it("shows step indicator at step 1", async () => {
    await renderAppPage(root);
    const steps = root.querySelectorAll(".step-dot");
    expect(steps.length).toBe(3);
    expect(steps[0].classList.contains("is-active")).toBe(true);
  });

  it("renders persisted dashboard summary from the authenticated API", async () => {
    vi.mocked(fetchDashboard).mockResolvedValueOnce({
      ok: true,
      dashboard: {
        reportCount: 3,
        latestReport: {
          id: "r-3",
          createdAt: "2026-08-03T00:00:00.000Z",
          display: { title: "Nginx 磁盘 I/O 故障排查", domain: "系统运维" },
          analysis: { artifactKind: "API incident review" },
          sections: { dangerousGaps: [{ title: "解释 iowait 与磁盘饱和的关系", gap: "能力缺口" }], feynmanCards: [] }
        },
        outstandingDebts: [{ reportId: "r-3", cardId: "c-1", title: "Explain the retry strategy", status: "outstanding" }],
        latestSession: {
          id: "s-1", reportId: "r-3", cardId: "c-1", state: "awaiting_answer", endedAt: null,
          createdAt: "2026-08-03T01:00:00.000Z", lastActivityAt: "2026-08-03T02:00:00.000Z",
          reportDisplay: { title: "Nginx 磁盘 I/O 故障排查", domain: "系统运维" },
          cardTitle: "解释重试策略的取舍",
          originalCard: { id: "c-1", target: "解释重试策略的取舍", prompt: "为什么这样重试" },
          clearanceQuestion: "为什么这样重试", attempts: [], finalResult: null
        },
        continuable: { sessionId: "s-1", reportId: "r-3", cardId: "c-1", title: "Explain the retry strategy", state: "awaiting_answer" }
      }
    } as never);

    await renderAppPage(root);

    expect(root.querySelector(".dashboard-metric-value")?.textContent).toBe("3");
    expect(root.textContent).toContain("Nginx 磁盘 I/O 故障排查");
    expect(root.textContent).toContain("系统运维");
    expect(root.textContent).toContain("主要欠条: 解释 iowait 与磁盘饱和的关系");
    expect(root.textContent).toContain("最近一次清偿");
    expect(root.textContent).toContain("解释重试策略的取舍");
    expect(root.textContent).toContain("继续清偿");
    expect(root.textContent).toContain("Explain the retry strategy");
  });
});

describe("renderGenesisPage", () => {
  it("renders the archive, honest metrics, program explanation, privacy status, and two CTAs", async () => {
    const root = el("div");
    document.body.appendChild(root);
    await renderGenesisPage(root);
    expect(root.textContent).toContain("连续 15 天");
    expect(root.textContent).toContain("已正式加入");
    expect(root.textContent).toContain("预期完成者：约 87 人（预估）");
    expect(root.textContent).toContain("这 15 天会发生什么");
    expect(root.textContent).toContain("报名不等于获得身份");
    expect(root.textContent).toContain("上线前需补齐");
    expect(root.querySelectorAll('a[href="#/register"]').length).toBeGreaterThanOrEqual(2);
    expect(root.querySelectorAll('a[href="#/app"]').length).toBeGreaterThanOrEqual(2);
  });
});

describe("renderReportPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    root = el("div");
    document.body.appendChild(root);
  });

  it("shows one retryable error when session creation fails repeatedly", async () => {
    vi.mocked(fetchReport).mockResolvedValue({
      ok: true,
      report: {
        id: "r-1",
        generation: { fallback: false },
        sections: {
          aiCompleted: [],
          userContributed: [],
          dangerousGaps: [],
          cognitiveStructure: {
            facts: [],
            hypotheses: [],
            questions: [],
            decisions: [],
            tradeoffs: []
          },
          feynmanCards: [{
            id: "c-1",
            target: "目标能力",
            prompt: "请解释这个问题",
            difficulty: "intermediate"
          }],
          nextActions: []
        },
        confusionResolutions: []
      } as never
    });
    vi.mocked(createSession).mockRejectedValue(
      new Error("服务暂时不可用，请稍后重试")
    );

    await renderReportPage(root, "r-1");
    const button = root.querySelector(".card-start-btn") as HTMLButtonElement;

    button.click();
    await vi.waitFor(() => {
      expect(button.disabled).toBe(false);
      expect(root.querySelectorAll(".error-inline")).toHaveLength(1);
    });

    button.click();
    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledTimes(2);
      expect(root.querySelectorAll(".error-inline")).toHaveLength(1);
    });

    const error = root.querySelector(".error-inline");
    expect(error?.textContent).toBe("服务暂时不可用，请稍后重试");
    expect(error?.getAttribute("role")).toBe("alert");
  });
});

// 策展备用模式降级通知：研究来源为预设材料，必须对用户透明
describe("renderSessionPage", () => {
  let root: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    root = el("div");
    document.body.appendChild(root);
  });

  it("shows fallback notice when session.researchMode is curated_demo_fallback", async () => {
    const fallbackSession = {
      id: "s-fallback-1",
      reportId: "r-1",
      cardId: "c-1",
      createdAt: "2026-07-27T00:00:00.000Z",
      endedAt: null,
      state: "awaiting_answer",
      originalCard: { id: "c-1", target: "目标能力", prompt: "解释提示" },
      clearanceQuestion: "请解释这个问题",
      researchMode: "curated_demo_fallback",
      sources: [],
      attempts: [],
      finalResult: null
    };
    vi.mocked(fetchSession).mockResolvedValue({
      ok: true,
      session: fallbackSession as never
    });

    await renderSessionPage(root, "s-fallback-1");

    const notice = root.querySelector(".notice-fallback");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("策展备用模式");
  });
});
