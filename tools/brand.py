#!/usr/bin/env python3
"""Apply the Bands for Days brand (name, mark, palette, manifest) to the four site pages.

Idempotent: run it again after a rebuild of app.html (the build chain still writes the old
palette and name) and it brings the page back to the brand. Usage: python3 tools/brand.py [repo root]
"""
import re, sys, pathlib

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
NAME = 'Bands for Days'
GREEN = '#1F6B45'

MARK = ('<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="7" fill="#1F6B45"/>'
        '<rect x="7.5" y="18" width="5" height="7" rx="1.5" fill="#F6F2EA"/><rect x="13.5" y="13" width="5" height="12" rx="1.5" fill="#F6F2EA"/>'
        '<rect x="19.5" y="7" width="5" height="18" rx="1.5" fill="#F2C14E"/></svg>')

# Warm neutrals, deep green actions. Every pair used for text passes WCAG AA (checked in tools/contrast.py).
LIGHT = {'--bg': '#F6F2EA', '--surface': '#FFFDF9', '--surface-2': '#ECE6DA', '--ink': '#1F1B16', '--muted': '#5C564C', '--border': '#D6CEC0',
         '--accent': '#1F6B45', '--accent-ink': '#FFFFFF', '--accent-soft': '#DCEFE2',
         '--good': '#2E7D4F', '--good-soft': '#DCEFE3', '--good-deep': '#1B5E37', '--warn': '#B5431A', '--warn-soft': '#F9E3D8', '--mid': '#9A6214', '--mid-soft': '#F7EAD0',
         '--focus': '#D97706', '--gold': '#C8921A'}
DARK = {'--bg': '#17150F', '--surface': '#211E17', '--surface-2': '#2C281F', '--ink': '#F1ECE2', '--muted': '#B3AB9A', '--border': '#3E382C',
        '--accent': '#6FCB95', '--accent-ink': '#0B1A12', '--accent-soft': '#1E3A2B',
        '--good': '#6FCB95', '--good-soft': '#1C3A2A', '--good-deep': '#9FE3BB', '--warn': '#F2A06B', '--warn-soft': '#45291A', '--mid': '#E0B050', '--mid-soft': '#3E3216',
        '--focus': '#FBBF24', '--gold': '#F2C14E'}

def block(vals, keys, extra=''):
    return ' '.join(f'{k}:{vals[k]};' for k in keys) + extra

def retheme(css):
    """Rewrite the three :root blocks, keeping whichever variables the page already declares (plus --font)."""
    m = re.search(r':root\{(.*?)\n\}', css, re.S)
    if not m: return css
    keys = [k for k in re.findall(r'(--[a-z0-9-]+):', m.group(1)) if k != '--font']
    font = re.search(r'--font:[^;]+;', m.group(1)).group(0)
    light = ':root{\n  ' + block(LIGHT, keys) + '\n  ' + font + '\n}'
    dark = block(DARK, keys, ' color-scheme:dark')
    css = css[:m.start()] + light + css[m.end():]
    css = re.sub(r'@media \(prefers-color-scheme: dark\)\{ :root:not\(\[data-theme="light"\]\)\{.*?\} \}', '@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){\n  ' + dark + ' } }', css, count=1, flags=re.S)
    css = re.sub(r':root\[data-theme="dark"\]\{.*?color-scheme:dark \}', ':root[data-theme="dark"]{\n  ' + dark + ' }', css, count=1, flags=re.S)
    return css

HEAD_LINKS = ('<link rel="icon" href="favicon.svg" type="image/svg+xml">\n'
              '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n'
              '<link rel="manifest" href="manifest.webmanifest">')

def brand(path):
    s = path.read_text(encoding='utf-8')
    s = retheme(s)
    s = re.sub(r'<link rel="icon" href="favicon.svg" type="image/svg\+xml">(\n<link rel="apple-touch-icon"[^\n]*\n<link rel="manifest"[^\n]*)?', HEAD_LINKS, s, count=1)
    s = re.sub(r'<meta name="theme-color" content="#[0-9A-Fa-f]{6}">', f'<meta name="theme-color" content="{GREEN}">', s)
    s = re.sub(r'<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="7" fill="#[0-9A-F]{6}"/>.*?</svg>', MARK, s, count=1, flags=re.S)
    s = s.replace("Band Six's", NAME + "'").replace('Band Six', NAME)
    s = s.replace('#1F6F8B', GREEN)  # confetti and any stray accent literal
    path.write_text(s, encoding='utf-8')

for f in ['index.html', 'app.html', 'exams.html', 'resources.html']:
    brand(ROOT / f)
(ROOT / 'favicon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" ' + MARK[len('<svg '):].replace(' aria-hidden="true"', '') + '\n', encoding='utf-8')
print('branded')
