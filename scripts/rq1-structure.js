#!/usr/bin/env node
// RQ1 structure-validity S1+S2: evidence-level monotonicity, adjacent-level
// discrimination, and six-dimension mastery internal structure.
// Reads tmp/training-store.json; small-n descriptive with explicit warnings.
// Usage: node scripts/rq1-structure.js

import { readFileSync, writeFileSync } from "node:fs";

const store = JSON.parse(readFileSync("tmp/training-store.json", "utf8"));
const attempts = store.trainingAttempts || [];
const profiles = store.masteryProfiles || [];
const debts = new Map((store.cognitiveDebts || []).map(d => [d.id, d]));

// ── S1a: monotonicity — higher currentStage should pair with more attempts ──
const stageOrder = ["new", "open", "in_progress", "monitoring", "cleared", "recurred"];
const stageRank = s => Math.max(0, stageOrder.indexOf(String(s || "").toLowerCase()));
const debtLevel = prof => {
  const debt = debts.get(prof.cognitiveDebtId);
  return stageRank(debt?.status);
};
const pairs = profiles.filter(p => p.successfulAttempts + p.failedAttempts > 0)
  .map(p => ({ level: debtLevel(p), effort: p.successfulAttempts + p.failedAttempts + p.relapseCount }));

function spearman(a, b) {
  const rank = arr => {
    const sorted = [...arr].sort((x, y) => x - y);
    return arr.map(v => sorted.indexOf(v) + 1);  // ties get first rank; fine for descriptive n
  };
  const ra = rank(a), rb = rank(b);
  const n = a.length;
  const ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, dbb = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; dbb += (rb[i] - mb) ** 2; }
  return da && dbb ? num / Math.sqrt(da * dbb) : null;
}
const rho = pairs.length >= 4 ? spearman(pairs.map(p => p.level), pairs.map(p => p.effort)) : null;

// ── S1b: adjacent-level first-attempt discrimination ──
const firstPass = new Map();
for (const a of attempts) {
  const key = a.cognitiveDebtId || a.cardId;
  if (!firstPass.has(key)) firstPass.set(key, a.evaluation?.passed === true);
}
const byLevel = {};
for (const [key, passed] of firstPass) {
  const prof = profiles.find(p => p.cognitiveDebtId === key);
  if (!prof) continue;
  const lv = debtLevel(prof);
  (byLevel[lv] ||= []).push(passed);
}
const discrimination = Object.fromEntries(Object.entries(byLevel).map(([lv, arr]) => [lv, { n: arr.length, firstPassRate: +(arr.filter(Boolean).length / arr.length).toFixed(2) }]));

// ── S2: six-dimension internal structure ──
const DIMS = ["conceptualUnderstanding", "independentRecall", "hintIndependence", "misconceptionResistance", "transferAbility", "retentionStrength"];
function pearson(a, b) {
  const n = a.length; const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : null;
}
const corr = {};
for (let i = 0; i < DIMS.length; i++) for (let j = i + 1; j < DIMS.length; j++) {
  const a = profiles.map(p => p[DIMS[i]]).filter(v => typeof v === "number");
  const b = profiles.map(p => p[DIMS[j]]).filter(v => typeof v === "number");
  const r = a.length >= 4 ? pearson(a, b) : null;
  if (r !== null) corr[`${DIMS[i]}~${DIMS[j]}`] = +r.toFixed(2);
}
const corrValues = Object.values(corr);
const meanR = corrValues.length ? +(corrValues.reduce((s, v) => s + v, 0) / corrValues.length).toFixed(2) : null;

const report = {
  generated_at: new Date().toISOString(),
  warning: `样本量 n(profiles)=${profiles.length}, n(attempts)=${attempts.length} — 仅作描述性基线，不具推断力；推断性检验待 EXP-2 后 n≥40`,
  s1a_monotonicity: { n: pairs.length, spearman_level_vs_effort: rho, verdict: rho === null ? "样本不足" : Math.abs(rho) >= 0.4 ? "方向成立（描述性）" : "未达 0.4（描述性）" },
  s1b_discrimination: discrimination,
  s2_internal_structure: { dimension_pairs: corrValues.length, mean_r: meanR, redundancy_threshold: 0.8, independence_threshold: 0.2, verdict: meanR === null ? "样本不足" : meanR > 0.8 ? "维度冗余信号" : meanR < 0.2 ? "可能不同构念（需分因子）" : "中低相关，维度基本独立" }
};
writeFileSync("docs/research/RQ1-structure-latest.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
console.log("\nwritten: docs/research/RQ1-structure-latest.json");
