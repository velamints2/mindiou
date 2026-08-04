#!/usr/bin/env bash
set -euo pipefail

STAGE_DIR="${STAGE_DIR:?STAGE_DIR is required}"
ROLLBACK_DIR="${ROLLBACK_DIR:?ROLLBACK_DIR is required}"
APP_DIR="${APP_DIR:-/opt/mindiou}"
DATA_DIR="${DATA_DIR:-/var/lib/mindiou}"
ENV_FILE="${ENV_FILE:-/etc/mindiou.env}"
SERVICE="${SERVICE:-mindiou.service}"
PORT="${PORT:-8794}"

code_files=(
  server.js auth-store.js mvp0-store.js mvp1-store.js training-store.js
  cognitive-repayment-store.js spiral-store.js sqlite-state-store.js
  package.json package-lock.json
)

for file in "${code_files[@]}" scripts/backup-database.mjs deploy/mindiou-db-backup.service deploy/mindiou-db-backup.timer; do
  test -f "${STAGE_DIR}/${file}"
done
test -f "${ROLLBACK_DIR}/mindiou.env"
test -f "${ROLLBACK_DIR}/data/auth-store.sqlite"

rollback() {
  echo "ROLLBACK_START"
  systemctl stop "${SERVICE}" || true
  install -o root -g root -m 0600 "${ROLLBACK_DIR}/mindiou.env" "${ENV_FILE}"
  for file in server.js auth-store.js mvp0-store.js mvp1-store.js training-store.js cognitive-repayment-store.js spiral-store.js package.json package-lock.json; do
    install -o mindiou -g mindiou -m 0644 "${ROLLBACK_DIR}/code/${file}" "${APP_DIR}/${file}"
  done
  find "${DATA_DIR}" -maxdepth 1 -type f \( -name 'mindiou.sqlite' -o -name 'mindiou.sqlite-wal' -o -name 'mindiou.sqlite-shm' \) -delete
  cp -a "${ROLLBACK_DIR}/data/." "${DATA_DIR}/"
  chown -R mindiou:mindiou "${DATA_DIR}"
  systemctl daemon-reload
  systemctl start "${SERVICE}"
  echo "ROLLBACK_DONE"
}
trap rollback ERR

systemctl stop "${SERVICE}"
cd "${APP_DIR}"
node --input-type=module -e '
  import Database from "better-sqlite3";
  const db = new Database("/var/lib/mindiou/auth-store.sqlite");
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`auth database integrity: ${integrity}`);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
'

install -o mindiou -g mindiou -m 0640 "${DATA_DIR}/auth-store.sqlite" "${DATA_DIR}/mindiou.sqlite"
for file in "${code_files[@]}"; do
  install -o mindiou -g mindiou -m 0644 "${STAGE_DIR}/${file}" "${APP_DIR}/${file}"
done
install -d -o mindiou -g mindiou -m 0755 "${APP_DIR}/scripts"
install -o mindiou -g mindiou -m 0644 "${STAGE_DIR}/scripts/backup-database.mjs" "${APP_DIR}/scripts/backup-database.mjs"

sed -i \
  -e '/^DATA_DB_PATH=/d' \
  -e '/^MAX_ARTIFACT_CHARS=/d' \
  -e '/^MAX_REQUEST_BODY_BYTES=/d' \
  -e '/^DAILY_ANALYSIS_LIMIT=/d' \
  -e '/^USER_DAILY_AI_TOKEN_BUDGET=/d' \
  -e '/^AI_OUTPUT_TOKEN_RESERVE=/d' \
  "${ENV_FILE}"
printf '\n%s\n' \
  'DATA_DB_PATH=/var/lib/mindiou/mindiou.sqlite' \
  'MAX_ARTIFACT_CHARS=30000' \
  'MAX_REQUEST_BODY_BYTES=10485760' \
  'DAILY_ANALYSIS_LIMIT=3' \
  'USER_DAILY_AI_TOKEN_BUDGET=200000' \
  'AI_OUTPUT_TOKEN_RESERVE=10000' >> "${ENV_FILE}"

install -o root -g root -m 0644 "${STAGE_DIR}/deploy/mindiou-db-backup.service" /etc/systemd/system/mindiou-db-backup.service
install -o root -g root -m 0644 "${STAGE_DIR}/deploy/mindiou-db-backup.timer" /etc/systemd/system/mindiou-db-backup.timer
systemctl daemon-reload
systemctl start "${SERVICE}"

healthy=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" > /tmp/mindiou-health.json; then
    healthy=1
    break
  fi
  sleep 1
done
test "${healthy}" -eq 1
cat /tmp/mindiou-health.json
systemctl enable --now mindiou-db-backup.timer
trap - ERR
echo "MIGRATION_STARTED_OK"
