#!/usr/bin/env python3
"""Make the production legacy token gate recognize Web account sessions."""

from datetime import datetime, timezone
from pathlib import Path
import shutil

path = Path("/opt/mindiou/server.js")
text = path.read_text()
old = '''  const session = readSession(req);
  return session ? { label: session.label, method: "session" } : null;
'''
new = '''  // Web accounts use the HttpOnly `session` cookie issued by
  // /api/auth/login. The legacy compatibility gate must recognize this
  // account session before it falls through to the old mindiou_session
  // invite-code session.
  const sessionId = parseCookies(req)[sessionCookieName] || "";
  const webUser = sessionId ? authStore.getUserBySession(sessionId) : null;
  if (webUser) {
    return { label: `web-user:${webUser.id}`, method: "web-session", userId: webUser.id };
  }
  const session = readSession(req);
  return session ? { label: session.label, method: "session" } : null;
'''
if old not in text:
    raise SystemExit("expected legacy authorizeRequest session block was not found")
backup = path.with_name(
    path.name + ".bak-web-session-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
)
shutil.copy2(path, backup)
path.write_text(text.replace(old, new, 1))
print(f"BACKUP {backup}")
