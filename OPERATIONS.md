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
- `python3 tools/counts.py --check` confirms the landing numbers match the data files.
- Open the PR preview build on a phone and a desktop.
