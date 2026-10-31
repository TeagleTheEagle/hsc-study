// Bands for Days Worker (Cloudflare Worker "bandsix"): serves the static site, plus /api/mark, which marks a typed past-paper
// answer with Claude for signed-in students (Free: DAILY_LIMIT a day each; Plus: PLUS_MONTHLY a month; GLOBAL_DAILY_CAP site-wide),
// /api/quota and /api/plan (what the student has left), and /api/billing/* (Stripe hosted checkout, billing portal, webhook).
// Secrets (wrangler secret put): ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET. None of them ever reaches the browser.
// Billing is off until STRIPE_SECRET_KEY and STRIPE_PRICE_ID are set; then the site shows Upgrade to Plus (blueprint 12 to 16).
import Anthropic from '@anthropic-ai/sdk';

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    mark: { type: 'integer' },
    band: { type: 'string' },
    verdict: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    next: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    model: { type: 'string' },
  },
  required: ['mark', 'band', 'verdict', 'strengths', 'improvements', 'evidence', 'missing', 'next', 'confidence', 'model'],
  additionalProperties: false,
};

// Business prompts are in data/mark-bank.json; other subjects in data/mark-bank-<prefix>.json,
// where the prefix starts the paper id (en-adv-2025-p1|3 -> en).
const BANKS = {};
async function bank(env, url, key) {
  const m = /^([a-z]{2,4})-/.exec(key || '');
  const file = m ? `/data/mark-bank-${m[1]}.json` : '/data/mark-bank.json';
  if (!BANKS[file]) {
    const res = await env.ASSETS.fetch(new URL(file, url));
    if (!res.ok) return {};
    BANKS[file] = await res.json();
  }
  return BANKS[file];
}

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

function sydneyDay() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

async function userFromToken(env, token) {
  const res = await fetch(env.SUPA_URL + '/auth/v1/user', {
    headers: { apikey: env.SUPA_KEY, authorization: 'Bearer ' + token },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u && u.id ? u : null;
}

function parseResult(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}

function normalise(res, max) {
  let m = Number(res && res.mark); if (!isFinite(m)) m = 0;
  m = Math.max(0, Math.min(max, Math.round(m)));
  const arr = x => Array.isArray(x) ? x.map(String).slice(0, 4) : (x ? [String(x)] : []);
  const conf = /^(high|medium|low)$/.test(String(res.confidence || '')) ? String(res.confidence) : '';
  return { mark: m, band: String(res.band || ''), verdict: String(res.verdict || ''), strengths: arr(res.strengths), improvements: arr(res.improvements), evidence: arr(res.evidence), missing: arr(res.missing), next: String(res.next || '').slice(0, 300), confidence: conf, model: String(res.model || '') };
}

// One marking call: 90 s timeout, one automatic retry on a network error or 5xx (the SDK never retries a 4xx).
async function askClaude(env, content) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90000, maxRetries: 1, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });
  const model = env.MODEL || 'claude-opus-5-5';
  const textOf = r => r.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  let response;
  try {
    response = await client.beta.messages.create({
      model, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
  } catch (error) {
    // A request-shape problem (an option this model or account doesn't take): retry once with the plain request.
    if (!(error instanceof Anthropic.BadRequestError)) throw error;
    response = await client.messages.create({
      model, max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content }],
    });
  }
  if (response.stop_reason === 'refusal') throw { code: 'refusal' };
  const parsed = parseResult(textOf(response));
  if (!parsed) throw { code: 'invalid_json' };
  const u = response.usage || {};
  return { parsed, usage: { in: Number(u.input_tokens || 0), out: Number(u.output_tokens || 0) }, model: response.model || model };
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
// Usage ledger (blueprint 14): one KV record per mark for 35 days, plus a running daily total.
// Read them with: npx wrangler kv key list --namespace-id c669400708c643d0b421cb6ec5ffb401 --prefix l:2026-10-31
async function ledger(env, day, rec) {
  const ttl = { expirationTtl: 60 * 60 * 24 * 35 };
  const key = 'l:' + day + ':' + String(rec.t).padStart(13, '0') + ':' + rec.u.slice(0, 8);
  const tot = JSON.parse((await env.MARKS.get('t:' + day)) || '{"n":0,"in":0,"out":0,"ms":0}');
  tot.n += 1; tot.in += rec.in; tot.out += rec.out; tot.ms += rec.ms;
  await Promise.all([env.MARKS.put(key, JSON.stringify(rec), ttl), env.MARKS.put('t:' + day, JSON.stringify(tot), ttl)]);
}

// Maths entries list the question and marking-guideline pictures (served from the site) to send with the prompt.
function b64(buf) {
  const a = new Uint8Array(buf); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
async function imageBlock(env, url, path) {
  const res = await env.ASSETS.fetch(new URL('/' + path, url));
  if (!res.ok) return null;
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(await res.arrayBuffer()) } };
}
// A photo of handwritten working: a JPEG/PNG/WebP data URL under about 2 MB. null = none, false = not acceptable.
function photoBlock(photo) {
  if (!photo) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(photo));
  if (!m || m[2].length > 2800000) return false;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

async function mark(request, env) {
  if (request.method !== 'POST') return json(405, { code: 'method' });
  if (!env.ANTHROPIC_API_KEY) return json(503, { code: 'not_configured' });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { code: 'sign_in' });
  let body;
  try { body = await request.json(); } catch (e) { return json(400, { code: 'bad_request' }); }
  const answer = String((body && body.answer) || '').trim();
  const key = String((body && body.key) || '');
  const photo = photoBlock(body && body.photo);
  if (photo === false) return json(400, { code: 'bad_photo' });

  const entry = (await bank(env, request.url, key))[key];
  if (!entry) return json(404, { code: 'unknown_question' });
  if (!photo && answer.split(/\s+/).filter(Boolean).length < (entry.min || 8)) return json(400, { code: 'too_short' });

  const user = await userFromToken(env, token);
  if (!user) return json(401, { code: 'sign_in' });

  const day = sydneyDay();
  const cap = Number(env.GLOBAL_DAILY_CAP || 300);
  const a = await allowance(env, user.id); const limit = a.limit, used = a.used;
  const ukey = a.key, gkey = 'g:' + day;
  // The same answer sent again within 10 minutes (a double tap, a retry after a dropped connection) gets the
  // same result and is not counted twice (blueprint 14).
  const rkey = 'r:' + (await sha256(user.id + '|' + key + '|' + answer + '|' + (photo ? photo.source.data.length : 0)));
  const [total, repeat] = await Promise.all([env.MARKS.get(gkey), env.MARKS.get(rkey)]).then(v => [Number(v[0] || 0), v[1]]);
  if (repeat) { try { return json(200, { result: JSON.parse(repeat), ...allowanceOut(a), repeated: true }); } catch (e) { /* fall through and mark again */ } }
  if (used >= limit) return json(429, { code: a.plan === 'plus' ? 'plan_limit' : 'daily_limit', ...allowanceOut(a), left: 0 });
  if (total >= cap) return json(503, { code: 'busy_today' });

  let result, usage = { in: 0, out: 0 }, modelUsed = '';
  const t0 = Date.now();
  try {
    const text = entry.pre + answer.slice(0, 12000) + entry.post;
    const imgs = (await Promise.all((entry.imgs || []).map(p => imageBlock(env, request.url, p)))).filter(Boolean);
    if (photo) imgs.push(photo);
    const out = await askClaude(env, imgs.length ? [...imgs, { type: 'text', text }] : text);
    result = normalise(out.parsed, entry.max); usage = out.usage; modelUsed = out.model;
  } catch (error) {
    // A failed job never consumes the student's allowance.
    if (error instanceof Anthropic.RateLimitError) return json(503, { code: 'rate_limited' });
    if (Anthropic.APIConnectionTimeoutError && error instanceof Anthropic.APIConnectionTimeoutError) return json(504, { code: 'timeout' });
    if (error instanceof Anthropic.APIError) return json(502, { code: 'upstream', status: error.status });
    return json(502, { code: (error && error.code) || 'upstream' });
  }
  const ttl = { expirationTtl: 60 * 60 * 48 };
  await Promise.all([
    env.MARKS.put(ukey, String(used + 1), { expirationTtl: a.ttl }), env.MARKS.put(gkey, String(total + 1), ttl),
    env.MARKS.put(rkey, JSON.stringify(result), { expirationTtl: 600 }),
    ledger(env, day, { t: Date.now(), u: user.id, k: key, mark: result.mark, max: entry.max, conf: result.confidence, in: usage.in, out: usage.out, ms: Date.now() - t0, model: modelUsed, photo: !!photo, plan: a.plan }).catch(() => {}),
  ]);
  return json(200, { result, ...allowanceOut(a), used: used + 1, left: Math.max(0, limit - used - 1) });
}

// ---------- plans and entitlements (blueprint 12 to 16) ----------
// Free: DAILY_LIMIT AI marks a day (the promise the site has made since launch; blueprint 15 says never cut it quietly).
// Plus: PLUS_MONTHLY marks per billing period, reset on the renewal date; no rollover.
// The plan record plan:<uid> in KV is written only by the Stripe webhook, so entitlements are enforced server-side.
function billingOn(env) { return !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID); }
async function planRecord(env, uid) {
  try { return JSON.parse((await env.MARKS.get('plan:' + uid)) || 'null'); } catch (e) { return null; }
}
const PAST_DUE_GRACE = 7 * 86400;
function isPlus(rec, now = Date.now() / 1000) {
  if (!rec || rec.plan !== 'plus') return false;
  if (rec.status === 'active' || rec.status === 'trialing') return true;
  if (rec.status === 'canceled') return Number(rec.periodEnd || 0) > now;           // cancelled but paid: access to the end of the period
  if (rec.status === 'past_due') return Number(rec.periodStart || 0) + PAST_DUE_GRACE > now;  // a failed renewal gets a week to fix the card
  return false;
}
function nextSydneyMidnight() {
  const d = new Date(); for (let i = 1; i <= 48; i++) { const t = new Date(d.getTime() + i * 1800000); if (t.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) !== sydneyDay()) { const h = t.toLocaleTimeString('en-GB', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit' }); if (h <= '00:30') return t.toISOString(); } }
  return new Date(d.getTime() + 86400000).toISOString();
}
// What a student may use right now: { plan, status, limit, used, left, period: 'day'|'month', resets, key }.
async function allowance(env, uid) {
  const rec = await planRecord(env, uid);
  if (isPlus(rec)) {
    const key = 'pm:' + uid + ':' + Number(rec.periodStart || 0), limit = Number(env.PLUS_MONTHLY || 100);
    const used = Number((await env.MARKS.get(key)) || 0);
    return { plan: 'plus', status: rec.status, limit, used, left: Math.max(0, limit - used), period: 'month', resets: new Date(Number(rec.periodEnd || 0) * 1000).toISOString(), cancelAtPeriodEnd: !!rec.cancelAtPeriodEnd, key, ttl: 60 * 86400 };
  }
  const key = 'u:' + uid + ':' + sydneyDay(), limit = Number(env.DAILY_LIMIT || 5);
  const used = Number((await env.MARKS.get(key)) || 0);
  return { plan: 'free', status: rec && rec.plan === 'plus' ? rec.status : 'none', limit, used, left: Math.max(0, limit - used), period: 'day', resets: nextSydneyMidnight(), key, ttl: 48 * 3600 };
}
function allowanceOut(a) { return { plan: a.plan, status: a.status, limit: a.limit, used: a.used, left: a.left, period: a.period, resets: a.resets, cancelAtPeriodEnd: !!a.cancelAtPeriodEnd }; }

async function quota(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const limit = Number(env.DAILY_LIMIT || 5);
  if (!env.ANTHROPIC_API_KEY) return json(200, { on: false, limit, billing: billingOn(env) });
  if (!token) return json(200, { on: true, limit, left: null, billing: billingOn(env) });
  const user = await userFromToken(env, token);
  if (!user) return json(200, { on: true, limit, left: null, billing: billingOn(env) });
  const a = await allowance(env, user.id);
  return json(200, { on: true, billing: billingOn(env), ...allowanceOut(a) });
}

// GET /api/plan: the student's plan and allowance for the account panel.
async function plan(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const base = { billing: billingOn(env), price: env.PLUS_PRICE_TEXT || 'A$9.99 a month', plusMonthly: Number(env.PLUS_MONTHLY || 100), dailyFree: Number(env.DAILY_LIMIT || 5) };
  if (!token) return json(200, { ...base, plan: 'free', signedIn: false });
  const user = await userFromToken(env, token);
  if (!user) return json(401, { code: 'sign_in' });
  const a = await allowance(env, user.id); const rec = await planRecord(env, user.id);
  return json(200, { ...base, signedIn: true, ...allowanceOut(a), periodEnd: rec && rec.periodEnd ? new Date(rec.periodEnd * 1000).toISOString() : null, hasCustomer: !!(rec && rec.customer) });
}

// ---------- Stripe (hosted checkout, billing portal, signed webhooks; no card data ever touches this code) ----------
function form(params, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) v.forEach((x, i) => out.push(typeof x === 'object' ? form(x, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`));
    else if (typeof v === 'object') out.push(form(v, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}
async function stripe(env, method, path, params, idem) {
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method, headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'content-type': 'application/x-www-form-urlencoded', ...(idem ? { 'idempotency-key': idem } : {}) },
    body: method === 'GET' ? undefined : form(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((data.error && data.error.message) || 'stripe'), { code: 'stripe', status: res.status });
  return data;
}
function siteOrigin(request, env) { return env.SITE_ORIGIN || new URL(request.url).origin; }

// POST /api/billing/checkout -> { url } of a Stripe Checkout page for Plus.
async function checkout(request, env) {
  if (request.method !== 'POST') return json(405, { code: 'method' });
  if (!billingOn(env)) return json(503, { code: 'billing_off' });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token ? await userFromToken(env, token) : null;
  if (!user) return json(401, { code: 'sign_in' });
  const rec = await planRecord(env, user.id);
  if (isPlus(rec)) return json(409, { code: 'already_plus' });
  const origin = siteOrigin(request, env);
  const params = {
    mode: 'subscription', client_reference_id: user.id, allow_promotion_codes: 'true',
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: origin + '/app.html?billing=success#home', cancel_url: origin + '/app.html?billing=cancel#home',
    metadata: { uid: user.id }, subscription_data: { metadata: { uid: user.id } },
  };
  if (rec && rec.customer) params.customer = rec.customer; else if (user.email) params.customer_email = user.email;
  try {
    const session = await stripe(env, 'POST', '/checkout/sessions', params, 'co:' + user.id + ':' + Math.floor(Date.now() / 60000));
    return json(200, { url: session.url });
  } catch (e) { return json(502, { code: 'stripe', message: String(e.message || '').slice(0, 200) }); }
}

// POST /api/billing/portal -> { url } of the Stripe customer portal (change card, cancel, receipts).
async function portal(request, env) {
  if (request.method !== 'POST') return json(405, { code: 'method' });
  if (!billingOn(env)) return json(503, { code: 'billing_off' });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token ? await userFromToken(env, token) : null;
  if (!user) return json(401, { code: 'sign_in' });
  const rec = await planRecord(env, user.id);
  if (!rec || !rec.customer) return json(404, { code: 'no_customer' });
  try {
    const session = await stripe(env, 'POST', '/billing_portal/sessions', { customer: rec.customer, return_url: siteOrigin(request, env) + '/app.html#home' });
    return json(200, { url: session.url });
  } catch (e) { return json(502, { code: 'stripe', message: String(e.message || '').slice(0, 200) }); }
}

// POST /api/account/delete: called by the app just before the Supabase function delete_my_account removes the user.
// Cancels a live Plus subscription at Stripe (no refund logic here; see OPERATIONS.md "Billing") and forgets the billing record,
// so a deleted account can never keep being charged. Safe when billing is off or the student never paid.
async function accountDelete(request, env) {
  if (request.method !== 'POST') return json(405, { code: 'method' });
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = token ? await userFromToken(env, token) : null;
  if (!user) return json(401, { code: 'sign_in' });
  const rec = await planRecord(env, user.id);
  let cancelled = false;
  if (rec && rec.sub && billingOn(env) && rec.status !== 'canceled') {
    try { await stripe(env, 'DELETE', '/subscriptions/' + encodeURIComponent(rec.sub)); cancelled = true; }
    catch (e) { if (!/No such subscription/i.test(String(e.message || ''))) return json(502, { code: 'stripe', message: String(e.message || '').slice(0, 200) }); }
  }
  await Promise.all([env.MARKS.delete('plan:' + user.id), rec && rec.customer ? env.MARKS.delete('cust:' + rec.customer) : null]);
  return json(200, { ok: true, cancelled });
}

// Stripe-Signature: t=<unix>,v1=<hmac sha256 of "<t>.<body>">; reject anything older than 5 minutes.
async function verifyStripe(secret, header, body) {
  const parts = Object.fromEntries(String(header || '').split(',').map(x => x.split('=')).filter(x => x.length === 2));
  const t = Number(parts.t), v1 = parts.v1; if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + body)))].map(b => b.toString(16).padStart(2, '0')).join('');
  if (sig.length !== v1.length) return false;
  let diff = 0; for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
// A subscription object (from an event or a fetch) becomes the plan record. Newer Stripe API versions keep the period on the item.
function periodOf(sub) {
  const item = sub.items && sub.items.data && sub.items.data[0];
  return { start: Number(sub.current_period_start || (item && item.current_period_start) || 0), end: Number(sub.current_period_end || (item && item.current_period_end) || 0) };
}
async function applySubscription(env, sub, uid, at) {
  uid = uid || (sub.metadata && sub.metadata.uid) || (sub.customer ? await env.MARKS.get('cust:' + sub.customer) : null);
  if (!uid) return false;
  const cur = await planRecord(env, uid);
  if (cur && cur.updated && at && at < cur.updated) return false;   // an older event arriving late never overwrites a newer state
  const per = periodOf(sub);
  const rec = { plan: 'plus', status: String(sub.status || ''), customer: String(sub.customer || ''), sub: String(sub.id || ''), periodStart: per.start, periodEnd: per.end, cancelAtPeriodEnd: !!sub.cancel_at_period_end, updated: at || Math.floor(Date.now() / 1000) };
  await Promise.all([env.MARKS.put('plan:' + uid, JSON.stringify(rec)), sub.customer ? env.MARKS.put('cust:' + sub.customer, uid) : null]);
  return true;
}
// POST /api/billing/webhook: idempotent on the event id; handles checkout completed, subscription changes and invoices.
async function webhook(request, env) {
  if (request.method !== 'POST') return json(405, { code: 'method' });
  if (!env.STRIPE_WEBHOOK_SECRET) return json(503, { code: 'billing_off' });
  const body = await request.text();
  if (!(await verifyStripe(env.STRIPE_WEBHOOK_SECRET, request.headers.get('stripe-signature'), body))) return json(400, { code: 'bad_signature' });
  let event; try { event = JSON.parse(body); } catch (e) { return json(400, { code: 'bad_request' }); }
  if (!event || !event.id || !event.type) return json(400, { code: 'bad_request' });
  if (await env.MARKS.get('evt:' + event.id)) return json(200, { received: true, duplicate: true });
  const obj = (event.data && event.data.object) || {}; const at = Number(event.created || 0);
  let applied = false;
  try {
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription' && obj.subscription) {
      const uid = obj.client_reference_id || (obj.metadata && obj.metadata.uid);
      if (uid && obj.customer) await env.MARKS.put('cust:' + obj.customer, uid);
      const sub = await stripe(env, 'GET', '/subscriptions/' + obj.subscription);
      applied = await applySubscription(env, sub, uid, at);
    } else if (/^customer\.subscription\.(created|updated|deleted|paused|resumed)$/.test(event.type)) {
      applied = await applySubscription(env, obj, null, at);
    } else if (/^invoice\.(paid|payment_failed|payment_action_required)$/.test(event.type)) {
      const subId = typeof obj.subscription === 'string' ? obj.subscription : (obj.subscription && obj.subscription.id) || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
      if (subId) { const sub = await stripe(env, 'GET', '/subscriptions/' + subId); applied = await applySubscription(env, sub, null, at); }
    }
  } catch (e) { return json(502, { code: 'stripe', message: String(e.message || '').slice(0, 200) }); }   // Stripe retries a non-2xx
  await env.MARKS.put('evt:' + event.id, '1', { expirationTtl: 30 * 86400 });
  return json(200, { received: true, applied });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/mark') return await mark(request, env);
      if (pathname === '/api/quota') return await quota(request, env);
      if (pathname === '/api/plan') return await plan(request, env);
      if (pathname === '/api/billing/checkout') return await checkout(request, env);
      if (pathname === '/api/billing/portal') return await portal(request, env);
      if (pathname === '/api/billing/webhook') return await webhook(request, env);
      if (pathname === '/api/account/delete') return await accountDelete(request, env);
    } catch (e) {
      return json(500, { code: 'server_error' });
    }
    if (pathname.startsWith('/api/')) return json(404, { code: 'not_found' });
    return env.ASSETS.fetch(request);
  },
};
