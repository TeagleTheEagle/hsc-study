// Phase D checks (Playwright): service worker installs, the app shell and a saved subject work with the server
// down, marking is refused offline with the draft kept, an unsaved subject explains itself, the install card
// shows and dismisses, a new worker version offers a reload. Starts its own server on 8767 so it can stop it.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 8767, BASE = `http://localhost:${PORT}`;
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
let server = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function startServer() { server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' }); for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/manifest.webmanifest'); return; } catch (_) { await sleep(100); } } throw new Error('server did not start'); }
async function stopServer() { if (!server) return; server.kill('SIGKILL'); server = null; for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/manifest.webmanifest'); await sleep(100); } catch (_) { return; } } }
await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, serviceWorkers: 'allow' });
await ctx.route(/fonts\.googleapis\.com/, r => r.abort());
await ctx.route(/cdn\.jsdelivr\.net/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(new URL('./supabase_stub.js', import.meta.url), 'utf8') }));
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const toasts = []; page.on('console', m => { if (m.text().startsWith('TOAST:')) toasts.push(m.text().slice(6)); });
const spyToast = () => page.evaluate(() => { const o = toast; window.toast = (m, k) => { console.log('TOAST:' + m); return o(m, k); }; });

// 1. first visit: the worker installs and takes control; the shell is cached
await page.goto(BASE + '/app.html'); await page.waitForSelector('#view .panel'); await spyToast();
await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 });
const ver = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; const p = new Promise(res => navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'VERSION') res(e.data.version); }, { once: true })); r.active.postMessage({ type: 'VERSION' }); return p; });
const swSrc = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
ok(swSrc.includes(`const VERSION = '${ver}';`), 'worker reports the stamped version: ' + ver);
const shell = await page.evaluate(async v => { const c = await caches.open('bfd-shell-' + v); return (await c.keys()).map(r => new URL(r.url).pathname); }, ver);
ok(shell.includes('/app.html') && shell.includes('/index.html') && shell.includes('/manifest.webmanifest'), 'app shell cached: ' + shell.length + ' files');

// 2. Subjects > Offline: save Biology
await page.evaluate(() => goMode('subjects')); await page.waitForSelector('#offline .offrow');
await page.waitForFunction(() => [...document.querySelectorAll('#offline .offrow')].every(r => !r.textContent.includes('…')));
const bizRow = await page.$eval('#offline .offrow:has-text("Business")', r => r.textContent);
ok(/Always available/.test(bizRow), 'Business is marked always available (built in)');
await page.click('#offline .offrow:has-text("Biology") button:has-text("Save")');
await page.waitForSelector('#offline .offrow:has-text("Biology") .offpill');
ok(toasts.some(t => /Biology saved for offline/.test(t)), 'Biology saved for offline use');
// open a Business paper question so the draft flow is ready, then type a draft
await page.goto(BASE + '/app.html#papers/nesa2025'); await page.waitForSelector('#view .panel'); await spyToast();
await page.evaluate(() => { const it = pItems(PBY.nesa2025).find(x => x.it.type === 'sa'); openItem(it.it.id); });
await page.waitForSelector('.unit textarea');
await page.locator('.unit textarea').first().fill('Outsourcing passes production to a specialist, which lowers cost but reduces control.');
await page.waitForTimeout(1000);

// 3. the server goes away and the browser goes offline
await stopServer(); await ctx.setOffline(true);
await page.reload(); await page.waitForSelector('#view .panel', { timeout: 15000 }); await spyToast();
ok(true, 'app.html loads with the server down');
ok((await page.locator('.unit textarea').first().inputValue()).startsWith('Outsourcing passes'), 'draft still there offline');
await page.click('.unit .markbtn');
await page.waitForSelector('.toast', { timeout: 3000 }).catch(() => {});
ok(toasts.some(t => /Marking needs internet/.test(t)), 'marking refused offline, draft kept: ' + (toasts[toasts.length - 1] || ''));
await page.evaluate(async () => { await switchSubject('biology'); });
ok((await page.evaluate(() => SUBJ.id === 'biology' && CARDS.length > 100)), 'saved subject (Biology) opens offline with ' + (await page.evaluate(() => CARDS.length)) + ' cards');
await page.evaluate(async () => { await switchSubject('physics'); });
ok(toasts.some(t => /offline and it is not saved/.test(t)), 'unsaved subject explains it is not saved on this device');
await ctx.setOffline(false); await startServer();

// 4. install card: shows on Today when the browser offers install, and stays dismissed
await page.evaluate(() => { localStorage.removeItem('bfd_install_dismiss'); goMode('home'); const e = new Event('beforeinstallprompt'); e.prompt = () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); });
await page.waitForSelector('.panel.install');
ok(!!(await page.$('.panel.install button:has-text("Install")')), 'install card shows on Today with an Install button');
await page.click('.panel.install button:has-text("Not now")');
ok(!(await page.$('.panel.install')), 'Not now hides the card');
await page.evaluate(() => goMode('subjects')); await page.evaluate(() => goMode('home'));
ok(!(await page.$('.panel.install')), 'card stays hidden after dismissing');

// 5. a new worker version offers a reload
// (page.route cannot intercept a worker script fetch, so the file on disk is swapped and restored)
const swPath = new URL('../sw.js', import.meta.url);
fs.writeFileSync(swPath, swSrc.replace(`const VERSION = '${ver}';`, "const VERSION = 'test-next';"));
process.on('exit', () => { try { fs.writeFileSync(swPath, swSrc); } catch (_) {} });
await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; await r.update(); });
await page.waitForSelector('.toast.action', { timeout: 15000 });
ok(/new version is ready/.test(await page.$eval('.toast.action', e => e.textContent)), 'update toast offers a reload');
const navP = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.click('.toast.action .tbtn'); await navP;
await page.waitForSelector('#view .panel');
const ver2 = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; const p = new Promise(res => navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'VERSION') res(e.data.version); }, { once: true })); r.active.postMessage({ type: 'VERSION' }); return p; });
ok(ver2 === 'test-next', 'after Reload the new worker is in control: ' + ver2);
const caches2 = await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('bfd-shell-')));
ok(caches2.length === 1 && caches2[0] === 'bfd-shell-test-next', 'old shell cache removed: ' + caches2.join(','));
fs.writeFileSync(swPath, swSrc);

// 6. index.html registers the worker too
const p2 = await ctx.newPage(); await p2.goto(BASE + '/index.html');
ok(!!(await p2.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()))), 'index.html registers the worker');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ').slice(0, 300) : ''));
await browser.close(); await stopServer();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
