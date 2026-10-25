import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const appJson = JSON.parse(await readFile("app.json", "utf8"));
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(packageJson.version === appJson.version, "package.json and app.json versions do not match.");
assert(/^0\.\d+\.\d+$/.test(appJson.version), "app.json version must look like 0.x.y for this prototype.");
assert(appJson.package_id === "com.personalos.g2learning", "Unexpected package_id.");
assert(appJson.entrypoint === "index.html", "Even Hub entrypoint must stay index.html.");
assert(appJson.min_sdk_version === "0.0.11", "Unexpected Even Hub SDK version.");
assert((appJson.tagline || "").length <= 50, "App tagline exceeds Even Hub limit.");
assert((appJson.name || "").length <= 20, "App name exceeds Even Hub limit.");
assert(existsSync("dist/index.html"), "dist/index.html is missing. Run npm run build first.");

if (existsSync("dist")) {
  const stat = statSync("dist");
  assert(stat.isDirectory(), "dist exists but is not a directory.");
}

if (failures.length) {
  console.error(failures.map(message => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  version: appJson.version,
  packageId: appJson.package_id,
  output: `release/mindiou-${appJson.version}.ehpk`
}, null, 2));
