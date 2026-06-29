import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const simulatorUrl = process.env.EVEN_SIMULATOR_URL || "http://127.0.0.1:9898";
const apiUrl = process.env.LEARNING_API_URL || "http://127.0.0.1:8793";
const outputDir = process.env.TEST_OUTPUT_DIR || "audits/pre-release-latest";
const failures = [];

await mkdir(outputDir, { recursive: true });

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
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    litPixels,
    totalPixels: png.width * png.height
  };
}

async function input(action) {
  await request("/api/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
  await new Promise(resolve => setTimeout(resolve, 800));
}

async function events() {
  const response = await fetch(`${apiUrl}/api/learn/events`);
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

const beforeEvents = await events();
await input("click");
const afterClick = await screenshot("02-after-click");
const clickEvents = (await events()).slice(beforeEvents.length);
assert(
  !clickEvents.some(event => event.type === "g2_gesture"),
  "Click unexpectedly triggered a navigation or coaching action."
);
assert(afterClick.hash === boot.hash, "Ignored click changed the visible concept.");

const beforeUp = await events();
await input("up");
await screenshot("03-after-up");
const upEvents = (await events()).slice(beforeUp.length);
assert(
  upEvents.some(event => event.type === "g2_gesture" && event.data?.action === "previous"),
  "Up did not produce the intended previous action."
);

const beforeDown = await events();
await input("down");
await screenshot("04-after-down");
const downEvents = (await events()).slice(beforeDown.length);
assert(
  downEvents.some(event => event.type === "g2_gesture" && event.data?.action === "next"),
  "Down did not produce the intended next action."
);

const consolePayload = await (await request("/api/console")).json();
await writeFile(`${outputDir}/console.json`, JSON.stringify(consolePayload, null, 2));
assert(
  !(consolePayload.entries || []).some(entry => entry.level === "error"),
  "Simulator console contains errors."
);

const report = {
  passed: failures.length === 0,
  failures,
  checks: {
    bootLitPixels: boot.litPixels,
    bootLitRatio: boot.litPixels / boot.totalPixels,
    ignoredClickKeptFrame: afterClick.hash === boot.hash,
    tutorAssessment: tutorPayload.assessment,
    tutorG2Text: tutorPayload.g2Text
  }
};
await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
