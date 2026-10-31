#!/usr/bin/env node
// Bands for Days: back up (or restore) the account data in Supabase.
//
// Backup (run on your own PC, never in a shared place):
//   set SUPABASE_URL=https://<project>.supabase.co
//   set SUPABASE_SERVICE_KEY=<service_role key from Supabase > Project settings > API>
//   node tools/backup_supabase.mjs backup
// Writes backups/<date>/users.json, progress.json and scores.json (the folder is git-ignored).
//
// Restore into a project (a scratch project for a restoration test, or the real one after an accident):
//   node tools/backup_supabase.mjs restore backups/2026-10-31 --yes
// Restore writes progress and scores rows (upsert by user_id). Users are listed, not recreated:
// Supabase keeps auth.users separately, so restore after the users exist (same ids), or
// restore into the same project where they still exist.
//
// The service key is read from the environment only; it is never written to disk or printed.
import fs from 'node:fs';
import path from 'node:path';

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY || '';
const [cmd, arg, flag] = process.argv.slice(2);

function die(msg) { console.error(msg); process.exit(1); }
if (!URL_ || !KEY) die('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment first.');
const H = { apikey: KEY, authorization: 'Bearer ' + KEY, 'content-type': 'application/json' };

async function getAll(table) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const r = await fetch(`${URL_}/rest/v1/${table}?select=*&order=user_id.asc`, { headers: { ...H, range: `${from}-${from + page - 1}`, prefer: 'count=exact' } });
    if (!r.ok) die(`${table}: HTTP ${r.status} ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < page) return out;
  }
}
async function listUsers() {
  const out = [];
  for (let p = 1; ; p++) {
    const r = await fetch(`${URL_}/auth/v1/admin/users?page=${p}&per_page=1000`, { headers: H });
    if (!r.ok) die(`users: HTTP ${r.status} ${await r.text()}`);
    const d = await r.json(); const us = d.users || [];
    out.push(...us.map(u => ({ id: u.id, email: u.email, created_at: u.created_at, last_sign_in_at: u.last_sign_in_at, class_code: u.user_metadata && u.user_metadata.class_code })));
    if (us.length < 1000) return out;
  }
}

if (cmd === 'backup') {
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join('backups', day); fs.mkdirSync(dir, { recursive: true });
  const [users, progress, scores] = await Promise.all([listUsers(), getAll('progress'), getAll('scores')]);
  fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(users, null, 1));
  fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(progress));
  fs.writeFileSync(path.join(dir, 'scores.json'), JSON.stringify(scores, null, 1));
  const bytes = fs.statSync(path.join(dir, 'progress.json')).size;
  console.log(`Backed up ${users.length} users, ${progress.length} progress docs (${(bytes / 1048576).toFixed(1)} MB) and ${scores.length} score rows to ${dir}/`);
  const missing = users.filter(u => !progress.some(p => p.user_id === u.id)).length;
  if (missing) console.log(`${missing} user(s) have no progress row yet (they never saved anything), which is normal.`);
} else if (cmd === 'restore') {
  if (!arg || !fs.existsSync(path.join(arg, 'progress.json'))) die('Give the backup folder, e.g. backups/2026-10-31');
  if (flag !== '--yes') die(`This would overwrite progress and scores rows in ${URL_}. Add --yes to go ahead.`);
  for (const table of ['progress', 'scores']) {
    const rows = JSON.parse(fs.readFileSync(path.join(arg, table + '.json'), 'utf8'));
    for (let i = 0; i < rows.length; i += 200) {
      const r = await fetch(`${URL_}/rest/v1/${table}?on_conflict=user_id`, { method: 'POST', headers: { ...H, prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 200)) });
      if (!r.ok) die(`${table} restore: HTTP ${r.status} ${await r.text()}`);
    }
    console.log(`Restored ${rows.length} ${table} rows.`);
  }
  console.log('Done. Open the site, sign in as a test account and check that progress loads.');
} else {
  die('Usage: node tools/backup_supabase.mjs backup | restore <folder> --yes');
}
