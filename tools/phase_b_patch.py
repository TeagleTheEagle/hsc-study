#!/usr/bin/env python3
"""Bands for Days phase B for app.html: reliable saving (blueprint 17), validated marking feedback (8, 9)
and the completed Business Studies flow (5). Run after tools/nav_patch.py. Refuses to run twice.
Usage: python3 tools/phase_b_patch.py [path/to/app.html]
"""
import sys, pathlib

P = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = P.read_text(encoding='utf-8')
if 'saveStatusText' in s:
    sys.exit('app.html already has phase B')

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

# ---------- B1 drafts: a typed answer is saved while you write ----------
# The old 700 ms oninput saver wrote S.papers directly and reset the word count without the suffix; one listener below now does both.
rep(" 'aria-label':'Your answer', oninput:e=>{ clearTimeout(ta._t); ta._t=setTimeout(()=>{ S.papers[key]=Object.assign(S.papers[key]||{},{a:e.target.value.slice(0,12000),t:Date.now()}); save(); },700); const w=box.querySelector('.wc'); if(w&&!isPicP(p)) w.textContent=wc(e.target.value)+' words'; }, onkeydown:", " 'aria-label':'Your answer', onkeydown:")
rep("""  ta.value=r.a||'';
  box.append(ta, el('div',{class:'wc'}, isMathsP(p)?'Show every step, the way the sample answers do.':isSciP(p)?'Use the scientific terms the criteria ask for; show working and units in calculations.':wc(ta.value)+' words'+(craft&&part&&part.p==='a'?' · aim for 600 to 800':craft?' · about 300 to 400':long&&!isBiz()?' · aim for 800 to 1,000':!isBiz()?' · about '+(max*45)+' words':long?' · aim for 600 to 800':max>=5?' · a solid paragraph':max>=3?' · 3 to 5 sentences':' · 1 to 2 sentences')));
""", """  ta.value=r.a||'';
  const wcSuffix=(craft&&part&&part.p==='a'?' · aim for 600 to 800':craft?' · about 300 to 400':long&&!isBiz()?' · aim for 800 to 1,000':!isBiz()?' · about '+(max*45)+' words':long?' · aim for 600 to 800':max>=5?' · a solid paragraph':max>=3?' · 3 to 5 sentences':' · 1 to 2 sentences');
  const wcText=()=>isMathsP(p)?'Show every step, the way the sample answers do.':isSciP(p)?'Use the scientific terms the criteria ask for; show working and units in calculations.':wc(ta.value)+' words'+wcSuffix;
  const wcEl=el('div',{class:'wc'}, wcText()+(r.a&&!marked?' · draft kept':''));
  box.append(ta, wcEl);
  // Drafts: whatever you type is kept on this device (and synced) 800 ms after you pause, before any marking.
  let draftT=null; ta.addEventListener('input',()=>{ if(!isPicP(p)) wcEl.textContent=wcText(); clearTimeout(draftT); draftT=setTimeout(()=>{ const cur=(rec(p,it,part)||{}).a||''; const val=ta.value.slice(0,12000); if(val!==cur){ setRec(p,it,part,{a:val}); if(!isPicP(p)) wcEl.textContent=wcText()+' · draft saved'; } },800); });
  ta.addEventListener('blur',()=>{ clearTimeout(draftT); const cur=(rec(p,it,part)||{}).a||''; const val=ta.value.slice(0,12000); if(val!==cur) setRec(p,it,part,{a:val}); });
""")

# ---------- B1 save status, retries, offline, expired sessions, no overwrite of newer progress ----------
rep("const sync={state:'local', timer:null, chain:Promise.resolve(), lastHash:'', lastScore:''};",
    "const sync={state:'local', timer:null, chain:Promise.resolve(), lastHash:'', lastScore:'', busy:false, err:null, retry:0, retryT:null, lastOk:0, remoteAt:''};\n"
    "function fmtClockShort(t){ const d=new Date(t); let h=d.getHours(); const m=d.getMinutes(); const ap=h>=12?'pm':'am'; h=h%12||12; return h+':'+String(m).padStart(2,'0')+' '+ap; }\n"
    "function saveStatusText(){ if(SAVE_ERR) return {cls:'bad', text:'Not saving in this browser'}; if(sync.state==='expired') return {cls:'bad', text:'Signed out: saved on this device only'}; if(sync.state!=='synced') return {cls:'', text:'Saved on this device'}; if(!navigator.onLine) return {cls:'warn', text:'Offline: saved here, syncs when you are back online'}; if(sync.busy) return {cls:'', text:'Syncing…'}; if(sync.err) return {cls:'warn', text:'Sync failed, retrying'+(sync.retry?' (attempt '+sync.retry+')':'')+'. Saved on this device.'}; return {cls:'ok', text:sync.lastOk?'Synced '+fmtClockShort(sync.lastOk):'Synced'}; }\n"
    "function renderSaveStatus(){ const e=$('#savestat'); if(!e){ renderAccount(); return; } const st=saveStatusText(); e.className='savestat '+st.cls; e.textContent=st.text; }\n"
    "window.addEventListener('online',()=>{ sync.lastHash=''; renderSaveStatus(); pushProgress(); });\n"
    "window.addEventListener('offline',renderSaveStatus);")
rep("""  if(h===sync.lastHash) return; sync.lastHash=h;
  sync.chain=sync.chain.then(()=>DBH.doc('data/users/'+UID+'/progress').set(doc)).then(()=>{ pushScore(false); }).catch(e=>{ if(e&&e.code==='invalid_argument'){ sync.state='readonly'; renderAccount(); } });
}""", """  if(h===sync.lastHash) return; sync.lastHash=h;
  clearTimeout(sync.retryT); sync.busy=true; renderSaveStatus();
  sync.chain=sync.chain.then(()=>DBH.doc('data/users/'+UID+'/progress').set(doc)).then(()=>{ sync.busy=false; sync.err=null; sync.retry=0; sync.lastOk=Date.now(); renderSaveStatus(); pushScore(false); }).catch(e=>{
    sync.busy=false; sync.lastHash='';
    if(e&&e.code==='invalid_argument'){ sync.state='readonly'; renderAccount(); return; }
    if(e&&e.code==='expired'){ sync.state='expired'; renderAccount(); return; }
    // Keep the work on this device and try again with a growing wait (3 s, 10 s, 30 s, 1 min, 2 min).
    sync.err=e; sync.retry=Math.min(sync.retry+1,5); renderSaveStatus();
    sync.retryT=setTimeout(pushProgress, [3,10,30,60,120][sync.retry-1]*1000);
  });
}""")
rep("function supaErr(e){ const c=(e&&e.code)||''; const err=new Error((e&&e.message)||'Request failed'); err.code=(c==='42501'||c==='PGRST301')?'invalid_argument':c; return err; }",
    "function supaErr(e){ const c=(e&&e.code)||''; const err=new Error((e&&e.message)||'Request failed'); err.code=c==='42501'?'invalid_argument':(c==='PGRST301'||c==='401'||/JWT|expired|not authenticated/i.test(err.message))?'expired':c; return err; }")
rep("""        async get(){ const {data,error}=await client.from('progress').select('doc').eq('user_id',uid).maybeSingle(); if(error) throw supaErr(error); return {exists:!!data, data:()=>data?data.doc:null}; },
        async set(d){ const {error}=await client.from('progress').upsert({user_id:uid, doc:d, updated_at:new Date().toISOString()}); if(error) throw supaErr(error); }""",
    """        async get(){ const {data,error}=await client.from('progress').select('doc,updated_at').eq('user_id',uid).maybeSingle(); if(error) throw supaErr(error); sync.remoteAt=(data&&data.updated_at)||''; return {exists:!!data, data:()=>data?data.doc:null}; },
        // Never overwrite progress another device saved after we last read it: merge it in first, then write.
        async set(d){ const {data:cur,error:e1}=await client.from('progress').select('updated_at').eq('user_id',uid).maybeSingle(); if(e1) throw supaErr(e1);
          if(cur&&cur.updated_at&&sync.remoteAt&&cur.updated_at>sync.remoteAt){ const {data:full,error:e2}=await client.from('progress').select('doc').eq('user_id',uid).maybeSingle(); if(e2) throw supaErr(e2); if(full&&full.doc){ mergeRemote(full.doc); d=progressDoc(); try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} try{ render(); }catch(e){} toast('Merged newer progress from another device.'); } }
          const {data:w,error}=await client.from('progress').upsert({user_id:uid, doc:d, updated_at:new Date().toISOString()}).select('updated_at').single(); if(error) throw supaErr(error); sync.remoteAt=(w&&w.updated_at)||sync.remoteAt; }""")
# account row: a save-status chip everywhere, and a re-sign-in prompt when the session has expired
rep("""  if(SAVE_ERR){ a.append(el('span',{class:'pill'},'⚠ Not saving'), el('span',{},'This browser is refusing to store progress (private window or storage full), so nothing you do here will be kept.')); return; }
  if(sync.state==='synced'){""", """  { const st=saveStatusText(); a.append(el('span',{class:'savestat '+st.cls,id:'savestat',role:'status'}, st.text)); }
  if(SAVE_ERR){ a.append(el('span',{class:'pill'},'⚠ Not saving'), el('span',{},'This browser is refusing to store progress (private window or storage full), so nothing you do here will be kept.')); return; }
  if(sync.state==='expired'){ a.append(el('span',{class:'pill'},'Signed out'), el('span',{},'Your sign-in expired. Everything is kept on this device; sign in again to keep syncing. '), el('button',{class:'ghost',onclick:()=>{ AUTH.open=!AUTH.open; renderAccount(); }}, AUTH.open?'Close':'Sign in again')); if(AUTH.open) a.append(authForm()); return; }
  if(sync.state==='synced'){""")
rep(".account img{width:22px;height:22px;border-radius:50%}",
    ".account img{width:22px;height:22px;border-radius:50%}\n.savestat{font-size:.85rem;color:var(--muted);padding:.1rem .55rem;border-radius:999px;background:var(--surface-2)} .savestat.ok{color:var(--good-deep);background:var(--good-soft)} .savestat.warn{color:var(--mid);background:var(--mid-soft)} .savestat.bad{color:var(--warn);background:var(--warn-soft)}\n.evid{margin:.2rem 0 .2rem .6rem;padding-left:.6rem;border-left:3px solid var(--good);font-style:italic;color:var(--muted)} .lowconf{background:var(--mid-soft);border-radius:10px;padding:.5rem .8rem;font-size:.95rem} .nextact{background:var(--accent-soft);border-radius:10px;padding:.5rem .8rem} .nextact b{color:var(--accent)}")
rep("async function startSync(session){\n  UID=session.user.id;", "async function startSync(session){\n  sync.err=null; sync.retry=0; clearTimeout(sync.retryT);\n  UID=session.user.id;")

# ---------- B2 marking feedback: estimated mark, criterion row, evidence, missing, next action, confidence ----------
rep("""Return JSON only, no prose, in this exact shape:
{"mark": <integer 0-${max}>, "band": "<the criteria row it fits, e.g. '${(unit.crit&&unit.crit[0]&&unit.crit[0].m)||max}'>", "verdict": "<one sentence saying why it got that mark>", "strengths": ["<up to 3 short points>"], "improvements": ["<up to 3 concrete things to add or change to reach the next row, each under 25 words>"], "model": \"""",
    """Rules: the mark is an estimate against the listed criteria only; never invent criteria that are not listed. Quote the student's own words as evidence for every mark you award. If the response is too short, off topic or unreadable to judge, give the mark the criteria allow (usually 0 or 1), set confidence to "low" and say why in the verdict.

Return JSON only, no prose, in this exact shape:
{"mark": <integer 0-${max}>, "band": "<the criteria row it fits, e.g. '${(unit.crit&&unit.crit[0]&&unit.crit[0].m)||max}'>", "verdict": "<one sentence saying why it got that mark>", "evidence": ["<up to 3 short quotes, under 15 words each, taken word for word from the student's response, that earned marks; [] if none>"], "strengths": ["<up to 3 short points>"], "missing": ["<up to 3 elements the criteria row above this one needs and the response lacks>"], "improvements": ["<up to 3 concrete things to add or change to reach the next row, each under 25 words>"], "next": "<the single most useful next action for this student, under 20 words>", "confidence": "<high, medium or low>", "model": \"""")
rep("function normalise(res,max){ let m=Number(res&&res.mark); if(!isFinite(m)) m=0; m=Math.max(0,Math.min(max,Math.round(m))); const arr=x=>Array.isArray(x)?x.map(String).slice(0,4):(x?[String(x)]:[]); return {m, band:String(res.band||''), verdict:String(res.verdict||''), strengths:arr(res.strengths), improvements:arr(res.improvements), model:String(res.model||'')}; }",
    "function normalise(res,max){ let m=Number(res&&res.mark); if(!isFinite(m)) m=0; m=Math.max(0,Math.min(max,Math.round(m))); const arr=x=>Array.isArray(x)?x.map(String).slice(0,4):(x?[String(x)]:[]); const conf=/^(high|medium|low)$/.test(String(res.confidence||''))?String(res.confidence):''; return {m, band:String(res.band||''), verdict:String(res.verdict||''), strengths:arr(res.strengths), improvements:arr(res.improvements), model:String(res.model||''), evidence:arr(res.evidence), missing:arr(res.missing), next:String(res.next||''), conf}; }\n"
    "function aiRec(x,max){ return {m:x.m, x:max, how:'ai', r:{band:x.band,verdict:x.verdict,strengths:x.strengths,improvements:x.improvements,model:x.model,evidence:x.evidence||[],missing:x.missing||[],next:x.next||'',conf:x.conf||''}}; }")
rep("const r=normalise(res,max); setRec(p,it,part,{m:r.m, x:max, how:'ai', r:{band:r.band,verdict:r.verdict,strengths:r.strengths,improvements:r.improvements,model:r.model}}); awardXP(p,it,part,r.m,max,'ai'); prender();",
    "const r=normalise(res,max); setRec(p,it,part,aiRec(r,max)); awardXP(p,it,part,r.m,max,'ai'); prender();")
rep("const x=normalise(data.result,max); setRec(p,it,part,{m:x.m, x:max, how:'ai', r:{band:x.band,verdict:x.verdict,strengths:x.strengths,improvements:x.improvements,model:x.model}}); awardXP(p,it,part,x.m,max,'ai');",
    "const x=normalise(data.result,max); setRec(p,it,part,aiRec(x,max)); awardXP(p,it,part,x.m,max,'ai');")
rep("""  box.append(el('div',{class:'row between'}, el('span',{class:'mk'}, `${r.m} / ${max}`), el('span',{class:'small'}, r.how==='ai'?'AI estimate against the official criteria (not an official result)':r.how==='self'?'Self-marked':'Auto-marked'), el('button',{class:r.m<max?'primary':'ghost',onclick:()=>startRewrite(p,it,part)}, r.m<max?'Rewrite it for more marks':'Try again')));""",
    """  box.append(el('div',{class:'row between'}, el('span',{class:'mk'}, `${r.m} / ${max}`), el('span',{class:'small'}, r.how==='ai'?'Estimated mark from AI against the official criteria. Not a NESA result.':r.how==='self'?'Self-marked':'Auto-marked'), el('button',{class:r.m<max?'primary':'ghost',onclick:()=>startRewrite(p,it,part)}, r.m<max?'Rewrite it for more marks':'Try again')));
  if(r.how==='ai'&&r.r&&r.r.conf==='low') box.append(el('div',{class:'lowconf'}, el('b',{},'Low confidence. '), 'The marker could not judge this properly (too short, off topic or unreadable), so treat the mark as a rough guide and rewrite it.'));""")
rep("""    if(r.r.strengths&&r.r.strengths.length) box.append(el('div',{}, el('b',{},'What worked'), ...r.r.strengths.map(s=>el('p',{class:'bul good'},'✓ '+s))));
    if(r.r.improvements&&r.r.improvements.length) box.append(el('div',{}, el('b',{},'To get more marks'), ...r.r.improvements.map(s=>el('p',{class:'bul warn'},'→ '+s))));
    if(r.r.model) box.append(el('div',{class:'answer'}, el('div',{class:'lab'}, it.type==='long'?'Full-mark plan':'What a full-mark answer looks like'), paras(r.r.model))); }""",
    """    if(r.r.evidence&&r.r.evidence.length) box.append(el('div',{}, el('b',{},'Where you earned marks (your words)'), ...r.r.evidence.map(s=>el('p',{class:'evid'},'“'+s+'”'))));
    if(r.r.strengths&&r.r.strengths.length) box.append(el('div',{}, el('b',{},'What worked'), ...r.r.strengths.map(s=>el('p',{class:'bul good'},'✓ '+s))));
    if(r.r.missing&&r.r.missing.length) box.append(el('div',{}, el('b',{},'Missing for the next criteria row'), ...r.r.missing.map(s=>el('p',{class:'bul warn'},'• '+s))));
    if(r.r.improvements&&r.r.improvements.length) box.append(el('div',{}, el('b',{},'To get more marks'), ...r.r.improvements.map(s=>el('p',{class:'bul warn'},'→ '+s))));
    if(r.r.next) box.append(el('div',{class:'nextact'}, el('b',{},'Next action: '), r.r.next));
    if(r.r.model){ const ex=el('div',{class:'answer'}, el('div',{class:'lab'}, it.type==='long'?'Full-mark plan':'What a full-mark answer looks like'), paras(r.r.model)); if(r.m<max){ const d=el('details',{}, el('summary',{},'Show a full-mark example (try your rewrite first)')); d.append(ex); box.append(d); } else box.append(ex); } }""")

# ---------- B3 Business flow: a missed exam question feeds its topic into tomorrow's session ----------
rep("function awardXP(p,it,part,m,max,how){ const ok=m/max>=0.5; const xp=how==='ai'?Math.max(4,m*4):how==='mc'?5:Math.max(2,m*2); recordReview(null, ok, xp);",
    "function awardXP(p,it,part,m,max,how){ const ok=m/max>=0.5; const xp=how==='ai'?Math.max(4,m*4):how==='mc'?5:Math.max(2,m*2); if(!ok&&isBiz()){ const row=itemRow(p.id,it.id); const t=(part&&part.topic&&coarseTopic(part.topic,part.text))||(row&&row.topic); if(t&&t!=='Other'){ if(!S.boost||typeof S.boost!=='object') S.boost={}; S.boost[t]=today(); } } recordReview(null, ok, xp);")
rep("""  for(const c of prioritised(CARDS.filter(c=>c.t===topic&&status(c)!=='k'&&!used.has(c.id))).slice(0,8)) steps.push({k:'card', id:c.id, why:`${TOPIC_NAME[topic]}: your weakest topic`});""",
    """  for(const c of prioritised(CARDS.filter(c=>c.t===topic&&status(c)!=='k'&&!used.has(c.id))).slice(0,8)){ used.add(c.id); steps.push({k:'card', id:c.id, why:`${TOPIC_NAME[topic]}: your weakest topic`}); }
  // Topics where you lost marks on a real exam question in the last 2 days come back as cards (blueprint 5 and 10).
  for(const [t,d] of Object.entries(S.boost||{})){ if(t===topic||!TOPIC_ORDER.includes(t)||daysBetween(d,today())>2) continue; for(const c of prioritised(CARDS.filter(c=>c.t===t&&status(c)!=='k'&&!used.has(c.id))).slice(0,5)){ used.add(c.id); steps.push({k:'card', id:c.id, why:`${TOPIC_NAME[t]}: from a missed exam question`}); } }""")
rep("""    const parts=[]; if(nDue) parts.push(`${nDue} card${nDue===1?'':'s'} due for review`); if(nCard-nDue) parts.push(`${nCard-nDue} ${TOPIC_NAME[topic]} card${nCard-nDue===1?'':'s'} you have not got yet`);""",
    """    const nBoost=steps.filter(s=>/missed exam question/.test(s.why||'')).length, dueAll=dueCards().length;
    const parts=[]; if(nDue) parts.push(`${nDue} card${nDue===1?'':'s'} due for review`+(dueAll>nDue?` (${dueAll-nDue} more roll over to tomorrow)`:'')); if(nCard-nDue-nBoost) parts.push(`${nCard-nDue-nBoost} ${TOPIC_NAME[topic]} card${nCard-nDue-nBoost===1?'':'s'} you have not got yet`); if(nBoost) parts.push(`${nBoost} card${nBoost===1?'':'s'} from a topic where you lost marks on an exam question`);""")
rep("function progressDoc(){ if(S.cfgBy&&S.subj) S.cfgBy[S.subj]=S.cfg; return {v:5, idv:2, subj:S.subj||'business', cfgBy:S.cfgBy||{}, diag:S.diag||{},",
    "function progressDoc(){ if(S.cfgBy&&S.subj) S.cfgBy[S.subj]=S.cfg; return {v:5, idv:2, subj:S.subj||'business', cfgBy:S.cfgBy||{}, diag:S.diag||{}, boost:S.boost||{},")
rep("  const star=maxMap(S.star, r.star), unstar=maxMap(S.unstar, r.unstar);",
    "  const star=maxMap(S.star, r.star), unstar=maxMap(S.unstar, r.unstar);\n  { const b=Object.assign({}, S.boost||{}); for(const [t,d] of Object.entries(r.boost||{})) if(!b[t]||String(d)>String(b[t])) b[t]=d; S.boost=b; }")
rep("doc.star,doc.unstar,doc.hist,doc.sess,doc.recent]);", "doc.star,doc.unstar,doc.hist,doc.sess,doc.recent,doc.boost]);")
rep("if(!S.diag||typeof S.diag!=='object'||Array.isArray(S.diag)) S.diag={};", "if(!S.diag||typeof S.diag!=='object'||Array.isArray(S.diag)) S.diag={};\nif(!S.boost||typeof S.boost!=='object'||Array.isArray(S.boost)) S.boost={};")

# ---------- B4 beta: a feedback box for signed-in students (table from supabase-feedback.sql) ----------
rep("""    const lbBox=el('div',{class:'lb'}, el('p',{class:'small'},'Loading leaderboard…')); ac.append(lbBox); loadLeaderboard(lbBox);""",
    """    const lbBox=el('div',{class:'lb'}, el('p',{class:'small'},'Loading leaderboard…')); ac.append(lbBox); loadLeaderboard(lbBox);
    ac.append(feedbackBox());""")
rep("function renderAuthPanels(){", """const FB={text:'', busy:false, done:false, err:''};
function feedbackBox(){
  const box=el('div',{class:'fbbox'}, el('h3',{},'Something wrong, or an idea?'));
  if(FB.done){ box.append(el('p',{class:'small'},'Thanks, sent. It goes straight to the person who runs the site.'), el('button',{class:'ghost',onclick:()=>{ FB.done=false; FB.text=''; renderStats(); }},'Send another')); return box; }
  const ta=el('textarea',{class:'fbta',maxlength:'2000',placeholder:'What happened, on which page, and what you expected. Two or three sentences is plenty.','aria-label':'Feedback'}); ta.value=FB.text; ta.addEventListener('input',()=>{ FB.text=ta.value; });
  const btn=el('button',{class:'primary',disabled:FB.busy?'':null,onclick:async()=>{ const text=ta.value.trim(); if(text.length<3){ toast('Write a sentence first.'); return; } FB.busy=true; FB.err=''; btn.disabled=true; btn.textContent='Sending…';
    try{ if(!SB||!UID) throw new Error('Sign in first.'); const {error}=await SB.from('feedback').insert({user_id:UID, text:text.slice(0,2000), page:(location.hash||'#home').slice(0,80), subject:SUBJ.id, agent:navigator.userAgent.slice(0,200)}); if(error) throw new Error(/relation .* does not exist|schema cache/i.test(error.message||'')?'Feedback is not switched on yet; tell your teacher instead.':(error.message||'Could not send.')); FB.done=true; FB.text=''; }
    catch(e){ FB.err=(e&&e.message)||'Could not send.'; }
    FB.busy=false; renderStats(); }}, 'Send feedback');
  box.append(ta, el('div',{class:'row'}, btn, el('span',{class:'small'},'Sent with your account email so I can reply. Nothing else is attached.')));
  if(FB.err) box.append(el('p',{class:'small err',role:'alert'}, FB.err));
  return box;
}
function renderAuthPanels(){""")
rep(".savestat{font-size:.85rem;", ".fbbox{display:grid;gap:.5rem;margin-top:.4rem} .fbta{font:inherit;font-size:1rem;min-height:5.5rem;padding:.6rem .8rem;border:2px solid var(--border);border-radius:12px;background:var(--surface);color:var(--ink);width:100%;resize:vertical}\n.savestat{font-size:.85rem;")

P.write_text(s, encoding='utf-8')
print('phase B patch applied')
