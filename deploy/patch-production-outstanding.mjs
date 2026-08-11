import fs from "node:fs";

const targetServerPath = process.argv[2] || "/opt/mindiou/server.js";
const targetRepaymentPath = process.argv[3] || "/opt/mindiou/cognitive-repayment.js";
const sourceServerPath = process.argv[4] || "/tmp/mindiou-local-server.js";
const sourceRepaymentPath = process.argv[5] || "/tmp/mindiou-local-cognitive-repayment.js";
const sourceServer = fs.readFileSync(sourceServerPath, "utf8");
const sourceRepayment = fs.readFileSync(sourceRepaymentPath, "utf8");
let targetServer = fs.readFileSync(targetServerPath, "utf8");
let targetRepayment = fs.readFileSync(targetRepaymentPath, "utf8");

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

function replaceBetween(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: missing start marker`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`${label}: missing end marker`);
  return `${text.slice(0, start)}${replacement}\n${text.slice(end)}`;
}

if (targetServer.includes("function listOutstandingDebts")) {
  throw new Error("Production server already contains unified outstanding patch");
}

const outstandingHelpers = extractBetween(sourceServer, "function reportCardForRepaymentGap", "const rawWebResearch");
targetServer = replaceOnce(targetServer, "const rawWebResearch", `${outstandingHelpers}\nconst rawWebResearch`, "insert outstanding helpers");
targetServer = replaceOnce(
  targetServer,
  "        const sessions = mvp1Store.listSessions(user.id);",
  "        await syncRepaymentGapsFromReports(user.id);\n        const sessions = mvp1Store.listSessions(user.id);",
  "sync dashboard gaps"
);

const dashboardBlock = [
  "        const repaymentGapsForDashboard = repaymentStore.listGaps(user.id);",
  "        const repaidTitles = new Set(",
  "          repaymentGapsForDashboard",
  "            .filter(gap => gap.status === \"repaid\")",
  "            .map(gap => gap.title)",
  "            .filter(Boolean)",
  "        );",
  "        const outstandingDebts = listOutstandingDebts(user.id, reports);"
].join("\n");
targetServer = replaceBetween(
  targetServer,
  "        const repaymentGapsForDashboard = repaymentStore.listGaps(user.id);",
  "        const clearedCardTitles = new Set();",
  dashboardBlock,
  "unify dashboard outstanding data"
);

const oldDebtCreation = [
  "                reportId: saved.id,",
  "                cardId: undefined,",
  "                gapText,"
].join("\n");
const newDebtCreation = [
  "                reportId: saved.id,",
  "                cardId: saved.sections?.feynmanCards?.find(card =>",
  "                  String(card.target || \"\").trim() === gapText || String(card.prompt || \"\").trim() === gapText",
  "                )?.id,",
  "                gapText,"
].join("\n");
targetServer = replaceOnce(targetServer, oldDebtCreation, newDebtCreation, "bind created debt to card");

if (targetRepayment.includes("const matchedCard = cards.find")) {
  throw new Error("Production repayment module already contains card association patch");
}
const oldRankReturn = "  return { gap: matched, card: null };";
const newRankReturn = [
  "  const cards = Array.isArray(report?.sections?.feynmanCards) ? report.sections.feynmanCards : [];",
  "  const matchedCard = cards.find(item => [item?.target, item?.prompt]",
  "    .some(value => clean(value || \"\") === clean(matched?.title || matched?.gap || \"\")))",
  "    || cards[rank - 1]",
  "    || null;",
  "  return { gap: matched, card: matchedCard };"
].join("\n");
targetRepayment = replaceOnce(targetRepayment, oldRankReturn, newRankReturn, "associate repayment gap with card");

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backups = {
  server: `${targetServerPath}.bak-outstanding-${stamp}`,
  repayment: `${targetRepaymentPath}.bak-outstanding-${stamp}`
};
fs.copyFileSync(targetServerPath, backups.server);
fs.copyFileSync(targetRepaymentPath, backups.repayment);
fs.writeFileSync(targetServerPath, targetServer);
fs.writeFileSync(targetRepaymentPath, targetRepayment);
console.log(JSON.stringify({ ok: true, backups, changedBytes: { server: targetServer.length - fs.statSync(backups.server).size, repayment: targetRepayment.length - fs.statSync(backups.repayment).size } }));
