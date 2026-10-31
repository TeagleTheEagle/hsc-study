// Builds tools/bench/business.json: a benchmark set for the AI marker (blueprint 9) from the Business papers.
// Each case = a question key from data/mark-bank.json, an answer, and the mark range a fair marker would give.
// Three automatic answer kinds per question: the official sample answer (should score at or near full marks),
// the sample answer from a DIFFERENT question (off topic, should score near 0), and a one-line stub (0 or 1,
// low confidence). Hand-written partial answers in tools/bench/handwritten.json are appended when present.
// Usage: node tools/make_bench.mjs
import fs from 'node:fs';
const html = fs.readFileSync('app.html', 'utf8');
const line = html.split('\n').find(l => l.startsWith('const BIZ_PAPERS = '));
const PAPERS = JSON.parse(line.slice('const BIZ_PAPERS = '.length).replace(/;\s*$/, ''));
const units = [];
for (const p of PAPERS) for (const s of p.sections) for (const it of s.items) {
  if (it.type === 'mc') continue;
  for (const part of (it.parts && it.parts.length ? it.parts : [null])) {
    const u = part || it; const max = part ? part.marks : it.marks;
    if (!u.sample || u.sample.length < 80 || max < 2 || max > 6) continue;   // short answers with an official sample
    units.push({ key: p.id + '|' + it.id + (part ? part.p : ''), paper: p.title, q: `Q${it.n}${part ? '(' + part.p + ')' : ''}`, max, sample: u.sample, text: (part && part.text) || it.text || '' });
  }
}
// spread across years and mark values: every 7th unit, at most 14 questions
const picked = units.filter((_, i) => i % 7 === 0).slice(0, 14);
const cases = [];
picked.forEach((u, i) => {
  const other = picked[(i + 3) % picked.length];
  cases.push({ key: u.key, label: `${u.paper} ${u.q} sample answer`, kind: 'sample', max: u.max, answer: u.sample, expect: [u.max - 1, u.max], confidence: ['high', 'medium'] });
  cases.push({ key: u.key, label: `${u.paper} ${u.q} off-topic (sample from ${other.q})`, kind: 'offtopic', max: u.max, answer: other.sample, expect: [0, Math.floor(u.max * 0.34)], confidence: null });
  cases.push({ key: u.key, label: `${u.paper} ${u.q} one-line stub`, kind: 'stub', max: u.max, answer: 'It helps the business a lot and is very important for success.', expect: [0, 1], confidence: ['low', 'medium'] });
});
if (fs.existsSync('tools/bench/handwritten.json')) cases.push(...JSON.parse(fs.readFileSync('tools/bench/handwritten.json', 'utf8')));
fs.writeFileSync('tools/bench/business.json', JSON.stringify(cases, null, 1));
console.log(`${cases.length} cases over ${picked.length} questions written to tools/bench/business.json`);
