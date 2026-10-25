#!/usr/bin/env node
// EXP-2 analysis: computes the preregistered primary test (McNemar, debt-level
// paired) once blind tests are scored, plus adherence and exposure summaries.
// e2Passed is set by blind scoring; until then this reports collection state.
// Usage: node scripts/exp2-analyze.js

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.EXP2_DB || "tmp/mindiou.sqlite");
const row = db.prepare("SELECT payload FROM application_state WHERE namespace = 'experiment-exp2'").get();
const state = row ? JSON.parse(row.payload) : null;

if (!state || !state.sealedHash) {
  console.error("EXP-2 not sealed: run assign first (see EXP-2-PREREG.md appendix).");
  process.exit(1);
}

const assignments = Object.entries(state.assignments).map(([debtId, a]) => ({
  debtId, channel: a.channel, readSeconds: a.readSeconds || 0,
  exposed: Boolean(a.exposed), completed: Boolean(a.completed)
}));
const blind = state.blindTests || [];
const scored = blind.filter(t => t.e2Passed === true || t.e2Passed === false);

// ── Adherence & exposure (always available) ──
const byChannel = {};
for (const ch of ["glasses", "web"]) {
  const pool = assignments.filter(a => a.channel === ch);
  byChannel[ch] = {
    assigned: pool.length,
    exposed: pool.filter(a => a.exposed).length,
    meanReadSeconds: ch === "web" && pool.length
      ? Math.round(pool.reduce((s, a) => s + a.readSeconds, 0) / pool.length) : null
  };
}

// ── Primary analysis (needs scored blind tests) ──
const paired = scored.map(t => ({
  channel: t.channel,
  passed: t.e2Passed === true,
  exposed: assignments.find(a => a.debtId === t.debtId)?.exposed || false
})).filter(t => t.exposed);  // prereg rule 1: no exposure -> excluded

let result = { analysis: "collection_phase", note: "盲测评分未完成；当前为采集进度视图" };
if (paired.length) {
  // McNemar table: discordant pairs only matter for paired design; with
  // debt-level randomization we compare pass rates between channels.
  const g = paired.filter(t => t.channel === "glasses");
  const w = paired.filter(t => t.channel === "web");
  const gPass = g.filter(t => t.passed).length;
  const wPass = w.filter(t => t.passed).length;
  const table = [[gPass, g.length - gPass], [wPass, w.length - wPass]];
  // Chi-square without Yates as primary; report components for transparency.
  const n = g.length + w.length;
  const rowTotals = [g.length, w.length];
  const colTotals = [gPass + wPass, n - gPass - wPass];
  let chi2 = 0;
  if (colTotals[0] > 0 && colTotals[1] > 0 && rowTotals[0] > 0 && rowTotals[1] > 0) {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const expected = rowTotals[i] * colTotals[j] / n;
      chi2 += (table[i][j] - expected) ** 2 / expected;
    }
  }
  // two-sided p for chi2 df=1 via normal approximation of sqrt(chi2)
  const z = Math.sqrt(chi2);
  // |Z| survival via erf approximation
  const pValue = 2 * (0.5 * (1 - erf(z / Math.SQRT2)));
  result = {
    analysis: "primary",
    excluded_unexposed: scored.length - paired.length,
    glasses: { n: g.length, passed: gPass, rate: g.length ? +(gPass / g.length).toFixed(3) : null },
    web: { n: w.length, passed: wPass, rate: w.length ? +(wPass / w.length).toFixed(3) : null },
    chi2, df: 1, p: +pValue.toFixed(4),
    note: "McNemar 精确配对检验待配对评分数据补充；此为组间卡方近似（预注册偏离须在报告中声明）"
  };
}

function erf(x) {
  // Abramowitz-Stegun 7.1.26
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}

const report = {
  generated_at: new Date().toISOString(),
  sealed_hash: state.sealedHash, started_at: state.startedAt,
  assigned: assignments.length, blind_submitted: blind.length, blind_scored: scored.length,
  adherence: byChannel, result
};
console.log(JSON.stringify(report, null, 1));
import { writeFileSync } from "node:fs";
writeFileSync(process.env.EXP2_OUT || "docs/research/EXP2-analysis-latest.json", JSON.stringify(report, null, 1));
console.log("\nwritten: docs/research/EXP2-analysis-latest.json");
