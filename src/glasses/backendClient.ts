/**
 * Browser-side client for the MindIOU glasses backend.
 *
 * getDeck() degrades visibly:
 *   1. GET {baseUrl}/api/g2/deck        (proposed full-deck contract; 404 today)
 *   2. GET {baseUrl}/api/mentra/clearance-entry  (thin mode: question layer only)
 *   3. throws BackendError -> the console enters an explicit error state.
 *
 * submitMarks() POSTs to the proposed /api/g2/marks contract with a
 * deterministic client idempotency key; a 404 is reported as "unsupported",
 * never disguised as success. The device token is only sent as a Bearer header
 * and is never logged.
 */
import type { CardLayer, CardMark, DebtCard } from "../glasses-core/types";

const DEFAULT_TIMEOUT_MS = 8000;

export interface BackendClientOptions {
  baseUrl: string;
  deviceToken?: string;
  timeoutMs?: number;
}

export type BackendErrorCode = "unsupported" | "network" | "timeout" | "http" | "bad_payload" | "empty";

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly status?: number;
  /** Human-readable degradation path, shown in the console error area. */
  readonly attempts: string[];

  constructor(code: BackendErrorCode, message: string, extras: { status?: number; attempts?: string[] } = {}) {
    super(message);
    this.name = "BackendError";
    this.code = code;
    this.status = extras.status;
    this.attempts = extras.attempts ?? [];
  }
}

export interface DeckResult {
  mode: "full" | "thin";
  cards: DebtCard[];
  /** User-facing mode notice; thin mode is always labelled. */
  notice: string;
  attempts: string[];
}

export interface MarkPayload {
  cardId: string;
  mark: CardMark;
  deepestLayer: CardLayer;
  answerRevealed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractErrorMessage(payload: unknown): string {
  if (isRecord(payload) && typeof payload.error === "string") return payload.error;
  return "";
}

async function requestJson(
  method: "GET" | "POST",
  options: BackendClientOptions,
  path: string,
  body?: unknown
): Promise<unknown> {
  const base = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
  let url: URL;
  try {
    url = new URL(path.replace(/^\/+/, ""), base);
  } catch {
    throw new BackendError("network", `API 地址格式无效：${options.baseUrl}`);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers: {
        accept: "application/json",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(options.deviceToken ? { authorization: `Bearer ${options.deviceToken}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
  } catch {
    if (controller.signal.aborted) {
      throw new BackendError("timeout", `请求超时（${timeoutMs}ms）`);
    }
    throw new BackendError("network", "网络不可达或连接被拒绝");
  } finally {
    clearTimeout(timer);
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    throw new BackendError("network", "读取响应失败", { status: response.status });
  }
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new BackendError("bad_payload", "响应不是合法 JSON", { status: response.status });
    }
  }
  if (!response.ok) {
    throw new BackendError("http", extractErrorMessage(payload) || `HTTP ${response.status}`, {
      status: response.status
    });
  }
  return payload;
}

function describeFailure(error: unknown): string {
  if (error instanceof BackendError) {
    const status = error.status !== undefined ? `（HTTP ${error.status}）` : "";
    return `${error.message}${status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function toDebtCard(raw: unknown, index: number): DebtCard | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title) || str(raw.prompt);
  if (!title) return null;
  return {
    id: str(raw.id) || `card-${index + 1}`,
    reportId: str(raw.reportId),
    gapId: str(raw.gapId) || str(raw.target),
    title,
    whyItMatters: str(raw.whyItMatters),
    evidence: str(raw.evidence),
    referenceAnswer: str(raw.referenceAnswer) || str(raw.answer),
    ...(str(raw.sourceRef) ? { sourceRef: str(raw.sourceRef) } : {})
  };
}

/** Parse the proposed /api/g2/deck payload; unknown/missing fields degrade to "". */
export function parseDeckPayload(payload: unknown): DebtCard[] {
  if (!isRecord(payload)) return [];
  const rawCards = Array.isArray(payload.cards)
    ? payload.cards
    : isRecord(payload.deck) && Array.isArray(payload.deck.cards)
      ? payload.deck.cards
      : [];
  return rawCards.map((raw, index) => toDebtCard(raw, index)).filter((card): card is DebtCard => card !== null);
}

export interface ClearanceEntry {
  reportId: string;
  cardId: string;
  target: string;
  prompt: string;
  cardNumber: number;
  cardCount: number;
}

/** Parse the mentra clearance-entry payload; null when no entry is available. */
export function parseClearanceEntry(payload: unknown): ClearanceEntry | null {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.entry)) return null;
  const entry = payload.entry;
  return {
    reportId: str(entry.reportId),
    cardId: str(entry.cardId) || "thin-card",
    target: str(entry.target),
    prompt: str(entry.prompt) || "请用自己的话解释这个问题。",
    cardNumber: typeof entry.cardNumber === "number" ? entry.cardNumber : 1,
    cardCount: typeof entry.cardCount === "number" ? entry.cardCount : 1
  };
}

function thinCardFromEntry(entry: ClearanceEntry): DebtCard {
  return {
    id: entry.cardId,
    reportId: entry.reportId,
    gapId: entry.target,
    title: entry.prompt,
    whyItMatters: "",
    evidence: "",
    referenceAnswer: "",
    ...(entry.reportId ? { sourceRef: entry.reportId } : {})
  };
}

export const THIN_MODE_NOTICE = "薄模式：后端完整卡组接口未上线";

/**
 * Load the review deck. Full contract first; on any failure fall back to the
 * thin clearance-entry mode; if both fail, throw a BackendError whose
 * `attempts` describe the exact degradation path.
 */
export async function getDeck(options: BackendClientOptions): Promise<DeckResult> {
  const attempts: string[] = [];
  let fullFailure: unknown = null;
  try {
    const payload = await requestJson("GET", options, "/api/g2/deck");
    const cards = parseDeckPayload(payload);
    if (!cards.length) {
      fullFailure = new BackendError("empty", "卡组接口返回空数据", { attempts: [...attempts] });
      attempts.push("① GET /api/g2/deck → 200，但卡组为空");
    } else {
      attempts.push("① GET /api/g2/deck → 200，完整卡组");
      return { mode: "full", cards, notice: "完整卡组模式", attempts };
    }
  } catch (error) {
    fullFailure = error;
    attempts.push(`① GET /api/g2/deck → ${describeFailure(error)}`);
  }

  try {
    const payload = await requestJson("GET", options, "/api/mentra/clearance-entry");
    const entry = parseClearanceEntry(payload);
    if (!entry) {
      attempts.push("② GET /api/mentra/clearance-entry → 200，但 entry 为空");
      throw new BackendError("empty", "后端暂无可复习的认知卡片", { attempts });
    }
    attempts.push("② GET /api/mentra/clearance-entry → 200（薄模式）");
    return {
      mode: "thin",
      cards: [thinCardFromEntry(entry)],
      notice: `${THIN_MODE_NOTICE}，仅加载问题层（卡片 ${entry.cardNumber}/${entry.cardCount}）`,
      attempts
    };
  } catch (error) {
    if (error instanceof BackendError && error.attempts.length) throw error;
    attempts.push(`② GET /api/mentra/clearance-entry → ${describeFailure(error)}`);
    if (fullFailure instanceof BackendError && fullFailure.code !== "http") {
      throw new BackendError(fullFailure.code, fullFailure.message, { attempts });
    }
    throw new BackendError(
      error instanceof BackendError ? error.code : "network",
      error instanceof Error ? error.message : String(error),
      { attempts }
    );
  }
}

/** Deterministic idempotency key: retrying the same marks reuses the same key. */
export function markIdempotencyKey(marks: MarkPayload[]): string {
  const stable = marks
    .map(mark => `${mark.cardId}:${mark.mark}:${mark.deepestLayer}:${mark.answerRevealed ? 1 : 0}`)
    .sort()
    .join("|");
  let hash = 5381;
  for (let index = 0; index < stable.length; index += 1) {
    hash = ((hash << 5) + hash + stable.charCodeAt(index)) >>> 0;
  }
  return `g2m-${hash.toString(36)}`;
}

/**
 * Submit card marks to the proposed marks contract. A 404 means the endpoint
 * is not deployed yet: surfaced as code "unsupported", never as success.
 */
export async function submitMarks(options: BackendClientOptions, marks: MarkPayload[]): Promise<{ ok: true }> {
  try {
    await requestJson("POST", options, "/api/g2/marks", {
      idempotencyKey: markIdempotencyKey(marks),
      client: "even-g2",
      sentAt: new Date().toISOString(),
      marks
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof BackendError && error.status === 404) {
      throw new BackendError("unsupported", "标记同步接口未上线（HTTP 404），标记已保留在本机", {
        status: 404
      });
    }
    throw error;
  }
}
