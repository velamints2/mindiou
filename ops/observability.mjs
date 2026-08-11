import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const traceStorage = new AsyncLocalStorage();
const traceFile = process.env.MINDIOU_TRACE_FILE || "tmp/mindiou-traces.ndjson";

function safe(value, max = 500) {
  if (value == null) return undefined;
  return String(value).replace(/[\r\n\u0000]/g, " ").slice(0, max);
}

function write(entry) {
  try {
    mkdirSync(path.dirname(path.resolve(traceFile)), { recursive: true });
    appendFileSync(traceFile, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { mode: 0o640 });
  } catch (error) {
    // Observability must never make a user request fail.
    if (process.env.NODE_ENV !== "test") console.warn(`trace write skipped: ${safe(error.message, 160)}`);
  }
}

export function createTraceContext(req, requestId) {
  const incoming = safe(req?.headers?.["x-trace-id"], 128);
  const traceId = /^[A-Za-z0-9._-]{1,128}$/.test(incoming || "") ? incoming : cryptoRandomId();
  return { traceId, requestId };
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function runWithTrace(context, fn) {
  return traceStorage.run(context, fn);
}

export function currentTrace() {
  return traceStorage.getStore() || {};
}

export function traceEvent(type, fields = {}) {
  write({ type, ...currentTrace(), ...fields });
}

export async function traceSpan(name, fields, fn) {
  const spanId = cryptoRandomId();
  const startedAt = Date.now();
  traceEvent("span_start", { span: name, spanId, ...fields });
  try {
    const result = await fn();
    traceEvent("span_end", { span: name, spanId, durationMs: Date.now() - startedAt, ok: true });
    return result;
  } catch (error) {
    traceEvent("span_end", {
      span: name,
      spanId,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: safe(error?.message || error, 300),
      errorCode: safe(error?.code, 80)
    });
    throw error;
  }
}

export function traceFilePath() { return path.resolve(traceFile); }
