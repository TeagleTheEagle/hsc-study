#!/usr/bin/env python3
"""Split the marking banks (data/mark-bank*.json, one file per subject, up to 1.8 MB) into one small file per question
in data/mark/, named <key>.json with '|' written as '__' (so the names work on Windows too).

Why: the Worker used to fetch and parse a whole subject bank on every cold start. On the Workers Free plan a request gets
10 ms of CPU, JSON parsing counts, and an 800 KB parse ate most of it, so /api/mark failed with error 1102 before Claude
was even asked. A 2 to 16 KB file parses in well under a millisecond.

Run after any script that rewrites a mark bank (BUILD-README.md lists them):  python3 tools/split_bank.py
Idempotent: rewrites every file and deletes stale ones.
"""
import json, os, re, sys
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out = os.path.join(root, 'data', 'mark')
os.makedirs(out, exist_ok=True)
SAFE = re.compile(r'^[A-Za-z0-9|_.()-]{1,80}$')
want = {}
for f in sorted(os.listdir(os.path.join(root, 'data'))):
    if not f.startswith('mark-bank') or not f.endswith('.json'): continue
    with open(os.path.join(root, 'data', f), encoding='utf-8') as fh: bank = json.load(fh)
    for key, entry in bank.items():
        if not SAFE.match(key) or '__' in key: sys.exit(f'unsafe key {key!r} in {f}')
        name = key.replace('|', '__') + '.json'
        if name in want: sys.exit(f'duplicate key {key!r} ({f})')
        want[name] = entry
stale = [n for n in os.listdir(out) if n.endswith('.json') and n not in want]
for n in stale: os.remove(os.path.join(out, n))
for name, entry in want.items():
    with open(os.path.join(out, name), 'w', encoding='utf-8') as fh: json.dump(entry, fh, ensure_ascii=False, separators=(',', ':'))
sizes = sorted(os.path.getsize(os.path.join(out, n)) for n in want)
print(f'{len(want)} question files in data/mark ({len(stale)} stale removed); largest {sizes[-1] // 1024} KB, median {sizes[len(sizes) // 2] // 1024} KB')
