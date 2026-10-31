// Native-app checks (Playwright, fake Supabase, the Worker stubbed, window.Capacitor faked): inside the App Store shell
// nothing sells Plus (Apple rule 3.1.1), the install card never shows, Delete account is offered and calls the Worker
// then the Supabase function, and PDFs / other sites open through the Browser plugin. Serve the repo root on 8766 first.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:8766';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
await ctx.route(/cdn\.jsdelivr\.net.*supabase/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(new URL('./supabase_stub.js', import.meta.url), 'utf8') }));
await ctx.route(/fonts\.googleapis\.com/, r => r.abort());
const SESSION = { user: { id: 'u-test', email: 'b1@example.com', user_metadata: {} }, access_token: 'tok' };
await ctx.addInitScript(() => {
  window.__db = { progress: null, feedback: [], writes: 0, fail: null, session: null, scores: [] };
  window.__opened = []; window.__rpc = [];
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: { Browser: { open: async o => { window.__opened.push(o.url); } } } };
});
const state = { plan: 'free', status: 'none', hasCustomer: false };
const planBody = () => ({ billing: true, price: 'A$9.99 a month', plusMonthly: 100, dailyFree: 5, signedIn: true, plan: state.plan, status: state.status, limit: state.plan === 'plus' ? 100 : 5, used: 0, left: state.plan === 'plus' ? 100 : 5, period: state.plan === 'plus' ? 'month' : 'day', resets: new Date(Date.now() + 20 * 864e5).toISOString(), cancelAtPeriodEnd: false, hasCustomer: state.hasCustomer });
const calls = [];
await ctx.route(/\/api\//, r => {
  const u = new URL(r.request().url()); calls.push(u.pathname + ' ' + r.request().method());
  const J = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.pathname === '/api/plan') return J(200, planBody());
  if (u.pathname === '/api/quota') return J(200, { on: true, ...planBody() });
  if (u.pathname === '/api/account/delete') return J(200, { ok: true, cancelled: state.plan === 'plus' });
  return J(404, { code: 'not_found' });
});
const page = await ctx.newPage(); const errors = []; const toasts = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { const t = m.text(); if (t.startsWith('TOAST:')) toasts.push(t.slice(6)); });
page.on('dialog', d => d.accept());
const spyToast = () => page.evaluate(() => { const o = toast; window.toast = (m, k) => { console.log('TOAST:' + m); return o(m, k); }; });
const signIn = async () => { await page.evaluate(async (S) => { window.__db.session = S; SB = window.supabase.createClient(); SB.rpc = async name => { window.__rpc.push(name); return { data: null, error: null }; }; await startSync(window.__db.session); }, SESSION); await page.waitForFunction(() => sync.state === 'synced'); };
const strip = async () => (await page.$eval('#account', e => e.textContent)).replace(/\s+/g, ' ');

await page.goto(BASE + '/app.html#home'); await page.waitForSelector('#view .panel'); await spyToast();
ok(await page.evaluate(() => NATIVE === true && document.documentElement.classList.contains('native')), 'NATIVE detected from window.Capacitor');
ok(!(await page.$('.panel.install')), 'no install card on Today in the app');
await signIn(); await page.waitForSelector('#account .planline .pill');
let t = await strip();
ok(/Free/.test(t) && /5 AI marks a day/.test(t) && !/Upgrade|checkout|Plus/.test(t), 'free account, billing on: nothing about Plus or upgrading: ' + t.slice(0, 160));
ok(/Delete account/.test(t), 'Delete account offered');
await page.click('#view [data-section], nav [data-section="practice"]').catch(() => {});
const note = await page.evaluate(() => typeof aiNoteText === 'function' ? aiNoteText() : '');
ok(!/upgrade to Plus/i.test(note), 'papers note does not say upgrade to Plus: ' + note.slice(0, 120));

// a Plus subscriber bought on the web: shown as Plus, but no Manage billing button
state.plan = 'plus'; state.status = 'active'; state.hasCustomer = true;
await page.evaluate(() => loadPlan(true)); await page.waitForFunction(() => PLAN.data && PLAN.data.plan === 'plus'); t = await strip();
ok(/Plus/.test(t) && /100 of 100/.test(t) && !/Manage billing/.test(t), 'web Plus shows as Plus without Manage billing: ' + t.slice(0, 160));

// links: a PDF and another site go through the Browser plugin; a same-site page does not
await page.evaluate(() => { const a = document.createElement('a'); a.href = 'papers/nesa/2025-hsc-business-studies-exam.pdf'; a.id = 'tpdf'; a.textContent = 'pdf'; document.body.append(a); const b = document.createElement('a'); b.href = 'https://files.bandsfordays.com/x.pdf'; b.id = 'text'; b.textContent = 'ext'; document.body.append(b); });
await page.click('#tpdf'); await page.click('#text');
const opened = await page.evaluate(() => window.__opened);
ok(opened.length === 2 && opened[0].endsWith('/papers/nesa/2025-hsc-business-studies-exam.pdf') && opened[1] === 'https://files.bandsfordays.com/x.pdf', 'PDF and external links open through the Browser plugin: ' + opened.join(' '));
ok(page.url().includes('/app.html'), 'the app page itself did not navigate away');

// delete account: Worker first, then the Supabase function, then signed out
await page.click('#account button:has-text("Delete account")');
await page.waitForFunction(() => sync.state === 'local');
const rpc = await page.evaluate(() => window.__rpc);
ok(calls.includes('/api/account/delete POST') && rpc.includes('delete_my_account'), 'delete: Worker then delete_my_account: ' + rpc.join(','));
ok(toasts.some(x => /deleted/.test(x)) && /Not signed in|Sign in/.test(await strip()), 'deleted and signed out: ' + toasts.slice(-1));
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close();
console.log(fails ? fails + ' check(s) failed' : 'all native checks passed'); process.exit(fails ? 1 : 0);
