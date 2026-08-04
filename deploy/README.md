# MindIOU Public Deployment

The public deployment keeps the existing server website intact and mounts:

- `/mindiou/`: MVP-0 report experience;
- `/mindiou/mvp1/`: one report/card-scoped MVP-1 clearance session;
- `/mindiou-api/`: rate-limited Node API reverse proxy.
- `https://114.67.169.78/mindiou/`: stable public TLS demo and Rokid AIUI
  backend origin, using a trusted short-lived IP certificate.

Runtime state is stored in one SQLite database outside the release directory:

```text
/var/lib/mindiou/mindiou.sqlite
```

Set `DATA_DB_PATH=/var/lib/mindiou/mindiou.sqlite` in `/etc/mindiou.env`.
The service enables WAL, `synchronous=NORMAL`, foreign keys, and a five-second
busy timeout on every connection. `LEARNING_STORE_PATH`, `MVP0_STORE_PATH`,
`MVP1_STORE_PATH`, `TRAINING_STORE_PATH`, and
`COGNITIVE_REPAYMENT_STORE_PATH` are legacy JSON import sources only. On the
first SQLite startup each source is imported once and recorded in
`data_migrations`; runtime writes never return to those JSON files.

Install and enable `mindiou-db-backup.service` and
`mindiou-db-backup.timer` for a daily online SQLite backup at 03:20 Asia/Shanghai:

```bash
install -m 0644 deploy/mindiou-db-backup.service /etc/systemd/system/
install -m 0644 deploy/mindiou-db-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mindiou-db-backup.timer
systemctl start mindiou-db-backup.service
```

Backups are written to `/var/lib/mindiou/backups`, verified with
`PRAGMA integrity_check`, and retained for 30 days by default.

The first-cohort import limits are enforced by the API and can be tuned in
`/etc/mindiou.env` without rebuilding the web client:

```text
MAX_ARTIFACT_CHARS=30000
MAX_REQUEST_BODY_BYTES=10485760
DAILY_ANALYSIS_LIMIT=3
USER_DAILY_AI_TOKEN_BUDGET=200000
AI_OUTPUT_TOKEN_RESERVE=10000
```

`daily_usage` stores per-user, Asia/Shanghai-day counters in SQLite. The token
budget is deliberately conservative: it estimates input tokens from character
count and reserves output tokens before starting the analysis. The current UI
accepts pasted plain text only; non-JSON/file-style imports return HTTP 415,
over-limit content returns 413, and exhausted daily quotas return 429.

The systemd service reads secrets from `/etc/mindiou.env`. Never copy that file
into the repository or web root. Configure individual early-access invite codes,
a session-signing secret, and secure cookies as documented in
`../../docs/engineering/early-access-auth.md`. The deployment still blocks the
report-list endpoint and the Rokid latest-report endpoint to prevent obvious
cross-visitor data disclosure. Early-access authentication is not complete
multi-tenant isolation, so the UI continues to warn visitors not to submit
secrets or private customer data.

For small demo servers, `journald-mindiou-limits.conf` bounds system journal
retention so old logs cannot consume multiple gigabytes of the root disk.

The server uses a Let's Encrypt short-lived IP certificate because the current
cloud provider intercepts unregistered hostnames before Nginx. Install Certbot
5.4 or newer in `/opt/certbot-ip-venv`, deploy
`nginx-mindiou-ip-https.conf`, and enable `mindiou-ip-cert-renew.timer` so the
six-day certificate is checked twice daily. `mindiou-quick-tunnel.service` is
kept only as an emergency fallback; its process-scoped hostname must not be
embedded in release packages.

The public demo enables `MVP1_DEMO_FALLBACK=1`. Live AI research remains the
first choice. If live research is unavailable, only the four cards in the controlled
public server-diagnostics report use source-cited deterministic scaffolds. The mode is
reported as `curated_demo_fallback`, and heuristic evaluation never claims clearance.
Unrelated debts still fail visibly instead of fabricating research.

Text generation can use a provider independently from research and speech. The
current mainland deployment uses `AI_PROVIDER=deepseek`,
`AI_BASE_URL=https://api.deepseek.com`, and `AI_MODEL=deepseek-v4-flash`.
`AI_API_KEY` must be set directly in `/etc/mindiou.env`; do not put it in this
repository or a client package. `RESEARCH_*` and `STT_*` remain empty until
separate compatible providers are configured.
