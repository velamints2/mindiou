import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const apiBase = (process.env.MINDIOU_API_URL || "http://127.0.0.1:8793").replace(/\/$/, "");
const token = process.env.LEARNING_API_TOKEN || "";
const fixturePath = path.resolve("evals/mvp1-samples.json");
const outputPath = path.resolve(process.env.MVP1_EVAL_OUTPUT || "tmp/mvp1-eval-results.json");
let sessionCookie = String(process.env.MVP1_EVAL_SESSION_COOKIE || "").trim();

function headers() {
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(sessionCookie ? { cookie: sessionCookie } : {})
  };
}

async function ensureAuthenticatedSession() {
  if (sessionCookie) return;
  const suffix = `${process.pid}-${Date.now()}`;
  const response = await fetch(`${apiBase}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: `mvp1-eval-${suffix}@example.invalid`,
      password: `mvp1-eval-${suffix}-secret`
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`/api/auth/register: ${data.error || `HTTP ${response.status}`}`);
  }
  sessionCookie = (response.headers.get("set-cookie") || "").split(";")[0];
  if (!sessionCookie) {
    throw new Error("/api/auth/register: session cookie was not returned");
  }
}

async function post(pathname, body = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${pathname}: ${data.error || `HTTP ${response.status}`}`);
  return data;
}

async function runSession(report, card, insufficientAnswer, goodAnswer) {
  const started = await post("/api/mvp1/sessions", { reportId: report.id, cardId: card.id });
  const sessionId = started.session.id;
  const insufficient = await post(`/api/mvp1/sessions/${sessionId}/answers`, { answer: insufficientAnswer });
  const good = await post(`/api/mvp1/sessions/${sessionId}/answers`, { answer: goodAnswer });
  const ended = await post(`/api/mvp1/sessions/${sessionId}/end`);
  return {
    sessionId,
    question: started.session.clearanceQuestion,
    sources: started.session.sources,
    insufficient: insufficient.attempt.analysis,
    good: good.attempt.analysis,
    finalResult: ended.result
  };
}

const allSamples = JSON.parse(await readFile(fixturePath, "utf8"));
const sampleFilter = String(process.env.MVP1_EVAL_SAMPLE || "").trim();
const samples = sampleFilter
  ? allSamples.filter(sample => sample.id === sampleFilter)
  : allSamples;
if (samples.length === 0) throw new Error(`No MVP-1 eval sample matched: ${sampleFilter}`);
const results = [];

await ensureAuthenticatedSession();

for (const sample of samples) {
  const generated = await post("/api/mvp0/report", {
    artifactText: sample.artifactText,
    artifactType: sample.artifactType
  });
  const report = generated.report;
  const card = report.sections.feynmanCards[0];
  const session = await runSession(report, card, sample.insufficientAnswer, sample.goodAnswer);
  const checks = {
    hasCitedSources: session.sources.length > 0 && session.sources.every(source => /^https?:\/\//.test(source.url)),
    insufficientNotCleared: session.insufficient.status !== "provisionally_cleared",
    insufficientGetsTeaching: session.insufficient.recommendation === "continue" && Boolean(session.insufficient.teaching),
    goodReachesClearanceBoundary: ["provisionally_cleared", "needs_verification"].includes(session.good.status),
    goodHasEvidence: session.finalResult.evidence.length > 0,
    reviewRuleConsistent: !(
      session.good.status === "provisionally_cleared"
      && session.sources.some(source => session.good.materialSourceIds.includes(source.id) && source.type === "ordinary_web")
      && session.finalResult.sourceReviewRequired === false
    )
  };
  results.push({
    id: sample.id,
    title: sample.title,
    reportId: report.id,
    card: { id: card.id, target: card.target, prompt: card.prompt },
    session,
    checks,
    passed: Object.values(checks).every(Boolean)
  });
  console.log(`${sample.id}: ${results.at(-1).passed ? "PASS" : "REVIEW"}`);
}

const output = {
  generatedAt: new Date().toISOString(),
  apiBase,
  samples: results,
  summary: {
    total: results.length,
    passed: results.filter(result => result.passed).length,
    requiresReview: results.filter(result => !result.passed).length
  }
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${outputPath}`);
if (output.summary.requiresReview > 0) process.exitCode = 1;
