import { mkdir, readdir, rm, stat, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";

const databasePath = path.resolve(process.env.DATA_DB_PATH || process.env.AUTH_STORE_PATH || "tmp/mindiou.sqlite");
const backupDirectory = path.resolve(process.env.DATABASE_BACKUP_DIR || path.join(path.dirname(databasePath), "backups"));
const retentionDays = Math.max(1, Number(process.env.DATABASE_BACKUP_RETENTION_DAYS || 30));
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const plainBackupPath = path.join(backupDirectory, `mindiou-${stamp}.sqlite`);
const encryptionKey = process.env.DATABASE_BACKUP_ENCRYPTION_KEY || "";
const requireEncryption = process.env.DATABASE_BACKUP_REQUIRE_ENCRYPTION === "1";
if (requireEncryption && !encryptionKey) throw new Error("DATABASE_BACKUP_ENCRYPTION_KEY is required");

await mkdir(backupDirectory, { recursive: true });
const source = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const integrity = source.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`Source database integrity check failed: ${integrity}`);
  await source.backup(plainBackupPath);
} finally {
  source.close();
}

const backup = new Database(plainBackupPath, { readonly: true, fileMustExist: true });
try {
  const integrity = backup.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity}`);
} finally {
  backup.close();
}

let backupPath = plainBackupPath;
if (encryptionKey) {
  const key = crypto.createHash("sha256").update(encryptionKey).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(await readFile(plainBackupPath)), cipher.final()]);
  const envelope = JSON.stringify({ version: 1, algorithm: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
  backupPath = `${plainBackupPath}.enc`;
  await writeFile(backupPath, envelope, { mode: 0o640 });
  await rm(plainBackupPath, { force: true });
}

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
for (const name of await readdir(backupDirectory)) {
  if (!/^mindiou-\d{8}T\d{6}Z\.sqlite(?:\.enc)?$/.test(name) || name === path.basename(backupPath)) continue;
  const candidate = path.join(backupDirectory, name);
  if ((await stat(candidate)).mtimeMs < cutoff) await rm(candidate, { force: true });
}

console.log(JSON.stringify({ ok: true, databasePath, backupPath, encrypted: Boolean(encryptionKey), retentionDays }));
