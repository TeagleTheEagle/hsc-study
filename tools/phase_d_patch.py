#!/usr/bin/env python3
"""Bands for Days phase D (blueprint 17, 19 D): offline service worker, install prompt, save subjects for offline,
offline guards. Usage: python3 tools/phase_d_patch.py app.html  (also patches index.html next to it).
Refuses to run twice. Run tools/sw_version.py afterwards."""
import sys, pathlib
path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = path.read_text(encoding='utf-8')
if 'phase D: offline' in s:
    sys.exit('phase D patch already applied')

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

# ---------- CSS ----------
rep(".savestat{font-size:.85rem;", """.toast.action{display:flex;gap:.7rem;align-items:center;border-radius:14px} .toast .tbtn{min-height:36px;padding:.2rem .9rem;border-radius:999px;background:var(--bg);color:var(--ink);border:0;font-weight:700}
.panel.install{border-color:var(--accent)} .panel.install .row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.5rem}
.offlist{display:grid;margin-top:.4rem} .offrow{display:flex;justify-content:space-between;align-items:center;gap:.6rem;padding:.45rem 0;border-top:1.5px solid var(--border)} .offrow button{min-height:40px;padding:.3rem .9rem} .offpill{font-size:.85rem;padding:.15rem .7rem;border-radius:999px;background:var(--good-soft);color:var(--good-deep);font-weight:700}
.savestat{font-size:.85rem;""")

# ---------- marking needs the network; the draft is already saved ----------
rep("  setRec(p,it,part,{a:text.slice(0,12000)});\n",
    "  setRec(p,it,part,{a:text.slice(0,12000)});\n  if(!navigator.onLine){ toast('Marking needs internet. Your answer is saved as a draft and will be here when you are back online.'); return; }\n")

# ---------- a subject that is not saved on this device, while offline ----------
rep("catch(e){ toast('Could not load '+(SUBJ_BY[id]?SUBJ_BY[id].name:'that subject')+'. Check your connection and try again.'); }",
    "catch(e){ toast('Could not load '+(SUBJ_BY[id]?SUBJ_BY[id].name:'that subject')+(navigator.onLine?'. Check your connection and try again.':'. You are offline and it is not saved on this device. Save it under Subjects > Offline when you are back online.')); }")

# ---------- Subjects page: save a subject for offline use ----------
rep("el('p',{class:'small'},'Links keep the subject: share app.html?s='+SUBJ.id+' and it opens here.')));\n}",
    "el('p',{class:'small'},'Links keep the subject: share app.html?s='+SUBJ.id+' and it opens here.')));\n  { const op=offlinePanel(); if(op) v.append(op); }\n}")

# ---------- install card on the Today page ----------
rep("today:renderToday, mistakes:renderMistakes, diag:renderDiag})[S.mode](); }",
    "today:renderToday, mistakes:renderMistakes, diag:renderDiag})[S.mode](); if(S.mode==='home') placeInstallCard(); if(PWA.waiting&&!$('.toast.action')) updateToast(); }")

# ---------- the phase D block itself, before start-up ----------
rep("render(); renderAccount(); initSync();", r"""// ---------- phase D: offline (service worker), install prompt, saved subjects ----------
const PWA={reg:null, waiting:null};
const DATA_CACHE='bfd-data-v1';
function updateToast(){ let t=$('.toast'); if(t) t.remove(); t=el('div',{class:'toast action',role:'status'}, 'A new version is ready. ', el('button',{class:'tbtn',onclick:()=>{ if(PWA.waiting) PWA.waiting.postMessage({type:'SKIP_WAITING'}); }},'Reload')); document.body.append(t); clearTimeout(toastT); }
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{ navigator.serviceWorker.register('sw.js').then(reg=>{ PWA.reg=reg; const track=w=>{ if(!w) return; w.addEventListener('statechange',()=>{ if(w.state==='installed'&&navigator.serviceWorker.controller){ PWA.waiting=w; updateToast(); } }); }; if(reg.waiting&&navigator.serviceWorker.controller){ PWA.waiting=reg.waiting; updateToast(); } track(reg.installing); reg.addEventListener('updatefound',()=>track(reg.installing)); }).catch(()=>{}); });
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(PWA.waiting){ PWA.waiting=null; location.reload(); } });
}
let installEvt=null;
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installEvt=e; if(S.mode==='home') render(); });
window.addEventListener('appinstalled',()=>{ installEvt=null; toast('Installed. Open Bands for Days from your home screen.'); if(S.mode==='home') render(); });
function isStandalone(){ return (window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true; }
function installCard(){
  if(isStandalone()) return null;
  const dis=+localStorage.getItem('bfd_install_dismiss')||0; if(Date.now()-dis<14*864e5) return null;
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent)&&!window.MSStream; if(!installEvt&&!ios) return null;
  const card=el('div',{class:'panel install'}, el('div',{class:'lab'},'Add to your phone'), el('h2',{},'Install Bands for Days'),
    el('p',{class:'small'}, ios?'Tap Share, then "Add to Home Screen". It opens full screen, and your cards and saved papers work offline.':'Opens from your home screen, and your cards and saved papers work offline. Marking and sync still need internet.'));
  const row=el('div',{class:'row'});
  if(installEvt) row.append(el('button',{class:'primary',onclick:async()=>{ const e=installEvt; installEvt=null; try{ e.prompt(); await e.userChoice; }catch(_){ } render(); }},'Install'));
  row.append(el('button',{class:'ghost',onclick:()=>{ localStorage.setItem('bfd_install_dismiss',String(Date.now())); render(); }},'Not now'));
  card.append(row); return card;
}
function placeInstallCard(){ const ic=installCard(); if(!ic) return; const v=$('#view'); if(!v.firstChild) return; v.insertBefore(ic, v.firstChild.nextSibling); }
function offlineUrls(s){ const u=[]; if(s.file) u.push(s.file+'?v='+(s.v||'1')); if(s.papers) u.push(s.papers+'?v='+(s.pv||'1')); return u; }
async function offlineState(s){ if(!('caches' in window)) return 'no'; if(s.id==='business') return 'builtin'; try{ const c=await caches.open(DATA_CACHE); for(const u of offlineUrls(s)){ if(!(await c.match(u))) return 'none'; } return 'saved'; }catch(e){ return 'no'; } }
async function saveOffline(s,btn){ btn.disabled=true; btn.textContent='Saving…'; try{ const c=await caches.open(DATA_CACHE); await c.addAll(offlineUrls(s)); toast(s.short+' saved for offline use.'); }catch(e){ toast('Could not save '+s.short+'. Check your connection and try again.'); } if(S.mode==='subjects') renderSubjects(); }
function offlinePanel(){
  if(!('caches' in window)||!('serviceWorker' in navigator)) return null;
  const p=el('div',{class:'panel',id:'offline'}, el('h2',{},'Offline'), el('p',{class:'small'},'Saved subjects work without internet: cards, Learn, Test, Match and typed past papers. AI marking, sign-in and sync need a connection, and pictures in papers load the first time you open them.'));
  const list=el('div',{class:'offlist'}); p.append(list);
  for(const s of SUBJECTS){ if(s.soon) continue; const row=el('div',{class:'offrow'}, el('span',{}, s.icon+' '+s.short), el('span',{class:'small'},'…')); list.append(row);
    offlineState(s).then(st=>{ row.lastChild.remove(); if(st==='builtin') row.append(el('span',{class:'offpill'},'Always available')); else if(st==='saved') row.append(el('span',{class:'offpill'},'Saved ✓')); else if(st==='none'){ const b=el('button',{class:'ghost',onclick:()=>saveOffline(s,b)},'Save'); row.append(b); } else row.append(el('span',{class:'small'},'Not supported in this browser')); }); }
  return p;
}
render(); renderAccount(); initSync();""")

# ---------- mobile polish: no tap delay or grey flash, no pull-to-refresh when installed, home-screen meta ----------
rep("<link rel=\"manifest\" href=\"manifest.webmanifest\">\n",
    "<link rel=\"manifest\" href=\"manifest.webmanifest\">\n<meta name=\"mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\">\n<meta name=\"apple-mobile-web-app-title\" content=\"Bands for Days\">\n")
rep(".savestat{font-size:.85rem;",
    "button,.act,.mainnav button,.subjgrid button,label.btnlike{touch-action:manipulation;-webkit-tap-highlight-color:transparent}\n@media (display-mode: standalone){ html{overscroll-behavior-y:none} }\n.savestat{font-size:.85rem;")

path.write_text(s, encoding='utf-8')

# index.html: register the worker so the shell is saved from the first visit
ix = path.parent / 'index.html'
t = ix.read_text(encoding='utf-8')
if 'serviceWorker' not in t:
    assert t.count('\n</body>') == 1
    t = t.replace('\n</body>', "\n<script>if('serviceWorker' in navigator) addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));</script>\n</body>")
    ix.write_text(t, encoding='utf-8')
t = ix.read_text(encoding='utf-8')
if 'apple-mobile-web-app-title' not in t:
    assert t.count('<link rel="manifest" href="manifest.webmanifest">\n') == 1
    t = t.replace('<link rel="manifest" href="manifest.webmanifest">\n', '<link rel="manifest" href="manifest.webmanifest">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-status-bar-style" content="default">\n<meta name="apple-mobile-web-app-title" content="Bands for Days">\n')
    ix.write_text(t, encoding='utf-8')
print('phase D patch applied')
