#!/usr/bin/env node
// EXP-1 template-gap material audit: for each legacy "当前材料…" gap, check
// whether the referenced clearance report actually contains the concept the
// gap claims the user was exposed to. Outputs JSON + prints a summary.
// Usage: node scripts/exp1-template-audit.js

import { readFileSync, writeFileSync } from "node:fs";

const training = JSON.parse(readFileSync("tmp/training-store.json", "utf8"));
const mvp0 = JSON.parse(readFileSync("tmp/mvp0-store.json", "utf8"));

const reportsById = new Map(
  (mvp0.clearanceReports || []).map(report => [report.id, report])
);

// Concept extraction: the clause after "能把/解释/复述" up to a verb boundary
// gives the claimed concept. Fall back to quoted spans and the longest noun run.
function extractConcept(gapText) {
  const text = gapText || "";
  // Pattern 1: "尚未证明(用户|其)?能(独立)?(把)?<concept>…" — the claimed gap action.
  const m = text.match(/尚未证明(?:用户|其)?能(?:独立)?(?:把|将)?([^，。；、]{2,24})/);
  if (m) return m[1];
  // Pattern 2: explicit capability verbs.
  const m2 = text.match(/(?:能把|解释|复述|说明白|讲清)([^，。；、]{2,24})/);
  if (m2) return m2[1];
  const quoted = text.match(/[「『"']([^」』"']{2,24})[」』"']/);
  if (quoted) return quoted[1];
  return null;
}

const templateDebts = (training.cognitiveDebts || [])
  .filter(debt => (debt.gapText || "").startsWith("当前材料"));

const results = [];
for (const debt of templateDebts) {
  const report = reportsById.get(debt.reportId);
  const concept = extractConcept(debt.gapText);
  // Evidence anchor = concrete terms the gap quotes (「“…”」or technical tokens).
  // A gap is exposure-anchored when at least one quoted term appears in the
  // raw material the user submitted; meta-requirements (organize/compare)
  // can never appear in material and are not evidence anchors.
  const rawSource = report
    ? [report.input?.artifactText || "", report.input?.preprocess?.summary || ""].join("\n")
    : "";
  const quotedTerms = [...(concept || "").matchAll(/[「『"']([^」』"']{2,20})[」』"']/g)].map(m => m[1]);
  const techTokens = (concept || "").match(/[A-Za-z][A-Za-z0-9.+#-]{2,}/g) || [];
  const anchors = [...new Set([...quotedTerms, ...techTokens])];
  const hits = anchors.filter(term => rawSource.includes(term));
  results.push({
    debt_id: debt.id,
    report_id: debt.reportId,
    report_found: Boolean(report),
    concept,
    anchors: anchors.length,
    anchor_hits: hits.length,
    hit_terms: hits.slice(0, 4),
    audit: !report ? "report_missing"
      : !anchors.length ? "no_anchor_terms"
      : hits.length >= 2 ? "exposure_anchored"
      : hits.length === 1 ? "weakly_anchored"
      : "not_anchored"
  });
}

const summary = {};
for (const row of results) summary[row.audit] = (summary[row.audit] || 0) + 1;
const out = { generated_at: new Date().toISOString(), n: results.length, summary, results };
writeFileSync("docs/research/EXP1-template-audit.json", JSON.stringify(out, null, 1));
console.log(`audited ${results.length} template gaps`);
console.log(JSON.stringify(summary, null, 1));
