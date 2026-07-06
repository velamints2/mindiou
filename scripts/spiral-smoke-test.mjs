import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = 18893;
const baseUrl = `http://127.0.0.1:${port}`;
const temporaryDir = await mkdtemp(path.join(os.tmpdir(), "spiral-smoke-"));
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
  throw new Error("Spiral API did not start");
}

async function json(pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

try {
  await waitForServer();
  const ingest = await json("/v1/events/codex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      event_id: "smoke-event-1",
      session_id: "smoke-session",
      turn_id: "turn-1",
      event_type: "Stop",
      source: "codex",
      projectId: "/tmp/spiral-g2",
      retainRaw: false,
      rawText: [
        "Goal: connect the Even G2 plugin WebView to a local API.",
        "The request worked in curl but failed on the glasses.",
        "We learned that app.json network whitelist permits the request while browser CORS permits reading the response.",
        "The server was fixed to return Access-Control-Allow-Origin and a regression test now verifies the G2 API flow."
      ].join(" ")
    })
  });

  if (ingest.status !== "captured") throw new Error("Codex event was not captured");
  if (ingest.atoms.length || ingest.debts.length || ingest.cards.length) {
    throw new Error("Ingestion created formal learning assets before human review");
  }

  const checkpoint = await json("/api/spiral/checkpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "/tmp/spiral-g2" })
  });
  if (checkpoint.candidates.length !== 1) {
    throw new Error(`Expected one candidate, received ${checkpoint.candidates.length}`);
  }
  const candidate = checkpoint.candidates[0];
  if (candidate.status !== "pending" || candidate.researchMode !== "stub") {
    throw new Error("Checkpoint did not create a pending candidate with labeled stub research");
  }
  if (Object.values(candidate.gateEvidence || {}).some(value => !value)) {
    throw new Error("Candidate is missing learning-value gate evidence");
  }

  const duplicateCheckpoint = await json("/api/spiral/checkpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectId: "/tmp/spiral-g2" })
  });
  if (duplicateCheckpoint.candidates.length !== 0) {
    throw new Error("Unchanged evidence created a duplicate candidate");
  }

  const rejected = await json(`/api/spiral/candidates/${candidate.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "rejected" })
  });
  if (rejected.path || rejected.cards.length) {
    throw new Error("Rejected candidate created formal learning assets");
  }

  const accepted = await json(`/api/spiral/candidates/${candidate.id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "accepted" })
  });
  if (accepted.path?.cardIds.length !== 5 || accepted.cards.length !== 5) {
    throw new Error("Accepted candidate did not create one five-step learning path");
  }
  if (accepted.cards.some((card, index) => card.pathOrder !== index || card.pathId !== accepted.path.id)) {
    throw new Error("Learning path cards lost their required order or path identity");
  }

  const shortSession = await json("/api/g2/session?duration=15");
  if (shortSession.session.cardCount !== 1) throw new Error("15-second session must contain one due card");
  const longSession = await json("/api/g2/session?duration=180");
  if (longSession.session.cardCount > 5) throw new Error("3-minute session exceeded five cards");

  const next = await json("/v1/review/next?mode=learn");
  if (!next.card?.id) throw new Error("Review scheduler did not return a card");

  const reviewed = await json("/v1/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cardId: next.card.id,
      result: "mastered",
      responseText: "Whitelist permits sending; CORS permits reading the browser response.",
      source: "smoke-test"
    })
  });
  if (reviewed.review.result !== "mastered") throw new Error("Review event was not recorded");
  if (reviewed.debt?.status !== "cleared") throw new Error("Mastered review did not clear its debt");
  if (reviewed.today.metrics.noAiPracticeRate !== 100) throw new Error("No-AI practice metric was not updated");

  const after = await json("/v1/review/next?mode=learn");
  if (after.card?.id === next.card.id) throw new Error("Reviewed card remained immediately due");

  console.log(JSON.stringify({
    ok: true,
    candidateId: candidate.id,
    pathId: accepted.path.id,
    cards: accepted.cards.length,
    shortSessionCards: shortSession.session.cardCount,
    longSessionCards: longSession.session.cardCount,
    reviewedCardId: next.card.id,
    nextCardId: after.card?.id || null
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(temporaryDir, { recursive: true, force: true });
}
