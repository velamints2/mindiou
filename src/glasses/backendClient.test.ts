/**
 * Unit tests for the glasses backend client: deck loading degradation path,
 * thin-mode parsing, mark submission, and idempotency. Fetch is stubbed; no
 * real network is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendError,
  THIN_MODE_NOTICE,
  getDeck,
  markIdempotencyKey,
  parseClearanceEntry,
  parseDeckPayload,
  submitMarks,
  type MarkPayload
} from "./backendClient";

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  // fresh stub per test
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const options = { baseUrl: "https://api.example.com", deviceToken: "dt-1" };

describe("parseDeckPayload", () => {
  it("parses the proposed full-deck shape", () => {
    const cards = parseDeckPayload({
      ok: true,
      cards: [
        {
          id: "card-1",
          reportId: "r1",
          gapId: "dangerousGap-1",
          title: "第一步做什么？",
          whyItMatters: "先保护证据",
          evidence: "时间线第 3 步",
          referenceAnswer: "先冻结现场",
          sourceRef: "report#s3"
        }
      ]
    });
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("第一步做什么？");
    expect(cards[0].gapId).toBe("dangerousGap-1");
    expect(cards[0].sourceRef).toBe("report#s3");
  });

  it("tolerates legacy field names (prompt/target/answer)", () => {
    const cards = parseDeckPayload({
      cards: [{ prompt: "p", target: "t", answer: "a" }]
    });
    expect(cards[0].title).toBe("p");
    expect(cards[0].gapId).toBe("t");
    expect(cards[0].referenceAnswer).toBe("a");
  });

  it("returns [] for malformed payloads and drops title-less cards", () => {
    expect(parseDeckPayload(null)).toEqual([]);
    expect(parseDeckPayload({ cards: "nope" })).toEqual([]);
    expect(parseDeckPayload({ cards: [{ whyItMatters: "x" }] })).toEqual([]);
  });
});

describe("parseClearanceEntry", () => {
  it("parses the thin entry", () => {
    const entry = parseClearanceEntry({
      ok: true,
      platform: "mentra",
      entry: { reportId: "r1", cardId: "c2", target: "缺口", prompt: "问题", cardNumber: 2, cardCount: 5 }
    });
    expect(entry).not.toBeNull();
    expect(entry!.cardNumber).toBe(2);
    expect(entry!.cardCount).toBe(5);
  });

  it("returns null when entry is missing or ok is false", () => {
    expect(parseClearanceEntry({ ok: true, entry: null })).toBeNull();
    expect(parseClearanceEntry({ ok: false })).toBeNull();
  });
});

describe("getDeck", () => {
  it("returns full mode when the deck endpoint answers with cards", async () => {
    stubFetch(url => {
      expect(url).toBe("https://api.example.com/api/g2/deck");
      return jsonResponse(200, { ok: true, cards: [{ id: "c1", title: "t" }] });
    });
    const deck = await getDeck(options);
    expect(deck.mode).toBe("full");
    expect(deck.cards).toHaveLength(1);
  });

  it("degrades to labelled thin mode on deck 404", async () => {
    stubFetch(url =>
      url.includes("/api/g2/deck")
        ? jsonResponse(404, { ok: false, error: "not found" })
        : jsonResponse(200, { ok: true, platform: "mentra", entry: { reportId: "r", cardId: "c", target: "g", prompt: "q", cardNumber: 1, cardCount: 3 } })
    );
    const deck = await getDeck(options);
    expect(deck.mode).toBe("thin");
    expect(deck.notice).toContain(THIN_MODE_NOTICE);
    expect(deck.attempts.join("\n")).toContain("① GET /api/g2/deck");
    expect(deck.attempts.join("\n")).toContain("② GET /api/mentra/clearance-entry");
  });

  it("throws BackendError with the full attempts trail when both fail", async () => {
    stubFetch(() => jsonResponse(500, { ok: false, error: "boom" }));
    const failure = await getDeck(options).catch(error => error);
    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as BackendError).attempts).toHaveLength(2);
  });

  it("reports bad_payload when the response is not JSON", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("<html>nope</html>", { status: 200 }))
    ) as unknown as typeof fetch;
    const failure = await getDeck(options).catch(error => error);
    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as BackendError).code).toBe("bad_payload");
  });

  it("never sends the token in the URL and sends it as a Bearer header", async () => {
    let seenAuth = "";
    stubFetch((url, init) => {
      expect(url).not.toContain("dt-1");
      seenAuth = String((init?.headers as Record<string, string>)?.authorization || "");
      return jsonResponse(200, { ok: true, cards: [{ id: "c1", title: "t" }] });
    });
    await getDeck(options);
    expect(seenAuth).toBe("Bearer dt-1");
  });
});

describe("markIdempotencyKey", () => {
  const marks: MarkPayload[] = [
    { cardId: "c1", mark: "known", deepestLayer: "why", answerRevealed: false },
    { cardId: "c2", mark: "review", deepestLayer: "answer", answerRevealed: true }
  ];

  it("is deterministic and order-independent", () => {
    const a = markIdempotencyKey(marks);
    const b = markIdempotencyKey([...marks].reverse());
    expect(a).toBe(b);
    expect(a.startsWith("g2m-")).toBe(true);
  });

  it("changes when the marks change", () => {
    expect(markIdempotencyKey(marks)).not.toBe(
      markIdempotencyKey([{ ...marks[0], mark: "review" }])
    );
  });
});

describe("submitMarks", () => {
  const marks: MarkPayload[] = [{ cardId: "c1", mark: "known", deepestLayer: "question", answerRevealed: false }];

  it("resolves on 200", async () => {
    stubFetch(() => jsonResponse(200, { ok: true, accepted: 1 }));
    await expect(submitMarks(options, marks)).resolves.toEqual({ ok: true });
  });

  it("maps 404 to an explicit unsupported error, never success", async () => {
    stubFetch(() => jsonResponse(404, { ok: false, error: "not deployed" }));
    const failure = await submitMarks(options, marks).catch(error => error);
    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as BackendError).code).toBe("unsupported");
  });

  it("times out with a dedicated code", async () => {
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })
    ) as unknown as typeof fetch;
    const failure = await submitMarks({ ...options, timeoutMs: 20 }, marks).catch(error => error);
    expect(failure).toBeInstanceOf(BackendError);
    expect((failure as BackendError).code).toBe("timeout");
  });
});
