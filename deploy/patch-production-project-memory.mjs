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

if (target.includes("async function projectMemoryLinkReport")) {
  throw new Error("Report project-memory link helper already exists; refusing duplicate patch");
}
if (target.includes("pmReportProjectMemoryMatch")) {
  throw new Error("Report project-memory route matcher already exists; refusing duplicate patch");
}
if (target.includes("function legacyProjectMemoryView")) {
  throw new Error("Legacy project-memory adapter already exists; refusing duplicate patch");
}

const reportLinkHelper = extractBetween(
  source,
  "async function projectMemoryLinkReport",
  "async function projectMemoryDetectRecurrences"
);
const legacyAdapter = extractBetween(
  source,
  "function legacyProjectMemoryView",
  "function detectArtifactType"
);

let next = target;
next = replaceOnce(
  next,
  "async function projectMemoryDetectRecurrences",
  `${reportLinkHelper}\n\nasync function projectMemoryDetectRecurrences`,
  "insert report link helper"
);
next = replaceOnce(
  next,
  "function detectArtifactType",
  `${legacyAdapter}\n\nfunction detectArtifactType`,
  "insert legacy memory adapter"
);
next = replaceOnce(
  next,
  "    const pmHookTokenRevokeMatch = url.pathname.match(/^\\/api\\/projects\\/([^/]+)\\/hook-token\\/([^/]+)$/);",
  "    const pmHookTokenRevokeMatch = url.pathname.match(/^\\/api\\/projects\\/([^/]+)\\/hook-token\\/([^/]+)$/);\n" +
    "    const pmReportProjectMemoryMatch = url.pathname.match(/^\\/api\\/mvp0\\/reports\\/([^/]+)\\/project-memory$/);",
  "add report link route matcher"
);
next = replaceOnce(
  next,
  "      pmSessionCandidateMatch || pmHookTokenMatch || pmHookTokenRevokeMatch;",
  "      pmSessionCandidateMatch || pmHookTokenMatch || pmHookTokenRevokeMatch || pmReportProjectMemoryMatch;",
  "register report link project-memory route"
);
next = replaceOnce(
  next,
  "        if (req.method === \"POST\" && url.pathname === \"/api/agent-sessions/events\") {",
  `        if (req.method === "POST" && pmReportProjectMemoryMatch) {
          const result = await projectMemoryLinkReport(
            decodeURIComponent(pmReportProjectMemoryMatch[1]),
            String(body.projectId || ""),
            user.id
          );
          jsonResponse(res, 200, { ok: true, ...result });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/agent-sessions/events") {`,
  "add report link route handler"
);
next = replaceOnce(
  next,
  "          jsonResponse(res, 200, { ok: true, memory: projectMemoryStore.memory(projectId, user.id, trainingStore.listCognitiveDebts(user.id)) });",
  `          let memory;
          try {
            memory = projectMemoryStore.memory(projectId, user.id, trainingStore.listCognitiveDebts(user.id));
          } catch {
            memory = legacyProjectMemoryView(projectId, user.id);
            if (!memory) {
              jsonResponse(res, 404, { ok: false, error: "Project not found" });
              return;
            }
            delete memory.byWorkItem;
            delete memory.raw;
          }
          jsonResponse(res, 200, { ok: true, memory });`,
  "add legacy memory read fallback"
);

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${targetPath}.bak-project-memory-${stamp}`;
fs.copyFileSync(targetPath, backupPath);
fs.writeFileSync(targetPath, next);
console.log(JSON.stringify({ ok: true, targetPath, backupPath, changedBytes: next.length - target.length }));
