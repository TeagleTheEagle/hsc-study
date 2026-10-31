#!/usr/bin/env python3
"""Bands for Days phase E2 (blueprint 11 groups/classes, 19 E): class leaderboard and class view from the class
code students signed up with, and an invite link that pre-fills the code. Needs supabase-classes.sql run once.
Usage: python3 tools/phase_e2_patch.py app.html  (after phase E1). Refuses to run twice."""
import sys, pathlib
path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = path.read_text(encoding='utf-8')
if 'phase E2: classes' in s:
    sys.exit('phase E2 patch already applied')
assert 'phase E1: marks report' in s, 'apply phase E1 first'

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

# ---------- routing ----------
rep("stats:'progress',mistakes:'progress',report:'progress'};", "stats:'progress',mistakes:'progress',report:'progress',class:'progress'};")
rep("stats:'#stats',mistakes:'#mistakes',report:'#report'};", "stats:'#stats',mistakes:'#mistakes',report:'#report',class:'#class'};")
rep("diag:renderDiag, report:renderReport})[S.mode]();", "diag:renderDiag, report:renderReport, class:renderClass})[S.mode]();")

# ---------- the class code travels with the session ----------
rep("UID=session.user.id; DBH=supaShim(SB,UID); ME={name:session.user.email||''};",
    "UID=session.user.id; DBH=supaShim(SB,UID); ME={name:session.user.email||'', classCode:String(((session.user.user_metadata||{}).class_code)||'').trim().toUpperCase()};")

# ---------- shim: rows of one class ----------
rep("    collection(name){ let lim=20;",
    "    async classScores(code){ const {data,error}=await client.from('scores').select('*').eq('class_code',code).order('xp',{ascending:false}).limit(200); if(error) throw supaErr(error); return (data||[]).map(r=>({id:r.user_id, ...r})); },\n    collection(name){ let lim=20;")

# ---------- leaderboard: my class by default, everyone on request ----------
rep("    const snap=await DBH.collection('scores').orderBy('xp','desc').limit(20).get();\n    const rows=snap.docs.map(d=>({id:d.id, ...d.data()}));",
    "    const useClass=LB.scope==='class'&&!!myClass()&&!!DBH.classScores;\n    const rows=useClass?(await DBH.classScores(myClass())).slice(0,20):(await DBH.collection('scores').orderBy('xp','desc').limit(20).get()).docs.map(d=>({id:d.id, ...d.data()}));")
rep("    if(!rows.length){ box.append(el('p',{class:'small'},'No scores yet. Answer a few cards and you will be first on the board.')); return; }",
    "    if(!rows.length){ box.append(el('p',{class:'small'},useClass?'No one in your class has scored yet. Answer a few cards and you will be first.':'No scores yet. Answer a few cards and you will be first on the board.')); return; }")
rep("    const lbBox=el('div',{class:'lb'}, el('p',{class:'small'},'Loading leaderboard…')); ac.append(lbBox); loadLeaderboard(lbBox);",
    "    if(myClass()) ac.append(el('div',{class:'row lbscope'}, seg([['class','My class'],['all','Everyone']], LB.scope, v=>{ LB.scope=v; renderStats(); }), el('button',{class:'ghost',onclick:()=>goMode('class')},'Class view →')));\n    const lbBox=el('div',{class:'lb'}, el('p',{class:'small'},'Loading leaderboard…')); ac.append(lbBox); loadLeaderboard(lbBox);")

# ---------- invite link pre-fills the class code on sign-up ----------
rep("render(); renderAccount(); initSync();",
    "{ const qc=new URLSearchParams(location.search).get('code'); if(qc&&qc.trim()){ AUTH.code=qc.trim().toUpperCase(); AUTH.mode='up'; AUTH.open=true; } }\nrender(); renderAccount(); initSync();")

# ---------- the class view ----------
rep("function renderStats(){", r"""// ---------- phase E2: classes ----------
const LB={scope:'class'};
function myClass(){ const c=ME&&ME.classCode; return (sync.state==='synced'&&c&&c!=='*')?c:''; }
function inviteLink(code){ return location.origin+location.pathname+'?code='+encodeURIComponent(code); }
async function renderClass(){
  const v=$('#view'); v.innerHTML='';
  const code=myClass(); const signed=sync.state==='synced';
  const head=el('div',{class:'panel hero'}, el('div',{class:'lab'},'My class'), el('h2',{}, code?'Class '+code:'Your class'));
  if(!signed){ head.append(el('p',{class:'small'},'Sign in to see your class. Everyone who signs up with the same class code is in it.'), el('div',{class:'row'}, el('button',{class:'primary',onclick:()=>goMode('stats')},'Sign in'))); v.append(head); return; }
  if(!code){ head.append(el('p',{class:'small'},'Your account has no class code, so there is no class view yet. Classmates who sign up with a class code see each other here.')); v.append(head); return; }
  head.append(el('p',{class:'small'},'Everyone who signed up with code '+code+' is here. Share the invite link and classmates land on sign-up with the code filled in.'));
  head.append(el('div',{class:'row'}, el('button',{class:'primary',onclick:async()=>{ const link=inviteLink(code); try{ await navigator.clipboard.writeText(link); toast('Invite link copied.'); }catch(e){ window.prompt('Copy this invite link', link); } }},'Copy invite link'), el('button',{class:'ghost',onclick:()=>goMode('stats')},'Leaderboard and badges')));
  v.append(head);
  const box=el('div',{class:'panel',id:'classbox'}, el('p',{class:'small'},'Loading…')); v.append(box);
  try{
    const rows=await DBH.classScores(code); if(S.mode!=='class') return; box.innerHTML='';
    const t=today(); const active=rows.filter(r=>r.updated_at&&dayOfMs(Date.parse(r.updated_at))===t).length;
    const xp=rows.reduce((a,r)=>a+(r.xp||0),0), total=rows.reduce((a,r)=>a+(r.total||0),0), mastered=rows.reduce((a,r)=>a+(r.mastered||0),0);
    box.append(el('h2',{},`${rows.length} member${rows.length===1?'':'s'}`), el('div',{class:'grid2'},
      el('div',{class:'stat'}, el('b',{},String(active)), el('span',{},'studied today')),
      el('div',{class:'stat'}, el('b',{},String(total)), el('span',{},'answers given, all together')),
      el('div',{class:'stat'}, el('b',{},String(mastered)), el('span',{},'cards mastered, all together')),
      el('div',{class:'stat'}, el('b',{},String(xp)), el('span',{},'class XP'))));
    const list=el('div',{class:'lb'});
    rows.forEach((r,i)=>{ const nm=(r.nick&&String(r.nick).trim())||'Someone'; const row=el('div',{class:'rowx'+(r.id===UID?' me':'')}, el('span',{class:'rk'},String(i+1)), el('span',{class:'nm'}), el('span',{}, `${r.xp||0} XP`, el('span',{class:'sub'},` · L${r.level||1}`)), el('span',{class:'sub'}, `🔥${r.streak||0} · ${r.mastered||0} mastered`)); row.querySelector('.nm').textContent=nm; list.append(row); });
    if(!rows.length) list.append(el('p',{class:'small'},'No one in the class has scored yet. Answer a few cards and you will be first.'));
    box.append(list);
    if(!S.nick) box.append(el('p',{class:'small'},'Set a nickname under Stats so classmates know who you are.'));
  }catch(e){ box.innerHTML=''; box.append(el('p',{class:'small'},'Could not load the class right now.')); }
}
function renderStats(){""")
rep("el('button',{onclick:()=>goMode('report')},'Marks report'), el('button',{onclick:()=>{ TS=null; goMode('today'); }},'Today’s session'))); }",
    "el('button',{onclick:()=>goMode('report')},'Marks report'), el('button',{onclick:()=>goMode('class')},'My class'), el('button',{onclick:()=>{ TS=null; goMode('today'); }},'Today’s session'))); }")
rep(".savestat{font-size:.85rem;", ".lbscope{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin:.3rem 0 .5rem}\n.savestat{font-size:.85rem;")
path.write_text(s, encoding='utf-8')
print('phase E2 patch applied')
