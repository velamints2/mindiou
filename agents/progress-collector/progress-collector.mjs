#!/usr/bin/env node
/**
 * Cross-tool project progress collector.
 * Scans local codex / dsh / claude-code session stores, aggregates per-project
 * progress, and optionally pushes a report to the MindIOU backend.
 *
 * Usage:
 *   node progress-collector.mjs                 # scan + print JSON
 *   node progress-collector.mjs --push          # scan + POST to backend
 *   MINDIOU_PROGRESS_TOKEN=... node progress-collector.mjs --push
 *
 * Data sources (adapters, skip silently when absent):
 *   codex  ~/.codex/sessions/...rollout-*.jsonl            (session_meta.cwd)
 *   dsh    ~/.dsh/sessions/...session.v4.jsonl.zstd
 *   claude ~/.claude/projects/[dir]/...jsonl               (dir encodes cwd)
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const MAX_TASK_TEXT = 160;
const MAX_PROJECTS = 30;
const DAYS_WINDOW = 30;

const machineId = createHash("sha256").update(os.hostname() + HOME).digest("hex").slice(0, 12);
const args = new Set(process.argv.slice(2));
const push = args.has("--push");
const backendUrl = (process.env.MINDIOU_PROGRESS_URL || "http://127.0.0.1:8793").replace(/\/+$/, "");
const pushToken = process.env.MINDIOU_PROGRESS_TOKEN || "";

function zstdDecompress(file) {
  return new Promise((resolve) => {
    execFile("/opt/homebrew/bin/zstd", ["-dc", file], { maxBuffer: 24 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? "" : stdout);
    });
  });
}

function firstUserText(lines) {
  for (const line of lines) {
    if (line.length > 2_000_000) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    // codex rollout format
    const p = obj.payload || {};
    if (obj.type === "event_msg" && p.type === "user_message") {
      const t = String(p.message || "").trim();
      if (t && !t.startsWith("<") && !t.includes("environment_context")) return t;
    }
    // codex newer rollout format: response_item message with role=user
    if (obj.type === "response_item" && p.type === "message" && p.role === "user") {
      const t = String((p.content || []).map(c => c.text || "").join(" ")).trim();
      if (t && !t.startsWith("<") && !t.includes("environment_context") && !t.startsWith("#")) return t;
    }
    // dsh v4: agent/inbox/spliced carries the user turn
    if (obj.type === "agent/inbox/spliced" && Array.isArray(obj.data?.inserted)) {
      for (const turn of obj.data.inserted) {
        const text = (turn.content || []).filter(c => c.type === "text").map(c => c.text).join(" ");
        const t = String(text || "").trim();
        if (t && !t.startsWith("#") && !t.startsWith("<")) return t;
      }
    }
    // dsh v4 direct user message
    if (obj.type === "agent/message" && obj.data?.role === "user") {
      const t = String(obj.data.content || "").trim();
      if (t) return t;
    }
  }
  return "";
}

async function* walk(root, depth, match) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      if (depth > 0 && !e.name.startsWith(".")) yield* walk(full, depth - 1, match);
    } else if (match(full)) {
      yield full;
    }
  }
}

async function fileMeta(file) {
  try { return await stat(file); } catch { return null; }
}

async function readHead(file, bytes) {
  const { open } = await import("node:fs/promises");
  try {
    const fh = await open(file, "r");
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally { await fh.close(); }
  } catch { return ""; }
}

async function scanCodex(projects) {
  const root = path.join(HOME, ".codex", "sessions");
  for await (const file of walk(root, 5, f => /rollout-.*\.jsonl$/.test(path.basename(f)))) {
    const meta = await fileMeta(file);
    if (!meta) continue;
    const head = await readHead(file, 400_000);
    const lines = head.split("\n");
    let cwd = "";
    for (const line of lines.slice(0, 3)) {
      try { const o = JSON.parse(line); cwd = o.payload?.cwd || ""; } catch {}
      if (cwd) break;
    }
    if (!cwd) continue;
    const task = firstUserText(lines);
    const rec = projects.get(cwd) || { projectPath: cwd, tools: new Set(), sessions: 0, lastActiveMs: 0, lastTask: "", source: "codex" };
    rec.tools.add("codex");
    rec.sessions += 1;
    if (meta.mtimeMs > rec.lastActiveMs) { rec.lastActiveMs = meta.mtimeMs; if (task) rec.lastTask = task; }
    projects.set(cwd, rec);
  }
}

async function scanDsh(projects) {
  const root = path.join(HOME, ".dsh", "sessions");
  let dirs;
  try { dirs = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const ws of dirs) {
    if (!ws.isDirectory()) continue;
    const wsPath = path.join(root, ws.name);
    let sessions;
    try { sessions = await readdir(wsPath, { withFileTypes: true }); } catch { continue; }
    for (const s of sessions) {
      if (!s.isDirectory() || !s.name.startsWith("session-")) continue;
      const v4 = path.join(wsPath, s.name, "session.v4.jsonl.zstd");
      const meta = await fileMeta(v4);
      if (!meta) continue;
      const body = await zstdDecompress(v4);
      if (!body) continue;
      const lines = body.split("\n");
      let cwd = "";
      try { cwd = JSON.parse(lines[0]).cwd || ""; } catch {}
      if (!cwd) continue;
      const task = firstUserText(lines);
      const rec = projects.get(cwd) || { projectPath: cwd, tools: new Set(), sessions: 0, lastActiveMs: 0, lastTask: "", source: "dsh" };
      rec.tools.add("dsh");
      rec.sessions += 1;
      if (meta.mtimeMs > rec.lastActiveMs) { rec.lastActiveMs = meta.mtimeMs; if (task) rec.lastTask = task; }
      projects.set(cwd, rec);
    }
  }
}

async function scanClaude(projects) {
  const root = path.join(HOME, ".claude", "projects");
  let dirs;
  try { dirs = await readdir(root, { withFileTypes: true }); } catch { return; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    // Directory name encodes the cwd: dashes for slashes.
    const cwd = "/" + d.name.replaceAll("-", "/").replace(/^\/+/, "");
    let files;
    try { files = await readdir(path.join(root, d.name)); } catch { continue; }
    const jsonls = files.filter(f => f.endsWith(".jsonl"));
    let latest = 0;
    let task = "";
    let count = 0;
    for (const f of jsonls) {
      const full = path.join(root, d.name, f);
      const meta = await fileMeta(full);
      if (!meta) continue;
      count += 1;
      if (meta.mtimeMs > latest) {
        latest = meta.mtimeMs;
        const head = await readHead(full, 200_000);
        task = firstUserText(head.split("\n")) || task;
      }
    }
    if (!count) continue;
    const rec = projects.get(cwd) || { projectPath: cwd, tools: new Set(), sessions: 0, lastActiveMs: 0, lastTask: "", source: "claude" };
    rec.tools.add("claude");
    rec.sessions += count;
    if (latest > rec.lastActiveMs) { rec.lastActiveMs = latest; if (task) rec.lastTask = task; }
    projects.set(cwd, rec);
  }
}

const projects = new Map();
await scanCodex(projects);
await scanDsh(projects);
await scanClaude(projects);

const cutoff = Date.now() - DAYS_WINDOW * 86400_000;
const report = {
  machineId,
  hostname: os.hostname(),
  collectedAt: new Date().toISOString(),
  projects: [...projects.values()]
    .filter(p => p.lastActiveMs >= cutoff)
    .sort((a, b) => b.lastActiveMs - a.lastActiveMs)
    .slice(0, MAX_PROJECTS)
    .map(p => ({
      projectPath: p.projectPath,
      projectName: path.basename(p.projectPath) || p.projectPath,
      tools: [...p.tools],
      sessions: p.sessions,
      lastActiveAt: new Date(p.lastActiveMs).toISOString(),
      lastTask: (p.lastTask || "").slice(0, MAX_TASK_TEXT)
    }))
};

if (push) {
  const res = await fetch(`${backendUrl}/api/progress/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(pushToken ? { authorization: `Bearer ${pushToken}` } : {})
    },
    body: JSON.stringify(report)
  });
  const body = await res.text();
  console.log(`push ${res.status}: ${body.slice(0, 300)}`);
  process.exit(res.ok ? 0 : 1);
} else {
  console.log(JSON.stringify(report, null, 2));
}
