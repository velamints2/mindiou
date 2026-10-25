#!/usr/bin/env node
// EXP-2 pool readiness: active debt count, source mix, and distance to the
// preregistered >=40 launch threshold. Reads both live stores (SQLite-backed
// training state file + MCP-imported sessions in the same JSON file).
// NOTE: legacy-JSON view only. For the authoritative EXP-2 launch board
// (subject's live SQLite debts), use scripts/exp2-launch-check.js.
// Usage: node scripts/debt-pool-stats.js [--json]

import { readFileSync } from "node:fs";

const store = JSON.parse(readFileSync("tmp/training-store.json", "utf8"));
const asJson = process.argv.includes("--json");
const THRESHOLD = 40;

const byUser = new Map();
for (const debt of store.cognitiveDebts || []) {
  const list = byUser.get(debt.userId) || [];
  list.push(debt);
  byUser.set(debt.userId, list);
}

// Active = open lifecycle states (training engine uses new/open/in_progress).
const ACTIVE = new Set(["new", "open", "in_progress"]);
const rows = [];
for (const [userId, debts] of byUser) {
  const active = debts.filter(d => ACTIVE.has((d.status || "new").toLowerCase())
    || !["cleared", "resolved", "mastered", "closed"].includes((d.status || "").toLowerCase()));
  if (!active.length) continue;
  const template = active.filter(d => (d.gapText || "").startsWith("当前材料")).length;
  rows.push({ user: userId.slice(0, 8), active: active.length, template, content_specific: active.length - template });
}
rows.sort((a, b) => b.active - a.active);

const totalActive = rows.reduce((sum, r) => sum + r.active, 0);
const top = rows[0] || { user: "-", active: 0 };
const out = {
  generated_at: new Date().toISOString(),
  threshold: THRESHOLD,
  users_with_active_debts: rows.length,
  total_active: totalActive,
  largest_pool: top,
  ready: top.active >= THRESHOLD,
  gap_to_threshold: Math.max(0, THRESHOLD - top.active)
};

if (asJson) {
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log(`active debts: ${out.total_active} across ${out.users_with_active_debts} users`);
  console.log(`largest pool: user ${top.user} with ${top.active} (${top.content_specific} content-specific, ${top.template} template)`);
  console.log(`EXP-2 launch (>=${THRESHOLD}): ${out.ready ? "READY" : `not ready, need ${out.gap_to_threshold} more`}`);
}
