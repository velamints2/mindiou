import fs from "node:fs";

const targetPath = process.argv[2] || "/opt/mindiou/server.js";
const sourcePath = process.argv[3] || "/tmp/mindiou-local-server.js";
const target = fs.readFileSync(targetPath, "utf8");
const source = fs.readFileSync(sourcePath, "utf8");

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing source marker: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Missing source end marker: ${endMarker}`);
  return text.slice(start, end).trimEnd();
}

function replaceOnce(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(oldValue, newValue);
}

if (target.includes("async function syncRepaymentGapsFromReports")) {
  throw new Error("Production server already contains repayment sync; refusing duplicate patch");
}

const syncHelper = extractBetween(source, "async function syncRepaymentGapsFromReports", "const rawWebResearch");
let next = target;
next = replaceOnce(next, "const rawWebResearch", `${syncHelper}\nconst rawWebResearch`, "insert repayment sync helper");
next = replaceOnce(
  next,
  "        const isFallback = Boolean(saved.generation?.fallback);",
  "        // Make report dangerous gaps visible to repayment and MCP immediately.\n        await syncRepaymentGapsFromReports(user.id);\n        const isFallback = Boolean(saved.generation?.fallback);",
  "sync report generation"
);
next = replaceOnce(
  next,
  "      if (req.method === \"GET\" && url.pathname === \"/api/repayment/gaps\") {\n        const status = clean(url.searchParams.get(\"status\") || \"\");",
  "      if (req.method === \"GET\" && url.pathname === \"/api/repayment/gaps\") {\n        await syncRepaymentGapsFromReports(user.id);\n        const status = clean(url.searchParams.get(\"status\") || \"\");",
  "sync repayment list"
);

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${targetPath}.bak-repayment-sync-${stamp}`;
fs.copyFileSync(targetPath, backupPath);
fs.writeFileSync(targetPath, next);
console.log(JSON.stringify({ ok: true, targetPath, backupPath, changedBytes: next.length - target.length }));
