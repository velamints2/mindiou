#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

const apiBaseUrl = process.env.SPIRAL_API_URL || "http://localhost:8793";
const apiToken = process.env.LEARNING_API_TOKEN || "";
const allowlist = (process.env.SPIRAL_PROJECT_ALLOWLIST || "")
  .split(path.delimiter)
  .map(item => item.trim())
  .filter(Boolean)
  .map(item => path.resolve(item));

function redact(value) {
  return String(value || "")
    .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/g, "[REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(^|\s)([A-Z][A-Z0-9_]{2,})=([^\s]+)/g, "$1$2=[REDACTED]");
}

function isAllowed(cwd) {
  if (!allowlist.length) return false;
  const resolved = path.resolve(cwd || ".");
  return allowlist.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

async function readInput() {
  const file = process.argv[2];
  if (file) return JSON.parse(await readFile(file, "utf8"));
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  return JSON.parse(body || "{}");
}

function eventText(input) {
  return [
    input.prompt,
    input.last_assistant_message,
    input.message,
    input.summary,
    input.git_summary,
    input.test_summary
  ].filter(Boolean).join("\n");
}

const input = await readInput();
const cwd = input.cwd || input.working_directory || "";
if (!isAllowed(cwd)) {
  console.error("Spiral collector skipped event: cwd is not in SPIRAL_PROJECT_ALLOWLIST");
  process.exit(0);
}

const rawText = redact(eventText(input)).slice(0, 30000);
if (rawText.length < 40) {
  console.error("Spiral collector skipped event: no meaningful learning payload");
  process.exit(0);
}

const response = await fetch(new URL("/v1/events/codex", apiBaseUrl), {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {})
  },
  body: JSON.stringify({
    event_id: input.event_id,
    session_id: input.session_id,
    turn_id: input.turn_id,
    event_type: input.hook_event_name || input.event_type || "Stop",
    source: "codex",
    projectId: cwd,
    title: input.title || "Codex learning increment",
    rawText,
    retainRaw: false,
    privacyTags: ["local-redaction", "allowlisted-project"]
  })
});

const payload = await response.json();
if (!response.ok) throw new Error(payload.error || `Spiral API HTTP ${response.status}`);
console.log(JSON.stringify({
  ok: true,
  eventId: payload.event?.id,
  atoms: payload.atoms?.length || 0,
  cards: payload.cards?.length || 0
}));
