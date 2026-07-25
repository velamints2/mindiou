import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";

const TEST_PORT = 8811;
const BASE = `http://127.0.0.1:${TEST_PORT}`;
let serverProcess: ChildProcess | null = null;

async function waitForServer(maxAttempts = 30): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Auth test server did not start");
}

beforeAll(async () => {
  serverProcess = spawn("node", ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      SPIRAL_DISABLE_AI: "1",
      LEARNING_API_TOKEN: "device-token",
      MINDIOU_EARLY_ACCESS_CODES: "alice:invite-alice,bob:invite-bob",
      MINDIOU_SESSION_SECRET: "test-session-secret-with-enough-entropy",
      MINDIOU_SESSION_TTL_SECONDS: "3600",
      MINDIOU_COOKIE_SECURE: "0"
    },
    stdio: "pipe"
  });
  await waitForServer();
});

afterAll(async () => {
  if (!serverProcess?.killed) {
    serverProcess?.kill("SIGTERM");
    await new Promise(resolve => setTimeout(resolve, 150));
  }
});

describe("early-access authentication", () => {
  it("keeps health public while protecting product APIs", async () => {
    expect((await fetch(`${BASE}/health`)).status).toBe(200);
    expect((await fetch(`${BASE}/api/access/session`)).status).toBe(401);
  });

  it("rejects an invalid invite code", async () => {
    const response = await fetch(`${BASE}/api/access/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "wrong-code" })
    });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toContain("邀请码无效");
  });

  it("creates an HttpOnly session for a valid invite code", async () => {
    const login = await fetch(`${BASE}/api/access/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https"
      },
      body: JSON.stringify({ code: "invite-alice" })
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") || "";
    expect(cookie).toContain("mindiou_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("invite-alice");

    const session = await fetch(`${BASE}/api/access/session`, {
      headers: { cookie: cookie.split(";")[0] }
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      ok: true,
      user: { label: "alice" },
      method: "session"
    });
  });

  it("preserves the existing bearer-token path for devices", async () => {
    const response = await fetch(`${BASE}/api/access/session`, {
      headers: { authorization: "Bearer device-token" }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      user: { label: "device-or-service" },
      method: "bearer"
    });
  });

  it("allows an authenticated browser session to use a product API", async () => {
    const login = await fetch(`${BASE}/api/access/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "invite-bob" })
    });
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

    const response = await fetch(`${BASE}/api/mvp0/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie
      },
      body: JSON.stringify({
        artifactType: "meeting",
        artifactText: "AI selected the deployment route. I accepted it but cannot explain the rollback boundary."
      })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, fallback: true });
  });

  it("clears the browser session cookie on logout", async () => {
    const response = await fetch(`${BASE}/api/access/logout`, { method: "POST" });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain("mindiou_session=");
    expect(cookie).toContain("Max-Age=0");
  });
});
