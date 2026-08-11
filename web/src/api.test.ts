import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, checkAuthSession, createSession, logoutAuth } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
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
    expect(error.message).toBe("登录状态已失效，请重新登录");
  });

  it("does not trust a stale local login marker when the session cookie is gone", async () => {
    localStorage.setItem("mindiou_access_session", "active");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: false, error: "Authentication required" }),
      { status: 401, headers: { "content-type": "application/json" } }
    )));

    const user = await checkAuthSession();

    expect(user).toBeNull();
    expect(localStorage.getItem("mindiou_access_session")).toBeNull();
  });

  it("can restore a session from the server even when the local marker is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, user: { id: "user-1", email: "user@example.com" } }),
      { status: 200, headers: { "content-type": "application/json" } }
    )));

    const user = await checkAuthSession();

    expect(user).toEqual({ id: "user-1", email: "user@example.com" });
  });

  it("clears the local marker immediately and sends the session cookie on logout", async () => {
    localStorage.setItem("mindiou_access_session", "active");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await logoutAuth();

    expect(localStorage.getItem("mindiou_access_session")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      cache: "no-store"
    });
  });
});
