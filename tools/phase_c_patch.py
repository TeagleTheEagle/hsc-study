#!/usr/bin/env python3
"""Bands for Days phase C (blueprint 12 to 16): Free and Plus plans in the app. The Worker decides the plan and the
allowance (worker.js: /api/plan, /api/quota, /api/billing/*); this patch makes the app show it: plan-aware marking
messages, a plan line in the account strip with Upgrade to Plus (only when the Worker says billing is on) and
Manage billing, the Plus terms before checkout, and the return from Stripe. Nothing is mocked: with billing off the
app shows the Free plan only.
Usage: python3 tools/phase_c_patch.py app.html  (after phase E3). Refuses to run twice."""
import sys, pathlib
path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = path.read_text(encoding='utf-8')
if 'phase C: plans' in s:
    sys.exit('phase C patch already applied')
assert 'phase E3: tests for every subject' in s, 'apply phase E3 first'

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

# ---------- allowance state and wording ----------
rep("const MARKQ={limit:5, left:null};",
    """// ---------- phase C: plans ----------
const MARKQ={limit:5, left:null, plan:'free', period:'day', resets:null, billing:false};
const PLAN={loaded:false, loading:false, data:null, offer:false, busy:false};
function takeQuota(q){ if(!q) return; if(q.limit) MARKQ.limit=q.limit; if(q.plan) MARKQ.plan=q.plan; if(q.period) MARKQ.period=q.period; if(q.resets) MARKQ.resets=q.resets; if(typeof q.billing==='boolean') MARKQ.billing=q.billing; if(typeof q.left==='number') MARKQ.left=q.left; }
function planDay(iso){ const d=iso?new Date(iso):null; if(!d||isNaN(d)) return ''; return d.toLocaleDateString('en-AU',{day:'numeric',month:'short',timeZone:'Australia/Sydney'}); }
function resetsText(){ if(MARKQ.period==='month') return MARKQ.resets?'They reset on '+planDay(MARKQ.resets)+'.':'They reset each month.'; return 'They reset tomorrow.'; }
function marksLeftText(n){ if(MARKQ.plan==='plus') return n===0?'That was your last Plus AI mark for this period. '+resetsText():n+' of '+MARKQ.limit+' Plus AI marks left this period.'; return n===0?'That was your last free AI mark for today. They reset tomorrow.':n+' free AI mark'+(n===1?'':'s')+' left today.'; }
function moreMarksText(){ return (MARKQ.plan==='plus'?'Plus gives you '+MARKQ.limit+' AI marks a month.':'Signed-in students get '+MARKQ.limit+' free AI marks a day.')+(MARKQ.billing&&MARKQ.plan!=='plus'?' Plus (under your account at the top) gives 100 a month. Other ways to get more:':' Two ways to get more:'); }
async function authToken(){ try{ const {data:sd}=await SB.auth.getSession(); return sd&&sd.session&&sd.session.access_token||''; }catch(e){ return ''; } }
async function loadPlan(force){ if(PLAN.loading||(PLAN.loaded&&!force)) return; if(!SB||!UID) return; PLAN.loading=true; try{ const tok=await authToken(); if(!tok) return; const r=await fetch('/api/plan',{headers:{authorization:'Bearer '+tok},cache:'no-store'}); if(!r.ok) return; PLAN.data=await r.json(); PLAN.loaded=true; takeQuota(PLAN.data); }catch(e){} finally{ PLAN.loading=false; renderAccount(); } }
async function billingGo(kind){ if(PLAN.busy) return; PLAN.busy=true; renderAccount(); try{ const tok=await authToken(); const r=await fetch('/api/billing/'+kind,{method:'POST',headers:{authorization:'Bearer '+tok}}); const d=await r.json().catch(()=>({})); if(r.ok&&d.url){ location.href=d.url; return; } const c=d.code||''; toast(c==='billing_off'?'Plus is not available yet.':c==='already_plus'?'You already have Plus.':c==='no_customer'?'No billing record found for this account yet.':c==='sign_in'?'Sign in again first.':'The billing page could not be opened. Try again in a minute.'); }catch(e){ toast('No connection to the billing service. Check your internet.'); } finally{ PLAN.busy=false; renderAccount(); } }
function planLine(){
  const d=PLAN.data; if(!PLAN.loaded){ if(!PLAN.loading) loadPlan(); return el('span',{class:'small'},'Checking your plan…'); }
  const box=el('span',{class:'planline'});
  if(d.plan==='plus'){
    const when=planDay(d.resets);
    box.append(el('span',{class:'pill on'},'Plus'), el('span',{}, d.status==='past_due'?'Your last payment failed. Update your card to keep Plus.':`${d.left} of ${d.limit} AI marks left this period${when?(d.cancelAtPeriodEnd?' · ends ':' · renews ')+when:''}.`));
    if(d.billing&&d.hasCustomer) box.append(el('button',{class:'ghost',disabled:PLAN.busy?'':null,onclick:()=>billingGo('portal')}, PLAN.busy?'Opening…':'Manage billing'));
    return box;
  }
  box.append(el('span',{class:'pill'},'Free'), el('span',{}, `${d.dailyFree} AI marks a day.`));
  if(d.billing){
    if(d.hasCustomer&&d.status==='past_due') box.append(el('span',{},' Your Plus payment failed and the grace week has ended. '), el('button',{class:'ghost',disabled:PLAN.busy?'':null,onclick:()=>billingGo('portal')}, PLAN.busy?'Opening…':'Update card'));
    else if(!PLAN.offer) box.append(el('button',{class:'ghost',onclick:()=>{ PLAN.offer=true; renderAccount(); }},'Upgrade to Plus'));
    else box.append(el('span',{class:'offer'},
      el('b',{},`Plus: ${d.plusMonthly} AI marks a month for ${d.price}. `),
      'Marks reset on your renewal date and unused ones do not roll over. Cancel any time under Manage billing and keep Plus until the end of the period you paid for. Everything in Free stays free, and your sets, answers and feedback are never removed. Payment is taken by Stripe; this site never sees your card. ',
      el('button',{class:'primary',disabled:PLAN.busy?'':null,onclick:()=>billingGo('checkout')}, PLAN.busy?'Opening…':'Continue to secure checkout'),
      el('button',{class:'ghost',onclick:()=>{ PLAN.offer=false; renderAccount(); }},'Not now')));
  }
  return box;
}
// Back from Stripe: ?billing=success means the webhook will switch the plan within a minute; poll for it.
function billingReturn(){ try{ const u=new URL(location.href); const b=u.searchParams.get('billing'); if(!b) return; u.searchParams.delete('billing'); history.replaceState(null,'',u.pathname+(u.search||'')+u.hash); if(b==='success'){ toast('Thanks. Plus switches on as soon as Stripe confirms the payment, usually within a minute.'); let n=0; const tick=()=>{ n++; loadPlan(true).then(()=>{ if(PLAN.data&&PLAN.data.plan==='plus'){ toast('Plus is on: '+PLAN.data.limit+' AI marks a month.'); return; } if(n<10) setTimeout(tick,4000); }); }; setTimeout(tick,2000); } }catch(e){} }""")

# ---------- marking messages use the plan ----------
rep("  if(data.limit) MARKQ.limit=data.limit;\n  if(r&&r.ok&&data.result){",
    "  takeQuota(data);\n  if(r&&r.ok&&data.result){")
rep("MARKQ.left=data.left; toast(data.left===0?'That was your last free AI mark for today. They reset tomorrow.':data.left+' free AI mark'+(data.left===1?'':'s')+' left today.');",
    "MARKQ.left=data.left; toast(marksLeftText(data.left)); if(PLAN.loaded&&PLAN.data){ PLAN.data.left=data.left; PLAN.data.used=data.used; renderAccount(); }")
rep("if(c==='daily_limit'){ MARKQ.left=0; toast('You have used today\\'s '+MARKQ.limit+' free AI marks. Mark this one yourself; they reset tomorrow.'); }",
    "if(c==='daily_limit'){ MARKQ.left=0; toast('You have used today\\'s '+MARKQ.limit+' free AI marks. Mark this one yourself; they reset tomorrow.'+(MARKQ.billing?' Plus gives 100 a month.':'')); }\n  else if(c==='plan_limit'){ MARKQ.left=0; toast('You have used this period\\'s '+MARKQ.limit+' Plus AI marks. '+resetsText()+' Mark this one yourself for now.'); }")
rep("const q=await r.json(); if(q.limit) MARKQ.limit=q.limit; MARKQ.on=q.on; if(typeof q.left==='number'){",
    "const q=await r.json(); takeQuota(q); MARKQ.on=q.on; if(typeof q.left==='number'){")
rep("return 'Free AI marking is on while you are signed in: '+(MARKQ.left==null?MARKQ.limit+' marked answers a day.':MARKQ.left+' of '+MARKQ.limit+' left today.')+' For more, add your own API key below.'; }",
    "if(MARKQ.plan==='plus') return 'Plus AI marking is on: '+(MARKQ.left==null?MARKQ.limit+' marked answers a month.':MARKQ.left+' of '+MARKQ.limit+' left this period.'); return 'Free AI marking is on while you are signed in: '+(MARKQ.left==null?MARKQ.limit+' marked answers a day.':MARKQ.left+' of '+MARKQ.limit+' left today.')+(MARKQ.billing?' For more, upgrade to Plus under your account at the top, or add your own API key below.':' For more, add your own API key below.'); }")
rep("kp.append(el('p',{class:'small'},'Signed-in students get '+MARKQ.limit+' free AI marks a day. Two ways to get more:'));",
    "kp.append(el('p',{class:'small'},moreMarksText()));", 2)

# ---------- account strip ----------
rep("a.append(pill, el('span',{},'Progress saves to your account and syncs across your devices.'), el('button',{class:'ghost',onclick:signOut},'Sign out'));",
    "a.append(pill, el('span',{},'Progress saves to your account and syncs across your devices.'), el('button',{class:'ghost',onclick:signOut},'Sign out'), planLine());")
rep("render(); renderAccount(); initSync();", "render(); renderAccount(); initSync(); billingReturn();")

# the plan line and the offer need a little room
rep("</style>", ".planline{display:inline-flex;flex-wrap:wrap;gap:.4rem .6rem;align-items:center}.planline .offer{display:block;max-width:60ch;margin-top:.3rem;line-height:1.45}.planline .offer button{margin:.4rem .4rem 0 0}\n</style>", 1)

path.write_text(s, encoding='utf-8')
print('phase C patch applied')
