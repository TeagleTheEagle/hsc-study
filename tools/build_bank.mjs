// Builds data/mark-bank.json for the /api/mark endpoint from the PAPERS data and the
// buildPrompt() function inside app.html, so the server sends exactly the prompt the app used to.
// Usage: node tools/build_bank.mjs [repo root, default: current folder]
import fs from 'fs'; import path from 'path';
const site=process.argv[2]||process.cwd();
const html=fs.readFileSync(path.join(site,'app.html'),'utf8');
const PFX=html.includes('\nconst BIZ_PAPERS = ')?'const BIZ_PAPERS = ':'const PAPERS = ';
const line=html.split('\n').find(l=>l.startsWith(PFX));
if(!line) throw new Error('PAPERS not found');
const PAPERS=JSON.parse(line.slice(PFX.length).replace(/;\s*$/,''));
const fnStart=html.indexOf('function buildPrompt(p,it,part,text){');
const fnEnd=html.indexOf('\nfunction normalise(', fnStart);
if(fnStart<0||fnEnd<0) throw new Error('buildPrompt not found');
const buildPrompt=new Function(html.slice(fnStart,fnEnd)+'\nreturn buildPrompt;')();
const MARK='\u0000ANSWER\u0000';
// Business goes in data/mark-bank.json; other subjects in data/mark-bank-<prefix>.json, where the
// prefix is the start of the paper id (en-adv-2025-p1 -> en). worker.js picks the file the same way.
const sets={'':PAPERS};
const sdir=path.join(site,'subjects');
for(const f of fs.readdirSync(sdir).filter(f=>f.endsWith('-papers.json'))){
  for(const p of JSON.parse(fs.readFileSync(path.join(sdir,f),'utf8'))){ const k=p.id.split('-')[0]; (sets[k]=sets[k]||[]).push(p); }
}
fs.mkdirSync(path.join(site,'data'),{recursive:true});
for(const [k,list] of Object.entries(sets)){
const bank={};
for(const p of list) for(const s of p.sections) for(const it of s.items){
  if(it.type==='mc') continue;
  const units=it.parts&&it.parts.length? it.parts : [null];
  for(const part of units){
    const full=buildPrompt(p,it,part,MARK); const i=full.indexOf(MARK);
    if(i<0||full.indexOf(MARK,i+1)>=0) throw new Error('placeholder problem '+p.id+' '+it.id);
    const e={max:part?part.marks:it.marks, pre:full.slice(0,i), post:full.slice(i+MARK.length)};
    // maths and sciences (p.pic): the question and guideline are pictures, and a one-line answer is a fair answer
    const imgs=[...(it.imgs||[]),...((part&&part.pimg)||[]),...((part&&part.mgimg)||[])].filter(x=>/\//.test(x));
    if(p.pic||/^maths/.test(p.subj||'')) e.min=1;
    if(imgs.length&&p.subj) e.imgs=imgs;  // sources (histories) or question + guideline pictures (maths, sciences)
    bank[p.id+'|'+it.id+(part?part.p:'')]=e;
  }
}
const fn=k?`mark-bank-${k}.json`:'mark-bank.json';
fs.writeFileSync(path.join(site,'data',fn), JSON.stringify(bank));
console.log(fn, 'entries', Object.keys(bank).length);
}
