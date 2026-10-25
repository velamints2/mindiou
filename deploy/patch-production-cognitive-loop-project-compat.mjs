import fs from "node:fs";

const serverPath = process.argv[2] || "/opt/mindiou/server.js";
const storePath = process.argv[3] || "/opt/mindiou/project-memory-store.js";

function replaceOnce(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(oldValue, newValue);
}

const helper = `// Cognitive Loop accepts both current Project Memory projects and the older
// ownership-store projects that /api/projects still exposes for compatibility.
// On first use, materialize a Project Memory row with the same stable ID so
// loop runs, activity sessions, and later reloads all refer to one project.
function ensureCognitiveLoopProject(projectId, userId) {
  try {
    return projectMemoryStore.getProject(projectId, userId);
  } catch (error) {
    const legacy = legacyProjectMemoryView(projectId, userId);
    if (!legacy?.project) throw error;
    return projectMemoryStore.ensureProject({
      id: projectId,
      name: legacy.project.name,
      description: legacy.project.description,
      repositoryUrl: legacy.project.repositoryUrl,
      projectType: legacy.project.projectType || "software"
    }, userId);
  }
}

`;

let server = fs.readFileSync(serverPath, "utf8");
if (!server.includes("function ensureCognitiveLoopProject")) {
  server = replaceOnce(
    server,
    "// Project Memory 项目也要能打开旧版“项目所有权”入口。",
    helper + "// Project Memory 项目也要能打开旧版“项目所有权”入口。",
    "insert Cognitive Loop project compatibility helper"
  );
}
server = replaceOnce(
  server,
  "          projectMemoryStore.getProject(projectId, user.id);\n          const run = cognitiveLoopStore.getLatestRun(projectId, user.id);",
  "          ensureCognitiveLoopProject(projectId, user.id);\n          const run = cognitiveLoopStore.getLatestRun(projectId, user.id);",
  "resolve Cognitive Loop latest project"
);
server = replaceOnce(
  server,
  "          projectMemoryStore.getProject(projectId, user.id);\n          if (!Array.isArray(body.activities) || body.activities.length === 0) {",
  "          const project = ensureCognitiveLoopProject(projectId, user.id);\n          if (!Array.isArray(body.activities) || body.activities.length === 0) {",
  "resolve Cognitive Loop run project"
);
server = replaceOnce(
  server,
  '            title: "Cognitive Loop · " + projectMemoryStore.getProject(projectId, user.id).name,',
  '            title: "Cognitive Loop · " + project.name,',
  "reuse resolved Cognitive Loop project"
);

let store = fs.readFileSync(storePath, "utf8");
store = replaceOnce(
  store,
  `  function ensureProject(input, userId) {
    if (input?.id) return requireProject(input.id, userId);`,
  `  function ensureProject(input, userId) {
    if (input?.id) {
      try {
        return requireProject(input.id, userId);
      } catch (error) {
        // Materialize a legacy ownership project without changing its stable ID.
        const projectId = clean(input.id, 100);
        const conflicting = db.prepare("SELECT id FROM pm_projects WHERE id = ? LIMIT 1").get(projectId);
        if (conflicting) throw error;
        return createProject({ ...input, id: projectId }, userId, { preserveId: true });
      }
    }`,
  "materialize legacy Project Memory project"
);
store = replaceOnce(
  store,
  "  function createProject(input = {}, userId) {\n    const projectId = id(\"project\");",
  "  function createProject(input = {}, userId, options = {}) {\n    const projectId = options.preserveId && clean(input.id, 100) ? clean(input.id, 100) : id(\"project\");",
  "preserve Project Memory project ID"
);

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const serverBackup = `${serverPath}.bak-cognitive-loop-project-compat-${stamp}`;
const storeBackup = `${storePath}.bak-cognitive-loop-project-compat-${stamp}`;
fs.copyFileSync(serverPath, serverBackup);
fs.copyFileSync(storePath, storeBackup);
fs.writeFileSync(serverPath, server);
fs.writeFileSync(storePath, store);
console.log(JSON.stringify({ ok: true, serverPath, storePath, serverBackup, storeBackup }));
