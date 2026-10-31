#!/usr/bin/env python3
"""Marking and billing fixes after the 31 Oct 2026 browser test (run after open_signup_patch.py, before sw_version.py):
- the "did not come back cleanly" toast now says why (the Worker's code, HTTP status and message), so a screenshot is enough to diagnose;
- a rejected server key gets its own message;
- coming back from the Stripe portal (?billing=portal) re-reads the plan from Stripe (/api/plan?refresh=1), so a cancellation
  shows "ends <date>" at once instead of waiting for the webhook;
- the Subjects topic bars say "Not started" instead of 0% for an untouched topic (blueprint 10: never 0% for untried work).
"""
import sys
p = 'app.html'
s = open(p, encoding='utf-8').read()
if "billing=portal" in s and "Not started" in s: sys.exit('mark_errors_patch.py already applied')
assert 'phase C: plans' in s, 'phase C must be applied first'
def rep(old, new, count=1):
    global s
    assert s.count(old) == count, (s.count(old), old[:90])
    s = s.replace(old, new)

rep("""async function loadPlan(force){ if(PLAN.loading||(PLAN.loaded&&!force)) return; if(!SB||!UID) return; PLAN.loading=true; try{ const tok=await authToken(); if(!tok) return; const r=await fetch('/api/plan',{headers:{authorization:'Bearer '+tok},cache:'no-store'});""",
    """async function loadPlan(force,refresh){ if(PLAN.loading||(PLAN.loaded&&!force)) return; if(!SB||!UID) return; PLAN.loading=true; try{ const tok=await authToken(); if(!tok) return; const r=await fetch('/api/plan'+(refresh?'?refresh=1':''),{headers:{authorization:'Bearer '+tok},cache:'no-store'});""")

rep("""if(b==='success'){ toast('Thanks. Plus switches on as soon as Stripe confirms the payment, usually within a minute.'); let n=0; const tick=()=>{ n++; loadPlan(true).then(()=>{ if(PLAN.data&&PLAN.data.plan==='plus'){ toast('Plus is on: '+PLAN.data.limit+' AI marks a month.'); return; } if(n<10) setTimeout(tick,4000); }); }; setTimeout(tick,2000); } }catch(e){} }""",
    """if(b==='success'){ toast('Thanks. Plus switches on as soon as Stripe confirms the payment, usually within a minute.'); let n=0; const tick=()=>{ n++; loadPlan(true).then(()=>{ if(PLAN.data&&PLAN.data.plan==='plus'){ toast('Plus is on: '+PLAN.data.limit+' AI marks a month.'); return; } if(n<10) setTimeout(tick,4000); }); }; setTimeout(tick,2000); }
    // Back from the Stripe portal: re-read the subscription from Stripe now (a cancellation shows "ends <date>" straight away).
    else if(b==='portal'){ const wait=()=>PLAN.loading?new Promise(r=>setTimeout(r,300)).then(wait):Promise.resolve(); wait().then(()=>loadPlan(true,true)).then(()=>{ const d=PLAN.data; if(!d) return; if(d.plan==='plus'&&d.cancelAtPeriodEnd) toast('Plus ends on '+planDay(d.resets)+'. You keep it until then.'); else if(d.plan==='plus') toast('Plus is active and renews on '+planDay(d.resets)+'.'); else toast('Your plan is Free: '+d.dailyFree+' AI marks a day.'); }); } }catch(e){} }""")

rep("""  else if(c==='not_configured') toast('Free AI marking is not switched on yet. Mark this one yourself against the criteria.');
  else toast('Marking did not come back cleanly. Mark it yourself against the criteria.');""",
    """  else if(c==='not_configured') toast('Free AI marking is not switched on yet. Mark this one yourself against the criteria.');
  else if(c==='auth') toast('AI marking is off on the server (its key was rejected). Mark this one yourself and tell whoever runs the site.');
  else if(c==='too_short') toast('Write a bit more first (at least a sentence or two), or add a photo of your working, then mark again.');
  else { const why=(c?c.replace(/_/g,' '):(r?'HTTP '+r.status:'no reply'))+(data.status?' '+data.status:'')+(data.message?': '+String(data.message).slice(0,160):''); toast('Marking did not come back cleanly ('+why+'). Mark it yourself against the criteria.',null,7000); }""")

rep("""function toast(msg, kind){ let t=$('.toast'); if(t)t.remove(); t=el('div',{class:'toast'+(kind?' '+kind:''),role:'status'}, msg); document.body.append(t); clearTimeout(toastT); toastT=setTimeout(()=>t.remove(), 2600); }""",
    """function toast(msg, kind, ms){ let t=$('.toast'); if(t)t.remove(); t=el('div',{class:'toast'+(kind?' '+kind:''),role:'status'}, msg); document.body.append(t); clearTimeout(toastT); toastT=setTimeout(()=>t.remove(), ms||2600); }""")

rep("""function deckBar(r){ return el('div',{class:'deckrow'}, el('span',{},r.d.name), el('div',{class:'bar'}, el('span',{class:'m',style:`width:${100*r.m/r.cs.length}%`}), el('span',{class:'k',style:`width:${100*(r.k-r.m)/r.cs.length}%`}), el('span',{class:'l',style:`width:${100*r.l/r.cs.length}%`})), el('span',{class:'pct'},r.pct+'%')); }""",
    """function deckBar(r){ return el('div',{class:'deckrow'}, el('span',{},r.d.name), el('div',{class:'bar'}, el('span',{class:'m',style:`width:${100*r.m/r.cs.length}%`}), el('span',{class:'k',style:`width:${100*(r.k-r.m)/r.cs.length}%`}), el('span',{class:'l',style:`width:${100*r.l/r.cs.length}%`})), el('span',{class:'pct',title:r.seen?`${r.k} of ${r.cs.length} cards got it`:'No cards tried yet'}, r.seen?r.pct+'%':'Not started')); }""")
open(p, 'w', encoding='utf-8').write(s)
print('mark_errors_patch applied')
