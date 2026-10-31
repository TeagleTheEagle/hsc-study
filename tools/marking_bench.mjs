#!/usr/bin/env node
// Runs the marking benchmark (blueprint 9): sends each case in tools/bench/business.json through the same
// prompt the site uses (data/mark-bank.json) and reports agreement with the expected mark range.
// Run it on your own PC with your key in the environment; the key is never written anywhere:
//   set ANTHROPIC_API_KEY=sk-ant-...     (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-...")
//   node tools/marking_bench.mjs [--limit 12] [--model claude-opus-5-5]
// Cost: about 2 to 5 cents a case. Writes tools/bench/last-run.json (no key in it).
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LIMIT = Number(opt('--limit', 0)) || Infinity, MODEL = opt('--model', 'claude-opus-5-5');
if (!process.env.ANTHROPIC_API_KEY) { console.error('Set ANTHROPIC_API_KEY first.'); process.exit(1); }
const bank = JSON.parse(fs.readFileSync('data/mark-bank.json', 'utf8'));
const cases = JSON.parse(fs.readFileSync('tools/bench/business.json', 'utf8')).slice(0, LIMIT);
const client = new Anthropic({ timeout: 90000, maxRetries: 1 });
const SCHEMA = { type: 'object', properties: { mark: { type: 'integer' }, band: { type: 'string' }, verdict: { type: 'string' }, strengths: { type: 'array', items: { type: 'string' } }, improvements: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'string' } }, missing: { type: 'array', items: { type: 'string' } }, next: { type: 'string' }, confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, model: { type: 'string' } }, required: ['mark', 'band', 'verdict', 'strengths', 'improvements', 'evidence', 'missing', 'next', 'confidence', 'model'], additionalProperties: false };

const out = []; let agree = 0, absErr = 0, confOk = 0, confN = 0, inTok = 0, outTok = 0;
for (const c of cases) {
  const e = bank[c.key]; if (!e) { console.log('skip (not in bank):', c.key); continue; }
  const t0 = Date.now(); let r;
  try {
    const res = await client.beta.messages.create({ model: MODEL, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } }, messages: [{ role: 'user', content: e.pre + c.answer + e.post }] });
    const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    r = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); inTok += res.usage.input_tokens; outTok += res.usage.output_tokens;
  } catch (err) { console.log('ERROR', c.label, err.message); out.push({ ...c, error: String(err.message) }); continue; }
  const ok = r.mark >= c.expect[0] && r.mark <= c.expect[1]; if (ok) agree++; absErr += Math.min(Math.abs(r.mark - c.expect[0]), Math.abs(r.mark - c.expect[1])) * (ok ? 0 : 1);
  if (c.confidence) { confN++; if (c.confidence.includes(r.confidence)) confOk++; }
  const evidOk = c.kind === 'stub' || c.kind === 'offtopic' ? true : (r.evidence || []).every(q => c.answer.toLowerCase().includes(String(q).toLowerCase().replace(/[“”"]/g, '').slice(0, 40)));
  console.log(`${ok ? 'ok  ' : 'MISS'} ${String(r.mark).padStart(2)}/${c.max} expected ${c.expect.join('-')} conf ${r.confidence}${evidOk ? '' : ' (evidence not verbatim)'}  ${c.label}`);
  out.push({ ...c, got: r.mark, band: r.band, confidence: r.confidence, verdict: r.verdict, evidence: r.evidence, missing: r.missing, next: r.next, evidenceVerbatim: evidOk, ms: Date.now() - t0 });
}
const n = out.filter(x => !x.error).length;
const summary = { cases: n, agreement: n ? +(agree / n).toFixed(2) : 0, meanMissDistance: n ? +(absErr / n).toFixed(2) : 0, confidenceAgreement: confN ? +(confOk / confN).toFixed(2) : null, tokens: { in: inTok, out: outTok }, model: MODEL, when: new Date().toISOString() };
fs.writeFileSync('tools/bench/last-run.json', JSON.stringify({ summary, results: out }, null, 1));
console.log('\nSummary', JSON.stringify(summary));
console.log('Release rule (blueprint 9): review every MISS before shipping a prompt or model change; agreement under 0.85 or any sample answer under full marks minus 1 blocks the change.');
