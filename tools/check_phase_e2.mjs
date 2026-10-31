// Phase E2 checks (Playwright, fake Supabase): class leaderboard and class view from the class code, invite link,
// sign-up pre-filled from ?code=, and the no-class-code case. Serve the repo root on 8766 first.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:8766';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/cdn\.jsdelivr\.net.*supabase/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(new URL('./supabase_stub.js', import.meta.url), 'utf8') }));
await ctx.route(/fonts\.googleapis\.com/, r => r.abort());
const now = new Date().toISOString(), old = new Date(Date.now() - 3 * 864e5).toISOString();
await ctx.addInitScript(([now, old]) => { window.__db = { progress: null, feedback: [], writes: 0, fail: null, session: null, scores: [
  { user_id: 'u-test', nick: 'B1', xp: 300, level: 3, streak: 4, mastered: 20, total: 150, updated_at: now, class_code: 'RIV-A' },
  { user_id: 'u-2', nick: 'Sam', xp: 900, level: 5, streak: 9, mastered: 60, total: 400, updated_at: now, class_code: 'RIV-A' },
  { user_id: 'u-3', nick: 'Alex', xp: 120, level: 2, streak: 1, mastered: 5, total: 40, updated_at: old, class_code: 'RIV-A' },
  { user_id: 'u-4', nick: 'Other1', xp: 2000, level: 8, streak: 20, mastered: 200, total: 900, updated_at: now, class_code: 'RIV-B' },
  { user_id: 'u-5', nick: 'Other2', xp: 50, level: 1, streak: 0, mastered: 0, total: 10, updated_at: old, class_code: 'RIV-B' } ] }; }, [now, old]);
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE + '/app.html#class'); await page.waitForSelector('#view .panel');
ok(/Sign in to see your class/.test(await page.$eval('#view .hero', e => e.textContent)), 'signed out: class view asks to sign in');

// sign in with a class code (lower case with spaces: normalised)
await page.evaluate(async () => { window.__db.session = { user: { id: 'u-test', email: 'b1@example.com', user_metadata: { class_code: ' riv-a ' } }, access_token: 'tok' }; SB = window.supabase.createClient(); await startSync(window.__db.session); });
await page.waitForFunction(() => sync.state === 'synced');
ok((await page.evaluate(() => ME.classCode)) === 'RIV-A', 'class code normalised from the sign-up metadata');
await page.evaluate(() => goMode('stats')); await page.waitForSelector('.lb .rowx');
ok(!!(await page.$('.lbscope button[aria-pressed="true"]:has-text("My class")')), 'leaderboard defaults to My class');
ok((await page.$$eval('.lb .rowx', r => r.length)) === 3 && (await page.$$eval('.lb .rowx.me', r => r.length)) === 1, 'class leaderboard: 3 classmates, me highlighted');
ok((await page.$eval('.lb .rowx', r => r.textContent)).includes('Sam'), 'ordered by XP within the class');
await page.click('.lbscope button:has-text("Everyone")'); await page.waitForFunction(() => document.querySelectorAll('.lb .rowx').length === 5);
ok(true, 'Everyone shows all 5');
ok((await page.$eval('.lb .rowx', r => r.textContent)).includes('Other1'), 'everyone board led by the top scorer overall');

// class view
await page.click('.lbscope button:has-text("Class view")'); await page.waitForSelector('#classbox .rowx');
ok((await page.evaluate(() => location.hash)) === '#class', 'class view has its own address');
ok(/Class RIV-A/.test(await page.$eval('#view .hero h2', e => e.textContent)), 'class view names the class');
const cb = await page.$eval('#classbox', e => e.textContent);
const cbs = cb.replace(/\s+/g, ' ');
ok(/3 members/.test(cbs) && /2 ?studied today/.test(cbs) && /590 ?answers given/.test(cbs) && /85 ?cards mastered/.test(cbs) && /1320 ?class XP/.test(cbs), 'class totals: 3 members, 2 studied today, 590 answers, 85 mastered, 1320 XP: ' + cbs.slice(0, 160));
ok((await page.$$eval('#classbox .rowx.me', r => r.length)) === 1, 'me highlighted in the class list');
await page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async t => { window.__copied = t; }; });
await page.click('#view button:has-text("Copy invite link")');
const inv = await page.evaluate(() => window.__copied);
ok(inv && inv.endsWith('/app.html?code=RIV-A'), 'invite link carries the class code: ' + inv);
await page.evaluate(() => goMode('stats'));
ok(!!(await page.$('#view button:text-is("My class")')), 'Stats has a My class button');

// the invite link pre-fills sign-up
const p2 = await ctx.newPage(); await p2.goto(BASE + '/app.html?code=abc-1#home'); await p2.waitForSelector('#view .panel');
ok((await p2.evaluate(() => AUTH.mode === 'up' && AUTH.code === 'ABC-1')), 'invite link opens sign-up with the code upper-cased');
ok((await p2.$eval('#account input[name=code]', e => e.value)) === 'ABC-1', 'the class code field is filled in');

// an account with no class code
const p3 = await ctx.newPage(); await p3.goto(BASE + '/app.html#stats'); await p3.waitForSelector('#view .panel');
await p3.evaluate(async () => { window.__db.session = { user: { id: 'u-9', email: 'x@example.com', user_metadata: {} }, access_token: 'tok' }; SB = window.supabase.createClient(); await startSync(window.__db.session); });
await p3.waitForFunction(() => sync.state === 'synced'); await p3.evaluate(() => goMode('stats')); await p3.waitForSelector('.lb .rowx');
ok(!(await p3.$('.lbscope')) && (await p3.$$eval('.lb .rowx', r => r.length)) === 5, 'no class code: no toggle, everyone shown');
await p3.evaluate(() => goMode('class'));
ok(/no class code/.test(await p3.$eval('#view .hero', e => e.textContent)), 'no class code: the class view explains');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ').slice(0, 300) : ''));
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
