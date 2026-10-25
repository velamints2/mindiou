#!/usr/bin/env node
// EXP-1 analysis: computes stratified precision over the reviewed labels.
// Reads labels from the SQLite namespace (written by /api/experiments/exp1/label)
// and joins them with the annotation sheet. Template/known-answer strata are
// reported separately per the annotation protocol.
// Usage: node scripts/exp1-analyze.js [--db tmp/mindiou.sqlite] [--sheet docs/research/EXP1-candidates-annotation-sheet.json]

import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1] || null;
const dbPath = flag("--db") || "tmp/mindiou.sqlite";
const sheetPath = flag("--sheet") || "docs/research/EXP1-candidates-annotation-sheet.json";

const sheet = JSON.parse(readFileSync(sheetPath, "utf8"));
const db = new DatabaseSync(dbPath);
const row = db.prepare("SELECT payload FROM application_state WHERE namespace = 'experiment-exp1-labels'").get();
const labels = row ? (JSON.parse(row.payload).labels || {}) : {};

// ── A-layer: session candidates aggregated by gap text ──
const groups = new Map();
for (const r of sheet.rows) {
  const key = (r.description || r.title).slice(0, 40);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const aRows = [...groups.values()].map(rows => {
  const first = rows[0];
  const label = labels[`candidate:${first.session_id}:${first.candidate_index}`]?.label || null;
  return { gap: (first.description || first.title).slice(0, 60), label, dup_rows: rows.length, source: "agent_session" };
});

// ── B-layer: legacy gaps, stratified by template flag and audit anchor ──
const bRows = sheet.legacy_debts.map(d => ({
  gap: (d.gap_text || "").slice(0, 60),
  label: labels[`legacy:${d.debt_id}`]?.label || null,
  template: Boolean(d.template_generated),
  audit: d.audit || null,
  source: "legacy"
}));

// ── Stratified metrics ──
function metrics(rows, name) {
  const labeled = rows.filter(r => r.label);
  const real = labeled.filter(r => r.label === "real_debt").length;
  const not = labeled.filter(r => r.label === "not_debt").length;
  const unsure = labeled.filter(r => r.label === "unsure").length;
  return { stratum: name, labeled: labeled.length, total: rows.length, real_debt: real, not_debt: not, unsure, coverage: rows.length ? +(labeled.length / rows.length).toFixed(2) : 0 };
}

const templateRows = bRows.filter(r => r.template);
const contentRows = bRows.filter(r => !r.template);
const anchored = templateRows.filter(r => r.audit === "exposure_anchored" || r.audit === "weakly_anchored");
const unanchored = templateRows.filter(r => r.audit === "not_anchored" || r.audit === "no_anchor_terms");

const report = {
  generated_at: new Date().toISOString(),
  reviewer_labels: Object.keys(labels).length,
  A_layer: {
    aggregated_gaps: aRows.length,
    duplicate_row_ratio: sheet.rows.length > 1 ? +(1 - aRows.length / sheet.rows.length).toFixed(2) : 0,
    metrics: metrics(aRows, "A: agent-session candidates (aggregated)"),
    rows: aRows
  },
  B_layer: {
    metrics_all: metrics(bRows, "B: legacy all"),
    metrics_content_specific: metrics(contentRows, "B1: content-specific"),
    metrics_template_anchored: metrics(anchored, "B2a: template w/ material anchor"),
    metrics_template_unanchored: metrics(unanchored, "B2b: template w/o anchor"),
    rows: bRows
  }
};

console.log(`labels: ${report.reviewer_labels}`);
console.log(`A-layer duplicate-row ratio: ${report.A_layer.duplicate_row_ratio}`);
for (const key of ["A_layer"]) {
  const m = report[key].metrics;
  console.log(`${m.stratum}: ${m.labeled}/${m.total} labeled → real ${m.real_debt} / not ${m.not_debt} / unsure ${m.unsure}`);
}
for (const m of Object.values(report.B_layer).filter(v => v && v.stratum)) {
  console.log(`${m.stratum}: ${m.labeled}/${m.total} labeled → real ${m.real_debt} / not ${m.not_debt} / unsure ${m.unsure}`);
}

writeFileSync("docs/research/EXP1-analysis-latest.json", JSON.stringify(report, null, 1));
console.log("written: docs/research/EXP1-analysis-latest.json");
