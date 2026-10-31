#!/usr/bin/env python3
"""Bands for Days phase E1 (blueprint 8 'add reporting', 10, 19 E): the Marks report.
A Progress view with marks by topic and by paper, every rewrite compared attempt by attempt, a four-week trend,
and a copy-as-text export. Usage: python3 tools/phase_e1_patch.py app.html. Refuses to run twice."""
import sys, pathlib
path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'app.html')
s = path.read_text(encoding='utf-8')
if 'phase E1: marks report' in s:
    sys.exit('phase E1 patch already applied')

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f'anchor found {n} times, expected {count}: {old[:90]!r}'
    s = s.replace(old, new)

# ---------- routing: #report lives under Progress ----------
rep("stats:'progress',mistakes:'progress'};", "stats:'progress',mistakes:'progress',report:'progress'};")
rep("stats:'#stats',mistakes:'#mistakes'};", "stats:'#stats',mistakes:'#mistakes',report:'#report'};")
rep("today:renderToday, mistakes:renderMistakes, diag:renderDiag})[S.mode]();", "today:renderToday, mistakes:renderMistakes, diag:renderDiag, report:renderReport})[S.mode]();")

# ---------- every mark gets a time, and rewrites keep it per attempt ----------
rep("function awardXP(p,it,part,m,max,how){ const ok=m/max>=0.5;",
    "function awardXP(p,it,part,m,max,how){ { const rr=S.papers[rkey(p,it,part)]; if(rr) rr.mt=Date.now(); } const ok=m/max>=0.5;")
rep("const prev=(r.prev||[]).concat([{m:r.m, how:r.how, a:String(r.a||'').slice(0,4000), imp:(r.r&&r.r.improvements)||[]}]).slice(-3);",
    "const prev=(r.prev||[]).concat([{m:r.m, how:r.how, a:String(r.a||'').slice(0,4000), imp:(r.r&&r.r.improvements)||[], t:r.mt||r.t||Date.now()}]).slice(-3);")

# ---------- entry points ----------
rep("el('button',{class:'ghost',onclick:()=>goMode('stats')},'Full stats, badges and leaderboard →')",
    "el('button',{class:'ghost',onclick:()=>goMode('report')},'Marks report →'), el('button',{class:'ghost',onclick:()=>goMode('stats')},'Full stats, badges and leaderboard →')", count=2)
rep("v.append(el('div',{class:'row'}, el('button',{class:'primary',onclick:()=>goMode('mistakes')}, `Mistake notebook (${mN})`), el('button',{onclick:()=>{ TS=null; goMode('today'); }},'Today’s session'))); }",
    "v.append(el('div',{class:'row'}, el('button',{class:'primary',onclick:()=>goMode('mistakes')}, `Mistake notebook (${mN})`), el('button',{onclick:()=>goMode('report')},'Marks report'), el('button',{onclick:()=>{ TS=null; goMode('today'); }},'Today’s session'))); }")

# ---------- CSS ----------
rep(".savestat{font-size:.85rem;", """.rep table{width:100%;border-collapse:collapse;font-size:.95rem;margin-top:.4rem} .rep th{text-align:left;font-size:.8rem;color:var(--muted);font-weight:700;padding:.2rem .4rem} .rep td{padding:.4rem .4rem;border-top:1.5px solid var(--border);vertical-align:top} .rep td.num,.rep th.num{text-align:right;white-space:nowrap} .rep .na{color:var(--muted);font-style:italic}
.rep .gain{color:var(--good-deep);font-weight:700} .rep .loss{color:var(--warn);font-weight:700} .rep .steps{font-variant-numeric:tabular-nums;white-space:nowrap}
.trend{display:grid;gap:.45rem;margin-top:.4rem} .trend .wk{display:grid;grid-template-columns:7.5rem 1fr 7rem;gap:.6rem;align-items:center} .tbar{height:12px;background:var(--surface-2);border-radius:6px;overflow:hidden} .tbar span{display:block;height:100%;background:var(--accent)} .tbar span.cards{background:var(--good)}
.rep .openq{min-height:36px;padding:.2rem .7rem;font-size:.9rem}
.savestat{font-size:.85rem;""")

# ---------- the report ----------
rep("function renderStats(){", r"""// ---------- phase E1: marks report ----------
function dayOfMs(ms){ const y=new Date(ms); return y.getFullYear()+'-'+String(y.getMonth()+1).padStart(2,'0')+'-'+String(y.getDate()).padStart(2,'0'); }
function unitTopic(p,it,part){ if(isBiz()){ const t=(part&&part.topic&&coarseTopic(part.topic,part.text))||((itemRow(p.id,it.id)||{}).topic)||'Other'; return t; } return (part&&part.topic)||it.topic||'General'; }
function attemptsOf(r){ const out=(r.prev||[]).map(x=>({m:x.m,t:x.t||null})); if(typeof r.m==='number') out.push({m:r.m,t:r.mt||r.t||null}); return out.filter(x=>typeof x.m==='number'); }
function reportRows(){
  const rows=[];
  for(const p of PAPERS){ for(const {s,it} of pItems(p)){ for(const u of itemUnits(it)){ const r=rec(p,it,u.part); if(!r) continue; const at=attemptsOf(r); if(!at.length) continue;
    rows.push({p, it, part:u.part, max:u.max, topic:unitTopic(p,it,u.part), at, first:at[0].m, last:at[at.length-1].m, best:Math.max(...at.map(x=>x.m)), t:at[at.length-1].t||0, label:`${p.title} · Q${it.n}${u.part&&u.part.p?'('+u.part.p+')':''}`}); } } }
  return rows;
}
function pctOf(got,max){ return max?Math.round(100*got/max):null; }
function reportTopics(rows){
  const names=isBiz()?TOPIC_ORDER.concat(['Other']):[...new Set(rows.map(r=>r.topic))].sort();
  return names.map(t=>{ const rs=rows.filter(r=>r.topic===t); const max=rs.reduce((a,r)=>a+r.max,0); return {t, name:isBiz()?(TOPIC_NAME[t]||t):t, n:rs.length, max, last:rs.reduce((a,r)=>a+r.last,0), first:rs.reduce((a,r)=>a+r.first,0), rewrites:rs.filter(r=>r.at.length>1).length}; }).filter(x=>x.n||isBiz()).sort((a,b)=>(a.n?pctOf(a.last,a.max):101)-(b.n?pctOf(b.last,b.max):101));
}
function reportPapers(rows){
  return PAPERS.map(p=>{ const rs=rows.filter(r=>r.p===p); const total=pItems(p).reduce((a,x)=>a+itemUnits(x.it).length,0); return {p, n:rs.length, total, max:rs.reduce((a,r)=>a+r.max,0), last:rs.reduce((a,r)=>a+r.last,0)}; }).filter(x=>x.n);
}
function reportWeeks(rows){
  const t=today(); const out=[];
  for(let i=3;i>=0;i--){ const end=dueDay(t,-7*i), start=dueDay(t,-7*i-6); const inWk=d=>d>=start&&d<=end;
    let cards=0; for(const [d,n] of Object.entries(S.days||{})) if(inWk(d)) cards+=n;
    let n=0, r=0; for(const x of S.sess||[]){ if(inWk(dayOfMs(x.a))){ n+=x.n; r+=x.r; } }
    let got=0, max=0, marks=0; for(const row of rows) for(const a of row.at){ if(a.t&&inWk(dayOfMs(a.t))){ got+=a.m; max+=row.max; marks++; } }
    out.push({start, end, cards, acc:n?Math.round(100*r/n):null, marks, pct:max?Math.round(100*got/max):null}); }
  return out;
}
function fmtShort(d){ const x=new Date(d+'T00:00:00'); return x.toLocaleDateString('en-AU',{day:'numeric',month:'short'}); }
function reportText(){
  const rows=reportRows(); const L=[]; L.push(`Bands for Days marks report · ${SUBJ.name} · ${fmtShort(today())}`);
  const got=rows.reduce((a,r)=>a+r.last,0), max=rows.reduce((a,r)=>a+r.max,0);
  L.push(rows.length?`${rows.length} answers marked · ${got}/${max} marks (${pctOf(got,max)}%) on the latest attempt`:'No typed answers marked yet.');
  if(rows.length){ L.push('', 'By topic (weakest first)'); for(const x of reportTopics(rows)) L.push(x.n?`  ${x.name}: ${x.last}/${x.max} (${pctOf(x.last,x.max)}%)${x.rewrites?`, first attempts ${pctOf(x.first,x.max)}%`:''}`:`  ${x.name}: Not assessed`);
    L.push('', 'By paper'); for(const x of reportPapers(rows)) L.push(`  ${x.p.title}: ${x.n}/${x.total} answered · ${x.last}/${x.max} (${pctOf(x.last,x.max)}%)`);
    const rw=rows.filter(r=>r.at.length>1); if(rw.length){ L.push('', 'Rewrites'); for(const r of rw) L.push(`  ${r.label}: ${r.at.map(a=>a.m).join(' → ')} / ${r.max}`); } }
  L.push('', 'Last four weeks'); for(const w of reportWeeks(rows)) L.push(`  ${fmtShort(w.start)} to ${fmtShort(w.end)}: ${w.cards} cards${w.acc!=null?` (${w.acc}% right)`:''}${w.marks?`, ${w.marks} marked answers at ${w.pct}%`:''}`);
  L.push('', 'AI marks are estimates against the official criteria, not NESA results.');
  return L.join('\n');
}
function renderReport(){
  const v=$('#view'); v.innerHTML=''; v.classList.add('rep');
  const rows=reportRows(); const got=rows.reduce((a,r)=>a+r.last,0), max=rows.reduce((a,r)=>a+r.max,0);
  const rw=rows.filter(r=>r.at.length>1); const gain=rw.reduce((a,r)=>a+(r.last-r.first),0);
  const head=el('div',{class:'panel hero'}, el('div',{class:'lab'},SUBJ.name), el('h2',{},'Marks report'),
    el('p',{class:'small'}, rows.length?`${rows.length} typed answers marked · ${got}/${max} marks (${pctOf(got,max)}%) on your latest attempts${rw.length?` · ${rw.length} rewritten, ${gain>=0?'+':''}${gain} marks gained`:''}.`:hasExams()?'Nothing marked yet. Mark a typed answer under Practice > Past papers and it shows up here.':'This subject has no typed papers yet, so this report only shows your card work.'));
  const copyBtn=el('button',{class:'ghost',onclick:async()=>{ const t=reportText(); try{ await navigator.clipboard.writeText(t); toast('Report copied. Paste it to a teacher or parent.'); }catch(e){ const ta=el('textarea',{'aria-label':'Report text'}); ta.value=t; head.append(ta); ta.select(); toast('Select the text below and copy it.'); } }},'Copy as text');
  head.append(el('div',{class:'row'}, copyBtn, el('button',{class:'ghost',onclick:()=>goMode('stats')},'Stats and badges')));
  v.append(head);
  if(rows.length){
    const tp=el('div',{class:'panel'}, el('h2',{},'By topic'), el('p',{class:'small'},'Weakest first. The first-attempt column shows where rewrites are paying off.'));
    const tb=el('table',{}, el('thead',{}, el('tr',{}, el('th',{},'Topic'), el('th',{class:'num'},'Answers'), el('th',{class:'num'},'First attempts'), el('th',{class:'num'},'Latest'))), el('tbody',{}));
    for(const x of reportTopics(rows)){ tb.lastChild.append(el('tr',{}, el('td',{},x.name), el('td',{class:'num'}, x.n?String(x.n):'·'), el('td',{class:'num'}, x.n?`${pctOf(x.first,x.max)}%`:'·'), x.n?el('td',{class:'num'}, `${x.last}/${x.max} · ${pctOf(x.last,x.max)}%`):el('td',{class:'num na'},'Not assessed'))); }
    tp.append(tb); v.append(tp);
    const pp=el('div',{class:'panel'}, el('h2',{},'By paper'));
    const pb=el('table',{}, el('thead',{}, el('tr',{}, el('th',{},'Paper'), el('th',{class:'num'},'Answered'), el('th',{class:'num'},'Marks'), el('th',{}))), el('tbody',{}));
    for(const x of reportPapers(rows)) pb.lastChild.append(el('tr',{}, el('td',{}, x.p.title), el('td',{class:'num'}, `${x.n}/${x.total}`), el('td',{class:'num'}, `${x.last}/${x.max} · ${pctOf(x.last,x.max)}%`), el('td',{}, el('button',{class:'ghost openq',onclick:()=>{ S.pp.paper=x.p.id; S.pp.item=null; goMode('papers'); }},'Open'))));
    pp.append(pb); v.append(pp);
    const rp=el('div',{class:'panel'}, el('h2',{},'Rewrites, attempt by attempt'), el('p',{class:'small'}, rw.length?`Average gain per rewritten answer: ${rw.length?(gain/rw.length>=0?'+':'')+(gain/rw.length).toFixed(1):'0'} marks.`:'No rewrites yet. After a mark, "Rewrite it for more marks" keeps every attempt so you can see the climb here.'));
    if(rw.length){ const rb=el('table',{}, el('thead',{}, el('tr',{}, el('th',{},'Question'), el('th',{class:'num'},'Attempts'), el('th',{class:'num'},'Change'), el('th',{}))), el('tbody',{}));
      for(const r of rw.sort((a,b)=>b.t-a.t)){ const d=r.last-r.first; rb.lastChild.append(el('tr',{}, el('td',{}, r.label, el('div',{class:'small'}, r.t?fmtShort(dayOfMs(r.t)):'')), el('td',{class:'num steps'}, r.at.map(a=>a.m).join(' → ')+' / '+r.max), el('td',{class:'num '+(d>0?'gain':d<0?'loss':'')}, (d>0?'+':'')+d), el('td',{}, el('button',{class:'ghost openq',onclick:()=>{ S.pp.paper=r.p.id; S.mode='papers'; save(); openItem(r.it.id); }},'Open')))); }
      rp.append(rb); }
    v.append(rp);
  }
  const wk=reportWeeks(rows); const maxCards=Math.max(1,...wk.map(w=>w.cards));
  const tr=el('div',{class:'panel'}, el('h2',{},'Last four weeks'), el('p',{class:'small'},'Cards answered each week with how many you got right, and the marks on typed answers marked that week.'));
  const tl=el('div',{class:'trend'});
  for(const w of wk){ tl.append(el('div',{class:'wk'}, el('span',{class:'small'}, fmtShort(w.start)+' – '+fmtShort(w.end)), el('div',{class:'tbar',title:`${w.cards} cards`}, el('span',{class:'cards',style:`width:${Math.round(100*w.cards/maxCards)}%`})), el('span',{class:'small'}, w.cards?`${w.cards} cards${w.acc!=null?' · '+w.acc+'%':''}`:'No cards'))); 
    tl.append(el('div',{class:'wk'}, el('span',{}), el('div',{class:'tbar',title:w.marks?`${w.marks} marked answers`:'No marked answers'}, el('span',{style:`width:${w.pct!=null?w.pct:0}%`})), el('span',{class:'small'}, w.marks?`${w.marks} marked · ${w.pct}%`:'No marks'))); }
  tr.append(tl); v.append(tr);
  v.append(el('p',{class:'small'},'AI marks are estimates against the official criteria, not NESA results. Nothing is shown as a band prediction.'));
}
function renderStats(){""")
# the report view adds a class to #view; every other view must clear it
rep("function render(){ if(!isBiz()", "function render(){ { const vv=$('#view'); if(vv&&S.mode!=='report') vv.classList.remove('rep'); } if(!isBiz()")

path.write_text(s, encoding='utf-8')
print('phase E1 patch applied')
