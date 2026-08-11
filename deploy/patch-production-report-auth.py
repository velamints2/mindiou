#!/usr/bin/env python3
"""Apply the minimal Web report session-auth patch to a production server.js."""

from datetime import datetime, timezone
from pathlib import Path
import shutil
import sys


path = Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/mindiou/server.js")
text = path.read_text()
anchor = "    if (!requireToken(req, res)) return;"

if "isWebDraftOrTimelineRequest" in text:
    raise SystemExit("patch already present")
if text.count(anchor) != 1:
    raise SystemExit(f"expected exactly one auth anchor, found {text.count(anchor)}")

block = """    // Web report drafts and timelines use the account session cookie.
    // Keep them out of the legacy service-token gate so an expired browser
    // session returns the normal authentication error.
    const isWebDraftOrTimelineRequest =
      url.pathname === \"/api/mvp0/drafts\" ||
      url.pathname === \"/api/mvp0/timelines\" ||
      /^\\/api\\/mvp0\\/drafts\\/[^/]+$/.test(url.pathname);
    if (isWebDraftOrTimelineRequest) {
      const user = requireAuth(req, res);
      if (!user) return;
    }

"""

backup = path.with_name(
    path.name + ".bak-auth-fix-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
)
shutil.copy2(path, backup)
path.write_text(text.replace(anchor, block + anchor, 1))
print(f"BACKUP {backup}")
