#!/usr/bin/env python3
"""Generate every number the public pages quote from the content data (blueprint section 3).

Counts come from app.html (Business cards and papers, the SUBJECTS registry), subjects/*.json,
data/nesa-papers.json and resources.html, and are written into the elements marked
data-count="<key>" on index.html, exams.html and resources.html.
Usage: python3 tools/counts.py [--check]   (--check only reports drift and exits 1 if any)
"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECK = '--check' in sys.argv

app = (ROOT / 'app.html').read_text(encoding='utf-8')
def const(name, end):
    m = re.search(r'const ' + name + r' ?= ?(\[.*?\]);\n' + end, app, re.S)
    return json.loads(m.group(1))
cards = const('CARDS', 'const DECKS')
papers = const('BIZ_PAPERS', 'const PIMG')
subjects = json.loads(re.search(r'const SUBJECTS=(\[.*?\]);\n', app).group(1))
nesa = json.load(open(ROOT / 'data/nesa-papers.json', encoding='utf-8'))['papers']
items = json.loads(re.search(r'const ITEMS=(\[.*?\]);\n', (ROOT / 'resources.html').read_text(encoding='utf-8'), re.S).group(1))

def n_items(ps): return sum(len(sec['items']) for p in ps for sec in p['sections'])
typed = 0
for s in subjects:
    if s.get('papers'):
        ps = json.load(open(ROOT / s['papers'], encoding='utf-8'))
        assert len(ps) == s.get('np'), f"{s['id']}: SUBJECTS says {s.get('np')} papers, file has {len(ps)}"
        typed += len(ps)
    if s.get('file'):
        d = json.load(open(ROOT / s['file'], encoding='utf-8'))
        assert len(d['cards']) == s['n'], f"{s['id']}: SUBJECTS says {s['n']} cards, file has {len(d['cards'])}"
biz = next(s for s in subjects if s['id'] == 'business')
assert biz['n'] == len(cards), f"SUBJECTS says {biz['n']} Business cards, app has {len(cards)}"
nesa_years = sorted(p['year'] for p in papers if p['src'] == 'nesa')

C = {
    'biz_cards': len(cards),
    'biz_nesa': sum(p['src'] == 'nesa' for p in papers),
    'biz_nesa_years': f'{nesa_years[0]} to {nesa_years[-1]}',
    'biz_riv': sum(p['src'] == 'riv' for p in papers),
    'biz_questions': n_items(papers),
    'resources': len(items),
    'nesa_pdfs': len(nesa),
    'subjects': len([s for s in subjects if not s.get('soon')]),
    'cards_total': sum(s['n'] for s in subjects),
    'typed_papers': len(papers) + typed,
}
C['summary'] = (f"{C['subjects']} subjects · {C['cards_total']:,} cards · {C['typed_papers']} past papers you can answer and have marked · "
                f"{C['nesa_pdfs']} NESA exam PDFs · {C['resources']} Business resources")

drift = 0
for f in ['index.html', 'exams.html', 'resources.html']:
    path = ROOT / f; s = path.read_text(encoding='utf-8')
    def fill(m):
        global drift
        key = m.group(2); new = str(C[key]) if isinstance(C[key], str) else f'{C[key]:,}' if C[key] >= 10000 else str(C[key])
        if m.group(3) != new:
            drift += 1; print(f'{f}: {key}: {m.group(3)!r} -> {new!r}')
        return m.group(1) + new + m.group(4)
    s2 = re.sub(r'(<(?:b|span|p)[^>]*data-count="([a-z_]+)"[^>]*>)([^<]*)(</)', fill, s)
    if not CHECK and s2 != s: path.write_text(s2, encoding='utf-8')
print(json.dumps(C, indent=1))
if CHECK and drift: sys.exit(f'{drift} number(s) on the pages differ from the data; run tools/counts.py')
print('counts in step' if not drift else ('counts updated' if not CHECK else ''))
