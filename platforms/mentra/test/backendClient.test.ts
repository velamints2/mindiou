import { describe, expect, it } from "vitest";
import { BackendError, createBackendClient, friendlyError } from "../src/backendClient.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    })) as typeof fetch;
}

const entryBody = {
  ok: true,
  entry: {
    reportId: "r1",
    cardId: "c1",
    nextCardId: "c2",
    createdAt: "2026-07-26T00:00:00.000Z",
    domain: "网络",
    target: "CORS",
    prompt: "解释可达性与 CORS 的区别",
    cardNumber: 1,
    cardCount: 2
  }
};

describe("createBackendClient", () => {
  it("GET clearance-entry 并解析入口", async () => {
    const client = createBackendClient({ baseUrl: "http://x", fetchImpl: fakeFetch(200, entryBody) });
    const entry = await client.fetchClearanceEntry();
    expect(entry?.cardId).toBe("c1");
  });

  it("入口为空时返回 null", async () => {
    const client = createBackendClient({ baseUrl: "http://x", fetchImpl: fakeFetch(200, { ok: true, entry: null }) });
    expect(await client.fetchClearanceEntry()).toBeNull();
  });

  it("携带 Bearer token", async () => {
    let auth = "";
    const capture = (async (_url: unknown, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>)?.authorization || "");
      return new Response(JSON.stringify(entryBody), { status: 200 });
    }) as typeof fetch;
    const client = createBackendClient({ baseUrl: "http://x", token: "secret", fetchImpl: capture });
    await client.fetchClearanceEntry();
    expect(auth).toBe("Bearer secret");
  });

  it("429 → rate_limited，503 → unavailable，其他 → http", async () => {
    const c429 = createBackendClient({ baseUrl: "http://x", fetchImpl: fakeFetch(429, { error: "slow down" }) });
    await expect(c429.fetchClearanceEntry()).rejects.toMatchObject({ kind: "rate_limited" });

    const c503 = createBackendClient({ baseUrl: "http://x", fetchImpl: fakeFetch(503, { error: "not ready" }) });
    await expect(c503.fetchClearanceEntry()).rejects.toMatchObject({ kind: "unavailable" });

    const c500 = createBackendClient({ baseUrl: "http://x", fetchImpl: fakeFetch(500, { error: "boom" }) });
    await expect(c500.fetchClearanceEntry()).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("网络异常归类为 network", async () => {
    const broken = (async () => {
      throw new Error("fetch failed");
    }) as typeof fetch;
    const client = createBackendClient({ baseUrl: "http://x", fetchImpl: broken });
    await expect(client.fetchClearanceEntry()).rejects.toMatchObject({ kind: "network" });
  });

  it("缺 baseUrl 直接报错", () => {
    expect(() => createBackendClient({ baseUrl: "" })).toThrow(BackendError);
  });
});

describe("friendlyError", () => {
  it("区分网络/限流/未就绪", () => {
    expect(friendlyError(new BackendError("network", "x"))).toContain("网络");
    expect(friendlyError(new BackendError("rate_limited", "x"))).toContain("频繁");
    expect(friendlyError(new BackendError("unavailable", "x"))).toContain("暂未就绪");
  });

  it("未知错误截断展示", () => {
    expect(friendlyError(new Error("boom"))).toContain("boom");
  });
});
