import { watch } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const IGNORED_SEGMENTS = new Set([
  ".git", ".trae", ".codex", "node_modules", "dist", "tmp", "coverage", ".vite", ".next"
]);

function shouldIgnore(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("../") || normalized === "..") return true;
  if (normalized.split("/").some(segment => IGNORED_SEGMENTS.has(segment))) return true;
  return /(?:^|\/)(?:\.DS_Store|.*\.log)$/.test(normalized);
}

function eventFor(relativePath) {
  return {
    id: `file-changed-${randomUUID()}`,
    type: "file_changed",
    occurredAt: new Date().toISOString(),
    payload: {
      path: relativePath,
      repositoryRelativePath: relativePath,
      relation: "modified"
    }
  };
}

export function startProjectChangeCapture({ workspace, onBatch, debounceMs = 1200 } = {}) {
  const root = path.resolve(String(workspace || ""));
  const status = {
    enabled: false,
    workspace: root || undefined,
    sessionId: undefined,
    pendingFiles: 0,
    lastCapturedAt: undefined,
    lastError: undefined
  };
  if (!workspace) return { getStatus: () => ({ ...status }), close() {} };

  let timer = null;
  let flushing = false;
  const pending = new Set();
  let watcher;
  try {
    watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      const relative = path.relative(root, path.resolve(root, String(filename || ""))).replaceAll("\\", "/");
      if (shouldIgnore(relative)) return;
      pending.add(relative);
      status.pendingFiles = pending.size;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void flush(); }, debounceMs);
    });
    watcher.on("error", error => {
      status.lastError = error.message;
      console.error(`[mindiou-mcp] change capture error: ${error.message}`);
    });
    status.enabled = true;
  } catch (error) {
    status.lastError = error.message;
    console.error(`[mindiou-mcp] change capture disabled: ${error.message}`);
  }

  async function flush() {
    if (flushing || pending.size === 0) return;
    flushing = true;
    const files = [...pending].sort();
    pending.clear();
    status.pendingFiles = 0;
    try {
      const events = files.map(eventFor);
      const result = await onBatch(events, status);
      status.sessionId = result?.sessionId || result?.session?.session?.id || result?.session?.id || status.sessionId;
      status.lastCapturedAt = new Date().toISOString();
      status.lastError = undefined;
    } catch (error) {
      status.lastError = error.message;
      for (const file of files) pending.add(file);
      status.pendingFiles = pending.size;
      console.error(`[mindiou-mcp] change capture failed: ${error.message}`);
    } finally {
      flushing = false;
    }
  }

  return {
    getStatus: () => ({ ...status }),
    close() {
      if (timer) clearTimeout(timer);
      watcher?.close();
    }
  };
}
