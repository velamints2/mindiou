# MindIOU Public Deployment

The public deployment keeps the existing server website intact and mounts:

- `/mindiou/`: MVP-0 report experience;
- `/mindiou/mvp1/`: one report/card-scoped MVP-1 clearance session;
- `/mindiou-api/`: rate-limited Node API reverse proxy.
- `https://114.67.169.78/mindiou/`: stable public TLS demo and Rokid AIUI
  backend origin, using a trusted short-lived IP certificate.

Runtime state is stored outside the release directory:

```text
/var/lib/mindiou/spiral-store.json
/var/lib/mindiou/mvp0-store.json
```

The systemd service reads secrets from `/etc/mindiou.env`. Never copy that file
into the repository or web root. The anonymous deployment intentionally blocks
the report-list endpoint and the Rokid latest-report endpoint to prevent obvious
cross-visitor data disclosure. It is still a public beta without accounts, so
the UI warns visitors not to submit secrets or private customer data.

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
