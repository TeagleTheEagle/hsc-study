// Phase B checks (Playwright): drafts, save status, sync retry, conflict merge, expired session, offline,
// marking feedback layout, missed-question boost, feedback box. Serve the repo root on 8766 first.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:8766';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const stub = fs.readFileSync(new URL('./supabase_stub.js', import.meta.url), 'utf8');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// Start signed out: the stub only signs in when the test hands it a session.
await ctx.addInitScript(() => { window.__db = { progress: null, scores: [], feedback: [], writes: 0, fail: null, session: null }; });
const SESSION = { user: { id: 'u-test', email: 'test@example.com' }, access_token: 'tok' };
await ctx.route(/cdn\.jsdelivr\.net.*supabase/, r => r.fulfill({ contentType: 'application/javascript', body: stub }));
await ctx.route(/fonts\.googleapis\.com/, r => r.abort());
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const chip = () => page.$eval('#savestat', e => e.textContent);
const toasts = []; page.on('console', m => { if (m.text().startsWith('TOAST:')) toasts.push(m.text().slice(6)); });

await page.goto(BASE + '/app.html#papers/nesa2025'); await page.waitForSelector('#view .panel');
const spyToast = () => page.evaluate(() => { const o = toast; window.toast = (m, k) => { console.log('TOAST:' + m); return o(m, k); }; });
await spyToast();
ok((await chip()) === 'Saved on this device', 'signed out: chip says saved on this device');

// drafts while typing
const itemId = await page.evaluate(() => { const it = pItems(PBY.nesa2025).find(x => x.it.type === 'sa'); openItem(it.it.id); return it.it.id; });
await page.waitForSelector('.unit textarea');
await page.locator('.unit textarea').first().fill('Outsourcing passes production to a specialist.');
await page.waitForTimeout(1200);
const draft = await page.evaluate(() => Object.values(S.papers).map(r => r.a).find(Boolean));
ok(draft === 'Outsourcing passes production to a specialist.', 'draft saved while typing (no marking)');
ok((await page.$eval('.unit .wc', e => e.textContent)).includes('draft saved'), 'word-count line says draft saved');
await page.reload(); await page.waitForSelector('.unit textarea'); await spyToast();
ok((await page.locator('.unit textarea').first().inputValue()) === 'Outsourcing passes production to a specialist.', 'draft survives a reload');

// sign in through the stub and sync
await page.evaluate(async (s) => { window.__db.session = s; SB = window.supabase.createClient(); await startSync(window.__db.session); }, SESSION);
await page.waitForFunction(() => sync.state === 'synced');
ok((await chip()).startsWith('Synced'), 'signed in: chip says Synced');
const w0 = await page.evaluate(() => window.__db.writes);
await page.evaluate(() => recordReview(CARDS[0], true, 10));
await page.waitForFunction(w => window.__db.writes > w, w0, { timeout: 5000 });
ok(true, 'a change is pushed within a couple of seconds');
ok((await page.evaluate(() => window.__db.progress.doc.boost !== undefined)), 'progress doc carries boost');

// another device saved newer progress: it is merged, not overwritten
await page.evaluate(() => { const d = JSON.parse(JSON.stringify(window.__db.progress.doc)); d.xp = 5000; d.total = 999; d.p[CARDS[5].id] = 'k'; window.__db.progress = { user_id: 'u-test', doc: d, updated_at: new Date(Date.now() + 60000).toISOString() }; });
await page.evaluate(() => recordReview(CARDS[1], true, 10));
await page.waitForFunction(() => S.xp >= 5000, null, { timeout: 6000 });
ok((await page.evaluate(() => S.p[CARDS[5].id] === 'k' && S.p[CARDS[1].id] === 'k')), 'merge keeps both devices\' cards');
ok(toasts.some(t => /Merged newer progress/.test(t)), 'student is told about the merge');
ok((await page.evaluate(() => window.__db.progress.doc.xp >= 5000)), 'the written doc has the merged XP');

// a failing sync retries and keeps the chip honest
await page.evaluate(() => { window.__db.fail = '500'; recordReview(CARDS[2], true, 10); });
await page.waitForFunction(() => /Sync failed/.test(document.querySelector('#savestat').textContent), null, { timeout: 6000 });
ok(true, 'chip says sync failed, retrying');
const w1 = await page.evaluate(() => window.__db.writes);
await page.evaluate(() => { window.__db.fail = null; });
await page.waitForFunction(w => window.__db.writes > w, w1, { timeout: 8000 });
await page.waitForFunction(() => /^Synced/.test(document.querySelector('#savestat').textContent));
ok(true, 'retry succeeds after the outage and chip returns to Synced');

// expired session
await page.evaluate(() => { window.__db.fail = 'PGRST301'; recordReview(CARDS[3], true, 10); });
await page.waitForFunction(() => sync.state === 'expired', null, { timeout: 6000 });
ok((await page.$eval('#account', e => e.textContent)).includes('Sign in again'), 'expired session asks to sign in again, keeps local work');
ok((await page.evaluate(() => S.p[CARDS[3].id] === 'k')), 'local progress kept while expired');
await page.evaluate(() => { window.__db.fail = null; });

// offline
await ctx.setOffline(true); await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await page.evaluate(async () => { await startSync(window.__db.session); });
ok(/Offline/.test(await chip()), 'offline chip: ' + await chip());
await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForFunction(() => /^Synced/.test(document.querySelector('#savestat').textContent), null, { timeout: 6000 });
ok(true, 'back online: synced again');

// marking feedback layout (as the server now returns it)
await page.evaluate(id => { const p = PBY.nesa2025; const it = pItems(p).find(x => x.it.id === id).it; const part = it.parts && it.parts[0]; const max = part ? part.marks : it.marks;
  setRec(p, it, part, aiRec({ m: 1, band: '1', verdict: 'One factor only.', strengths: ['Names a factor'], improvements: ['Link it to the stimulus'], model: 'A full answer would…', evidence: ['passes production to a specialist'], missing: ['the effect on the business'], next: 'Add one sentence on the effect.', conf: 'low' }, max)); S.pp.item = id; render(); }, itemId);
const t = await page.$eval('.markbox', e => e.textContent);
ok(/Estimated mark/.test(t) && /Not a NESA result/.test(t), 'mark labelled as an estimate, not NESA');
ok(/Where you earned marks/.test(t) && /passes production/.test(t), 'evidence quotes shown');
ok(/Missing for the next criteria row/.test(t) && /Next action/.test(t), 'missing and next action shown');
ok(/Low confidence/.test(t), 'low-confidence notice shown');
ok(!!(await page.$('.markbox details summary:has-text("full-mark example")')), 'full-mark example is collapsed until a rewrite');

// a missed exam question feeds its topic into the next session
await page.evaluate(() => { S.boost = {}; const p = PBY.nesa2025; const it = pItems(p).find(x => x.it.type === 'sa').it; const part = it.parts[0]; awardXP(p, it, part, 0, part.marks, 'ai'); });
const boost = await page.evaluate(() => Object.keys(S.boost));
ok(boost.length === 1, 'missed question records its topic: ' + boost.join(','));
const steps = await page.evaluate(t => { const other = TOPIC_ORDER.find(x => x !== t); return buildSession(other).filter(s => /missed exam question/.test(s.why)).length; }, boost[0]);
ok(steps === 5, 'next session on another topic adds 5 cards from the missed topic (' + steps + ')');

// feedback box
await page.evaluate(() => goMode('stats')); await page.waitForSelector('.fbta');
await page.locator('.fbta').fill('The Match game timer kept going after I finished.');
await page.click('button:has-text("Send feedback")');
await page.waitForFunction(() => window.__db.feedback.length === 1);
ok((await page.evaluate(() => window.__db.feedback[0].text)).startsWith('The Match game'), 'feedback stored with text, page and subject');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ').slice(0, 300) : ''));
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
