import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createSession } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("API error normalization", () => {
  it("turns an nginx 503 HTML page into a short user-facing error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      "<html><head><title>503 Service Temporarily Unavailable</title></head><body>nginx/1.18.0</body></html>",
      { status: 503, headers: { "content-type": "text/html" } }
    )));

    const error = await createSession("r-1", "c-1").catch(value => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(503);
    expect(error.message).toBe("服务暂时不可用，请稍后重试");
    expect(error.message).not.toContain("<html>");
    expect(error.message).not.toContain("nginx");
  });

  it("preserves a structured JSON error from the application server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: false, error: "登录状态已失效" }),
      { status: 401, headers: { "content-type": "application/json" } }
    )));

    const error = await createSession("r-1", "c-1").catch(value => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe("登录状态已失效");
  });
});
