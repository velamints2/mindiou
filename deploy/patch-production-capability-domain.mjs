import fs from "node:fs";

const targetServer = process.argv[2] || "/opt/mindiou/server.js";
const targetRepayment = process.argv[3] || "/opt/mindiou/cognitive-repayment.js";
const targetReport = process.argv[4] || "/opt/mindiou/mvp0-report.js";
const sourceServer = process.argv[5] || "/tmp/mindiou-local-server.js";
const sourceRepayment = process.argv[6] || "/tmp/mindiou-local-cognitive-repayment.js";
const sourceReport = process.argv[7] || "/tmp/mindiou-local-mvp0-report.js";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

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

const sourceServerText = read(sourceServer);
const sourceRepaymentText = read(sourceRepayment);
const sourceReportText = read(sourceReport);
let server = read(targetServer);
let repayment = read(targetRepayment);
let report = read(targetReport);

if (server.includes("deriveReportCapabilityDomain") || server.includes("ensureCapabilityProfileDomain")) {
  throw new Error("Production server already contains capability-domain patch; refusing duplicate patch");
}
if (repayment.includes("ensureCapabilityProfileDomain")) {
  throw new Error("Production repayment module already contains capability-domain patch; refusing duplicate patch");
}

// The helper depends on NON_SPECIFIC_CAPABILITY_DOMAINS.  Extract the
// dependency together with the function; the previous patch copied only the
// function body, which made production fail at report time with
// "NON_SPECIFIC_CAPABILITY_DOMAINS is not defined".
const profileDomainConstants = extractBetween(
  sourceRepaymentText,
  "const NON_SPECIFIC_CAPABILITY_DOMAINS",
  "/**\n * Create a zero-evidence domain"
);
const profileDomainHelper = extractBetween(
  sourceRepaymentText,
  "/**\n * Create a zero-evidence domain",
  "/**\n * EMA-updates the per-domain capability profile."
);
const reportDomainHelper = extractBetween(
  sourceServerText,
  "const NON_SPECIFIC_REPORT_DOMAINS",
  "const sessionCookieName"
);

repayment = replaceOnce(
  repayment,
  "/**\n * EMA-updates the per-domain capability profile.",
  `${profileDomainConstants}\n\n${profileDomainHelper}\n\n/**\n * EMA-updates the per-domain capability profile.`,
  "insert capability profile domain helper"
);

server = replaceOnce(
  server,
  "  completePendingReviewItems,\n  updateCapabilityProfile",
  "  completePendingReviewItems,\n  ensureCapabilityProfileDomain,\n  updateCapabilityProfile",
  "import capability profile domain helper"
);
server = replaceOnce(
  server,
  "const sessionCookieName",
  `${reportDomainHelper}\n\nconst sessionCookieName`,
  "insert report domain resolver"
);
server = replaceOnce(
  server,
  "        const saved = await mvp0Store.saveReport(report);",
  `        const saved = await mvp0Store.saveReport(report);
        // Create a zero-evidence domain at report time; repayment answers update its scores later.
        try {
          const reportDomain = deriveReportCapabilityDomain(saved);
          if (reportDomain) {
            const profile = ensureCapabilityProfileDomain({
              profiles: repaymentStore.getState().capabilityProfiles,
              userId: user.id,
              domain: reportDomain,
              reportId: saved.id,
              now: saved.createdAt || new Date().toISOString()
            });
            if (profile) await repaymentStore.saveCapabilityProfile(profile);
          }
        } catch (profileError) {
          console.warn(\`Capability domain initialization failed for report \${saved.id}: \${profileError.message}\`);
        }`,
  "add report-time capability domain creation"
);

const promptMarker = "  '\"currentDomain\":\"\",\"strongestDemonstratedAbility\":\"\",\"highestPriorityGrowthArea\":\"\",\"evidenceSignals\":[],\"recommendedCardLevel\":\"foundation|intermediate|advanced\"}}',";
report = replaceOnce(
  report,
  promptMarker,
  `${promptMarker}\n  "currentDomain 必须提取材料的具体主题领域（例如‘3D打印与增材制造’、‘AR眼镜硬件协同设计’），不要填用户能力等级；只有材料主题确实无法判断时才填 unknown，不要把所有主题都归为 general。",`,
  "strengthen report domain prompt"
);

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backups = {
  server: `${targetServer}.bak-capability-domain-${stamp}`,
  repayment: `${targetRepayment}.bak-capability-domain-${stamp}`,
  report: `${targetReport}.bak-capability-domain-${stamp}`
};
fs.copyFileSync(targetServer, backups.server);
fs.copyFileSync(targetRepayment, backups.repayment);
fs.copyFileSync(targetReport, backups.report);
const changedBytes = {
  server: server.length - read(backups.server).length,
  repayment: repayment.length - read(backups.repayment).length,
  report: report.length - read(backups.report).length
};
fs.writeFileSync(targetServer, server);
fs.writeFileSync(targetRepayment, repayment);
fs.writeFileSync(targetReport, report);
console.log(JSON.stringify({ ok: true, backups, changedBytes }));
