/**
 * 共享后端 HTTP 客户端。复用与 Rokid/G2 相同的设备凭证模型：
 * Authorization: Bearer LEARNING_API_TOKEN。
 */

export interface ClearanceEntry {
  reportId: string;
  cardId: string;
  nextCardId: string;
  createdAt: string;
  domain: string;
  target: string;
  prompt: string;
  cardNumber: number;
  cardCount: number;
}

export interface ClearanceSource {
  id: string;
  title?: string;
  url?: string;
  type?: string;
  credibility?: string;
}

export interface ClearanceSession {
  id: string;
  reportId: string;
  cardId: string;
  state: string;
  clearanceQuestion: string;
  researchSummary?: string;
  researchMode?: string;
  sources: ClearanceSource[];
  scaffold?: { id?: string; point: string }[];
  attempts: unknown[];
  finalResult?: ClearanceFinalResult | null;
}

export interface ClearanceAnalysis {
  status: string;
  coverage: number;
  demonstrated: string[];
  missing: string[];
  misconceptions: string[];
  evidence: string[];
  feedback: string;
  teaching: string;
  nextQuestion: string;
  recommendation: "end" | "continue";
}

export interface ClearanceAttempt {
  id: string;
  createdAt: string;
  answer: string;
  analysis: ClearanceAnalysis;
}

export interface ClearanceFinalResult {
  status: string;
  sourceReviewRequired: boolean;
  evidence: string[];
  demonstrated: string[];
  remainingGaps: string[];
  nextRecommendation: string;
}

export type BackendErrorKind = "network" | "rate_limited" | "unavailable" | "http" | "data";

export class BackendError extends Error {
  kind: BackendErrorKind;
  status?: number;

  constructor(kind: BackendErrorKind, message: string, status?: number) {
    super(message);
    this.name = "BackendError";
    this.kind = kind;
    this.status = status;
  }
}

export interface BackendClientConfig {
  /** 例：http://127.0.0.1:8793 或 https://demo.mindiou.top/mindiou-api（旧 IP 已弃用） */
  baseUrl: string;
  /** LEARNING_API_TOKEN；本地无鉴权部署可为空。 */
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface BackendClient {
  fetchClearanceEntry(): Promise<ClearanceEntry | null>;
  startSession(reportId: string, cardId: string): Promise<ClearanceSession>;
  submitAnswer(sessionId: string, answer: string): Promise<{ attempt: ClearanceAttempt; session: ClearanceSession }>;
  endSession(sessionId: string): Promise<{ result: ClearanceFinalResult; session: ClearanceSession }>;
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return String(data?.error || `HTTP ${response.status}`);
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function createBackendClient(config: BackendClientConfig): BackendClient {
  const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new BackendError("data", "MINDIOU_API_BASE 未配置");
  const fetchImpl = config.fetchImpl || fetch;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch (error) {
      throw new BackendError("network", String((error as Error)?.message || "network error"));
    }
    if (!response.ok) {
      const message = await parseErrorMessage(response);
      if (response.status === 429) throw new BackendError("rate_limited", message, 429);
      if (response.status === 503) throw new BackendError("unavailable", message, 503);
      throw new BackendError("http", message, response.status);
    }
    return (await response.json()) as T;
  }

  return {
    async fetchClearanceEntry() {
      const data = await request<{ ok: boolean; entry: ClearanceEntry | null }>(
        "GET",
        "/api/mentra/clearance-entry"
      );
      return data?.entry || null;
    },
    async startSession(reportId, cardId) {
      const data = await request<{ ok: boolean; session: ClearanceSession }>(
        "POST",
        "/api/mvp1/sessions",
        { reportId, cardId }
      );
      if (!data?.session?.id) throw new BackendError("data", "后端未返回清偿会话");
      return data.session;
    },
    async submitAnswer(sessionId, answer) {
      const data = await request<{ ok: boolean; attempt: ClearanceAttempt; session: ClearanceSession }>(
        "POST",
        `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/answers`,
        { answer }
      );
      if (!data?.attempt?.analysis) throw new BackendError("data", "后端未返回回答分析");
      return { attempt: data.attempt, session: data.session };
    },
    async endSession(sessionId) {
      const data = await request<{ ok: boolean; result: ClearanceFinalResult; session: ClearanceSession }>(
        "POST",
        `/api/mvp1/sessions/${encodeURIComponent(sessionId)}/end`
      );
      if (!data?.result?.status) throw new BackendError("data", "后端未返回结算结果");
      return { result: data.result, session: data.session };
    }
  };
}

/** 面向眼镜屏的错误文案，区分网络/限流/服务未就绪/其他。 */
export function friendlyError(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.kind === "network") return "网络暂时不可用，请检查手机网络后说「重复」重试。";
    if (error.kind === "rate_limited") return "请求过于频繁，请稍等片刻后说「重复」重试。";
    if (error.kind === "unavailable") return "AI 服务暂未就绪，请稍后再试。";
  }
  const message = String((error as Error)?.message || error || "").trim();
  if (/fetch failed|network|socket|dns|timeout|timed out/i.test(message)) {
    return "网络暂时不可用，请检查手机网络后说「重复」重试。";
  }
  return `暂时无法继续：${message.slice(0, 36) || "未知错误"}`;
}
