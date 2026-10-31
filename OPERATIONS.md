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
- `node tools/check_phase_c.mjs` (Playwright, Worker routes stubbed): the plan line, Upgrade to Plus only when billing is on, the terms, the hop to checkout and back, Plus wording on marks, plan_limit, cancel-at-period-end, past due, Manage billing. The Worker side of billing is in `tools/worker-test/run.sh` (test_billing.mjs: fake Stripe, signed webhooks, duplicates, out-of-order events, grace week).
- `node tools/check_phase_d.mjs` (Playwright, starts its own server on 8767 and stops it mid-run): worker installs, app and a saved subject load with the server down, marking refused offline with the draft kept, install card, new-version reload.
- `node tools/check_phase_e1.mjs` (Playwright): the Marks report with seeded attempts (topics weakest first, Not assessed, rewrites attempt by attempt, four-week trend, text export, routing).
- `node tools/check_phase_e2.mjs` (Playwright, fake Supabase): class leaderboard, class view, invite link, sign-up pre-fill, no-class-code case.
- `node tools/check_phase_e3.mjs` (Playwright): the exam-style test and Find a question for every subject (Biology modules mapped onto card topics, an MC test with pictures, Legal sections, Modern History written only, English search, Business unchanged).
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

## Classes (phase E2)

Run `supabase-classes.sql` once. It adds `class_code` to `public.scores`, filled by a trigger from the code each student typed at sign-up (`auth.users.raw_user_meta_data`), and back-fills existing rows. To see the classes: `select class_code, count(*) from public.scores group by 1;`. A new class is just a new code: add it to `private.class_codes` (see supabase-hardening.sql) and give classmates the invite link from the class view, which pre-fills the code at sign-up. Since 31 Oct sign-ups no longer need a code (`supabase-open-signups.sql` adds the `'*'` row); delete that row to require one again. Students only ever see nicknames and scores, never emails.

## Feedback table (phase B)

Run `supabase-feedback.sql` once in Supabase > SQL Editor. Students can only insert their own rows; read them in Table editor > feedback.

## Billing: Free and Plus (phase C)

**What is built.** Free stays what the site has always promised: `DAILY_LIMIT` (5) AI marks a day, reset at midnight Sydney. Plus is `PLUS_MONTHLY` (100) AI marks per billing period for `PLUS_PRICE_TEXT` (A$9.99 a month), reset on the renewal date, no rollover. The Worker decides the plan from the KV record `plan:<user id>` (written only by the Stripe webhook) and counts Plus marks in `pm:<user id>:<period start>`; Free marks keep using `u:<user id>:<day>`. Routes: `GET /api/plan`, `POST /api/billing/checkout` (Stripe hosted Checkout), `POST /api/billing/portal` (Stripe customer portal: change card, cancel, receipts), `POST /api/billing/webhook` (signed; idempotent on the event id; an older event never overwrites a newer state). Cancelled-but-paid keeps Plus to the end of the period; a failed renewal keeps Plus for 7 days then drops to Free until the card is fixed. Nothing is charged for features that do not exist: Plus is the larger marking allowance, nothing else.

**Billing is off** until the two secrets and the price id are set. With it off the app shows only the Free plan (no Upgrade button); the checkout and webhook routes answer 503.

**Opening the Stripe account** (the account holder must be 18 or over, so a parent may have to open it, with Ben as a team member):
1. dashboard.stripe.com/register. Business type individual or sole trader is fine; Stripe will ask for ID, an address, and a bank account (BSB and account number) for payouts. If it asks for an ABN, one is free at abr.gov.au. Business name on statements: Bands for Days.
2. Stay in **Test mode** first. Product catalogue > Add product: "Bands for Days Plus", recurring, A$9.99 a month. Copy the price id (`price_…`).
3. Settings > Billing > Customer portal: turn on "Cancel subscriptions", "Update payment methods" and "Invoice history", then Save.
4. Developers > Webhooks > Add endpoint: `https://bandsfordays.com/api/billing/webhook`, events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`. Copy the signing secret (`whsec_…`).
5. Developers > API keys: copy the secret key (`sk_test_…`). Never paste it into chat, a file in the repo, or the site.
6. On the PC, in `C:\Users\jonny\bandsix-ops`:
   `npx wrangler secret put STRIPE_SECRET_KEY --name bandsix` (paste the key when asked), then `npx wrangler secret put STRIPE_WEBHOOK_SECRET --name bandsix`. Secrets survive every GitHub deploy.
7. In wrangler.toml set `STRIPE_PRICE_ID = "price_…"` and push to main. A minute later the account strip shows Upgrade to Plus.
8. Test: sign in, Upgrade to Plus, pay with card 4242 4242 4242 4242 (any future expiry, any CVC). Within a minute the strip says Plus with 100 marks. Mark one answer (the count drops), open Manage billing, cancel: the strip says "ends <date>" and Plus stays until then. Check the KV record: `npx wrangler kv key get plan:<user id> --namespace-id c669400708c643d0b421cb6ec5ffb401`.
9. Go live: switch the dashboard to Live mode and repeat steps 2 to 7 with the live product, live webhook endpoint and live keys (`sk_live_…`, a new `whsec_…`). Make one real purchase and refund it from the dashboard.

**Before charging anyone**, decide and write down: the refund rule (the app says "cancel any time, keep Plus to the end of the paid period"; refunds beyond that are at your discretion, and Australian Consumer Law still applies), and GST (under A$75,000 a year turnover there is no GST registration; the price is shown as the total either way). Put the answer in BETA-CHECKLIST.md.

**Kill switch.** Set `STRIPE_PRICE_ID = ""` and push: Upgrade disappears, existing subscribers keep their Plus allowance and the webhook keeps running. Removing the webhook secret stops plan updates (Stripe retries for 3 days), so only do that to stop everything.

**Support.** "Where is my Plus?" means the webhook has not landed: check Developers > Webhooks > the endpoint > recent deliveries (a 2xx means applied; a 502 means Stripe could not be reached from the Worker and it will retry). To fix a record by hand: `npx wrangler kv key put plan:<user id> '{"plan":"plus","status":"active","customer":"cus_…","sub":"sub_…","periodStart":<unix>,"periodEnd":<unix>,"cancelAtPeriodEnd":false,"updated":<unix>}' --namespace-id c669400708c643d0b421cb6ec5ffb401`.

