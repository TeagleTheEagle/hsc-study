// Phase C checks (Playwright, fake Supabase, the Worker's billing routes stubbed): the plan line in the account strip,
// Upgrade to Plus only when billing is on, the Plus terms, the hop to checkout and back, Manage billing, Plus wording,
// and the plan_limit message. Serve the repo root on 8766 first.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:8766';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/cdn\.jsdelivr\.net.*supabase/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(new URL('./supabase_stub.js', import.meta.url), 'utf8') }));
await ctx.route(/fonts\.googleapis\.com/, r => r.abort());
const SESSION = { user: { id: 'u-test', email: 'b1@example.com', user_metadata: {} }, access_token: 'tok' };
await ctx.addInitScript(() => { window.__db = { progress: null, feedback: [], writes: 0, fail: null, session: null, scores: [] }; });
// the fake Worker
const resets = new Date(Date.now() + 20 * 864e5).toISOString();
const state = { billing: false, plan: 'free', left: 5, limit: 5, period: 'day', status: 'none', hasCustomer: false, cancelAtPeriodEnd: false, markCode: null, markFail: null };
const planBody = () => ({ billing: state.billing, price: 'A$9.99 a month', plusMonthly: 100, dailyFree: 5, signedIn: true, plan: state.plan, status: state.status, limit: state.limit, used: state.limit - state.left, left: state.left, period: state.period, resets: state.period === 'month' ? resets : new Date(Date.now() + 36e5).toISOString(), cancelAtPeriodEnd: state.cancelAtPeriodEnd, hasCustomer: state.hasCustomer, periodEnd: state.period === 'month' ? resets : null });
const calls = [];
await ctx.route(/\/api\//, r => {
  const u = new URL(r.request().url()); calls.push(u.pathname + u.search + ' ' + r.request().method());
  const J = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/plan') return J(200, planBody());
  if (u.pathname === '/api/quota') return J(200, { on: true, ...planBody() });
  if (u.pathname === '/api/billing/checkout') return state.billing ? J(200, { url: BASE + '/app.html?billing=success#home' }) : J(503, { code: 'billing_off' });
  if (u.pathname === '/api/billing/portal') return J(200, { url: BASE + '/app.html?portal=1#home' });
  if (u.pathname === '/api/mark' && state.markFail) return J(state.markFail.status, state.markFail.body);
  if (u.pathname === '/api/mark') return state.markCode ? J(429, { code: state.markCode, ...planBody(), left: 0 }) : J(200, { result: { mark: 2, band: '2', verdict: 'v', strengths: [], improvements: [], evidence: [], missing: [], next: 'n', confidence: 'high' }, ...planBody(), left: state.left - 1, used: state.limit - state.left + 1 });
  return J(404, { code: 'not_found' });
});
const page = await ctx.newPage(); const errors = []; const toasts = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { const t = m.text(); if (t.startsWith('TOAST:')) toasts.push(t.slice(6)); });
const spyToast = () => page.evaluate(() => { const o = toast; window.toast = (m, k, ms) => { console.log('TOAST:' + m); return o(m, k, ms); }; });
const signIn = async () => { await page.evaluate(async (S) => { window.__db.session = S; SB = window.supabase.createClient(); await startSync(window.__db.session); }, SESSION); await page.waitForFunction(() => sync.state === 'synced'); };
const strip = async () => (await page.$eval('#account', e => e.textContent)).replace(/\s+/g, ' ');

// ---- billing off: Free only, no upgrade ----
await page.goto(BASE + '/app.html#home'); await page.waitForSelector('#view .panel'); await spyToast(); await signIn();
await page.waitForSelector('#account .planline .pill');
let t = await strip();
ok(/Free/.test(t) && /5 AI marks a day/.test(t) && !/Upgrade/.test(t) && !/Plus/.test(t), 'billing off: Free plan shown, nothing about Plus: ' + t.slice(0, 120));
ok(calls.some(c => c === '/api/plan GET'), 'the plan was fetched once signed in');

// ---- billing on: the offer, the terms, the hop to Stripe and back ----
state.billing = true; await page.evaluate(() => loadPlan(true)); await page.waitForSelector('#account button:has-text("Upgrade to Plus")');
ok(true, 'billing on: Upgrade to Plus appears');
await page.click('#account button:has-text("Upgrade to Plus")'); await page.waitForSelector('#account .offer');
t = await page.$eval('#account .offer', e => e.textContent);
ok(/100 AI marks a month for A\$9\.99 a month/.test(t) && /do not roll over/.test(t) && /Cancel any time/.test(t) && /never sees your card/.test(t), 'the terms: price, allowance, no rollover, cancel, card never seen');
await page.click('#account .offer button:has-text("Not now")'); ok(!(await page.$('#account .offer')) && !!(await page.$('#account button:has-text("Upgrade to Plus")')), 'Not now closes the offer');
await page.click('#account button:has-text("Upgrade to Plus")'); await page.waitForSelector('#account .offer');
await Promise.all([page.waitForNavigation(), page.click('#account .offer button:has-text("Continue to secure checkout")')]);
ok(calls.some(c => c === '/api/billing/checkout POST'), 'checkout was requested from the Worker');
await page.waitForSelector('.toast'); const backToast = await page.$eval('.toast', e => e.textContent); await spyToast();
ok(/Thanks\. Plus switches on/.test(backToast), 'return toast explains the wait: ' + backToast.slice(0, 80));
ok(!/billing=/.test(await page.evaluate(() => location.href)), 'the billing= marker is removed from the address');
await signIn();
// the webhook has not landed yet: still free, then it lands
await page.waitForFunction(() => PLAN.loaded);
state.plan = 'plus'; state.limit = 100; state.left = 100; state.period = 'month'; state.status = 'active'; state.hasCustomer = true;
await page.waitForSelector('#account .planline .pill.on:has-text("Plus")', { timeout: 15000 });
t = await strip();
ok(/Plus/.test(t) && /100 of 100 AI marks left this period/.test(t) && /renews/.test(t) && /Manage billing/.test(t), 'after the webhook: Plus, 100 of 100, renews, Manage billing: ' + t.slice(0, 140));

// ---- Plus wording on marking ----
await page.evaluate(() => { S.pp.paper = null; S.pp.item = null; goMode('papers'); }); await page.waitForSelector('#aiNote');
await page.waitForFunction(() => /Plus AI marking is on/.test(document.querySelector('#aiNote').textContent));
ok(true, 'papers note says Plus AI marking is on with the monthly count');
await page.evaluate(() => { const it = pItems(PBY.nesa2025).find(x => x.it.type === 'sa'); S.pp.paper = 'nesa2025'; openItem(it.it.id); });
await page.waitForSelector('.unit textarea');
await page.evaluate(() => { const it = pItems(PBY.nesa2025).find(x => x.it.type === 'sa'); const p = PBY.nesa2025; const part = it.it.parts[0]; return markOnServer(p, it.it, part, 'A long enough answer about outsourcing and quality control for the marker.', part.marks, document.querySelector('.markbtn')); });
await page.waitForFunction(() => document.querySelector('.markbox'));
ok(toasts.some(x => /99 of 100 Plus AI marks left this period/.test(x)), 'Plus mark toast counts the period allowance');
state.markCode = 'plan_limit'; state.left = 0;
await page.evaluate(() => { const it = pItems(PBY.nesa2025).find(x => x.it.type === 'sa'); const p = PBY.nesa2025; const part = it.it.parts[1] || it.it.parts[0]; return markOnServer(p, it.it, part, 'Another long enough answer about outsourcing and quality control for the marker.', part.marks, document.querySelector('.markbtn')); });
await page.waitForFunction(() => document.querySelector('.selfmark'));
ok(toasts.some(x => /used this period’s 100 Plus AI marks|used this period's 100 Plus AI marks/.test(x) && /reset on/.test(x)), 'plan_limit: message names the period allowance and the reset date, then self-marking opens');

// ---- a failed mark says why ----
state.markCode = null; state.markFail = { status: 502, body: { code: 'upstream', status: 400, message: 'Your credit balance is too low to access the Anthropic API.' } }; toasts.length = 0;
await page.evaluate(() => { const it = pItems(PBY.nesa2025).find(x => x.it.type === 'sa'); const p = PBY.nesa2025; const part = it.it.parts[1] || it.it.parts[0]; return markOnServer(p, it.it, part, 'A third long enough answer about outsourcing and quality control for the marker.', part.marks, document.querySelector('.markbtn')); });
await page.waitForFunction(() => document.querySelector('.selfmark'));
ok(toasts.some(x => /did not come back cleanly \(upstream 400: Your credit balance is too low/.test(x)), 'a failed mark names the Worker code, status and message, then self-marking opens: ' + (toasts.find(x => /cleanly/.test(x)) || '').slice(0, 120));
state.markFail = null;

// ---- cancelled but paid, back from the portal, past due, Manage billing ----
state.cancelAtPeriodEnd = true; await page.evaluate(() => loadPlan(true)); await page.waitForFunction(() => /ends/.test(document.querySelector('#account').textContent));
ok(true, 'cancel at period end shows "ends <date>"');
toasts.length = 0; await page.evaluate(() => { history.replaceState(null, '', '/app.html?billing=portal#home'); billingReturn(); });
await page.waitForFunction(() => document.querySelector('.toast') && /Plus ends on/.test(document.querySelector('.toast').textContent));
ok(calls.some(c => c === '/api/plan?refresh=1 GET') && !/billing=/.test(await page.evaluate(() => location.href)), 'back from the portal: the plan is re-read from Stripe (refresh=1), the toast says when Plus ends, the marker is removed');
state.status = 'past_due'; await page.evaluate(() => loadPlan(true)); await page.waitForFunction(() => /payment failed/.test(document.querySelector('#account').textContent));
ok(true, 'past due: asks for a card update');
await Promise.all([page.waitForNavigation(), page.click('#account button:has-text("Manage billing")')]);
ok(/portal=1/.test(await page.evaluate(() => location.href)) && calls.some(c => c === '/api/billing/portal POST'), 'Manage billing opens the Stripe portal');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ').slice(0, 400) : ''));
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
