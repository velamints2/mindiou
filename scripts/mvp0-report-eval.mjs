/**
 * One-off MVP-0 model comparison runner.
 *
 * Reuses the exact production path (mvp0-report.js prompt + payload builder)
 * but calls the configured chat model directly, so we can compare the current
 * API model's report against another model's report on the same sample input.
 *
 * Usage:
 *   node scripts/mvp0-report-eval.mjs <output.json>
 *
 * Env is read from .env.local (OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL).
 * Never prints secrets.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateClearanceReport } from "../mvp0-report.js";

const execFileAsync = promisify(execFile);
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || "";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function extractGoldenSample() {
  const src = readFileSync(join(root, "src/mvp0-golden-sample.test.ts"), "utf8");
  const m = src.match(/const GOLDEN_SAMPLE_WORKFLOW = `([\s\S]*?)`;/);
  if (!m) throw new Error("golden sample not found in test file");
  return m[1];
}

const env = loadEnv(join(root, ".env.local"));
const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY || "";
const baseUrl = (process.env.OPENAI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const model = process.env.OPENAI_MODEL || env.OPENAI_MODEL || "gpt-4o-mini";

if (!apiKey) {
  console.error("OPENAI_API_KEY is not set");
  process.exit(1);
}

async function chatCompletions(body) {
  // Node 22 fetch ignores http(s)_proxy env vars; use curl when a proxy is set.
  if (proxyUrl) {
    const dir = mkdtempSync(join(tmpdir(), "mvp0-eval-"));
    const bodyFile = join(dir, "body.json");
    try {
      writeFileSync(bodyFile, JSON.stringify(body));
      const args = [
        "-sS", "--max-time", "170", "-x", proxyUrl,
        "-H", `authorization: Bearer ${apiKey}`,
        "-H", "content-type: application/json",
        "-H", "accept: application/json",
        "--data-binary", `@${bodyFile}`,
        `${baseUrl}/chat/completions`
      ];
      const { stdout } = await execFileAsync("curl", args, {
        maxBuffer: 16 * 1024 * 1024
      });
      return JSON.parse(stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function chatJson(messages, fallback) {
  const payload = await chatCompletions({
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages
  });
  if (payload.error) throw new Error(payload.error.message || "API error");
  const content = payload.choices?.[0]?.message?.content || "{}";
  try {
    return JSON.parse(content);
  } catch {
    return { ...fallback(), __fallback: true, __fallbackError: "model returned non-JSON" };
  }
}

const sample = extractGoldenSample();
const outPath = process.argv[2] || join(root, "evals/output-mvp0-report.json");
mkdirSync(dirname(outPath), { recursive: true });

console.log(`model=${model} baseUrl=${baseUrl}`);
const started = Date.now();
const report = await generateClearanceReport(sample, "codex", chatJson);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

writeFileSync(outPath, JSON.stringify({ model, elapsedSeconds: Number(elapsed), report }, null, 2));
console.log(`fallback=${report.generation?.fallback} elapsed=${elapsed}s`);
console.log(`wrote ${outPath}`);
