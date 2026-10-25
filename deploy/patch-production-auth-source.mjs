import { copyFile, readFile, writeFile } from "node:fs/promises";

const target = process.env.PRODUCTION_SERVER_FILE || "/opt/mindiou/server.js";
const source = await readFile(target, "utf8");
const oldStore = "const authStore = createAuthStore(dataDbPath);";
const newStore = "const authDbPath = process.env.AUTH_STORE_PATH || dataDbPath;\nconst authStore = createAuthStore(authDbPath);";
const hasWebSessionGate = source.includes("const webUser = sessionId ? authStore.getUserBySession(sessionId) : null;")
  && source.includes('method: "web-session"');
if (!hasWebSessionGate) {
  throw new Error("authorizeRequest is still missing Web session support; aborting without write");
}
if (source.includes(newStore)) {
  console.log(JSON.stringify({ ok: true, changed: [], alreadyApplied: true }));
  process.exit(0);
}
if (!source.includes(oldStore)) {
  throw new Error("production authStore initialization not found; aborting without write");
}
const backup = `${target}.before-auth-store-path-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;
await copyFile(target, backup);
await writeFile(target, source.replace(oldStore, newStore));
console.log(JSON.stringify({ ok: true, changed: ["AUTH_STORE_PATH", "WebSessionGate"], backup }));
