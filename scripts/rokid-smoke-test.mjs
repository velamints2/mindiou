import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = 18894;
const baseUrl = `http://127.0.0.1:${port}`;
const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "rokid-smoke-"));
const server = spawn(process.execPath, ["server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    SPIRAL_DISABLE_AI: "1",
    LEARNING_API_TOKEN: "",
    LEARNING_STORE_PATH: path.join(temporaryDir, "store.json")
  },
  stdio: ["ignore", "pipe", "pipe"]
});

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error("Rokid smoke API did not start");
}

async function json(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

try {
  await waitForServer();

  const demo = await json("/api/rokid/session?duration=60&demo=1");
  if (demo.platform !== "rokid-aiui" || demo.session.cards.length !== 3) {
    throw new Error("Rokid demo session contract failed");
  }
  if (!demo.display.currentCard?.front || !demo.commands.includes("answer")) {
    throw new Error("Rokid session is missing display or command metadata");
  }

  const ingest = await json("/v1/events/codex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: "rokid-smoke-event",
      source: "codex",
      projectId: "rokid-learn-coach",
      retainRaw: false,
      rawText: [
        "Goal: prevent a short voice command from interrupting a long learning answer.",
        "The bug treated every transcript containing next as navigation.",
        "We learned to accept navigation only when the whole transcript is a short explicit command."
      ].join(" ")
    })
  });
  if (ingest.cards.length) throw new Error("Rokid ingest bypassed candidate review");
  const checkpoint = await json("/api/spiral/checkpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "rokid-learn-coach" })
  });
  const candidate = checkpoint.candidates[0];
  if (!candidate?.id) throw new Error("Rokid smoke checkpoint created no candidate");
  const accepted = await json(`/api/spiral/candidates/${candidate.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "accepted" })
  });
  if (accepted.cards.length !== 5) throw new Error("Rokid accepted candidate created no learning path");

  const session = await json("/api/rokid/session?duration=60");
  const card = session.session.cards[0];
  if (!card?.id || card.front.length > 36) throw new Error("Rokid card normalization failed");

  const tutor = await json("/api/rokid/tutor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      card,
      action: "answer",
      transcript: "长回答只有整句话是明确短命令时才应该触发导航。"
    })
  });
  if (!tutor.tutor?.assessment || !tutor.display?.feedback) {
    throw new Error("Rokid tutor response is incomplete");
  }

  const review = await json("/api/rokid/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cardId: card.id,
      result: "partial",
      responseText: "长解释默认是回答，短而完整的命令才导航。"
    })
  });
  if (review.review?.source !== "rokid" || review.debt?.status !== "training") {
    throw new Error("Rokid review was not persisted correctly");
  }

  const imported = await json("/api/rokid/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: "Active recall - retrieve an answer before seeing it.",
      maxCards: 3
    })
  });
  if (imported.platform !== "rokid-aiui" || !imported.cards.length || !imported.fallback) {
    throw new Error("Rokid import fallback contract failed");
  }

  console.log(JSON.stringify({
    ok: true,
    demoCards: demo.session.cards.length,
    liveCards: session.session.cards.length,
    tutorAssessment: tutor.tutor.assessment,
    reviewSource: review.review.source,
    importCards: imported.cards.length,
    importFallbackVisible: imported.fallback
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(temporaryDir, { recursive: true, force: true });
}
