import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const exec = promisify(execFile);
const tracePath = path.resolve(process.env.MINDIOU_TRACE_FILE || "tmp/mindiou-traces.ndjson");
const windowMs = Math.max(60_000, Number(process.env.MINDIOU_ALERT_WINDOW_MS || 15 * 60_000));
const now = Date.now();
let events = [];
try {
  const text = await readFile(tracePath, "utf8");
  events = text.split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(event => {
    const ts = Date.parse(event.ts);
    return Number.isFinite(ts) && now - ts <= windowMs;
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const alerts = [];
const requestEvents = events.filter(event => event.type === "http_request");
const health = requestEvents.filter(event => /^\/(healthz|readyz|health)$/.test(event.path || ""));
let consecutiveHealthFailures = 0;
for (const event of [...health].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
  if (Number(event.status) >= 500) consecutiveHealthFailures += 1;
  else consecutiveHealthFailures = 0;
}
if (consecutiveHealthFailures >= 3) alerts.push({ code: "HEALTH_FAILURE_STREAK", threshold: 3, observed: consecutiveHealthFailures });

const ai = events.filter(event => event.type === "span_end" && event.span === "ai.chat_completion");
const aiFailures = ai.filter(event => event.ok === false).length;
if (ai.length >= 5 && aiFailures / ai.length > 0.1) alerts.push({ code: "AI_FAILURE_RATE", threshold: 0.1, observed: aiFailures / ai.length, samples: ai.length });

const db = events.filter(event => event.type === "span_end" && /^sqlite\./.test(event.span || ""));
const slowDbMs = Math.max(100, Number(process.env.MINDIOU_DB_SLOW_MS || 1000));
const slowDb = db.filter(event => Number(event.durationMs) > slowDbMs);
if (slowDb.length) alerts.push({ code: "DATABASE_WRITE_LATENCY", thresholdMs: slowDbMs, observed: slowDb.map(event => event.durationMs).sort((a, b) => b - a)[0] });

const failedRequests = requestEvents.filter(event => Number(event.status) >= 500).length;
const errorRate = requestEvents.length ? failedRequests / requestEvents.length : 0;
if (requestEvents.length >= 20 && errorRate > Number(process.env.MINDIOU_ERROR_RATE_THRESHOLD || 0.1)) alerts.push({ code: "DEPLOY_ERROR_SPIKE", observed: errorRate, samples: requestEvents.length });

const costByUser = new Map();
for (const event of events.filter(item => item.type === "ai.cost")) {
  const userId = event.userId || "unknown";
  costByUser.set(userId, (costByUser.get(userId) || 0) + Number(event.estimatedUsd || 0));
}
const costLimit = Number(process.env.MINDIOU_USER_COST_THRESHOLD_USD || 5);
for (const [userId, estimatedUsd] of costByUser) {
  if (estimatedUsd > costLimit) alerts.push({ code: "USER_COST_ANOMALY", userId, thresholdUsd: costLimit, observedUsd: estimatedUsd });
}

const backlog = events.filter(event => event.type === "queue.backlog").at(-1);
const backlogLimit = Number(process.env.MINDIOU_QUEUE_BACKLOG_THRESHOLD || 100);
if (backlog && Number(backlog.depth) >= backlogLimit) alerts.push({ code: "QUEUE_BACKLOG", threshold: backlogLimit, observed: Number(backlog.depth) });

try {
  const { stdout } = await exec("df", ["-Pk", process.env.MINDIOU_DATA_VOLUME || "/var/lib/mindiou"]);
  const line = stdout.trim().split("\n").at(-1)?.trim().split(/\s+/);
  const used = Number(String(line?.[4] || "0").replace("%", ""));
  if (used >= Number(process.env.MINDIOU_DISK_USED_THRESHOLD || 85)) alerts.push({ code: "DISK_SPACE_LOW", thresholdPercent: 85, observedPercent: used });
} catch { /* local development may not have the production volume */ }

const result = { ok: alerts.length === 0, checkedAt: new Date(now).toISOString(), windowMs, tracePath, samples: events.length, alerts };
console.log(JSON.stringify(result));
if (alerts.length) process.exitCode = 2;
