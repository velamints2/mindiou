import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const databasePath = path.resolve(process.env.DATA_DB_PATH || process.env.AUTH_STORE_PATH || "tmp/mindiou.sqlite");
const backupDirectory = path.resolve(process.env.DATABASE_BACKUP_DIR || path.join(path.dirname(databasePath), "backups"));
const retentionDays = Math.max(1, Number(process.env.DATABASE_BACKUP_RETENTION_DAYS || 30));
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupPath = path.join(backupDirectory, `mindiou-${stamp}.sqlite`);

await mkdir(backupDirectory, { recursive: true });
const source = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const integrity = source.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`Source database integrity check failed: ${integrity}`);
  await source.backup(backupPath);
} finally {
  source.close();
}

const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
try {
  const integrity = backup.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity}`);
} finally {
  backup.close();
}

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const name of await readdir(backupDirectory)) {
  if (!/^mindiou-\d{8}T\d{6}Z\.sqlite$/.test(name) || name === path.basename(backupPath)) continue;
  const candidate = path.join(backupDirectory, name);
  if ((await stat(candidate)).mtimeMs < cutoff) await rm(candidate, { force: true });
}

console.log(JSON.stringify({ ok: true, databasePath, backupPath, retentionDays }));
