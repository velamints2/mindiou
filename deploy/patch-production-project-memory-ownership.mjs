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

if (target.includes("function projectMemoryOwnershipView")) {
  throw new Error("Production already contains the Project Memory ownership adapter; refusing duplicate patch");
}

const helper = extractBetween(source, "function projectMemoryOwnershipView", "function detectArtifactType");
const oldRoute = `        if (req.method === "GET" && pmProjectOwnershipMatch) {
          const projectId = decodeURIComponent(pmProjectOwnershipMatch[1]);
          const project = ownershipStore.getProject(projectId, user.id);
          if (!project) {
            jsonResponse(res, 404, { ok: false, error: "Project not found" });
            return;
          }
          const view = computeProjectOwnershipView(ownershipStore, trainingStore, projectId, user.id);
          jsonResponse(res, 200, { ok: true, ...view });
          return;
        }`;
const newRoute = `        if (req.method === "GET" && pmProjectOwnershipMatch) {
          const projectId = decodeURIComponent(pmProjectOwnershipMatch[1]);
          const project = ownershipStore.getProject(projectId, user.id);
          const memoryProject = project || (() => { try { return projectMemoryStore.getProject(projectId, user.id); } catch { return null; } })();
          if (!memoryProject) {
            jsonResponse(res, 404, { ok: false, error: "Project not found" });
            return;
          }
          const view = project
            ? computeProjectOwnershipView(ownershipStore, trainingStore, projectId, user.id)
            : projectMemoryOwnershipView(projectId, user.id);
          jsonResponse(res, 200, { ok: true, ...view });
          return;
        }`;

let next = target;
next = replaceOnce(next, "function detectArtifactType", `${helper}\n\nfunction detectArtifactType`, "insert Project Memory ownership adapter");
next = replaceOnce(next, oldRoute, newRoute, "unify ownership route project lookup");

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupPath = `${targetPath}.bak-project-memory-ownership-${stamp}`;
fs.copyFileSync(targetPath, backupPath);
fs.writeFileSync(targetPath, next);
console.log(JSON.stringify({ ok: true, targetPath, backupPath, changedBytes: next.length - target.length }));
