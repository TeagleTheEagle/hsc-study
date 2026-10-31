// Phase E3 checks (Playwright, fake Supabase): the Exam-style test and Find a question for every subject with
// typed papers. Biology (modules mapped to card topics, MC test), Legal (case-insensitive sections), Modern History
// (no MC: written only), English (search), and Business unchanged. Serve the repo root on 8766 first.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:8766';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/cdn\.jsdelivr\.net.*supabase/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(new URL('./supabase_stub.js', import.meta.url), 'utf8') }));
await ctx.route(/fonts\.googleapis\.com/, r => r.abort());
await ctx.addInitScript(() => { window.__db = { progress: null, feedback: [], writes: 0, fail: null, session: null, scores: [] }; });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const txt = async sel => (await page.$eval(sel, e => e.textContent)).replace(/\s+/g, ' ');
const papersLoaded = () => page.waitForFunction(() => !!SUBJ_PAPERS[SUBJ.id] && PAPERS.length > 0 && itemIndex().length > 0);

// ---- Biology: Practice shows the two actions, the test lists modules mapped onto card topics ----
await page.goto(BASE + '/app.html?s=biology#practice'); await page.waitForSelector('#view .actions');
let acts = await txt('#view .actions');
ok(/Exam-style test/.test(acts) && /Find a question/.test(acts), 'Biology Practice has Exam-style test and Find a question');
await page.click('#view .actions :text-is("Exam-style test")'); await page.waitForSelector('#view .panel');
await papersLoaded(); await page.waitForSelector('#view button:has-text("Start the test")');
ok((await page.evaluate(() => location.hash)) === '#test', 'exam test has the #test address for Biology');
const topics = await page.$$eval('#view .row:has(span:text-is("Topic:")) button', b => b.map(x => x.textContent.trim()));
ok(topics.length === 5 && /M5/.test(topics[1]) && /M8/.test(topics[4]), 'topics: All + Module 5 to 8 mapped onto the card topics: ' + topics.join(' | '));
ok(/NESA HSC Biology exams \(2019 to 2025\)/.test(await txt('#view .panel')), 'intro names the subject and years');
ok((await page.evaluate(() => itemIndex().filter(r => r.type === 'mc').length)) === 140 && (await page.evaluate(() => itemIndex().every(r => /^Mod[5-8]$/.test(r.topic)))), '140 MC questions, every question on a card topic');
await page.click('#view .row:has(span:text-is("Topic:")) button:nth-child(2)'); await page.waitForSelector('#view button:has-text("Start the test")');
const line = await txt('#view .panel p.small');
ok(/multiple choice and \d+ written questions in Module 5: Heredity/.test(line), 'topic line uses the full card topic name: ' + line.slice(0, 90));
await page.click('#view button:has-text("Start the test")'); await page.waitForSelector('.panel.q');
ok(/Question 1 of 10/.test(await txt('#view .tally')) && !!(await page.$('.panel.q img.stimimg')), 'MC test starts and shows the question picture');
ok(/HSC 20\d\d/.test(await txt('.panel.q .lab')) && /Heredity/.test(await txt('.panel.q .lab .deck')), 'question label names the paper and the module');
await page.click('.panel.q .opts button.opt');
await page.waitForFunction(() => { const x = XT.list[0]; const r = itemRow(x.pid, x.iid); return !!rec(r.p, r.it, null); });
ok(true, 'an MC answer is recorded');
await page.click('#view button:has-text("End test")'); await page.waitForSelector('#view .panel h2');
ok(/By topic|Strong result|Solid|Good practice/.test(await txt('#view')), 'results page renders');

// ---- Biology: Find a question ----
await page.evaluate(() => { S.pp.paper = null; S.pp.item = null; goMode('papers'); }); await page.waitForSelector('details.qsearch');
ok(true, 'Find a question panel is on the Biology papers page');
await page.$eval('details.qsearch', d => d.open = true);
const sopts = await page.$$eval('details.qsearch select >> nth=0 >> option', o => o.map(x => x.textContent));
ok(sopts.length === 5 && /M5/.test(sopts[1]), 'search topic list = Any topic + the 4 modules: ' + sopts.join(' | '));
await page.fill('details.qsearch input[type=search]', 'mutation'); await page.press('details.qsearch input[type=search]', 'Enter'); await page.waitForSelector('details.qsearch .qrow');
const hits = await page.$$eval('details.qsearch .qrow', r => r.length);
ok(hits > 0 && hits <= 60, `'mutation' finds ${hits} Biology questions`);
ok(/Module 6|M6/.test(await txt('details.qsearch .qrow .meta')), 'hit meta shows the mapped topic name');

// ---- Legal: 'Human rights' and 'Human Rights' merge onto one card topic; 'Options' stays its own ----
await page.goto(BASE + '/app.html?s=legal#test'); await page.waitForSelector('#view .panel'); await papersLoaded(); await page.waitForSelector('#view button:has-text("Start the test")');
const lt = await page.$$eval('#view .row:has(span:text-is("Topic:")) button', b => b.map(x => x.textContent.trim()));
ok(lt.join('|') === 'All topics|Crime|Human rights', 'Legal: every MC and short answer lands on Crime or Human rights (options are extended responses only): ' + lt.join(' | '));

// ---- Modern History: no multiple choice, so the format is Written only ----
await page.goto(BASE + '/app.html?s=modern-history#test'); await page.waitForSelector('#view .panel'); await papersLoaded(); await page.waitForSelector('#view button:has-text("Start the test")');
const fm = await page.$$eval('#view .row:has(span:text-is("Topic:")) + .row button', b => b.map(x => x.textContent.trim()));
ok(fm.length === 1 && fm[0] === 'Written' && (await page.evaluate(() => S.xtFmt)) === 'sa', 'Modern History: Written is the only format');
await page.click('#view button:has-text("Start the test")'); await page.waitForSelector('.panel.q textarea');
ok(!!(await page.$('.panel.q .unit')), 'a written question with parts starts');

// ---- English: search works, Practice shows the actions ----
await page.goto(BASE + '/app.html?s=english#practice'); await page.waitForSelector('#view .actions');
acts = await txt('#view .actions');
ok(/Exam-style test/.test(acts) && /Find a question/.test(acts), 'English Practice has the two actions');
await page.click('#view .actions :text-is("Find a question")'); await page.waitForSelector('details.qsearch');
await page.$eval('details.qsearch', d => d.open = true);
await page.fill('details.qsearch input[type=search]', 'analyse'); await page.press('details.qsearch input[type=search]', 'Enter'); await page.waitForSelector('details.qsearch .qrow');
ok((await page.$$eval('details.qsearch .qrow', r => r.length)) > 0, "'analyse' finds English questions");
ok(/Extended response/.test(await page.$eval('details.qsearch', d => d.textContent)), 'type filter says Extended response, not Report or essay');

// ---- Business unchanged ----
await page.goto(BASE + '/app.html?s=business#test'); await page.waitForSelector('#view button:has-text("Start the test")');
const bt = await page.$$eval('#view .row:has(span:text-is("Topic:")) button', b => b.map(x => x.textContent.trim()));
ok(bt.join('|') === 'All topics|Operations|Marketing|Finance|Human resources', 'Business topics unchanged: ' + bt.join('|'));
ok(/Riverview Task 1/.test(await txt('#view .panel')), 'Business intro unchanged');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ').slice(0, 400) : ''));
await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
