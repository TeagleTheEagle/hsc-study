#!/usr/bin/env python3
"""Bands for Days navigation (blueprint section 4) and truthful progress (section 10) for app.html.

Today / Subjects / Practice / Library / Progress: a sidebar from 960 px, a bottom bar on phones; every mode has
a hash so the Back button works; the subject stays in the URL; topics with no evidence say "Not assessed".
Run after the build chain has written app.html (and after tools/brand.py). Refuses to run twice.
Usage: python3 tools/nav_patch.py [path/to/app.html]
"""
import sys, pathlib, re

P = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = P.read_text(encoding='utf-8')
if 'HASH_OF' in s:
    sys.exit('app.html already has the five-section navigation')

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

# ---------- CSS ----------
rep(""".mainnav{display:flex;gap:.15rem;overflow-x:auto;scrollbar-width:none}
.mainnav::-webkit-scrollbar{display:none}
.mainnav a.navlink{display:inline-flex;align-items:center;border-radius:10px;min-height:44px;padding:.35rem .85rem;font-weight:700;color:var(--muted);white-space:nowrap;flex:0 0 auto;text-decoration:none}
.mainnav button{border:0;border-radius:10px;background:none;min-height:44px;padding:.35rem .85rem;font-weight:700;color:var(--muted);white-space:nowrap;flex:0 0 auto}
.mainnav button[aria-current="page"]{background:var(--accent);color:var(--accent-ink)}
""", """/* Five sections (Today, Subjects, Practice, Library, Progress): a bottom bar on phones, a sidebar from 960px. */
.mainnav{position:fixed;left:0;right:0;bottom:0;z-index:6;display:flex;justify-content:space-around;gap:0;background:var(--surface);border-top:2px solid var(--border);padding:.25rem .25rem calc(.25rem + env(safe-area-inset-bottom,0px))}
.mainnav .navbrand{display:none}
.mainnav button{border:0;border-radius:12px;background:none;min-height:52px;padding:.3rem .2rem;font-weight:700;font-size:.78rem;color:var(--muted);white-space:nowrap;flex:1 1 0;display:grid;justify-items:center;gap:.1rem;line-height:1.1;min-width:0}
.mainnav button svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.mainnav button[aria-current="page"]{color:var(--accent);background:var(--accent-soft)}
body{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))}
.toast{bottom:calc(5.2rem + env(safe-area-inset-bottom,0px))}
@media (min-width:960px){
  body{padding-bottom:0;padding-left:232px}
  .mainnav{right:auto;top:0;bottom:0;width:232px;flex-direction:column;justify-content:flex-start;gap:.2rem;border-top:0;border-right:2px solid var(--border);padding:1rem .8rem}
  .mainnav .navbrand{display:flex;align-items:center;gap:.55rem;font-weight:700;font-size:1.15rem;color:inherit;text-decoration:none;padding:.3rem .5rem 1rem}
  .mainnav .navbrand svg{width:30px;height:30px;flex:0 0 auto}
  .mainnav button{flex:0 0 auto;display:flex;justify-content:flex-start;align-items:center;gap:.7rem;font-size:1rem;padding:.55rem .8rem;min-height:48px;width:100%}
  .mainnav button svg{width:22px;height:22px}
  .mainnav .navfoot{margin-top:auto;font-size:.85rem;color:var(--muted);padding:.5rem;display:grid;gap:.3rem}
  .mainnav .navfoot a{color:var(--accent)}
  .titlebar h1{display:none}
  .toast{bottom:calc(1.2rem + env(safe-area-inset-bottom,0px));left:calc(50% + 116px)}
}
@media (max-width:959px){ .mainnav .navfoot{display:none} }
.hub{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.6rem}
.hub .act b{display:flex;align-items:center;gap:.4rem}
.subjgrid button .dot{display:inline-block;width:.6em;height:.6em;border-radius:50%;background:var(--subj,var(--accent));margin-right:.35em}
body[data-subj] .hero{border-top:6px solid var(--subj,var(--accent))}
body[data-subj="business"]{--subj:#1F6B45} body[data-subj="english"]{--subj:#8B3A62} body[data-subj="maths-std2"]{--subj:#2F5FA8} body[data-subj="maths-adv"]{--subj:#1F4E8C}
body[data-subj="biology"]{--subj:#3B7D3A} body[data-subj="chemistry"]{--subj:#B05A1A} body[data-subj="physics"]{--subj:#4B5BB0} body[data-subj="modern-history"]{--subj:#8A5A1F} body[data-subj="ancient-history"]{--subj:#9A4A2A} body[data-subj="legal"]{--subj:#5E4B8B}
""")
rep("dialog#subjdlg{", "dialog#subjdlg-unused{")

# ---------- markup: nav out of the header, no dialog ----------
rep("""    <nav class="mainnav" id="mainnav" aria-label="Sections">
      <button data-section="home">Home</button>
      <button data-section="study">Cards</button>
      <button data-section="practice">Ratios</button>
      <button data-section="papers">Past papers</button>
      <button data-section="guide">Exam guide</button>
      <button data-section="progress">Progress</button>
      <button data-section="library">Library</button>
      <a class="navlink" id="reslink" href="resources.html">Resources</a>
    </nav>
""", "")
ICONS = {
 'today': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
 'subjects': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5V5.5M8 7h8"/></svg>',
 'practice': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3l7 7-10 10H4v-7z"/><path d="M11 6l7 7"/></svg>',
 'library': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
 'progress': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/></svg>',
}
nav = ('<nav class="mainnav" id="mainnav" aria-label="Sections">\n'
       '  <a class="navbrand" href="index.html"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="7" fill="#1F6B45"/><rect x="7.5" y="18" width="5" height="7" rx="1.5" fill="#F6F2EA"/><rect x="13.5" y="13" width="5" height="12" rx="1.5" fill="#F6F2EA"/><rect x="19.5" y="7" width="5" height="18" rx="1.5" fill="#F2C14E"/></svg>Bands for Days</a>\n'
       + ''.join(f'  <button data-section="{k}">{ICONS[k]}<span>{k.capitalize()}</span></button>\n' for k in ['today','subjects','practice','library','progress'])
       + '  <div class="navfoot"><a href="exams.html">HSC exams</a><a href="resources.html">Resources</a><a href="index.html">About</a></div>\n</nav>\n')
rep("</header>\n\n<main>", "</header>\n" + nav + "\n<main>")
rep(re.search(r'<dialog id="subjdlg".*?</dialog>\n', s, re.S).group(0), "")

# ---------- sections, routing, history ----------
rep("""const SECTION_OF={home:'home',flash:'study',learn:'study',test:'study',match:'study',ratio:'practice',papers:'papers',guide:'guide',stats:'progress',today:'home',diag:'home',mistakes:'progress',library:'library',editset:'library'};
const SECTION_DEFAULT={home:'home',study:'flash',practice:'ratio',papers:'papers',guide:'guide',progress:'stats',library:'library'};
function goMode(m){ S.mode=m; if(SECTION_OF[m]==='study') S.lastStudy=m; save(); render(); window.scrollTo({top:0}); }
""", """// Five sections. A mode belongs to one section; 'test' belongs to Practice when it is the exam-style test.
const SECTION_OF={home:'today',today:'today',diag:'today',subjects:'subjects',flash:'subjects',learn:'subjects',match:'subjects',test:'subjects',guide:'practice',practice:'practice',papers:'practice',ratio:'practice',library:'library',editset:'library',stats:'progress',mistakes:'progress'};
function sectionOf(m){ if(m==='test'&&isBiz()&&(S.testKind||'exam')==='exam') return 'practice'; return SECTION_OF[m]||'today'; }
const SECTION_DEFAULT={today:'home',subjects:'subjects',practice:'practice',library:'library',progress:'stats'};
// Every mode has an address, so links can be shared and the Back button works.
const HASH_OF={home:'#home',today:'#today',diag:'#check',subjects:'#subjects',flash:'#cards',learn:'#learn',match:'#match',test:'#test',practice:'#practice',papers:'#papers',ratio:'#ratio',guide:'#guide',library:'#library',editset:'#set',stats:'#stats',mistakes:'#mistakes'};
function hashFor(m){ if(m==='test') return (isBiz()&&(S.testKind||'exam')==='exam')?'#test':'#test-cards'; if(m==='papers'&&S.pp.paper) return '#papers/'+S.pp.paper+(S.pp.item?'/'+S.pp.item:''); return HASH_OF[m]||'#home'; }
function modeOfHash(h){ h=String(h||'').replace(/^#/,''); if(!h||h.startsWith('import=')) return null; const [head,...rest]=h.split('/'); if(head==='test-cards') return {mode:'test',kind:'cards'}; if(head==='test') return {mode:'test',kind:'exam'}; if(head==='papers') return {mode:'papers',paper:rest[0]||null,item:rest[1]||null}; const m=Object.keys(HASH_OF).find(k=>HASH_OF[k]==='#'+head); return m?{mode:m}:null; }
function applyHash(h){ const x=modeOfHash(h); if(!x) return false; S.mode=x.mode; if(x.kind) S.testKind=x.kind; if(x.mode==='papers'){ S.pp.paper=x.paper&&PBY[x.paper]?x.paper:null; S.pp.item=S.pp.paper&&x.item?x.item:null; } return true; }
let NAV_POP=false;
function pushMode(){ if(NAV_POP) return; const h=hashFor(S.mode); if(location.hash!==h) history.pushState({mode:S.mode,paper:S.pp.paper,item:S.pp.item}, '', location.pathname+location.search+h); }
window.addEventListener('popstate',()=>{ NAV_POP=true; try{ if(applyHash(location.hash)){ save(); render(); window.scrollTo({top:0}); } } finally{ NAV_POP=false; } });
function goMode(m){ S.mode=m; if(['flash','learn','match'].includes(m)||(m==='test'&&sectionOf(m)==='subjects')) S.lastStudy=m; save(); pushMode(); render(); window.scrollTo({top:0}); }
""")
rep("""  const sec=SECTION_OF[S.mode]||'home';
  document.querySelectorAll('#mainnav button').forEach(b=>{ b.setAttribute('aria-current', b.dataset.section===sec?'page':'false'); b.onclick=()=>goMode(b.dataset.section==='study'?(S.lastStudy||'flash'):SECTION_DEFAULT[b.dataset.section]); });
  for(const b of document.querySelectorAll('#mainnav button')){ if(['practice','guide'].includes(b.dataset.section)) b.hidden=!isBiz(); if(b.dataset.section==='papers') b.hidden=!hasExams(); }
  { const rl=$('#reslink'); if(rl) rl.style.display=isBiz()?'':'none'; }
  $('#subjbtn').onclick=openSubjects;
  $('#subbar').hidden=(sec!=='study');
""", """  const sec=sectionOf(S.mode);
  document.querySelectorAll('#mainnav button').forEach(b=>{ b.setAttribute('aria-current', b.dataset.section===sec?'page':'false'); b.onclick=()=>goMode(SECTION_DEFAULT[b.dataset.section]); });
  $('#subjbtn').onclick=openSubjects;
  $('#subbar').hidden=!(['flash','learn','match'].includes(S.mode)||(S.mode==='test'&&sec==='subjects'));
""")
rep("function openPaper(id){ S.pp.paper=id; S.pp.item=null; save(); prender(); window.scrollTo({top:0}); }\nfunction openItem(id){ S.pp.item=id; save(); prender(); window.scrollTo({top:0}); }",
    "function openPaper(id){ S.pp.paper=id; S.pp.item=null; save(); pushMode(); prender(); window.scrollTo({top:0}); }\nfunction openItem(id){ S.pp.item=id; save(); pushMode(); prender(); window.scrollTo({top:0}); }")

# ---------- subjects page and practice hub ----------
rep(re.search(r"function openSubjects\(\)\{.*?\n\}\nfunction closeSubjects\(\)\{[^\n]*\n", s, re.S).group(0), """function openSubjects(){ goMode('subjects'); }
function closeSubjects(){}
function subjLine(s){ return s.soon?'Coming soon':`${s.n} cards`+(s.id==='business'?` · ${BIZ_PAPERS.length} past papers · ratio drill`:s.papers?` · ${s.np||''} past papers marked by AI`:' · HSC exams to download'); }
function renderSubjects(){
  const v=$('#view'); v.innerHTML='';
  const cards=CARDS.length, learning=CARDS.filter(c=>status(c)==='l').length, unseen=CARDS.filter(c=>status(c)==='u').length, dueN=dueCards().length;
  const hero=el('div',{class:'panel hero'}, el('div',{class:'lab'},'Current subject'), el('h2',{}, SUBJ.icon+' '+SUBJ.name), el('p',{class:'small'}, subjLine(SUBJ)+'. Your progress, streak and XP are kept for every subject.'));
  v.append(hero);
  const acts=el('div',{class:'actions'});
  acts.append(action('Flashcards', dueN?`${dueN} due for review`:learning?`${learning} cards still learning`:unseen?`${unseen} cards not seen yet`:`All ${cards} cards seen`, ()=>{ S.filter=dueN?'due':learning?'l':'all'; S.deck='all'; goMode('flash'); }, 'primary'));
  acts.append(action('Learn', 'Multiple choice or typed, 20 at a time, weakest first', ()=>goMode('learn')));
  acts.append(action('Test', 'Questions one at a time, then mark yourself', ()=>{ S.testKind='cards'; T=null; goMode('test'); }));
  acts.append(action('Match', '5 pairs against the clock', ()=>goMode('match')));
  v.append(el('div',{class:'panel'}, el('h2',{},'Study '+SUBJ.short), acts));
  const tp=el('div',{class:'panel'}, el('h2',{},'Topics'));
  for(const r of topicRows()) tp.append(deckBar(r));
  v.append(tp);
  const g=el('div',{class:'subjgrid'});
  for(const x of SUBJECTS){ g.append(el('button',{'aria-current':String(x.id===SUBJ.id),disabled:x.soon?'':null,onclick:()=>switchSubject(x.id)}, el('b',{}, el('span',{class:'dot',style:`--subj:${SUBJ_COLOUR[x.id]||'var(--accent)'}`}), x.icon+' '+x.name), el('span',{}, subjLine(x)))); }
  v.append(el('div',{class:'panel'}, el('h2',{},'All subjects'), g, el('p',{class:'small'},'Links keep the subject: share app.html?s='+SUBJ.id+' and it opens here.')));
}
const SUBJ_COLOUR={business:'#1F6B45',english:'#8B3A62','maths-std2':'#2F5FA8','maths-adv':'#1F4E8C',biology:'#3B7D3A',chemistry:'#B05A1A',physics:'#4B5BB0','modern-history':'#8A5A1F','ancient-history':'#9A4A2A',legal:'#5E4B8B'};
function renderPractice(){
  const v=$('#view'); v.innerHTML='';
  const acts=el('div',{class:'actions'});
  if(isBiz()){
    let pq=0,pn=0; for(const p of PAPERS){ pq+=pItems(p).filter(x=>itemStatus(p,x.it).done).length; pn+=pItems(p).length; }
    const lastPaper=S.pp&&S.pp.paper&&PBY[S.pp.paper];
    acts.append(action('Past papers', lastPaper?`Continue ${lastPaper.title}`:`${PAPERS.length} papers · ${pn} questions · ${pq} answered`, ()=>{ if(!lastPaper){ S.pp.paper=null; S.pp.item=null; } goMode('papers'); }, 'primary'));
    acts.append(action('Exam-style test', 'Real HSC questions by topic, marked like the exam', ()=>{ S.testKind='exam'; XT=null; goMode('test'); }));
    acts.append(action('Ratio drill', 'All 7 ratios with exam-style figures and interpretation', ()=>goMode('ratio')));
    acts.append(action('Exam guide', 'Exam structure, what each band looks like, the 35 NESA key words', ()=>goMode('guide')));
    acts.append(action('Find a question', 'Search every HSC and Riverview question by words, topic, year or verb', ()=>{ S.pp.paper=null; S.pp.item=null; goMode('papers'); }));
  } else if(hasExams()){
    const lastPaper=S.pp&&S.pp.paper&&PBY[S.pp.paper];
    acts.append(action('Past papers', lastPaper?`Continue ${lastPaper.title}`:(SUBJ.np?`${SUBJ.np} HSC papers, typed answers marked by AI`:'HSC exams and marking guidelines to download'), ()=>goMode('papers'), 'primary'));
  }
  acts.append(action('Test on cards', 'Questions one at a time, typed or on paper, then mark yourself', ()=>{ S.testKind='cards'; T=null; goMode('test'); }));
  acts.append(action('Today’s session', sessLine(), ()=>{ TS=null; goMode('today'); }));
  { const n=mistakeQs().length+mistakeCards().length; acts.append(action('Mistake notebook', n?`${n} to fix`:'Empty so far. Anything you miss lands here.', ()=>goMode('mistakes'))); }
  v.append(el('div',{class:'panel'}, el('h2',{},'Practice '+SUBJ.short), acts));
  const links=el('div',{class:'row'}, el('a',{class:'btn',href:'exams.html'+(isBiz()?'':'#'+SUBJ.id)},'HSC exams and marking guidelines (PDF)'));
  if(isBiz()) links.append(el('a',{class:'btn',href:'resources.html'},'Resources: Business trial papers, exemplars and notes'));
  v.append(el('div',{class:'panel'}, el('h2',{},'Downloads'), links));
}
""")
rep("({library:renderLibrary, editset:renderEditSet, flash:renderFlash,", "({library:renderLibrary, editset:renderEditSet, subjects:renderSubjects, practice:renderPractice, flash:renderFlash,")
rep("if(S.mode==='stats'||S.mode==='ratio'||S.mode==='papers'||S.mode==='home'||", "if(S.mode==='stats'||S.mode==='subjects'||S.mode==='practice'||S.mode==='ratio'||S.mode==='papers'||S.mode==='home'||")
rep("  if(!isBiz()&&(['ratio','guide'].includes(S.mode)||(S.mode==='papers'&&!hasExams()))) S.mode='home';\n  if(MF) MF.topic='all';",
    "  if(!isBiz()&&(['ratio','guide'].includes(S.mode)||(S.mode==='papers'&&!hasExams()))) S.mode='home';\n  document.body.dataset.subj=s.id;\n  if(MF) MF.topic='all';")
rep("$('#subjclose').onclick=closeSubjects;\n$('#subjdlg').addEventListener('click',e=>{ if(e.target.id==='subjdlg') closeSubjects(); });\n", "")
# subject stays in the address after a switch and on load
rep("try{ await loadSubject(id); applySubject(id); save(); closeSubjects(); render();", "try{ await loadSubject(id); applySubject(id); save(); history.replaceState(history.state,'',location.pathname+'?s='+id+location.hash); render();")
rep("if(location.hash==='#papers'){ S.mode='papers'; } else if(location.hash==='#ratio'){ S.mode='ratio'; } else if(location.hash==='#stats'){ S.mode='stats'; } else if(location.hash==='#guide'){ S.mode='guide'; } else if(location.hash==='#today'){ S.mode='today'; } else if(location.hash==='#mistakes'){ S.mode='mistakes'; } else if(location.hash==='#test'){ S.mode='test'; S.testKind='exam'; }",
    "if(!applyHash(location.hash)&&['subjects','practice'].includes(S.mode)) S.mode='home';")
rep("render(); renderAccount(); initSync();\ndocument.addEventListener('visibilitychange'",
    "if(!new URLSearchParams(location.search).get('s')&&S.subj&&S.subj!=='business') history.replaceState(history.state,'',location.pathname+'?s='+S.subj+location.hash);\nrender(); renderAccount(); initSync();\ndocument.addEventListener('visibilitychange'")
rep("t.onclick=()=>goMode(t.dataset.mode); });", "t.onclick=()=>{ if(t.dataset.mode==='test'){ S.testKind='cards'; T=null; } goMode(t.dataset.mode); }; });")
# the subject button in the header shows the current subject; the subjects page is where it switches
rep('aria-haspopup="dialog" aria-label="Change subject"', 'aria-label="Change subject"')

# ---------- truthful progress: "Not assessed" instead of 0% (section 10) ----------
rep("function mCell(v, tip){ return el('td',{class:v==null?'none':v<50?'lo':v<80?'mid':'hi', title:tip}, v==null?'–':v+'%'); }",
    "function mCell(v, tip){ return el('td',{class:v==null?'none':v<50?'lo':v<80?'mid':'hi', title:tip}, v==null?el('span',{class:'na'},'Not assessed'):v+'%'); }")
rep("table.mastery td.none{color:var(--muted);font-weight:400}", "table.mastery td.none{color:var(--muted);font-weight:400} table.mastery .na{font-size:.78rem}")
rep("    const recall=Math.round(100*cs.filter(c=>status(c)==='k').length/cs.length), lt=Math.round(100*cs.filter(mastered).length/cs.length);",
    "    const seen=cs.filter(c=>status(c)!=='u').length, kn=cs.filter(c=>status(c)==='k').length, ms=cs.filter(mastered).length; const recall=seen?Math.round(100*kn/cs.length):null, lt=seen?Math.round(100*ms/cs.length):null;")
rep("      mCell(recall,'Cards you got right last time'), mCell(lt,'Cards right on 3 or more separate days'),",
    "      mCell(recall,seen?`${kn} of ${cs.length} cards right last time (${seen} seen)`:'No cards from this topic seen yet'), mCell(lt,seen?`${ms} of ${cs.length} cards right on 3 or more separate days`:'No cards from this topic seen yet'),")
rep("function topicRows(){ const rows=[]; for(const d of DECKS.filter(d=>d.topic)){ const cs=CARDS.filter(d.test); const k=cs.filter(c=>status(c)==='k').length, m=cs.filter(mastered).length, l=cs.filter(c=>status(c)==='l').length; rows.push({d,cs,k,m,l,pct:Math.round(100*k/cs.length)}); } return rows; }",
    "function topicRows(){ const rows=[]; for(const d of DECKS.filter(d=>d.topic)){ const cs=CARDS.filter(d.test); const k=cs.filter(c=>status(c)==='k').length, m=cs.filter(mastered).length, l=cs.filter(c=>status(c)==='l').length; rows.push({d,cs,k,m,l,seen:k+l,pct:Math.round(100*k/cs.length)}); } return rows; }\nfunction pctLabel(r){ return r.seen?`${r.pct}% got it, ${r.seen} of ${r.cs.length} seen`:'not assessed yet'; }")
rep("`Weakest topic first: ${weak.d.full||weak.d.name} (${weak.pct}% got it)`", "`Weakest topic first: ${weak.d.full||weak.d.name} (${pctLabel(weak)})`")
rep("`Weakest topic first: ${weak.d.name} (${weak.pct}% got it)`", "`Weakest topic first: ${weak.d.name} (${pctLabel(weak)})`")
rep("parts.push(`${a} min · Learn ${wk.d.name} (${wk.pct}% got it${i===0&&due?", "parts.push(`${a} min · Learn ${wk.d.name} (${pctLabel(wk)}${i===0&&due?")
rep("`${a} min · Learn ${wk.d.full||wk.d.name} (${wk.pct}% got it). ${b} min", "`${a} min · Learn ${wk.d.full||wk.d.name} (${pctLabel(wk)}). ${b} min")
# Progress by topic in stats: no percentage without evidence
rep("const pct=Math.round(100*k/cs.length);\n    dk.append(el('div',{class:'deckrow'}, el('span',{},d.name), el('div',{class:'bar'}, el('span',{class:'m',style:`width:${100*m/cs.length}%`}), el('span',{class:'k',style:`width:${100*(k-m)/cs.length}%`}), el('span',{class:'l',style:`width:${100*l/cs.length}%`})), el('span',{class:'pct'},pct+'%'))); }",
    "const pct=Math.round(100*k/cs.length);\n    dk.append(el('div',{class:'deckrow'}, el('span',{},d.name), el('div',{class:'bar'}, el('span',{class:'m',style:`width:${100*m/cs.length}%`}), el('span',{class:'k',style:`width:${100*(k-m)/cs.length}%`}), el('span',{class:'l',style:`width:${100*l/cs.length}%`})), el('span',{class:'pct',title:`${k} of ${cs.length} cards got it`}, k+l?pct+'%':'Not assessed'))); }\n  dk.append(el('p',{class:'small'},'A percentage is the share of a topic’s cards you got right last time. Nothing is counted until you have seen a card.'));")

P.write_text(s, encoding='utf-8')
print('nav patch applied')
