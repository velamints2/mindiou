# MindIOU Public Deployment

The public deployment keeps the existing server website intact and mounts:

- `/mindiou/`: MVP-0 report experience;
- `/mindiou/mvp1/`: one report/card-scoped MVP-1 clearance session;
- `/mindiou-api/`: rate-limited Node API reverse proxy.

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
