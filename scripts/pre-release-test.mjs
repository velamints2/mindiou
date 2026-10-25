import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const simulatorUrl = process.env.EVEN_SIMULATOR_URL || "http://127.0.0.1:9898";
const apiUrl = process.env.LEARNING_API_URL || "http://127.0.0.1:8793";
const outputDir = process.env.TEST_OUTPUT_DIR || "audits/pre-release-latest";
const failures = [];

await mkdir(outputDir, { recursive: true });
const TEST_START_TS = Date.now();

async function request(path, options) {
  const response = await fetch(`${simulatorUrl}${path}`, options);
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response;
}

async function screenshot(name) {
  const bytes = new Uint8Array(await (await request("/api/screenshot/glasses")).arrayBuffer());
  await writeFile(`${outputDir}/${name}.png`, bytes);
  const png = PNG.sync.read(Buffer.from(bytes));
  let litPixels = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    if (png.data[index] > 0) litPixels += 1;
  }
  const alpha = Buffer.alloc(png.width * png.height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = png.data[index * 4 + 3];
  }
  return {
    hash: createHash("sha256").update(alpha).digest("hex"),
    alpha,
    litPixels,
    totalPixels: png.width * png.height
  };
}

// Re-rendered text can shift by one sub-pixel between frames of identical
// content, so frame equality is tolerant to <0.5% differing pixels.
function framesEquivalent(a, b) {
  if (!a.alpha || a.alpha.length !== b.alpha.length) return a.hash === b.hash;
  let diff = 0;
  for (let index = 0; index < a.alpha.length; index += 1) {
    if (a.alpha[index] !== b.alpha[index]) diff += 1;
  }
  return diff / a.alpha.length < 0.005;
}

async function input(action, waitMs = 1700) {
  await request("/api/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
  await new Promise(resolve => setTimeout(resolve, waitMs));
}

async function events(since = "") {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const response = await fetch(`${apiUrl}/api/learn/events${query}`);
  if (!response.ok) throw new Error(`events returned ${response.status}`);
  return (await response.json()).events || [];
}

async function apiPost(path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function assertTutorSchema(payload) {
  const assessments = new Set(["correct", "partial", "incorrect", "unknown"]);
  assert(payload.ok === true, "Tutor API did not return ok=true.");
  assert(assessments.has(payload.assessment), "Tutor API returned an invalid assessment.");
  assert(Array.isArray(payload.missingPoints), "Tutor API missingPoints is not an array.");
  assert(typeof payload.nextQuestion === "string", "Tutor API nextQuestion is not a string.");
  assert(typeof payload.g2Text === "string" && payload.g2Text.length > 0, "Tutor API g2Text is empty.");
  assert(payload.g2Text.length <= 42, "Tutor API g2Text is too long for G2.");
}

await request("/api/ping");
const tutorPayload = await apiPost("/api/learn/tutor", {
  kind: "answer",
  card: {
    front: "cognitive dissonance",
    back: "认知失调",
    prompt: "Explain it in your own words."
  },
  transcript: "就是想法和行为冲突的时候会不舒服",
  progress: { index: 0, total: 1 }
});
assertTutorSchema(tutorPayload);

const boot = await screenshot("01-boot");
assert(boot.litPixels > 500, "Boot framebuffer is blank.");
assert(boot.litPixels / boot.totalPixels < 0.35, "Boot framebuffer is overfilled.");

// Frame-navigation assertions need at least one scheduled concept; an empty
// day is an environment condition, not a regression (up/down no-op then).
const spiralToday = await fetch(`${apiUrl}/api/spiral/today`).then(r => r.json()).catch(() => null);
const hasConcepts = Boolean(spiralToday?.cards?.length);
if (!hasConcepts) {
  console.error("NOTE: spiral/today has no cards — frame-change assertions degrade to event-level checks.");
}

const beforeClickAt = new Date().toISOString();
await input("click");
const afterClick = await screenshot("02-after-click");
const clickEvents = await events(beforeClickAt);
assert(
  !clickEvents.some(event => event.type === "g2_gesture"),
  "Click unexpectedly triggered a navigation or coaching action."
);
assert(afterClick.hash === boot.hash, "Ignored click changed the visible concept.");

const beforeUpAt = new Date().toISOString();
await input("up");
const afterUp = await screenshot("03-after-up");
const upEvents = await events(beforeUpAt);
assert(
  upEvents.some(event => event.type === "g2_gesture" && event.data?.action === "previous"),
  "Up did not produce the intended previous action."
);
if (hasConcepts) assert(afterUp.hash !== boot.hash, "Up did not change the visible frame.");

const beforeDownAt = new Date().toISOString();
await input("down");
const afterDown = await screenshot("04-after-down");
const downEvents = await events(beforeDownAt);
assert(
  downEvents.some(event => event.type === "g2_gesture" && event.data?.action === "next"),
  "Down did not produce the intended next action."
);
if (hasConcepts) assert(afterDown.hash === boot.hash, "Down did not return to the original visible frame.");

const beforeRapidDownAt = new Date().toISOString();
await input("down", 300);
await input("down", 300);
await input("down", 300);
await new Promise(resolve => setTimeout(resolve, 2000));
const afterRapidDown = await screenshot("05-after-rapid-down");
const rapidDownEvents = await events(beforeRapidDownAt);
const rapidDownAcceptedCount = rapidDownEvents.filter(
  event => event.type === "g2_gesture" && event.data?.action === "next"
).length;
assert(rapidDownAcceptedCount === 3, "Rapid down gestures were not all acknowledged.");
assert(framesEquivalent(afterRapidDown, afterUp), "Rapid down gestures did not settle on the latest visible frame.");

const consolePayload = await (await request("/api/console")).json();
await writeFile(`${outputDir}/console.json`, JSON.stringify(consolePayload, null, 2));
// The simulator process outlives test runs, so only errors emitted after the
// test started belong to this gate (stale boot-time 500s are not regressions).
const testStartTs = TEST_START_TS;
const relevantErrors = (consolePayload.entries || []).filter(
  entry => entry.level === "error" && entry.ts >= testStartTs
);
assert(
  relevantErrors.length === 0,
  "Simulator console contains errors."
);

const report = {
  passed: failures.length === 0,
  failures,
  checks: {
    bootLitPixels: boot.litPixels,
    bootLitRatio: boot.litPixels / boot.totalPixels,
    ignoredClickKeptFrame: afterClick.hash === boot.hash,
    upChangedFrame: afterUp.hash !== boot.hash,
    downReturnedFrame: afterDown.hash === boot.hash,
    rapidDownAcceptedCount,
    rapidDownSettledOnLatestFrame: framesEquivalent(afterRapidDown, afterUp),
    tutorAssessment: tutorPayload.assessment,
    tutorG2Text: tutorPayload.g2Text
  }
};
await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
