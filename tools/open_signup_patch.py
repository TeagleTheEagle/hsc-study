#!/usr/bin/env python3
"""Bands for Days: the class code at sign-up becomes optional (the owner asked for a normal sign-up, 31 Oct 2026).
A code still puts the student on their class leaderboard (phase E2); without one they are just not in a class.
Pair with supabase-open-signups.sql, which tells the database trigger to accept sign-ups without a code.
Usage: python3 tools/open_signup_patch.py app.html  (after phase C). Refuses to run twice."""
import sys, pathlib
path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = path.read_text(encoding='utf-8')
if 'Class code (optional)' in s:
    sys.exit('open sign-up patch already applied')
assert 'phase C: plans' in s, 'apply phase C first'

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

rep("el('input',{type:'text',name:'code',placeholder:'Class code',autocomplete:'off',autocapitalize:'characters',spellcheck:'false',required:'','aria-label':'Class code',value:AUTH.code||''})",
    "el('input',{type:'text',name:'code',placeholder:'Class code (optional)',autocomplete:'off',autocapitalize:'characters',spellcheck:'false','aria-label':'Class code (optional)',value:AUTH.code||''})")
rep("AUTH.mode==='up'?'You need the class code from whoever shared the site. Only your email and your study progress are stored (Supabase, Sydney). No confirmation email is needed.'",
    "AUTH.mode==='up'?'A class code is optional: it puts you on your class leaderboard. Only your email and your study progress are stored (Supabase, Sydney). No confirmation email is needed.'")
rep("if(/Database error saving new user/i.test(m)) return 'That class code is wrong. Ask whoever gave you the site link.';",
    "if(/Database error saving new user/i.test(m)) return 'Sign-up was refused. If you typed a class code, check it with whoever gave it to you; otherwise leave it blank and try again.';")
path.write_text(s, encoding='utf-8')
print('open sign-up patch applied')
