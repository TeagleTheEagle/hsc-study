# Bands for Days: beta checklist

Blueprint section 20, narrowed to what exists after phase B (no billing yet). Tick each line on the live site, on a phone and a desktop, before inviting other students. Lines marked (auto) are covered by `node tools/check_phase_b.mjs`, `node tools/check_phase_a.mjs` or `bash tools/worker-test/run.sh`; still spot-check them once by hand.

## Accounts and saving

- [ ] Sign up with email, password and class code; the account appears in Supabase > Authentication.
- [ ] Sign in on a second device: the same cards, sets and marked answers are there within a few seconds.
- [ ] (auto) Type half an answer, close the tab, reopen: the draft is still in the box and the word count says "draft kept".
- [ ] (auto) The chip under the account panel says "Saved on this device" when signed out and "Synced <time>" when signed in.
- [ ] (auto) Turn the network off mid-session: the chip says "Offline: saved here, syncs when you are back online"; turn it on: "Synced".
- [ ] (auto) Study on device A, then device B, then A again: nothing is lost and a toast says progress was merged.
- [ ] (auto) After a long idle, an expired session shows "Sign in again" and keeps the local work; signing in again syncs it.
- [ ] Private browsing or full storage shows "Not saving in this browser" instead of failing silently.
- [ ] A second student cannot see the first student's progress (try the leaderboard and a shared link): access isolation holds.

## Install and offline (phase D)

- [ ] Android or desktop Chrome: the "Install Bands for Days" card appears on Today; Install opens the app from the home screen in its own window.
- [ ] iPhone: the card explains Share > Add to Home Screen; after adding, the app opens full screen with the green status bar.
- [ ] (auto) Subjects > Offline: Save a subject, turn on flight mode, open the app: cards, Learn, Test and typed papers work; an unsaved subject says it is not saved on this device.
- [ ] (auto) Offline, the Mark button says marking needs internet and the draft is kept; back online, marking works.
- [ ] After a deploy, an open tab shows "A new version is ready. Reload" and reloads to the new version.

## Marking

- [ ] (auto) A marked answer shows: estimated mark with "Not a NESA result", the criteria row reached, quotes from the student's own words, what is missing for the next row, one next action, and a low-confidence notice when the model is unsure.
- [ ] (auto) Submitting the same answer twice within ten minutes does not use a second free mark.
- [ ] (auto) A failed model call (timeout, outage) says so and does not use a free mark.
- [ ] (auto) The sixth distinct answer in a Sydney day gets the limit message; the counter resets the next day.
- [ ] A photo of handwriting is marked and the transcription is visible.
- [ ] `node tools/marking_bench.mjs` on the PC: agreement at or above 0.85 (record the number and date in last-run.json).

## Business Studies flow

- [ ] Today page: the plan for the day lists the weakest topic first and shows the days to the exam.
- [ ] (auto) A missed exam question adds up to five cards from its topic to the next session, labelled "from a missed exam question".
- [ ] Flashcards, Learn, Test and Match all finish and record XP; Progress shows the change.
- [ ] Ratio drill: all seven ratios, with worked examples.
- [ ] Past papers: every NESA Business paper opens, every typed question can be marked, PDFs download.

## Beta operations

- [ ] `supabase-feedback.sql` has been run; a test feedback message appears in Table editor > feedback.
- [ ] A backup has been taken (`node tools/backup_supabase.mjs backup`) and the restore test in OPERATIONS.md has been done once.
- [ ] Rollback tried once from the Cloudflare dashboard (and rolled forward again).
- [ ] Usage ledger read for one day (`t:<day>` key) and the cost per mark noted.
- [ ] Three to five classmates invited with the class code; ask each for one piece of feedback through the box in Progress.

## Measure during the beta

Activation (signed up and finished one session), seven-day return, marks per student per week, marking disagreements reported through the feedback box, page errors (browser console), and the daily token spend from the ledger. Decide prices and limits for Plus from these numbers before phase C.
