import fs from "node:fs";

const targetPath = process.argv[2] || "/opt/mindiou/server.js";
const source = fs.readFileSync(targetPath, "utf8");

const oldBlock = `        const outstandingDebts = reports.flatMap(report =>
          (report.sections?.feynmanCards || [])
            .filter(card => !["provisionally_cleared"].includes(card.clearance?.status))
            .map(card => ({
              reportId: report.id,
              cardId: card.id,
              title: card.target || card.prompt || "Cognitive debt",
              status: card.clearance?.status || "not_started",
              locale: report.locale || "zh-CN"
            }))
        ).slice(0, 12);`;

const newBlock = `        const outstandingDebts = reports
          // Explicit fallback reports contain synthetic cards created after an
          // AI failure. Do not resurrect those cards as debts after their
          // authoritative training records have been removed.
          .filter(report => !report.generation || report.generation.fallback !== true)
          .flatMap(report =>
            (report.sections?.feynmanCards || [])
              .filter(card => !["provisionally_cleared", "repaid"].includes(card.clearance?.status))
              .map(card => ({
                reportId: report.id,
                cardId: card.id,
                title: card.target || card.prompt || "Cognitive debt",
                status: card.clearance?.status || "not_started",
                locale: report.locale || "zh-CN"
              }))
          );`;

const matches = source.split(oldBlock).length - 1;
if (matches !== 1) {
  throw new Error(`expected exactly one legacy dashboard block, got ${matches}`);
}

const backup = `${targetPath}.bak-fallback-debts-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
fs.copyFileSync(targetPath, backup);
fs.writeFileSync(targetPath, source.replace(oldBlock, newBlock));
console.log(JSON.stringify({ ok: true, backup, removedLimit: true, excludedFallbackReports: true }));
