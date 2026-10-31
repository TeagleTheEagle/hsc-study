// Phase E1 checks (Playwright): the Marks report. Seeds marked answers (some rewritten, dated across weeks) and
// checks topics weakest-first with Not assessed, papers, rewrites attempt by attempt, the four-week trend, the
// text export, routing and entry points. Serve the repo root on 8766 first.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:8766';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/cdn\.jsdelivr\.net.*supabase/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(new URL('./supabase_stub.js', import.meta.url), 'utf8') }));
await ctx.addInitScript(() => { window.__db = { progress: null, scores: [], feedback: [], writes: 0, fail: null, session: null }; });
await ctx.route(/fonts\.googleapis\.com/, r => r.abort());
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(BASE + '/app.html#home'); await page.waitForSelector('#view .panel');

// empty state
await page.evaluate(() => goMode('report')); await page.waitForSelector('.rep .hero');
ok(/Nothing marked yet/.test(await page.$eval('.rep .hero', e => e.textContent)), 'empty report explains what to do');
ok((await page.evaluate(() => location.hash)) === '#report', 'report has its own address (#report)');
ok((await page.$$eval('.trend .wk', ws => ws.length)) === 8, 'four weeks shown (cards row and marks row each)');

// seed: Finance question rewritten 2 -> 4 -> 6 over three weeks; a Marketing question marked once at 1/4;
// an Operations MC right; a card session this week
const seeded = await page.evaluate(() => {
  const day = n => Date.now() - n * 864e5;
  const p = PBY.nesa2025; const units = [];
  for (const { it } of pItems(p)) for (const u of itemUnits(it)) units.push({ it, part: u.part, max: u.max, topic: unitTopic(p, it, u.part) });
  const fin = units.find(u => u.topic === 'Finance' && u.max >= 6) || units.find(u => u.topic === 'Finance' && u.max >= 4);
  const mkt = units.find(u => u.topic === 'Marketing' && u.max >= 3 && u !== fin);
  const mc = units.find(u => u.it.type === 'mc');
  S.papers = {};
  S.papers[rkey(p, fin.it, fin.part)] = { a: 'final answer', m: fin.max, x: fin.max, how: 'ai', mt: day(1), t: day(1), r: { band: String(fin.max), verdict: 'v', strengths: [], improvements: [], model: 'm' }, prev: [{ m: 2, how: 'ai', a: 'first', imp: [], t: day(16) }, { m: 4, how: 'ai', a: 'second', imp: [], t: day(8) }] };
  S.papers[rkey(p, mkt.it, mkt.part)] = { a: 'one factor', m: 1, x: mkt.max, how: 'ai', mt: day(2), t: day(2), r: { band: '1', verdict: 'v', strengths: [], improvements: [], model: 'm' } };
  S.papers[rkey(p, mc.it, null)] = { m: 1, x: 1, how: 'mc', mt: day(3), t: day(3) };
  S.days = {}; S.days[today()] = 12; S.sess = [{ a: Date.now() - 3600e3, b: Date.now() - 3500e3, n: 12, r: 9, m: 'learn', d: 'all' }];
  save(); goMode('report');
  return { finMax: fin.max, mktMax: mkt.max, finLabel: 'Q' + fin.it.n + (fin.part && fin.part.p ? '(' + fin.part.p + ')' : '') };
});
await page.waitForSelector('.rep table');
const hero = await page.$eval('.rep .hero', e => e.textContent);
ok(/3 typed answers marked/.test(hero) && new RegExp(`${seeded.finMax + 1 + 1}/${seeded.finMax + seeded.mktMax + 1} marks`).test(hero), 'hero totals use the latest attempt: ' + hero.match(/\d+\/\d+ marks[^.]*/)[0]);
ok(new RegExp(`1 rewritten, \\+${seeded.finMax - 2} marks gained`).test(hero), 'hero counts the rewrite gain (+' + (seeded.finMax - 2) + ')');
const topicRows = await page.$$eval('.rep .panel:has(h2:has-text("By topic")) tbody tr', trs => trs.map(tr => [...tr.children].map(td => td.textContent)));
ok(topicRows[0][0] === 'Marketing', 'weakest topic first: ' + topicRows.map(r => r[0]).join(', '));
ok(topicRows.some(r => r[0] === 'Human resources' && r[3] === 'Not assessed'), 'untried topic says Not assessed, not 0%');
const finRow = topicRows.find(r => r[0] === 'Finance');
ok(finRow && finRow[2] === Math.round(200 / seeded.finMax) + '%' && finRow[3].endsWith('100%'), 'Finance shows first attempts vs latest: ' + finRow.slice(1).join(' | '));
const paperRows = await page.$$eval('.rep .panel:has(h2:has-text("By paper")) tbody tr', trs => trs.map(tr => tr.textContent));
ok(paperRows.length === 1 && /3\/\d+/.test(paperRows[0]), 'one paper row with answered count: ' + paperRows[0].replace(/Open$/, ''));
const rw = await page.$eval('.rep .panel:has(h2:has-text("Rewrites")) tbody tr', tr => tr.textContent);
ok(new RegExp(`2 → 4 → ${seeded.finMax} / ${seeded.finMax}`).test(rw) && rw.includes('+' + (seeded.finMax - 2)) && rw.includes(seeded.finLabel), 'rewrite shown attempt by attempt: ' + rw.replace(/Open$/, ''));
ok(new RegExp(`Average gain per rewritten answer: \\+${seeded.finMax - 2}\\.0 marks`).test(await page.$eval('.rep .panel:has(h2:has-text("Rewrites")) p', e => e.textContent)), 'average gain per rewrite');
const weeks = await page.$$eval('.trend .wk', ws => ws.map(w => w.textContent));
ok(/12 cards · 75%/.test(weeks[6]) && /3 marked · 67%/.test(weeks[7]), 'this week: 12 cards at 75%, 3 marked answers at 67%: ' + weeks[6] + ' / ' + weeks[7]);
ok(/1 marked · 33%/.test(weeks[3]) || /1 marked/.test(weeks[3]), 'two weeks ago: the 2-mark attempt counts in its own week: ' + weeks[3]);
// text export
const txt = await page.evaluate(() => reportText());
ok(txt.startsWith('Bands for Days marks report') && /By topic/.test(txt) && /Not assessed/.test(txt) && /Rewrites/.test(txt) && /not NESA results/.test(txt), 'text export has every section and the disclaimer');
// Open on a rewrite goes to the question
await page.click('.rep .panel:has(h2:has-text("Rewrites")) tbody tr button');
await page.waitForSelector('.markbox');
ok((await page.evaluate(() => S.mode === 'papers' && !!S.pp.item)), 'Open on a rewrite opens that question');
// entry points and the class clean-up
await page.evaluate(() => goMode('stats'));
ok(!!(await page.$('#view button:has-text("Marks report")')), 'Stats has a Marks report button');
ok(!(await page.$eval('#view', e => e.classList.contains('rep'))), 'report styling removed on other views');
await page.evaluate(() => goMode('home'));
ok(!!(await page.$('#view button:has-text("Marks report")')), 'Today has a Marks report link');
// awardXP stamps the mark time; a rewrite keeps it
await page.evaluate(() => { const p = PBY.nesa2025; const u = pItems(p).find(x => x.it.type === 'sa'); const part = u.it.parts[0]; setRec(p, u.it, part, { a: 'answer', m: 1, x: part.marks, how: 'ai', r: { band: '1', verdict: '', strengths: [], improvements: [], model: '' } }); awardXP(p, u.it, part, 1, part.marks, 'ai'); window.__k = rkey(p, u.it, part); });
ok((await page.evaluate(() => typeof S.papers[window.__k].mt === 'number')), 'a mark records when it was given');
await page.evaluate(() => { const p = PBY.nesa2025; const u = pItems(p).find(x => x.it.type === 'sa'); startRewrite(p, u.it, u.it.parts[0]); });
ok((await page.evaluate(() => typeof S.papers[window.__k].prev[0].t === 'number')), 'a rewrite keeps the previous attempt\'s time');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ').slice(0, 300) : ''));
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
