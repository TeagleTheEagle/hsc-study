# Bands for Days: operations runbook

What runs where, how to back it up, and how to roll back. Blueprint section 1 and 19.

## What runs where

| Piece | Where | Changed by |
|---|---|---|
| Site and API | Cloudflare Worker `bandsix` (static assets from this repo + `worker.js`), custom domains bandsfordays.com and www | every push to `main` (Workers Builds); PRs get preview builds |
| Resource and NESA PDFs | R2 bucket `bandsix-files`, public at files.bandsfordays.com | `wrangler r2 object put` from the PC (see cloudflare-deploy.md in the project files) |
| Marking counters | KV namespace `MARKS` (keys expire after 2 days) | the Worker |
| Accounts and progress | Supabase project "HSC Business Hub" (Sydney): `auth.users`, `public.progress` (one JSON doc per student), `public.scores` (leaderboard, computed by a trigger) | the app, through the publishable key and row-level security |
| Anthropic key | Worker secret `ANTHROPIC_API_KEY` | `npx wrangler secret put ANTHROPIC_API_KEY --name bandsix` on the PC |
| Old address | GitHub Pages at teagletheeagle.github.io/hsc-study (serves `main` too) | same pushes |

Names like `bandsix` are infrastructure identifiers and stay as they are; only what students see says Bands for Days.

## Backups

- Code and content: this git repo is the backup. Before a big change, tag the last good commit (for example `git tag v2026-10-31-band-six && git push origin v2026-10-31-band-six`) so the old site can be rebuilt from it.
- Student data: run `node tools/backup_supabase.mjs backup` on your PC with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set in that terminal only (the service-role key is in Supabase > Project settings > API; never paste it into the site, the repo or a chat). It writes `backups/<date>/users.json`, `progress.json`, `scores.json`. Keep the folder somewhere private (OneDrive is fine); it is git-ignored.
- Supabase also keeps its own daily backups on paid plans; on the Free plan the script above is the backup, so run it weekly and before any migration.
- PDFs: the originals are on the PC and in /mnt/project-files/hsc-study/res-pdf; R2 is not the only copy.

## Restoration test (do this once, and after any schema change)

1. Create a scratch Supabase project, run `supabase-setup.sql` and `supabase-hardening.sql` in it (both in the project files).
2. Create one or two test users in it with the same ids as in `users.json` (Authentication > Users > Add user, or `auth.admin.createUser` with the `id` given), or just restore into the real project where the users still exist.
3. `set SUPABASE_URL=<scratch project>` and its service key, then `node tools/backup_supabase.mjs restore backups/<date> --yes`.
4. Point a local copy of `app.html` at the scratch project (the `SUPA` constant near the end of the file) and sign in as a test user: progress, sets and marked answers should be there.

## Rollback

- Site code: Cloudflare dashboard > Workers & Pages > bandsix > Deployments > Rollback to the previous version (instant), or `npx wrangler rollback --name bandsix` on the PC. A `git revert` on `main` does the same through the normal build.
- Data: `node tools/backup_supabase.mjs restore backups/<date> --yes` puts the backed-up progress and scores rows back (upsert by user id). Anything saved after the backup is lost for those rows, so take a fresh backup first and restore only the users who need it if possible.
- Content files (subjects/*.json, data/*.json, papers/): git revert.

## Migrations

The progress doc has a version (`v`, now 5). The app upgrades older docs on load (`mergeRemote` and `migrateIds` in app.html) and never deletes fields it does not know. When a new version is introduced: back up first, keep the old merge path, ship, then spot-check one real account.

## Checks before a release

- `node tools/check_phase_a.mjs` (Playwright) against a local server: navigation, hashes, subject links, counts.
- `node tools/check_phase_b.mjs` (Playwright, uses `tools/supabase_stub.js` instead of the real Supabase): drafts, the save-status chip, retries, offline, expired sessions, merge of newer progress from another device, the marking feedback layout, missed-question boost, feedback box.
- `bash tools/worker-test/run.sh`: the Worker with a stub Anthropic SDK: first mark, repeat not counted, ledger, failed job not counted, too-short answer, limits.
- `node tools/check_phase_d.mjs` (Playwright, starts its own server on 8767 and stops it mid-run): worker installs, app and a saved subject load with the server down, marking refused offline with the draft kept, install card, new-version reload.
- `node tools/check_phase_e1.mjs` (Playwright): the Marks report with seeded attempts (topics weakest first, Not assessed, rewrites attempt by attempt, four-week trend, text export, routing).
- `python3 tools/counts.py --check` confirms the landing numbers match the data files.
- `python3 tools/sw_version.py` has been run (git diff should show sw.js when app.html changed).
- Open the PR preview build on a phone and a desktop.

## Offline and the service worker (phase D)

`sw.js` at the site root keeps the app shell (app.html, index.html, manifest, icons) and the subject files a student has opened or saved under Subjects > Offline, so cards, Learn, Test, Match and typed papers work without internet. `/api/*`, Supabase and Anthropic are never cached. `tools/sw_version.py` stamps `VERSION` in sw.js from a hash of app.html, index.html and the manifest; run it after any build step (the build chain in BUILD-README.md ends with it). A browser only installs a new worker when the file's bytes change, so a release that forgets the stamp still updates app.html for online students (network-first) but leaves the offline shell on the old version.

- Update flow: a student with the old version open sees "A new version is ready. Reload" and reloads when they choose; a fresh visit gets the new shell on the next load.
- Rollback: a Cloudflare rollback serves the old sw.js again, and because its VERSION differs the browser installs it as a new worker; nothing special to do.
- Kill switch: if the worker ever misbehaves, deploy an sw.js whose install handler calls `self.registration.unregister()` and whose activate handler deletes every `bfd-*` cache; students drop back to plain online use on their next visit.
- Storage: per student roughly 3 MB for the shell, 0.2 to 1 MB per saved subject, plus paper pictures seen (capped at 400 files).

## Marking usage ledger (phase B)

Every successful mark writes two KV records in `MARKS` (35-day expiry): `l:<day>:<timestamp>:<first 8 chars of user id>` with the question key, tokens in and out, model and duration, and a running total `t:<day>` (`{n, in, out}`). Repeated identical answers within ten minutes return the cached result and are not counted; a failed model call returns 502, 503 or 504 and is not counted either.

To read a day's totals on the PC:

```
npx wrangler kv key get --namespace-id c669400708c643d0b421cb6ec5ffb401 t:2026-11-01
npx wrangler kv key list --namespace-id c669400708c643d0b421cb6ec5ffb401 --prefix l:2026-11-01
```

Rough cost per mark: input tokens x $5 per million plus output tokens x $25 per million for Opus. The daily total gives the day's spend; compare it with the global cap (`GLOBAL_DAILY_CAP`).

## Marking benchmark (phase B)

`tools/bench/business.json` holds 46 cases built from the sample answers in the Business question bank (`node tools/make_bench.mjs` regenerates it) plus two handwritten partial answers in `handwritten.json`. `node tools/marking_bench.mjs` runs them through the same prompt the site uses and writes `tools/bench/last-run.json` with the agreement rate. It needs `ANTHROPIC_API_KEY` in the terminal environment (never in a file). Release rule: agreement at or above 0.85 before changing the prompt on `main`; run it on the PC when the prompt or the model changes.

## Feedback table (phase B)

Run `supabase-feedback.sql` once in Supabase > SQL Editor. Students can only insert their own rows; read them in Table editor > feedback.
