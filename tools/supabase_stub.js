// A stand-in for supabase-js used by tools/check_phase_b.mjs (served in place of the CDN script).
// State lives in window.__db so the test can play "another device" and failures.
window.supabase = { createClient() {
  const db = window.__db = window.__db || { progress: null, scores: [], feedback: [], writes: 0, fail: null, session: { user: { id: 'u-test', email: 'test@example.com' }, access_token: 'tok' } };
  function from(table) {
    let op = 'select', cols = '*', single = null, payload = null;
    const pick = r => { if (!r) return r; if (cols === '*') return r; const o = {}; for (const c of cols.split(',')) o[c.trim()] = r[c.trim()]; return o; };
    function run() {
      if (db.fail) return { data: null, error: { message: db.fail === 'PGRST301' ? 'JWT expired' : 'boom', code: db.fail } };
      if (table === 'progress') {
        if (op === 'upsert') { db.progress = { user_id: payload.user_id, doc: payload.doc, updated_at: new Date().toISOString() }; db.writes++; return { data: single ? pick(db.progress) : [pick(db.progress)], error: null }; }
        return { data: db.progress ? pick(db.progress) : null, error: null };
      }
      if (table === 'scores') return { data: applyF(db.scores), error: null };
      if (table === 'feedback') { if (op === 'insert') db.feedback.push(payload); return { data: null, error: null }; }
      return { data: null, error: null };
    }
    const filters = []; let ordering = null; const applyF = rows => { if (!Array.isArray(rows)) return rows; let out = rows.filter(r => filters.every(([k, v]) => r[k] === v)); if (ordering) { const [c, asc] = ordering; out = out.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); } return out; };
    const b = { select(c) { cols = c || '*'; return b; }, eq(k, v) { filters.push([k, v]); return b; }, order(col, o) { ordering = [col, !(o && o.ascending === false)]; return b; }, limit() { return b; }, maybeSingle() { single = 'maybe'; return b; }, single() { single = 'one'; return b; },
      upsert(p) { op = 'upsert'; payload = p; return b; }, insert(p) { op = 'insert'; payload = p; return b; },
      then(res, rej) { return new Promise(r => setTimeout(r, 5)).then(run).then(res, rej); } };
    return b;
  }
  return { from, auth: { async getSession() { return { data: { session: db.session } }; }, async signInWithPassword() { return { data: { session: db.session }, error: null }; }, async signUp() { return { data: { session: db.session }, error: null }; }, async signOut() { db.session = null; return {}; } } };
} };
