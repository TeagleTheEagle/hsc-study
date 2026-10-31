# Rebuilding the Band Six app

`build-src.zip` holds the build chain for app.html (the website) and the Claude artifact page.
Unzip it somewhere, then:

1. `python3 quiz/build/build.py` writes quiz/business-study-set.html (the Claude artifact page)
   from quiz/page_template8.html, quiz/cards2.json, quiz/build/papers.js, papers.json and images.json.
2. `python3 quiz/build/site_patch.py` turns it into app.html in the hsc-study repo (set ROOT/SITE paths
   at the top of the script) and refreshes the counts on index.html.
3. Accounts on the website: put `{"url": "https://<project>.supabase.co", "key": "<anon public key>"}` in
   quiz/build/supabase.json before step 2. Without that file the site runs device-only (no sign-in).
   The anon key is public by design; never put the service_role key anywhere.
   Tables and policies: supabase-setup.sql in this folder.
4. Tests (Playwright, local http servers on 8765 = quiz/ and 8766 = repo): quiz/check5.mjs (exam guide),
   quiz/check6.mjs (settings, ids, reviews, search), quiz/check7.mjs (sign-in and sync against
   quiz/fake_supabase.js) and quiz/check8.mjs (exam-style test, mistake notebook, today's session).
   check6's "no errors" check only fails where cdn.jsdelivr.net is unreachable.

Template chain if the page itself needs changing: make_template.py -> ... -> make_template4.py ->
make_template5.py (each reads the previous page_templateN.html and the last one splices in
quiz/build/exam_test.js, which holds the exam-style Test mode, mistake notebook and today's session;
the earlier templates are not in the zip, so edit page_template7.html or exam_test.js directly and,
for exam_test.js, re-run make_template5.py on page_template6.html if you still have it).

Hardening (24 Oct): supabase-hardening.sql in this folder adds the class-code check on sign-up
(private.class_codes + trigger on auth.users) and the server-computed leaderboard rows (trigger on
public.progress; client write policies on scores dropped). mock_auth.sql + sqltest.sql in the zip run
both SQL files against a local PostgreSQL with a mock auth schema (su postgres -c "psql" < file).

## Resources page (24 Oct)
`resources-src/catalog2.py` catalogues the files staged from the OneDrive "business quizzlet" folder (originals under /mnt/user-data/uploads/business quizzlet/, converted PDFs from `convert.sh` in res/pdf) into catalog.json; `resources-src/build_resources.py` turns it into resources.html (copies the landing-page styles from index.html; PICKS lists the "Start here" slugs). Converted PDFs are kept in `res-pdf/`. Hosting runbook: `cloudflare-deploy.md`.

## Library release (24 Oct, PR #1)
`quiz/build/library.js` holds the Library section (own sets, import, AI drafting, folders, tags, stars, pool filters,
retention analytics) and `quiz/build/make_template6.py` splices it plus its CSS and the hook patches into
page_template7.html -> page_template8.html (build.py now reads page_template8.html). To change the library,
edit library.js and re-run make_template6.py, build.py, site_patch.py. Test: quiz/check9.mjs (pass the site
app.html path as its argument to test both builds); it needs `ln -s /opt/node-tools/node_modules quiz/node_modules`
in the cloud container. The progress doc is now v4 (sets, setsDel, folders, foldersDel, star, unstar, hist, sess, recent).

## Multi-subject step (added 27 Oct 2026, commit 06c382b)

After site_patch.py writes app.html, run the subjects step from `subjects-src/`:

1. `python3 subjects-src/build_subjects.py` builds `subjects/<id>.json` in the site repo (Biology and Maths Std 2 from `flashcards/`, plus any hand-written sets in `subjects-src/cards/<id>.json`).
2. `python3 subjects-src/subjects_patch.py /home/claude/hsc-study/app.html` adds the subject switcher and fills the subject cards on index.html. It refuses to run twice, so start from a fresh site_patch output.

`landing_once.py` was a one-time landing page rewrite and is already in index.html. New-subject card ids are `'c'+base36(fnv1a(subject|topic|front))`: never edit a front once it is live. Progress doc is v5 (adds `subj` and `cfgBy`); check9.mjs expects v4 in one check, which is now v5.

## Free AI marking step (added 27 Oct 2026)

`worker.js` (repo root, `main` in wrangler.toml) serves /api/mark and /api/quota; everything else is static assets. Signed-in students (Supabase token checked against /auth/v1/user) get DAILY_LIMIT marks a day (5), site-wide GLOBAL_DAILY_CAP (300), counted in KV namespace `bandsix-marks` (id c669400708c643d0b421cb6ec5ffb401, binding MARKS). Model claude-opus-5-5 with structured JSON output and server-side fallbacks; the API key is the Worker secret ANTHROPIC_API_KEY (the user sets it with `npx wrangler secret put ANTHROPIC_API_KEY`; Claude never handles it).
After site_patch.py and subjects_patch.py:
1. `python3 server-src/marking_patch.py /home/claude/hsc-study` (app sends marking to the server for signed-in students; landing note).
2. `node server-src/build_bank.mjs /home/claude/hsc-study` rebuilds data/mark-bank.json from PAPERS + buildPrompt() in app.html (run it whenever papers change).
Local test: `wrangler dev` with a .dev.vars (ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL pointing at a mock) and `--var SUPA_URL:<mock>`; see server-src/test_marking.mjs.

## Release 1 step (added 27 Oct 2026)

After marking_patch.py: `python3 release1-src/release1_patch.py /home/claude/hsc-study`. Adds the quick check (mode 'diag', results in S.diag[subject], synced), the mastery map in "Where you stand" (Recall, Long-term, Applying, Exam writing), the rewrite-and-re-mark loop on written answers (S.papers[key].prev keeps the last 3 attempts), and a Business home that doesn't say "Exam done" once the date has passed. Then re-run server-src/build_bank.mjs (the prompts don't change, but keep it in step).

## NESA exam packs (27 Oct 2026)

197 NESA PDFs (exams, marking guidelines, Maths marking feedback) for English, Maths Adv, Maths Std 2, Biology,
Chemistry, Physics, Modern, Ancient and Legal live in R2 at https://files.bandsfordays.com/nesa/<sid>/<file>.
They came from the user's TOP15 folder via nesa_pick.js and nesa_upload.js on his PC (C:\Users\jonny\bandsix-ops).
- `exams-src/manifest.txt` lists them; `exams-src/build_exams.py` writes data/nesa-papers.json and exams.html
  (from exams_template.html) and links them from index.html (nav + coming-soon subject cards). Re-run it after
  subjects_patch.py, which rewrites the landing subject cards.
- `exams-src/exams_app_patch.py` (after release1_patch.py) gives every non-Business subject a Past papers tab
  that lists the PDFs. Business keeps its interactive papers.

## English typed past papers + card sets (27 Oct 2026)

- Cards: `subjects-src/cards-src/english.py` and `chemistry.py` write subjects-src/cards/*.json; then
  `python3 subjects-src/build_subjects.py /home/claude/hsc-study/subjects`.
- Papers: `exams-src/parse_english.py <txt dir> subjects/english-papers.json <pdf dir> papers/img/english`
  parses the NESA English Adv/Std exams + marking guidelines 2019 to 2025 (pdftotext -layout of the PDFs
  in R2 nesa/english/) into the same shape as the Business PAPERS (ids en-<adv|std>-<year>-p<1|2>).
  Visual stimulus pages are rendered to papers/img/english/.
- `exams-src/papers_subj_patch.py` (after exams_app_patch.py) makes PAPERS switch per subject
  (BIZ_PAPERS, SUBJ_PAPERS loaded lazily from SUBJECTS[].papers), adds renderPickSubj, and generalises
  buildPrompt (subject from p.subjName; craft part (b) is marked with part (a) attached).
- `subjects-src/register.py` rewrites `const SUBJECTS=` in app.html and the landing subject cards from
  subjects/*.json and *-papers.json. Run build_exams.py after it.
- `server-src/build_bank.mjs` now writes data/mark-bank.json (Business) plus data/mark-bank-<prefix>.json
  per subject (en for English); worker.js picks the file from the key prefix.
Order after a card/paper change: build_subjects -> parse_* -> register.py -> build_exams.py -> build_bank.mjs.

## Maths Advanced typed papers (27 Oct 2026)

- Cards: `subjects-src/cards-src/maths-adv.py` (131 cards), then build_subjects.py as above.
- Papers: `python3 exams-src/parse_maths.py <pdf dir with <year>-exam.pdf/-mg.pdf/-feedback.pdf> subjects/maths-adv-papers.json papers/img/maths-adv [maths-adv|maths-std2] [years]`.
  Uses pdftotext -bbox-layout. Every MC question, question stem, part and guideline entry is cropped to a 16-grey PNG
  (exam crops x 60-540pt, guideline crops 40-548pt). Part marks come from the guideline's top criterion; topics from
  the guideline's Mapping Grid. Prints per paper: MC key, total written marks (must be 90) and parts with no criteria.
  The PDFs came from R2 nesa/maths-adv/ (staged copies were in the session scratchpad).
- `exams-src/maths_patch.py` (after papers_subj_patch.py): maths wording, a photo of handwritten working on any
  non-Business typed answer (PHOTO, memory only), guideline pictures in self-mark/results, tap-to-zoom pictures,
  picture-only MC in one row, and the AI marker gets the pictures (own-key path sends them itself).
- build_bank.mjs adds `min:1` and `imgs:[question, part, guideline pictures]` to maths entries; worker.js fetches
  those PNGs from ASSETS and sends them as image blocks, plus `photo` (data URL, <= ~2 MB) from the request.
Order: build_subjects -> parse_english/parse_maths -> (fresh app: ... papers_subj_patch -> maths_patch) -> register -> build_exams -> build_bank.
- Maths Standard 2 (27 Oct): same parser, `parse_maths.py <pdfs> subjects/maths-std2-papers.json papers/img/maths-std2 maths-std2 2025,...,2019`
  (15 MC + 85 written, 2.5 h; topics from MS-/MS2- codes). Bank data/mark-bank-ms.json. PDFs copied from
  C:\Users\jonny\bandsix-ops\nesa\maths-std2 via the connected folder's _bandsix_tmp.

## Biology, Chemistry and Physics typed papers (31 Oct 2026)

- Same parser: `parse_maths.py <pdfs> subjects/<sid>-papers.json papers/img/<sid> <sid>` with sid biology|chemistry|physics
  (default years 2025..2019; 20 MC + 80 written; topics from the Mapping Grid's "Mod N" / "M N" codes, area "Module N";
  multi-topic rows whose code sits on the line above/below are handled). Papers carry `pic: true`.
- `exams-src/sci_patch.py` (after maths_patch.py): isPicP(p) = p.pic || maths, so any picture paper sends its pictures to
  the marker, accepts a short or photo-only answer and shows guideline pictures; science placeholder/footer wording and
  a prompt sentence accepting typed chemical/physical notation (H2SO4, ->, 3.0 x 10^8), units and sig figs per criteria.
- build_bank.mjs now uses `p.pic || /^maths/` for min:1 + imgs. Banks: mark-bank-bi/ch/ph.json.
- Known gaps: ch-2024 Q6, Q28, Q29 have no topic (mapping grid layout). bi-2019 Q14 key is "AB" (both accepted), which the app already supports.
Order: build_subjects -> parse_* -> (fresh app: ... papers_subj_patch -> maths_patch -> sci_patch) -> register -> build_exams -> build_bank.
