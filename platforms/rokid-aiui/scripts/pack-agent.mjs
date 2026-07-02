import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const releaseDir = path.join(root, "release");
const output = path.join(releaseDir, `learn-coach-rokid-aiui-${manifest.version}.zip`);

await mkdir(releaseDir, { recursive: true });
await rm(output, { force: true });

const included = [
  "AGENTS.md",
  "app.js",
  "app.json",
  "app.wxss",
  "config.js",
  "package.json",
  "pages",
  "utils"
];
const result = spawnSync("zip", ["-qr", output, ...included], {
  cwd: root,
  encoding: "utf8"
});
if (result.status !== 0) {
  throw new Error(result.stderr || "zip failed");
}

const info = await stat(output);
const maxBytes = 5 * 1024 * 1024;
if (info.size > maxBytes) {
  throw new Error(`AIUI package exceeds 5MB: ${info.size} bytes`);
}

console.log(JSON.stringify({
  ok: true,
  version: manifest.version,
  output: path.relative(root, output),
  bytes: info.size,
  underFiveMb: true
}, null, 2));
