# Spiral Codex Collector

The collector accepts a structured Codex hook event on stdin or as a JSON file,
checks the project allowlist, redacts common secrets locally, and sends only a
compact learning payload to `POST /v1/events/codex`.

```bash
export SPIRAL_PROJECT_ALLOWLIST="/path/to/project:/path/to/another-project"
export SPIRAL_API_URL="http://localhost:8793"
node agents/codex-collector/collector.mjs hook-event.json
```

No project is captured when `SPIRAL_PROJECT_ALLOWLIST` is empty.
