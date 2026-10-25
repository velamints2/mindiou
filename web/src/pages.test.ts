import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError, createSession, fetchDashboard, fetchDraft, fetchReport, fetchSession, fetchTodayTraining, generateReport, saveDraftConfusions } from "./api";
import { renderAppPage, renderDevicesPage, renderGenesisPage, renderReportPage, renderSessionPage, renderTimelinePage, renderTrainingPage } from "./pages";
import { el, navigate } from "./router";
import { setLocale, translateText } from "./i18n";

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
  fetchDraft: vi.fn(),
  saveDraftConfusions: vi.fn().mockResolvedValue({ ok: true }),
  generateReport: vi.fn(),
  checkHealth: vi.fn().mockResolvedValue({ ok: true }),
  createSession: vi.fn(),
  createDeviceToken: vi.fn().mockResolvedValue({ id: "device-1", name: "眼镜", createdAt: "2026-08-01T00:00:00.000Z", lastUsedAt: null, token: "device-token" }),
  listDeviceTokens: vi.fn().mockResolvedValue([]),
  revokeDeviceToken: vi.fn(),
  listProjects: vi.fn().mockResolvedValue([{ id: "project-1", name: "认知欠条" }]),
  listProjectHookTokens: vi.fn().mockResolvedValue([]),
  createProjectHookToken: vi.fn().mockResolvedValue({ id: "hook-1", projectId: "project-1", name: "评委演示", createdAt: "2026-08-01T00:00:00.000Z", revokedAt: null, token: "hook-token-plaintext" }),
  revokeProjectHookToken: vi.fn(),
  fetchReport: vi.fn(),
  fetchTodayTraining: vi.fn(),
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
      actual: { registered: 12, joined: 3, completedFirstClearance: 1, adoptedSuggestions: 4 },
      adoptedSuggestions: ["建议一", "建议二", "建议三", "建议四"],
      productImprovements: [],
      members: [1, 2, 3, 4, 5].map(index => ({ number: `MIOU-001-000${index}`, activatedAt: null, visibility: "anonymous" as const })),
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
    setLocale("zh-CN");
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

  it("renders the English workbench without Chinese UI chrome", async () => {
    setLocale("en");
    await renderAppPage(root);
    const text = root.textContent || "";
    expect(text).toContain("My cognitive dashboard");
    expect(text).toContain("Find the cognitive work AI skipped for you");
    expect(text).toContain("Attach to project memory");
    expect(text).toContain("Generate a cognitive debt report");
    expect(text).not.toContain("我的认知仪表盘");
    expect(text).not.toContain("识别你跳过的认知债务");
    expect(text).not.toContain("归入项目记忆");
    expect(text).not.toContain("生成认知债务报告");
    expect(text).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("translates compound enum labels instead of leaving a Chinese suffix", () => {
    setLocale("en");
    expect(translateText("协作测试")).toBe("Collaborative test");
    expect(translateText("Collaborative测试")).not.toContain("测试");
    setLocale("zh-CN");
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

  it("shows five visible report-generation stages while the report request is pending", async () => {
    vi.mocked(fetchDraft).mockResolvedValueOnce({
      ok: true,
      draft: {
        id: "d-1",
        generation: { fallback: false },
        timeline: { steps: [{ id: "step-1", title: "确定边界", aiDid: "AI 拆解了任务范围", keyActions: [], keyConcepts: [], userConfusion: "" }] }
      }
    } as never);

    let resolveReport!: (value: unknown) => void;
    vi.mocked(generateReport).mockReturnValueOnce(new Promise(resolve => { resolveReport = resolve; }) as never);

    await renderTimelinePage(root, "d-1");
    const submit = [...root.querySelectorAll("button")].find(button => button.textContent?.includes("生成认知债务报告")) as HTMLButtonElement;
    submit.click();
    await Promise.resolve();
    await Promise.resolve();

    const progress = root.querySelector(".report-progress-overlay");
    expect(progress).not.toBeNull();
    expect(progress?.querySelectorAll(".report-progress-step")).toHaveLength(5);
    expect(progress?.textContent).toContain("Step B：根能力缺口分析");
    expect(progress?.querySelector(".report-progress-step.is-active")?.textContent).toContain("最多 3 次外部资料检索");

    resolveReport({ report: { id: "report-1" } });
    await new Promise(resolve => window.setTimeout(resolve, 320));
    expect(navigate).toHaveBeenCalledWith({ name: "report", reportId: "report-1" });
    expect(vi.mocked(saveDraftConfusions)).toHaveBeenCalledWith("d-1", []);
  });
});

describe("renderGenesisPage", () => {
  it("renders the founder archive, honest metrics, member wall, and privacy status", async () => {
    const root = el("div");
    document.body.appendChild(root);
    await renderGenesisPage(root);
    expect(root.textContent).toContain("注册用户");
    expect(root.textContent).toContain("36");
    expect(root.textContent).toContain("已完成首次清偿");
    expect(root.textContent).toContain("首发体验者名录");
    expect(root.textContent).toContain("当前已支持");
    expect(root.textContent).not.toContain("上线前需补齐");
    expect(root.textContent).toContain("共创建议已采纳");
    expect(root.textContent).toContain("已注册首发用户");
    expect(root.querySelectorAll(".genesis-member")).toHaveLength(5);
    expect(root.textContent).not.toContain("预期完成者");
    expect(root.textContent).not.toContain("这 15 天会发生什么");
  });
});

describe("renderTrainingPage", () => {
  it("shows a sign-in recovery state when the account session has expired", async () => {
    const root = el("div");
    const error = new ApiError(401, "Your session has expired. Please sign in again.");
    vi.mocked(fetchTodayTraining).mockRejectedValueOnce(error);

    await renderTrainingPage(root);

    expect(root.querySelector(".training-session-expired")?.textContent).toContain("登录状态已失效");
    expect(root.querySelector(".training-error-card")).toBeNull();
    expect(root.querySelector(".training-session-expired button")?.textContent).toContain("重新登录");
  });
});

describe("renderDevicesPage", () => {
  it("separates project Hook Token management from glasses tokens and shows plaintext only after creation", async () => {
    const root = el("div");
    document.body.appendChild(root);

    await renderDevicesPage(root);

    expect(root.textContent).toContain("设备 Token 管理");
    expect(root.textContent).toContain("项目 MCP / Hook Token");
    const projectSelect = root.querySelector(".project-hook-section select") as HTMLSelectElement;
    expect(projectSelect.value).toBe("project-1");
    expect(root.querySelector(".project-hook-section .token-display")?.getAttribute("style")).toContain("display: none");

    const nameInput = root.querySelector(".project-hook-section input") as HTMLInputElement;
    nameInput.value = "评委演示";
    const form = root.querySelector(".hook-token-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(root.querySelector(".project-hook-section .token-plaintext")?.getAttribute("value")).toBe(null);
    expect((root.querySelector(".project-hook-section .token-plaintext") as HTMLInputElement).value).toBe("hook-token-plaintext");
    expect(root.textContent).toContain("明文只在生成成功后显示一次");
  });

  it("renders the new token management UI in English", async () => {
    setLocale("en");
    const root = el("div");
    document.body.appendChild(root);
    await renderDevicesPage(root);
    const text = root.textContent || "";
    expect(text).toContain("Project MCP / Hook tokens");
    expect(text).toContain("Generate project token");
    expect(text).not.toContain("项目 MCP / Hook Token");
    expect(text).not.toContain("生成项目 Token");
    setLocale("zh-CN");
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
