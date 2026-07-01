import { readFile } from "node:fs/promises";

const apiBaseUrl = process.env.LEARNING_API_URL || "http://localhost:8793";
const audioPath = process.env.VOICE_TEST_PCM || "";

async function request(path, options = {}) {
  const response = await fetch(new URL(path, `${apiBaseUrl}/`), options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${payload.error || "unknown error"}`);
  }
  return payload;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await request("/health");
assert(health.ok === true, "API health check failed");
assert(health.sttModel, "Health response is missing sttModel");

const missingAudio = await request("/api/learn/transcribe", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}"
});
assert(missingAudio.ok === false, "Empty transcription request should fail");
assert(missingAudio.error === "Missing audioBase64", "Missing-audio error is not explicit");

let realAudio = {
  attempted: false,
  passed: false,
  text: "",
  latencyMs: null
};

if (audioPath) {
  const pcm = await readFile(audioPath);
  const startedAt = Date.now();
  const result = await request("/api/learn/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: "voice-smoke-test",
      format: "pcm16",
      sampleRate: 16000,
      audioBase64: pcm.toString("base64")
    })
  });
  realAudio = {
    attempted: true,
    passed: result.ok === true && Boolean(result.text),
    text: result.text || "",
    latencyMs: Date.now() - startedAt
  };
  assert(realAudio.passed, result.error || "Real PCM transcription failed");
}

console.log(JSON.stringify({
  passed: true,
  health: {
    ai: health.ai,
    model: health.model,
    sttModel: health.sttModel
  },
  missingAudioError: missingAudio.error,
  realAudio,
  next: audioPath
    ? "Real PCM transcription completed."
    : "Set VOICE_TEST_PCM to a raw 16 kHz mono s16le file for a real transcription check."
}, null, 2));
