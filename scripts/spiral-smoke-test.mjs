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

  if (ingest.atoms.length < 1 || ingest.atoms.length > 3) {
    throw new Error(`Expected 1-3 atoms, received ${ingest.atoms.length}`);
  }
  if (ingest.debts.length !== ingest.atoms.length) {
    throw new Error("Each new atom must create one learning debt");
  }
  if (!ingest.debts.every(debt => debt.debtScore >= 0 && debt.debtScore <= 100 && debt.microExercise)) {
    throw new Error("Learning debt is missing score or no-AI exercise");
  }
  if (!ingest.cards.every(card => card.sourceEventId === "smoke-event-1" && card.projectId === "/tmp/spiral-g2")) {
    throw new Error("Generated cards lost source traceability");
  }
  if (!ingest.cards.every(card => {
    const atom = ingest.atoms.find(item => item.id === card.knowledgeAtomId);
    return atom && card.front === atom.concept && card.prompt === atom.recallQuestion;
  })) {
    throw new Error("Generated cards must use concept as front and recall question as prompt");
  }
  if (ingest.cards.some(card => /Goal:|request worked|Access-Control-Allow-Origin/i.test(card.prompt))) {
    throw new Error("Raw source context leaked into a learning-card prompt");
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
    atoms: ingest.atoms.length,
    debts: ingest.debts.length,
    cards: ingest.cards.length,
    shortSessionCards: shortSession.session.cardCount,
    longSessionCards: longSession.session.cardCount,
    reviewedCardId: next.card.id,
    nextCardId: after.card?.id || null
  }, null, 2));
} finally {
  server.kill("SIGTERM");
  await rm(temporaryDir, { recursive: true, force: true });
}
