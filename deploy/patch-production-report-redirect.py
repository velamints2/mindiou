#!/usr/bin/env python3
"""Redirect the legacy report entry to the current Web SPA workspace."""

from datetime import datetime, timezone
from pathlib import Path
import shutil

path = Path("/etc/nginx/snippets/mindiou-locations.conf")
text = path.read_text()
old = '''location = /mindiou/report.html {
    root /var/www;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    try_files $uri =404;
}
'''
new = '''location = /mindiou/report.html {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 302 /mindiou/#/app;
}
'''
if old not in text:
    raise SystemExit("expected legacy report location was not found")
backup = path.with_name(
    path.name + ".bak-report-redirect-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
)
shutil.copy2(path, backup)
path.write_text(text.replace(old, new, 1))
print(f"BACKUP {backup}")
