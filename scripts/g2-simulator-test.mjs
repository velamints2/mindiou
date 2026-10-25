/**
 * MindIOU G2 surface ( ?surface=mindiou&demo=1 ) headless simulator test.
 *
 * Run the app and the official simulator first:
 *
 *   npm run dev
 *   evenhub-simulator \
 *     "http://localhost:5175/?surface=mindiou&demo=1&fresh=1" \
 *     --automation-port 9898 --no-glow
 *   npm run test:g2-simulator
 *
 * Hermetic gate contract: each run requires a FRESHLY STARTED simulator
 * process. The simulator has no page-reload API, so a long-lived simulator
 * keeps the app state left by the previous run and Gate 1 would pass on stale
 * console history. The `fresh=1` query param clears the host-persisted queue
 * (which survives simulator restarts) when the page boots, so a fresh
 * simulator process plus `fresh=1` always starts from card 1/3.
 *
 * Transport note (investigated 2026-08-03): the simulator's flutter->WebView
 * event channel drops gestures intermittently; a dropped gesture leaves no
 * SDK echo and no '[g2m-action]' entry. Deterministic gestures therefore go
 * through inputConfirmed() (send -> poll the console for the expected action
 * -> retry, bounded). This absorbs a simulator automation-transport quirk;
 * the real-device event path (glasses -> BLE -> phone app -> WebView) is
 * different and is not covered by this observation.
 *
 * The test drives the DEMO fixture deck (3 cards, no network) and must prove:
 * - the MindIOU surface booted (not the legacy Learn Coach surface);
 * - the framebuffer is nonblank and not overfilled;
 * - click reveals the next layer (question -> why -> evidence -> answer) and
 *   stops at the answer layer (main text unchanged, boundary hint in footer);
 * - double_click steps one layer back on deep layers and marks for review on
 *   the question layer (auto-advancing to the next card);
 * - up/down move between cards deterministically;
 * - rapid repeated down settles on the latest card and clamps at the last
 *   card without wrapping;
 * - the simulator console contains no errors.
 *
 * Raw simulator screenshots encode visibility in alpha, so the test counts
 * alpha pixels rather than judging RGB color. Footer transient messages (e.g.
 * boundary hints) intentionally change the footer, so main-text assertions
 * compare only the main container pixel region.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const simulatorUrl = process.env.EVEN_SIMULATOR_URL || "http://127.0.0.1:9898";
const outputDir = process.env.TEST_OUTPUT_DIR || "audits/g2-simulator-latest";
const failures = [];

/** Main text container region (matches displayAdapter mainContainer layout). */
const MAIN_REGION = { x0: 16, y0: 12, x1: 560, y1: 172 };

await mkdir(outputDir, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    name,
    png,
    hash: createHash("sha256").update(bytes).digest("hex"),
    litPixels,
    totalPixels: png.width * png.height
  };
}

function sameMainRegion(a, b) {
  const regionOf = png => {
    const { x0, y0, x1, y1 } = MAIN_REGION;
    const rows = [];
    for (let y = y0; y < y1; y += 1) {
      const start = (y * png.width + x0) * 4;
      rows.push(png.data.subarray(start, start + (x1 - x0) * 4));
    }
    return Buffer.concat(rows);
  };
  return createHash("sha256").update(regionOf(a.png)).digest("hex")
    === createHash("sha256").update(regionOf(b.png)).digest("hex");
}

async function input(action, waitMs = 1700) {
  await request("/api/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action })
  });
  await sleep(waitMs);
}

/**
 * Send-confirm-retry wrapper. Investigation (2026-08-03) showed the
 * simulator's flutter->WebView event channel drops gestures intermittently:
 * a dropped gesture produces neither the SDK echo nor a '[g2m-action]'
 * entry, while confirmed dispatches appear within ~2s. So wait up to
 * `confirmTimeoutMs` for the expected action before retrying; a gesture with
 * no action entry provably never reached the app, which makes retrying safe.
 * This is a simulator automation-transport issue only - the real-device
 * event path (glasses -> BLE -> phone app -> WebView) is different.
 */
async function inputConfirmed(action, expectedAction, { confirmTimeoutMs = 5000, maxAttempts = 3, settleMs = 700 } = {}) {
  let actions = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const marker = await consoleMarker();
    await request("/api/input", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    const deadline = Date.now() + confirmTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(400);
      actions = await actionsSince(marker);
      if (actions.includes(expectedAction)) {
        await sleep(settleMs);
        return { confirmed: true, attempts: attempt, actions };
      }
    }
  }
  return { confirmed: false, attempts: maxAttempts, actions };
}

function entryText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    return String(entry.message ?? entry.text ?? JSON.stringify(entry));
  }
  return String(entry);
}

function entryId(entry) {
  return entry && typeof entry === "object" ? Number(entry.id) || 0 : 0;
}

async function consoleEntries() {
  const payload = await (await request("/api/console")).json();
  return payload.entries || [];
}

async function consoleMarker() {
  const entries = await consoleEntries();
  return entries.reduce((max, entry) => Math.max(max, entryId(entry)), 0);
}

async function actionsSince(marker) {
  const entries = await consoleEntries();
  return entries
    .filter(entry => entryId(entry) > marker)
    .map(entryText)
    .filter(text => text.includes("[g2m-action]"))
    .map(text => text.split("[g2m-action]")[1].trim());
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

await request("/api/ping");

// Gate 0: no previous run may have interacted with the app. A boot record is
// expected (the app boots as soon as the simulator loads the URL), but
// '[g2m-action]' entries only appear after gestures were dispatched. Without
// a page-reload API, a simulator that already ran this test would keep the
// leftover app state, make Gate 1 pass on stale console history, and fail
// later gates on misleading frame hashes. Fail fast instead.
const preExistingEntries = await consoleEntries();
if (preExistingEntries.some(entry => entryText(entry).includes("[g2m-action]"))) {
  const report = {
    passed: false,
    failures: [
      "Simulator console already contains '[g2m-action]' records: a previous run already interacted " +
        "with this simulator process. Restart evenhub-simulator (fresh process + ?fresh=1 URL) and re-run; " +
        "see the header comment."
    ]
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}

// Gate 1: the MindIOU surface booted in labelled demo mode.
let bootSeen = false;
for (let attempt = 0; attempt < 15 && !bootSeen; attempt += 1) {
  const entries = await consoleEntries();
  bootSeen = entries.some(entry => {
    const text = entryText(entry);
    return text.includes("[g2m-boot]") && text.includes("surface=mindiou") && text.includes("demo=1");
  });
  if (!bootSeen) await sleep(1000);
}
assert(bootSeen, "Console missing '[g2m-boot] surface=mindiou demo=1': MindIOU surface did not boot in demo mode.");

// Gate 2: first frame is nonblank and not overfilled (poll while the bridge starts).
let shot = await screenshot("01-boot-card1-question");
for (let attempt = 0; attempt < 10 && shot.litPixels <= 500; attempt += 1) {
  await sleep(1000);
  shot = await screenshot("01-boot-card1-question");
}
const boot = shot;
assert(boot.litPixels > 500, "Boot framebuffer is blank.");
assert(boot.litPixels / boot.totalPixels < 0.35, "Boot framebuffer is overfilled.");

// Gate 3: click reveals layers in order; answer layer clamps with a boundary hint.
let probe = await inputConfirmed("click", "REVEAL_HINT");
const whyShot = await screenshot("02-card1-why");
assert(probe.confirmed, "Click on question layer did not dispatch REVEAL_HINT.");
assert(whyShot.hash !== boot.hash, "Click did not advance question -> why.");

probe = await inputConfirmed("click", "REVEAL_HINT");
const evidenceShot = await screenshot("03-card1-evidence");
assert(probe.confirmed, "Click on why layer did not dispatch REVEAL_HINT.");
assert(evidenceShot.hash !== whyShot.hash, "Click did not advance why -> evidence.");

probe = await inputConfirmed("click", "REVEAL_HINT");
const answerShot = await screenshot("04-card1-answer");
assert(probe.confirmed, "Click on evidence layer did not dispatch REVEAL_HINT.");
assert(answerShot.hash !== evidenceShot.hash, "Click did not advance evidence -> answer.");

probe = await inputConfirmed("click", "REVEAL_HINT");
const clampedShot = await screenshot("05-card1-answer-clamped");
assert(probe.confirmed, "Click on answer layer was not acknowledged.");
assert(sameMainRegion(clampedShot, answerShot), "Click on the answer layer changed the main text (layers must stop at answer).");
assert(clampedShot.hash !== answerShot.hash, "Click on the answer layer produced no boundary feedback in the footer.");

// Gate 4: double_click on a deep layer steps one layer back.
probe = await inputConfirmed("double_click", "LAYER_BACK");
const backShot = await screenshot("06-card1-evidence-again");
assert(probe.confirmed, "Double click on answer layer did not dispatch LAYER_BACK.");
assert(backShot.hash === evidenceShot.hash, "Double click did not return answer -> evidence.");

// Gate 5: down/up move between cards deterministically.
probe = await inputConfirmed("down", "NEXT_CARD");
const card2Shot = await screenshot("07-card2-question");
assert(probe.confirmed, "Down did not dispatch NEXT_CARD.");
assert(card2Shot.hash !== backShot.hash, "Down did not move to the next card.");

probe = await inputConfirmed("up", "PREVIOUS_CARD");
const card1Shot = await screenshot("08-card1-question-again");
assert(probe.confirmed, "Up did not dispatch PREVIOUS_CARD.");
assert(card1Shot.hash === boot.hash, "Up did not deterministically return to the first card frame.");

// Gate 6: double_click on the question layer marks for review and auto-advances.
probe = await inputConfirmed("double_click", "MARK_REVIEW");
const markedShot = await screenshot("09-card2-after-mark-review");
assert(probe.confirmed, "Double click on question layer did not dispatch MARK_REVIEW.");
assert(sameMainRegion(markedShot, card2Shot), "Marking for review did not auto-advance to the next card's question layer.");
assert(markedShot.hash !== card2Shot.hash, "Mark acknowledgement was not shown in the footer.");

// Gate 7: rapid repeated down coalesces onto the latest card and clamps at
// the end. Burst semantics forbid per-gesture retry (a retry would break the
// 300ms cadence and the count assertion), so poll for the total instead.
let marker = await consoleMarker();
await input("down", 300);
await input("down", 300);
await input("down", 300);
let rapidActions = [];
for (let attempt = 0; attempt < 12; attempt += 1) {
  await sleep(500);
  rapidActions = (await actionsSince(marker)).filter(action => action === "NEXT_CARD");
  if (rapidActions.length >= 3) break;
}
const rapidShot = await screenshot("10-card3-after-rapid-down");
assert(rapidActions.length === 3, `Rapid down gestures were not all acknowledged (got ${rapidActions.length}/3).`);
assert(!sameMainRegion(rapidShot, markedShot), "Rapid down did not move past the marked card.");

probe = await inputConfirmed("down", "NEXT_CARD");
const lastClampedShot = await screenshot("11-card3-clamped");
assert(probe.confirmed, "Down on the last card was not acknowledged.");
assert(sameMainRegion(lastClampedShot, rapidShot), "Down on the last card wrapped instead of clamping.");

// Gate 8: no console errors for the whole run.
const finalEntries = await consoleEntries();
await writeFile(`${outputDir}/console.json`, JSON.stringify(finalEntries, null, 2));
assert(
  !finalEntries.some(entry => entry && typeof entry === "object" && entry.level === "error"),
  "Simulator console contains errors."
);

const report = {
  passed: failures.length === 0,
  failures,
  checks: {
    bootLitPixels: boot.litPixels,
    bootLitRatio: boot.litPixels / boot.totalPixels,
    clickAdvancedLayers: whyShot.hash !== boot.hash && evidenceShot.hash !== whyShot.hash && answerShot.hash !== evidenceShot.hash,
    answerLayerClampedMain: sameMainRegion(clampedShot, answerShot),
    doubleClickSteppedBack: backShot.hash === evidenceShot.hash,
    upReturnedToBootFrame: card1Shot.hash === boot.hash,
    markReviewAutoAdvanced: sameMainRegion(markedShot, card2Shot),
    rapidDownAcceptedCount: rapidActions.length,
    lastCardClampedMain: sameMainRegion(lastClampedShot, rapidShot)
  }
};
await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
