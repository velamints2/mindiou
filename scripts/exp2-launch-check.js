#!/usr/bin/env node
// EXP-2 launch readiness: checks every preregistered precondition against
// live state and prints a go/no-go board. Run any time; exit 0 = ready.
// Usage: node scripts/exp2-launch-check.js [--json]

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const asJson = process.argv.includes("--json");
const THRESHOLD = 40;

const db = new DatabaseSync("tmp/mindiou.sqlite");
const get = (ns) => {
  const row = db.prepare("SELECT payload FROM application_state WHERE namespace = ?").get(ns);
  return row ? JSON.parse(row.payload) : null;
};

const store = JSON.parse(readFileSync("tmp/training-store.json", "utf8"));
const sheet = JSON.parse(readFileSync("docs/research/EXP1-candidates-annotation-sheet.json", "utf8"));
const exp2 = get("experiment-exp2");
const exp1 = get("experiment-exp1-labels");
const bili = get("bilibili-digests-a4907e01-f6e5-4e6e-b94b-9fc36e522594");
const audit = get("research-audit-log");

// 1. debt pool: the SUBJECT's own active debts only (single-subject design —
// the legacy 69-user corpus is demo material, not this subject's real debts).
const ACTIVE = new Set(["new", "open", "in_progress"]);
const YG_ID = "a4907e01-f6e5-4e6e-b94b-9fc36e522594";
const corpusRef = store.cognitiveDebts.filter(d => ACTIVE.has((d.status || "new").toLowerCase())).length;
const liveDebts = [];
for (const row of db.prepare("SELECT namespace, payload FROM application_state").all()) {
  const { namespace, payload } = row;
  if (payload && payload.includes("cognitiveDebts")) {
    try {
      const debts = JSON.parse(payload).cognitiveDebts || [];
      liveDebts.push(...debts.filter(d => d.userId === YG_ID && ACTIVE.has((d.status || "new").toLowerCase())));
    } catch { /* skip malformed */ }
  }
}
const pool = liveDebts.length;

// 2. EXP-1 review coverage (A-layer aggregated gaps)
const groups = new Set(sheet.rows.map(r => (r.description || r.title).slice(0, 40)));
const labels = exp1?.labels || {};
const aLabeled = [...groups].filter(gap => {
  const row = sheet.rows.find(r => (r.description || r.title).slice(0, 40) === gap);
  return row && labels[`candidate:${row.session_id}:${row.candidate_index}`];
}).length;

const checks = [
  { id: "pool", label: "欠条池 ≥ 40（被试本人活跃欠条）", ok: pool >= THRESHOLD, detail: `${pool}/${THRESHOLD}（legacy 演示语料 ${corpusRef} 条不计入）` },
  { id: "review", label: "EXP-1 A 层复核完成（≥4/5，为池子质量把关）", ok: aLabeled >= 4, detail: `${aLabeled}/${groups.size}` },
  { id: "sessdata", label: "SESSDATA 已配置（字幕模式可用，可选）", ok: Boolean(bili?.sessdata), detail: bili?.sessdata ? "已配置" : "未配置（降级模式仍可产候选）", optional: true },
  { id: "clean", label: "实验装置未封存（演练数据已清）", ok: !exp2?.sealedHash, detail: exp2?.sealedHash ? "已封存（勿重复 assign）" : "未封存 ✓" },
  { id: "audit", label: "审计日志工作正常", ok: Boolean(audit?.entries?.length), detail: `${audit?.entries?.length || 0} 条` }
];

const ready = checks.filter(c => !c.optional).every(c => c.ok);
const out = { at: new Date().toISOString(), ready, pool, checks };

if (asJson) {
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log(`EXP-2 启动检查 · ${out.at.slice(0, 16).replace("T", " ")}`);
  for (const c of checks) {
    const mark = c.ok ? "✓" : c.optional ? "○" : "✗";
    console.log(` ${mark} ${c.label} — ${c.detail}`);
  }
  console.log(ready ? "\nGO: 条件满足，可执行 assign 封存分组并填写预注册附录" : "\nNO-GO: 存在未满足的必要条件");
}
process.exit(ready ? 0 : 1);
