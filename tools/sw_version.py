#!/usr/bin/env python3
"""Writes the service-worker VERSION from a hash of the app shell, so a changed app.html or index.html
always ships a new worker (browsers only replace a service worker whose bytes changed).
Run after every build step that touches app.html or index.html:  python3 tools/sw_version.py
Idempotent: running it twice writes the same version."""
import hashlib, re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
h = hashlib.sha1()
for f in ['app.html', 'index.html', 'manifest.webmanifest']:
    h.update((root / f).read_bytes())
ver = h.hexdigest()[:10]
sw = root / 'sw.js'
s = sw.read_text(encoding='utf-8')
new = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{ver}';", s, count=1)
if new == s and f"'{ver}'" in s:
    print('sw.js version unchanged:', ver)
else:
    sw.write_text(new, encoding='utf-8'); print('sw.js version:', ver)
