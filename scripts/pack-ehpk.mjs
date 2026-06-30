import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

const appJson = JSON.parse(await readFile("app.json", "utf8"));
const output = `release/learn-coach-${appJson.version}.ehpk`;

const check = spawnSync(process.execPath, ["scripts/check-release.mjs"], { stdio: "inherit" });
if (check.status !== 0) process.exit(check.status || 1);

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const pack = spawnSync(npx, ["evenhub", "pack", "app.json", "dist", "-o", output], { stdio: "inherit" });
if (pack.status !== 0) process.exit(pack.status || 1);

if (!existsSync(output)) {
  console.error(`Package was not created: ${output}`);
  process.exit(1);
}

const { size } = statSync(output);
if (size < 1024) {
  console.error(`Package looks too small: ${output} (${size} bytes)`);
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, output, bytes: size }, null, 2));
