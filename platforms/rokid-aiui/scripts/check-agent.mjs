import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const required = [
  "AGENTS.md",
  "app.js",
  "app.json",
  "app.wxss",
  "config.js",
  "pages/index/index.ink",
  "pages/voice-action/index.ink",
  "pages/import/index.ink",
  "pages/settings/index.ink",
  "utils/api.js",
  "utils/learning.js"
];

const failures = [];
for (const relativePath of required) {
  try {
    await stat(path.join(root, relativePath));
  } catch {
    failures.push(`Missing ${relativePath}`);
  }
}

const app = JSON.parse(await readFile(path.join(root, "app.json"), "utf8"));
for (const page of app.pages || []) {
  const inkPath = path.join(root, `${page}.ink`);
  try {
    const source = await readFile(inkPath, "utf8");
    for (const marker of ["<script def>", "<script setup>", "<page>", "<style>"]) {
      if (!source.includes(marker)) failures.push(`${page}.ink is missing ${marker}`);
    }
    if (!source.includes("export default")) failures.push(`${page}.ink has no page controller`);
  } catch {
    failures.push(`app.json references missing page ${page}.ink`);
  }
}

const allText = await Promise.all(required.map(async relativePath => {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch {
    return "";
  }
}));
const combined = allText.join("\n");
for (const pattern of [
  /sk-[A-Za-z0-9_-]{20,}/,
  /OPENAI_API_KEY\s*=\s*\S+/,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/
]) {
  if (pattern.test(combined)) failures.push(`Potential secret matched ${pattern}`);
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  pages: app.pages.length,
  requiredFiles: required.length,
  defaultPage: app.pages[0]
}, null, 2));
