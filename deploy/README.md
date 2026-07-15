# MindIOU Public Deployment

The public deployment keeps the existing server website intact and mounts:

- `/mindiou/`: MVP-0 report experience;
- `/mindiou/mvp1/`: one report/card-scoped MVP-1 clearance session;
- `/mindiou-api/`: rate-limited Node API reverse proxy.
- `https://launch-wonder-construction-unto.trycloudflare.com/mindiou/`: current
  public TLS demo and Rokid AIUI backend origin.

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

The current cloud provider intercepts unregistered hostnames before Nginx, so
`mindiou-quick-tunnel.service` provides the HTTPS hostname used by remote judges
and the Rokid companion-phone network proxy. The raw IP HTTP site remains
available for diagnostics only. Quick-tunnel hostnames are process-scoped and
must be replaced by a named tunnel or an owned domain before long-term release.

The public demo enables `MVP1_DEMO_FALLBACK=1`. Live AI research remains the
first choice. If the server cannot reach the model provider, only the curated
server-diagnostics debt uses a source-cited deterministic scaffold and a
conservative `needs_verification` evaluation. Other debts still fail visibly
instead of fabricating research.

Text generation can use a provider independently from research and speech. The
current mainland deployment uses `AI_PROVIDER=deepseek`,
`AI_BASE_URL=https://api.deepseek.com`, and `AI_MODEL=deepseek-v4-flash`.
`AI_API_KEY` must be set directly in `/etc/mindiou.env`; do not put it in this
repository or a client package. `RESEARCH_*` and `STT_*` remain empty until
separate compatible providers are configured.
