import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSession, fetchReport, fetchSession } from "./api";
import { renderAppPage, renderReportPage, renderSessionPage } from "./pages";
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

  it("renders input form with textarea", () => {
    renderAppPage(root);
    const textarea = root.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(textarea?.placeholder).toContain("粘贴");
    expect(textarea?.maxLength).toBe(30000);
  });

  it("renders demo sample button", () => {
    renderAppPage(root);
    const demoBtn = root.querySelector(".btn-demo-sample");
    expect(demoBtn).not.toBeNull();
    expect(demoBtn?.textContent).toContain("演示样本");
  });

  it("demo button fills textarea with sample text", () => {
    renderAppPage(root);
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    const demoBtn = root.querySelector(".btn-demo-sample") as HTMLButtonElement;
    expect(textarea.value).toBe("");
    demoBtn.click();
    expect(textarea.value.length).toBeGreaterThan(100);
    expect(textarea.value).toContain("服务器");
  });

  it("submit button starts disabled", () => {
    renderAppPage(root);
    const submit = root.querySelector(".btn-primary") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("submit button enables when textarea has content", () => {
    renderAppPage(root);
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    const submit = root.querySelector(".btn-primary") as HTMLButtonElement;
    textarea.value = "这是一段足够长的测试文本内容";
    textarea.dispatchEvent(new Event("input"));
    expect(submit.disabled).toBe(false);
  });

  it("shows step indicator at step 1", () => {
    renderAppPage(root);
    const steps = root.querySelectorAll(".step-dot");
    expect(steps.length).toBe(3);
    expect(steps[0].classList.contains("is-active")).toBe(true);
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
