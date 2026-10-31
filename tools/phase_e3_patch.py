#!/usr/bin/env python3
"""Bands for Days phase E3 (blueprint 19 E, fuller subjects): the Exam-style test and Find a question work for
every subject with typed papers, not only Business. Paper questions are grouped by module/section and mapped onto
the subject's card topics where the names line up (Module 5 -> M5 · Heredity, Crime -> Crime, ...).
Usage: python3 tools/phase_e3_patch.py app.html  (after phase E2). Refuses to run twice."""
import sys, pathlib
path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = path.read_text(encoding='utf-8')
if 'phase E3: tests for every subject' in s:
    sys.exit('phase E3 patch already applied')
assert 'phase E2: classes' in s, 'apply phase E2 first'

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

# ---------- helpers: subject-aware topics ----------
rep("function deckTopic(){ if(!isBiz()) return TOPIC_ORDER.includes(S.deck)?S.deck:'all';",
    """// ---------- phase E3: tests for every subject ----------
function hasXT(){ return isBiz()||(hasExams()&&!!SUBJ.papers); }
function tName(t){ return TOPIC_NAME[t]||t; }
function normT(x){ return String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,''); }
// a paper question's module/section, mapped onto the subject's card topic id when the names line up
function xtMatch(c){
  const forms=[String(c||'').trim(), String(c||'').split(/\\s[—–-]\\s/)[0].trim()].filter(Boolean);
  for(const f of forms){ const A=normT(f), fl=f.toLowerCase(); if(A.length<4) continue;
    for(const id of TOPIC_ORDER){ const name=String(TOPIC_NAME[id]||''); const names=[name, name.replace(/^[^:]*:\\s*/,'')];
      for(const nm of names){ const N=normT(nm); if(!N) continue; if(N===A||nm.toLowerCase().startsWith(fl+':')||(A.length>=6&&N.includes(A))||(N.length>=5&&A.includes(N))) return id; } } }
  // first-word stem: 'Criminal investigation process' -> Crime
  const words=String(c||'').toLowerCase().split(/[^a-z]+/).filter(w=>w.length>=4);
  for(const id of TOPIC_ORDER){ const w=String(TOPIC_NAME[id]||'').toLowerCase().replace(/^[^:]*:\\s*/,'').split(/[^a-z]+/)[0]||''; if(w.length>=5&&words.some(x=>x.startsWith(w.slice(0,4)))) return id; }
  return null;
}
function xtTopicOf(it,s){
  const cands=[it.area, it.topic, ...((it.parts||[]).map(p=>p.topic))].map(x=>String(x||'').trim()).filter(Boolean);
  for(const c of cands){ const id=xtMatch(c); if(id) return id; }
  const sec=String((s&&s.name)||'').split(' · ').pop().trim(); const sid=sec&&!/^section\\s/i.test(sec)?xtMatch(sec):null; if(sid) return sid;
  const fb=XT_FALLBACK[SUBJ.id]&&XT_FALLBACK[SUBJ.id](it,s); if(fb) return fb;
  if(!cands.length) return 'General';
  const raw=cands[0].split(/\\s[—–-]\\s/)[0].trim(); return raw.charAt(0).toUpperCase()+raw.slice(1);
}
// where a paper gives no module label, the exam's own layout says which topic a question is from
const XT_FALLBACK={
  legal:(it,s)=>{ const n=parseInt(it.n,10); const hr=TOPIC_ORDER.find(id=>/human rights/i.test(TOPIC_NAME[id]||'')), cr=TOPIC_ORDER.find(id=>/^crime$/i.test(TOPIC_NAME[id]||'')); if(it.type==='mc'&&n>=1&&n<=20) return n<=15?cr:hr; if(it.type==='sa'&&!/Section III|Option/i.test(String((s&&s.name)||''))) return hr; return null; }
};
function xtTopicOpts(){
  if(isBiz()) return XTOPICS;
  const have=new Set(itemIndex().map(r=>r.topic)); const out=[['all','All topics']];
  for(const [k,n] of XTOPICS){ if(k!=='all'&&have.has(k)) out.push([k,n]); }
  for(const t of [...have].filter(t=>!TOPIC_NAME[t]).sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}))) out.push([t,t]);
  return out;
}
function deckTopic(){ if(!isBiz()) return TOPIC_ORDER.includes(S.deck)?S.deck:'all';""")

rep("""function itemIndex(){
  if(!isBiz()) return [];
  if(itemIndex.cache) return itemIndex.cache; const rows=[];
  for(const p of PAPERS){ for(const {s,it} of pItems(p)){
    if(it.type!=='mc'&&it.type!=='sa') continue; let topic;
    if(it.type==='mc')""",
    """function itemIndex(){
  if(itemIndex.cache&&itemIndex.sid===SUBJ.id) return itemIndex.cache; const rows=[]; itemIndex.sid=SUBJ.id;
  for(const p of PAPERS){ for(const {s,it} of pItems(p)){
    if(it.type!=='mc'&&it.type!=='sa') continue; let topic;
    if(!isBiz()) topic=xtTopicOf(it,s);
    else if(it.type==='mc')""")
rep("PAPERS=want; PBY=Object.fromEntries(PAPERS.map(p=>[p.id,p])); qIndex.cache=null; }",
    "PAPERS=want; PBY=Object.fromEntries(PAPERS.map(p=>[p.id,p])); qIndex.cache=null; itemIndex.cache=null; }")

# ---------- routing and the test switch ----------
rep("function sectionOf(m){ if(m==='test'&&isBiz()&&(S.testKind||'exam')==='exam') return 'practice';",
    "function sectionOf(m){ if(m==='test'&&hasXT()&&(S.testKind||'exam')==='exam') return 'practice';")
rep("function hashFor(m){ if(m==='test') return (isBiz()&&(S.testKind||'exam')==='exam')?'#test':'#test-cards';",
    "function hashFor(m){ if(m==='test') return (hasXT()&&(S.testKind||'exam')==='exam')?'#test':'#test-cards';")
rep("function testKindSeg(){ if(!isBiz()) return null;", "function testKindSeg(){ if(!hasXT()) return null;")
rep("function renderTest(){ if(!isBiz()||(S.testKind||'exam')==='cards') return renderCardTest(); return renderExamTest(); }",
    "function renderTest(){ if(!hasXT()||(S.testKind||'exam')==='cards') return renderCardTest(); return renderExamTest(); }")

# ---------- test setup: load the subject's papers first, then subject-aware wording and topics ----------
rep("""function renderXtSetup(v){
  if(S.xtDeck!==S.deck){ S.xtTopic=deckTopic(); S.xtDeck=S.deck; }
  const topic=S.xtTopic||'all', fmt=S.xtFmt||'mc';
  const pool=t=>itemIndex().filter(r=>r.type===t&&(topic==='all'||r.topic===topic));""",
    """function renderXtSetup(v){
  if(!isBiz()&&SUBJ.papers&&!SUBJ_PAPERS[SUBJ.id]){ v.append(el('div',{class:'panel'}, el('h2',{},'Exam-style test'), el('p',{class:'small'},'Loading the papers…'))); const want=SUBJ.id; loadSubjPapers().then(()=>{ if(SUBJ.id===want){ setPapers(); if(S.mode==='test') render(); } }).catch(()=>{ const n=v.querySelector('.panel p'); if(n) n.textContent='Could not load the papers. Check your connection and try again.'; }); return; }
  setPapers();
  if(S.xtDeck!==S.deck){ S.xtTopic=deckTopic(); S.xtDeck=S.deck; }
  const opts=xtTopicOpts(); if(!opts.some(([k])=>k===(S.xtTopic||'all'))) S.xtTopic='all';
  const hasMC=itemIndex().some(r=>r.type==='mc'); if(!hasMC&&(S.xtFmt||'mc')!=='sa') S.xtFmt='sa';
  const topic=S.xtTopic||'all', fmt=S.xtFmt||'mc';
  const pool=t=>itemIndex().filter(r=>r.type===t&&(topic==='all'||r.topic===topic));""")
rep("""  const what= fmt==='mc'? `${n} multiple-choice questions, the same style as Section I (20 questions, 1 mark each).` : fmt==='sa'? `${n} short-answer question${n===1?'':'s'} with a stimulus and parts, the same style as Section II. Written answers are marked against the official criteria.` : `10 multiple-choice questions and 1 short-answer question: a slice of Sections I and II.`;
  const box=el('div',{class:'panel'}, el('h2',{},'Exam-style test'),
    el('p',{},'Real questions from the HSC Business Studies exams (2015 to 2025) and Riverview Task 1, in the format you will see in the exam. Multiple choice marks itself. Short answers are marked against the official marking criteria, with the sample answer and what the markers said.'),
    testKindSeg(),
    el('div',{class:'row'}, el('span',{class:'small'},'Topic:'), seg(XTOPICS, topic, val=>{ S.xtTopic=val; S.xtDeck=S.deck; save(); render(); })),
    el('div',{class:'row'}, el('span',{class:'small'},'Format:'), seg([['mc','Multiple choice'],['sa','Short answer'],['mini','Mini exam']], fmt, val=>{ S.xtFmt=val; save(); render(); })),""",
    """  const what= isBiz()? (fmt==='mc'? `${n} multiple-choice questions, the same style as Section I (20 questions, 1 mark each).` : fmt==='sa'? `${n} short-answer question${n===1?'':'s'} with a stimulus and parts, the same style as Section II. Written answers are marked against the official criteria.` : `10 multiple-choice questions and 1 short-answer question: a slice of Sections I and II.`)
    : (fmt==='mc'? `${n} multiple-choice questions from past HSC papers, 1 mark each. They mark themselves.` : fmt==='sa'? `${n} written question${n===1?'':'s'} with parts, marked by AI against the official marking guidelines.` : `10 multiple-choice questions and 1 written question: a slice of a real paper.`);
  const yrs=PAPERS.map(p=>p.year).filter(Boolean); const yspan=yrs.length?` (${Math.min(...yrs)} to ${Math.max(...yrs)})`:'';
  const box=el('div',{class:'panel'}, el('h2',{},'Exam-style test'),
    el('p',{}, isBiz()?'Real questions from the HSC Business Studies exams (2015 to 2025) and Riverview Task 1, in the format you will see in the exam. Multiple choice marks itself. Short answers are marked against the official marking criteria, with the sample answer and what the markers said.':`Real questions from the NESA HSC ${SUBJ.name} exams${yspan}, by module or section. Multiple choice marks itself. Written answers are marked by AI against the official marking guidelines, or you can mark them yourself.`),
    testKindSeg(),
    el('div',{class:'row'}, el('span',{class:'small'},'Topic:'), seg(opts, topic, val=>{ S.xtTopic=val; S.xtDeck=S.deck; save(); render(); })),
    el('div',{class:'row'}, el('span',{class:'small'},'Format:'), seg(hasMC?[['mc','Multiple choice'],['sa',isBiz()?'Short answer':'Written'],['mini','Mini exam']]:[['sa','Written']], fmt, val=>{ S.xtFmt=val; save(); render(); })),""")
rep("el('p',{class:'small'}, `${mcPool.length} multiple choice and ${saPool.length} short-answer questions in ${TOPIC_NAME[topic].toLowerCase()==='all topics'?'all topics':TOPIC_NAME[topic]}.",
    "el('p',{class:'small'}, `${mcPool.length} multiple choice and ${saPool.length} ${isBiz()?'short-answer':'written'} questions in ${topic==='all'?'all topics':tName(topic)}.")
rep("el('p',{class:'small'},'Business reports and essays are under Past papers, with a timed run.'));",
    "el('p',{class:'small'}, isBiz()?'Business reports and essays are under Past papers, with a timed run.':'Whole papers, with the extended responses, are under Past papers.'));")

# ---------- Practice page: the two actions for every subject with typed papers ----------
rep("""    acts.append(action('Past papers', lastPaper?`Continue ${lastPaper.title}`:(SUBJ.np?`${SUBJ.np} HSC papers, typed answers marked by AI`:'HSC exams and marking guidelines to download'), ()=>goMode('papers'), 'primary'));
  }""",
    """    acts.append(action('Past papers', lastPaper?`Continue ${lastPaper.title}`:(SUBJ.np?`${SUBJ.np} HSC papers, typed answers marked by AI`:'HSC exams and marking guidelines to download'), ()=>goMode('papers'), 'primary'));
    if(SUBJ.papers){
      acts.append(action('Exam-style test', 'Real HSC questions by module, marked like the exam', ()=>{ S.testKind='exam'; XT=null; goMode('test'); }));
      acts.append(action('Find a question', 'Search every HSC question by words, module, year or verb', ()=>{ S.pp.paper=null; S.pp.item=null; goMode('papers'); }));
    }
  }""")

# ---------- Find a question for every subject ----------
rep("function qIndex(){ if(!isBiz()) return []; if(qIndex.cache) return qIndex.cache;",
    "function qIndex(){ if(!hasXT()) return []; if(qIndex.cache) return qIndex.cache;")
rep("const raw=(u.part&&u.part.topic)||it.topic||''; rows.push({p,s,it,part:u.part,max:u.max,text:String(text||'').replace(/\\s+/g,' ').slice(0,170),verb,topic:coarseTopic(raw,text),raw,type:it.type,year:p.year,src:p.src}); } } } return qIndex.cache=rows; }",
    "const raw=(u.part&&u.part.topic)||it.topic||''; rows.push({p,s,it,part:u.part,max:u.max,text:String(text||'').replace(/\\s+/g,' ').slice(0,170),verb,topic:isBiz()?coarseTopic(raw,text):xtTopicOf(it,s),raw,type:it.type,year:p.year,src:p.src}); } } } return qIndex.cache=rows; }")
rep("const qin=el('input',{type:'search',class:'qsel',placeholder:'Words in the question, e.g. cash flow',value:QF.q,'aria-label':'Search questions'});",
    "const topicOpts=isBiz()?[['all','Any topic'],['Operations','Operations'],['Marketing','Marketing'],['Finance','Finance'],['HR','Human resources'],['Other','Other']]:[['all','Any topic']].concat(xtTopicOpts().slice(1)); if(!topicOpts.some(([k])=>k===QF.topic)) QF.topic='all';\n  const qin=el('input',{type:'search',class:'qsel',placeholder:isBiz()?'Words in the question, e.g. cash flow':'Words in the question or its topic',value:QF.q,'aria-label':'Search questions'});")
rep("    sel([['all','Any topic'],['Operations','Operations'],['Marketing','Marketing'],['Finance','Finance'],['HR','Human resources'],['Other','Other']],QF.topic,v=>{QF.topic=v; re();}),",
    "    sel(topicOpts,QF.topic,v=>{QF.topic=v; re();}),")
rep("sel([['all','Any type'],['mc','Multiple choice'],['sa','Short answer'],['long','Report or essay']],QF.type,v=>{QF.type=v; re();}),",
    "sel([['all','Any type'],['mc','Multiple choice'],['sa',isBiz()?'Short answer':'Written, with parts'],['long',isBiz()?'Report or essay':'Extended response']],QF.type,v=>{QF.type=v; re();}),")
rep("Topics are from the NESA mapping grid where it exists, otherwise guessed from the wording.`));",
    "${isBiz()?'Topics are from the NESA mapping grid where it exists, otherwise guessed from the wording.':'Topics follow the module or section each question comes from.'}`));")
rep("${r.verb} · ${r.topic}${done", "${r.verb} · ${tName(r.topic)}${done")
rep("el('div',{}, r.text), el('div',{class:'row'}, el('button',{class:'ghost',onclick:()=>{ S.pp.paper=r.p.id;",
    "el('div',{}, r.text||'(The question is a picture. Open it to see it.)'), el('div',{class:'row'}, el('button',{class:'ghost',onclick:()=>{ S.pp.paper=r.p.id;")
rep("""  v.append(intro);
  const grid=(ps)=>{ const g=el('div',{class:'pgrid'}); for(const p of ps){ const st=paperStatus(p); g.append(el('button',{class:'pbtn'+(st.done===st.n?' done':st.done?' part':''),onclick:()=>openPaper(p.id)}, el('b',{},p.title.replace(""",
    """  v.append(intro);
  v.append(searchPanel());
  const grid=(ps)=>{ const g=el('div',{class:'pgrid'}); for(const p of ps){ const st=paperStatus(p); g.append(el('button',{class:'pbtn'+(st.done===st.n?' done':st.done?' part':''),onclick:()=>openPaper(p.id)}, el('b',{},p.title.replace(""")

path.write_text(s, encoding='utf-8')
print('phase E3 patch applied')
