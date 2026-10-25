#!/bin/bash
# MindIOU local stack: backend (8793) + remote MCP (8795).
# Usage: bash scripts/start-mindiou-local.sh [start|stop|status]
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
API_LOG="$DIR/tmp/api.log"
MCP_LOG="$DIR/tmp/mcp.log"
mkdir -p "$DIR/tmp"

alive() { curl -sS -m 2 -o /dev/null "http://127.0.0.1:$1$2" 2>/dev/null; }

case "${1:-start}" in
start)
  if ! alive 8793 /api/projects; then
    (cd "$DIR" && nohup npm run api >"$API_LOG" 2>&1 &)
    for i in $(seq 1 20); do alive 8793 /api/projects && break; sleep 1; done
  fi
  if ! alive 8795 /healthz; then
    (cd "$DIR" && MINDIOU_MCP_PORT=8795 MINDIOU_BACKEND_URL=http://127.0.0.1:8793 \
      nohup npm run mcp:remote >"$MCP_LOG" 2>&1 &)
    for i in $(seq 1 10); do alive 8795 /healthz && break; sleep 1; done
  fi
  alive 8795 /healthz && echo "MindIOU stack UP (api 8793, mcp 8795)" || { echo "FAILED, see $API_LOG / $MCP_LOG"; exit 1; }
  ;;
stop)
  pkill -f "node.*server.js" 2>/dev/null; pkill -f "mcp/remote-server.mjs" 2>/dev/null
  echo "stopped"
  ;;
status)
  alive 8793 /api/projects && echo "api: UP" || echo "api: DOWN"
  alive 8795 /healthz && echo "mcp: UP" || echo "mcp: DOWN"
  ;;
esac
