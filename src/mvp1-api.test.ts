// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const API_PORT = 8801;
const OPENAI_PORT = 8802;
const BASE = `http://127.0.0.1:${API_PORT}`;
const STORE = path.resolve("tmp/mvp1-api-test-store.json");
let appProcess;
let fakeOpenAi;
let sessionId = "";

const seededReport = {
  id: "mvp1-seeded-report",
  createdAt: "2026-07-14T00:00:00.000Z",
  input: { artifactText: "G2 request failed in a phone WebView.", artifactType: "codex", charCount: 42, preprocess: null },
  analysis: { userCapability: { currentDomain: "G2 WebView networking" } },
  sections: {
    aiCompleted: [],
    userContributed: [],
    dangerousGaps: [{ rank: 1, gap: "CORS versus reachability", whyDangerous: "A partial fix can pass desktop tests.", evidence: "The device still failed." }],
    cognitiveStructure: { facts: [], hypotheses: [], questions: [], decisions: [], tradeoffs: [] },
    feynmanCards: [{ id: "mvp1-card", target: "CORS versus reachability", prompt: "Explain why a reachable API may still fail in a WebView.", targetLevel: "L2", difficulty: "intermediate", userAnswer: "", aiFollowUp: "", answeredAt: null }],
    nextActions: []
  },
  corrections: [],
  status: "generated"
};

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function waitFor(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

beforeAll(async () => {
  await mkdir(path.dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify({ version: 1, clearanceReports: [seededReport] }, null, 2));
  fakeOpenAi = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.url === "/v1/responses") {
      json(res, 200, { output: [{ type: "message", content: [{ type: "output_text", text: "Reachability comes before CORS. CORS controls whether JavaScript can read a cross-origin response.", annotations: [{ type: "url_citation", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS", title: "Cross-Origin Resource Sharing" }] }] }] });
      return;
    }
    if (req.url === "/v1/chat/completions") {
      const payload = JSON.parse(body || "{}");
      const userInput = JSON.parse(payload.messages?.at(-1)?.content || "{}");
      if (userInput.researchText) {
        json(res, 200, { choices: [{ message: { content: JSON.stringify({
          rewrittenQuestion: "How do reachability and CORS fail at different stages?",
          summary: "They are separate boundaries.",
          scaffold: [{ id: "point-1", point: "Reachability comes before browser response access.", whyItMatters: "A response can arrive but remain unreadable.", sourceIds: ["source-1"] }]
        }) } }] });
        return;
      }
      const good = String(userInput.answer || "").includes("JavaScript");
      const analysis = good ? {
        status: "provisionally_cleared", coverage: 0.9, demonstrated: ["Separates transport from response access"], missing: [], misconceptions: [], evidence: ["The answer describes both stages"], materialSourceIds: ["source-1"], feedback: "Core boundary explained.", teaching: "", nextQuestion: "", recommendation: "end"
      } : {
        status: "needs_practice", coverage: 0.2, demonstrated: ["Mentions network"], missing: ["CORS boundary"], misconceptions: ["Merges all failures"], evidence: ["Only transport is mentioned"], materialSourceIds: ["source-1"], feedback: "Separate transport from browser access.", teaching: "The server may respond before CORS decides whether JavaScript can read it.", nextQuestion: "What does CORS control?", recommendation: "continue"
      };
      json(res, 200, { choices: [{ message: { content: JSON.stringify(analysis) } }] });
      return;
    }
    json(res, 404, { error: { message: "not found" } });
  });
  await new Promise(resolve => fakeOpenAi.listen(OPENAI_PORT, "127.0.0.1", resolve));
  appProcess = spawn("node", ["server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      PORT: String(API_PORT),
      MVP0_STORE_PATH: STORE,
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${OPENAI_PORT}/v1`,
      OPENAI_RESEARCH_MODEL: "gpt-5.5",
      LEARNING_API_TOKEN: ""
    },
    stdio: "pipe"
  });
  await waitFor(`${BASE}/health`);
});

afterAll(async () => {
  appProcess?.kill("SIGTERM");
  await new Promise(resolve => fakeOpenAi?.close(resolve));
  await rm(STORE, { force: true });
});

describe("MVP-1 HTTP vertical slice", () => {
  it("starts from a persisted card without exposing the hidden scaffold", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reportId: seededReport.id, cardId: "mvp1-card" })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    sessionId = data.session.id;
    expect(data.session.clearanceQuestion).toContain("reachability");
    expect(data.session.sources[0].type).toBe("official_doc");
    expect(data.session.scaffold).toBeUndefined();
  });

  it("analyzes an answer and reveals the scaffold", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions/${sessionId}/answers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "The request may reach the server, but CORS can stop JavaScript from reading the response." })
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.attempt.analysis.status).toBe("provisionally_cleared");
    expect(data.session.scaffold).toHaveLength(1);
  });

  it("ends only when the user calls the end endpoint", async () => {
    const response = await fetch(`${BASE}/api/mvp1/sessions/${sessionId}/end`, { method: "POST" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result.status).toBe("provisionally_cleared");
    expect(data.result.sourceReviewRequired).toBe(false);
    expect(data.session.state).toBe("ended");
  });
});
