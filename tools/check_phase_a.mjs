// Phase A checks (Playwright): navigation, hashes, Back button, subject links, brand, counts.
// Usage: node tools/check_phase_a.mjs [http://localhost:8766]   (serve the repo root first: python3 -m http.server 8766)
import { chromium } from 'playwright';
const BASE = process.argv[2] || 'http://localhost:8766';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

const browser = await chromium.launch();
async function fresh(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route(/cdn\.jsdelivr\.net|fonts\.googleapis\.com/, r => r.abort());
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/jsdelivr|fonts|net::ERR/.test(m.text())) errors.push(m.text()); });
  return { ctx, page, errors };
}
const mode = p => p.evaluate(() => S.mode);
const section = p => p.evaluate(() => document.querySelector('#mainnav button[aria-current="page"]').dataset.section);

{ // desktop
  const { page, errors } = await fresh(1280, 900);
  await page.goto(BASE + '/app.html'); await page.waitForSelector('#view .panel');
  ok(await page.title() === 'Business Studies · Bands for Days', 'title says Bands for Days');
  const labels = await page.$$eval('#mainnav button span', s => s.map(x => x.textContent));
  ok(labels.join(',') === 'Today,Subjects,Practice,Library,Progress', 'five sections: ' + labels.join(','));
  const navBox = await page.$eval('#mainnav', n => n.getBoundingClientRect());
  ok(navBox.x === 0 && navBox.width > 200 && navBox.height > 600, 'desktop: sidebar on the left');
  ok(await section(page) === 'today', 'Today is current on load');
  for (const [sec, m, h] of [['subjects', 'subjects', '#subjects'], ['practice', 'practice', '#practice'], ['library', 'library', '#library'], ['progress', 'stats', '#stats'], ['today', 'home', '#home']]) {
    await page.click(`#mainnav button[data-section="${sec}"]`);
    ok(await mode(page) === m && await page.evaluate(() => location.hash) === h, `${sec} -> mode ${m}, hash ${h}`);
  }
  await page.goBack(); ok(await mode(page) === 'stats', 'Back returns to Progress');
  await page.goBack(); ok(await mode(page) === 'library', 'Back again returns to Library');
  await page.goForward(); ok(await mode(page) === 'stats', 'Forward works');
  // practice hub -> past papers -> paper -> item, and Back up the chain
  await page.click('#mainnav button[data-section="practice"]');
  await page.click('#view .act:has-text("Past papers")'); ok(await mode(page) === 'papers' && await section(page) === 'practice', 'Past papers sits under Practice');
  await page.evaluate(() => openPaper('nesa2025')); ok((await page.evaluate(() => location.hash)) === '#papers/nesa2025', 'paper gets its own address');
  await page.goBack(); ok(await page.evaluate(() => S.pp.paper) === null && await mode(page) === 'papers', 'Back leaves the paper, stays on Past papers');
  // sub-tabs show only for card modes
  await page.click('#mainnav button[data-section="subjects"]');
  ok(await page.$eval('#subbar', e => e.hidden), 'no card tabs on the Subjects page');
  await page.click('#view .act:has-text("Flashcards")'); ok(await mode(page) === 'flash' && !(await page.$eval('#subbar', e => e.hidden)) && await section(page) === 'subjects', 'Flashcards under Subjects with tabs');
  await page.click('.tab[data-mode="test"]'); ok(await section(page) === 'subjects' && await page.evaluate(() => location.hash) === '#test-cards', 'card test stays under Subjects (#test-cards)');
  await page.click('#mainnav button[data-section="practice"]'); await page.click('#view .act:has-text("Exam-style test")');
  ok(await mode(page) === 'test' && await section(page) === 'practice' && await page.evaluate(() => location.hash) === '#test', 'exam-style test under Practice (#test)');
  // not assessed
  await page.click('#mainnav button[data-section="today"]');
  const na = await page.$$eval('table.mastery .na', e => e.length); ok(na >= 4, `fresh account shows "Not assessed" (${na} cells)`);
  ok((await page.textContent('#view')).includes('not assessed yet'), 'Learn action says not assessed yet');
  // old links still work
  for (const [h, m] of [['#papers', 'papers'], ['#ratio', 'ratio'], ['#stats', 'stats'], ['#guide', 'guide'], ['#today', 'today'], ['#mistakes', 'mistakes'], ['#library', 'library'], ['#test', 'test']]) {
    await page.goto(BASE + '/app.html' + h); await page.waitForSelector('#view .panel, #view .card, #view'); ok(await mode(page) === m, `old link ${h} opens ${m}`);
  }
  // subject switch keeps the subject in the address, and the page reloads into it
  await page.goto(BASE + '/app.html#subjects'); await page.waitForSelector('.subjgrid');
  await page.click('.subjgrid button:has-text("Biology")'); await page.waitForFunction(() => SUBJ.id === 'biology');
  ok((await page.evaluate(() => location.search)) === '?s=biology', 'switching puts ?s=biology in the address');
  ok((await page.evaluate(() => document.body.dataset.subj)) === 'biology', 'body carries the subject colour');
  await page.reload(); await page.waitForFunction(() => SUBJ.id === 'biology' && !document.body.classList.contains('subj-loading'));
  ok(await page.title() === 'Biology · Bands for Days', 'reload keeps Biology');
  await page.click('#mainnav button[data-section="practice"]'); ok((await page.textContent('#view')).includes('Past papers'), 'Biology practice hub lists past papers');
  await page.goto(BASE + '/app.html?s=legal#practice'); await page.waitForFunction(() => SUBJ.id === 'legal' && !document.body.classList.contains('subj-loading'));
  ok((await page.textContent('#view')).includes('HSC exams and marking guidelines'), 'Legal practice hub links the exam downloads');
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ').slice(0, 400) : ''));
  await page.close();
}
{ // phone, dark
  const { ctx, page, errors } = await fresh(390, 844);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(BASE + '/app.html'); await page.waitForSelector('#view .panel');
  const nb = await page.$eval('#mainnav', n => n.getBoundingClientRect());
  ok(nb.y > 700 && nb.width === 390, 'phone: bottom bar');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor); ok(bg === 'rgb(23, 21, 15)', 'dark palette applied (' + bg + ')');
  const overlap = await page.evaluate(() => { const f = document.querySelector('#foot').getBoundingClientRect(); const n = document.querySelector('#mainnav').getBoundingClientRect(); window.scrollTo(0, 1e6); const f2 = document.querySelector('#foot').getBoundingClientRect(); return f2.bottom <= n.top + 1; });
  ok(overlap, 'bottom bar does not cover the footer when scrolled to the end');
  ok(errors.length === 0, 'phone: no page errors');
  await ctx.close();
}
{ // landing, exams, resources: brand + nav
  const { page } = await fresh(1280, 900);
  for (const f of ['index.html', 'exams.html', 'resources.html']) {
    await page.goto(BASE + '/' + f);
    const t = await page.title(); ok(t.includes('Bands for Days') && !t.includes('Band Six'), f + ' title: ' + t);
    const body = await page.evaluate(() => document.body.innerText); ok(!/Band Six/.test(body), f + ' has no "Band Six" text');
    const nav = await page.$$eval('header nav a', a => a.map(x => x.textContent.trim())); ok(nav.slice(0, 5).join(',') === 'Today,Subjects,Practice,Library,Progress', f + ' nav: ' + nav.join(','));
    ok(!!(await page.$('link[rel="manifest"]')), f + ' links the manifest');
  }
  const r = await page.goto(BASE + '/manifest.webmanifest'); ok(r.ok(), 'manifest served');
  await page.close();
}
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
