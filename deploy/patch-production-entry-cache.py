#!/usr/bin/env python3
"""Disable browser caching for the legacy report and compatibility entries."""

from datetime import datetime, timezone
from pathlib import Path
import shutil

path = Path("/etc/nginx/snippets/mindiou-locations.conf")
text = path.read_text()
marker = "location = /mindiou/report.html {"
if marker in text:
    raise SystemExit("patch already present")
anchor = '''location = /mindiou/index.html {
    root /var/www;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    try_files $uri =404;
}

'''
if text.count(anchor) != 1:
    raise SystemExit(f"expected exactly one index entry block, found {text.count(anchor)}")
replacement = anchor + '''location = /mindiou/report.html {
    root /var/www;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    try_files $uri =404;
}

location = /mindiou/legacy.html {
    root /var/www;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    try_files $uri =404;
}

'''
backup = path.with_name(
    path.name + ".bak-entry-cache-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
)
shutil.copy2(path, backup)
path.write_text(text.replace(anchor, replacement, 1))
print(f"BACKUP {backup}")
