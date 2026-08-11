#!/usr/bin/env python3
"""Add no-cache headers to the production MindIOU SPA entry points."""

from datetime import datetime, timezone
from pathlib import Path
import shutil
import sys


path = Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/nginx/snippets/mindiou-locations.conf")
text = path.read_text()
marker = 'location = /mindiou/index.html {'
if marker in text:
    raise SystemExit("patch already present")
anchor = '''location = /mindiou/ {
    return 302 /mindiou/index.html;
}

'''
if text.count(anchor) != 1:
    raise SystemExit(f"expected exactly one SPA redirect block, found {text.count(anchor)}")
replacement = '''location = /mindiou/ {
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    return 302 /mindiou/index.html;
}

location = /mindiou/index.html {
    root /var/www;
    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    try_files $uri =404;
}

'''
backup = path.with_name(
    path.name + ".bak-cache-fix-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
)
shutil.copy2(path, backup)
path.write_text(text.replace(anchor, replacement, 1))
print(f"BACKUP {backup}")
