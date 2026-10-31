import worker from './worker.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const kv = new Map(); const MARKS = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); } };
const bank = { 'nesa2025|21': { max: 4, pre: 'PRE ', post: ' POST' } };   // the old whole-subject bank (fallback only)
const small = { 'ma-2025|11a': { max: 2, min: 1, pre: 'PRE ', post: ' POST', imgs: ['papers/img/maths-adv/2025-q11a.png', 'papers/img/maths-adv/2025-mg11a.png'] } };   // data/mark/<key>.json
const served = [];
const ASSETS = { async fetch(u) { const str = String(u); served.push(new URL(str).pathname); const m = /\/data\/mark\/([^/]+)\.json$/.exec(str);
  if (m) { const k = decodeURIComponent(m[1]).replace(/__/g, '|'); return small[k] ? new Response(JSON.stringify(small[k]), { status: 200 }) : new Response('', { status: 404 }); }
  if (/\.png$/.test(str)) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
  return new Response(JSON.stringify(bank), { status: str.includes('mark-bank.json') ? 200 : 404 }); } };
const env = { ANTHROPIC_API_KEY: 'x', SUPA_URL: 'https://supa.test', SUPA_KEY: 'k', DAILY_LIMIT: '5', GLOBAL_DAILY_CAP: '300', MARKS, ASSETS };
globalThis.fetch = async (url, init) => { if (String(url).includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }); return new Response('{}', { status: 404 }); };
let calls = 0, mode = 'ok', lastReq = null;
globalThis.__claude = async req => { calls++; lastReq = req; if (mode === 'fail') { const { default: A } = await import('@anthropic-ai/sdk'); throw new A.APIError(500, 'down'); }
  if (mode === 'bad' && req.betas) { const { default: A } = await import('@anthropic-ai/sdk'); throw new A.BadRequestError(400, 'no such option'); }
  return { stop_reason: 'end_turn', model: 'claude-test', usage: { input_tokens: 1200, output_tokens: 300 }, content: [{ type: 'text', text: JSON.stringify({ mark: 3, band: '3', verdict: 'v', strengths: [], improvements: [], evidence: ['q'], missing: [], next: 'n', confidence: 'high', model: 'm' }) }] }; };
const post = (body, tok = 'tok') => worker.fetch(new Request('https://bandsfordays.com/api/mark', { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) }), env);
const answer = 'Outsourcing passes production to a specialist which lowers costs but reduces control over quality.';
let r = await post({ key: 'nesa2025|21', answer }); let d = await r.json();
ok(r.status === 200 && d.result.mark === 3 && d.left === 4 && d.result.next === 'n' && d.result.confidence === 'high', 'first mark: 200, left 4, new fields pass through');
ok(served.includes('/data/mark/nesa2025__21.json') && served.includes('/data/mark-bank.json'), 'the small per-question file is tried first, then the old bank as a fallback');
r = await post({ key: 'nesa2025|21', answer }); d = await r.json();
ok(r.status === 200 && d.repeated === true && d.left === 4 && calls === 1, 'same answer again: cached, not counted, no second model call');
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
ok(kv.get('u:user-1:' + day) === '1', 'per-user counter is 1');
const tot = JSON.parse(kv.get('t:' + day)); ok(tot.n === 1 && tot.in === 1200 && tot.out === 300, 'ledger daily total records tokens');
ok([...kv.keys()].some(k => k.startsWith('l:' + day + ':')), 'ledger has a per-mark record');
mode = 'fail'; r = await post({ key: 'nesa2025|21', answer: answer + ' Second attempt.' }); d = await r.json();
ok(r.status === 502 && d.code === 'upstream' && d.status === 500 && d.message === 'down' && kv.get('u:user-1:' + day) === '1', 'failed job: 502 with the status and message, and the allowance is not consumed');
mode = 'ok'; r = await post({ key: 'nesa2025|21', answer: 'too short' }); d = await r.json(); ok(r.status === 400 && d.code === 'too_short', 'too short rejected');
r = await post({ key: 'nope|1', answer }); ok(r.status === 404, 'unknown question 404');
r = await post({ key: 'nesa2025|21', answer }, ''); ok(r.status === 401, 'no token 401');
// a Maths question from its own small file: the pictures go by URL (no base64 work in the Worker)
served.length = 0; r = await post({ key: 'ma-2025|11a', answer: 'x = 4 because 2x = 8' }); d = await r.json();
let blocks = Array.isArray(lastReq.messages[0].content) ? lastReq.messages[0].content : [];
ok(r.status === 200 && d.left === 3 && served.includes('/data/mark/ma-2025__11a.json') && !served.some(x => x.includes('mark-bank-ma')) && !served.some(x => x.endsWith('.png')), 'a question with its own small file: no bank, no picture bytes fetched');
ok(blocks.length === 3 && blocks[0].type === 'image' && blocks[0].source.type === 'url' && blocks[0].source.url === 'https://bandsfordays.com/papers/img/maths-adv/2025-q11a.png' && blocks[1].source.url.endsWith('2025-mg11a.png') && blocks[2].type === 'text' && /^PRE x = 4/.test(blocks[2].text), 'pictures are sent as URLs, then the prompt text');
// a 400 on the structured request: retried plain, with the pictures inlined as base64
mode = 'bad'; r = await post({ key: 'ma-2025|11a', answer: 'x = 4 because 2x = 8 (again)' }); d = await r.json();
blocks = Array.isArray(lastReq.messages[0].content) ? lastReq.messages[0].content : [];
ok(r.status === 200 && !lastReq.betas && blocks[0].source.type === 'base64' && blocks[0].source.media_type === 'image/png' && served.filter(x => x.endsWith('.png')).length === 2, 'bad request: retried once without the extras, pictures inlined');
mode = 'ok';
// a photo of working: only the header is checked, the data is passed through; a failed job still does not count
const png = 'data:image/png;base64,' + 'A'.repeat(200);
mode = 'fail'; r = await post({ key: 'ma-2025|11a', answer: 'see photo', photo: png }); d = await r.json();
blocks = Array.isArray(lastReq.messages[0].content) ? lastReq.messages[0].content : [];
ok(r.status === 502 && blocks.length === 4 && blocks[2].source.type === 'base64' && blocks[2].source.data === 'A'.repeat(200), 'photo appended after the question pictures');
r = await post({ key: 'ma-2025|11a', answer: 'see photo', photo: 'data:text/plain;base64,' + 'A'.repeat(200) }); d = await r.json(); ok(r.status === 400 && d.code === 'bad_photo', 'a non-image photo is refused');
mode = 'ok';
for (let i = 0; i < 3; i++) { r = await post({ key: 'nesa2025|21', answer: answer + ' variant ' + i }); }
r = await post({ key: 'nesa2025|21', answer: answer + ' one more' }); d = await r.json();
ok(r.status === 429 && d.code === 'daily_limit', 'sixth distinct answer today hits the 5-a-day limit');
r = await worker.fetch(new Request('https://bandsfordays.com/api/quota', { headers: { authorization: 'Bearer tok' } }), env); d = await r.json();
ok(d.on === true && d.limit === 5 && d.left === 0, 'quota reports 0 left');
console.log(fails ? `${fails} check(s) failed` : 'worker checks passed'); process.exit(fails ? 1 : 0);
