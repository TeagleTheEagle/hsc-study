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

// Marking prompts: one small file per question in data/mark/<key>.json ('|' written as '__'), built by tools/split_bank.py
// from the per-subject banks (data/mark-bank.json for Business, data/mark-bank-<prefix>.json for the rest, where the
// prefix starts the paper id: en-adv-2025-p1|3 -> en). The Worker reads the small file, so a mark parses a few KB:
// on the Workers Free plan a request gets 10 ms of CPU and parsing a whole 1 MB bank used it up (error 1102, no mark).
// The big bank is only a fallback for a question whose small file is missing.
const BANKS = {}, ENTRIES = {};
async function entryFor(env, url, key) {
  if (!/^[A-Za-z0-9|_.()-]{1,80}$/.test(key) || key.includes('__')) return null;
  if (ENTRIES[key]) return ENTRIES[key];
  const small = await env.ASSETS.fetch(new URL('/data/mark/' + key.replace(/\|/g, '__') + '.json', url));
  if (small.ok) { try { const e = await small.json(); if (e && e.pre) { ENTRIES[key] = e; return e; } } catch (e) { /* fall through to the bank */ } }
  const m = /^([a-z]{2,4})-/.exec(key);
  const file = m ? `/data/mark-bank-${m[1]}.json` : '/data/mark-bank.json';
  if (!BANKS[file]) {
    const res = await env.ASSETS.fetch(new URL(file, url));
    if (!res.ok) return null;
    BANKS[file] = await res.json();
  }
  return BANKS[file][key] || null;
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
// `pics` are site paths of question and marking-guideline pictures (Maths, sciences). They go by URL, so Anthropic fetches
// them from the site and the Worker spends no CPU on base64; the retry inlines them in case a URL could not be fetched.
async function askClaude(env, text, pics, photo, siteUrl) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90000, maxRetries: 1, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });
  const model = env.MODEL || 'claude-opus-5-5';
  const textOf = r => r.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const content = blocks => blocks.length ? [...blocks, { type: 'text', text }] : text;
  let response;
  try {
    const blocks = [...pics.map(p => imageUrlBlock(siteUrl, p)), ...(photo ? [photo] : [])];
    response = await client.beta.messages.create({
      model, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [{ role: 'user', content: content(blocks) }],
    });
  } catch (error) {
    // A request-shape problem (an option this model or account doesn't take, or a picture Anthropic could not fetch):
    // retry once with the plain request and the pictures inlined.
    if (!(error instanceof Anthropic.BadRequestError)) throw error;
    const inlined = (await Promise.all(pics.map(p => imageBlock(env, siteUrl, p)))).filter(Boolean);
    const blocks = [...inlined, ...(photo ? [photo] : [])];
    response = await client.messages.create({
      model, max_tokens: 16000,
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: content(blocks) }],
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

// Maths and science entries list the question and marking-guideline pictures (served from the site) to send with the prompt.
function imageUrlBlock(siteUrl, path) { return { type: 'image', source: { type: 'url', url: new URL('/' + path, siteUrl).href } }; }
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
// Only the header is checked here (a regex over 2 MB of base64 costs CPU the Free plan doesn't have); Anthropic validates the rest.
function photoBlock(photo) {
  if (!photo) return null;
  const s = String(photo), i = s.indexOf(';base64,');
  const m = i > 0 && i < 40 ? /^data:(image\/(?:jpeg|png|webp))$/.exec(s.slice(0, i)) : null;
  const n = s.length - i - 8;
  if (!m || n > 2800000 || n < 64) return false;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: s.slice(i + 8) } };
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

  const entry = await entryFor(env, request.url, key);
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
    const out = await askClaude(env, text, entry.imgs || [], photo, request.url);
    result = normalise(out.parsed, entry.max); usage = out.usage; modelUsed = out.model;
  } catch (error) {
    // A failed job never consumes the student's allowance. The status and message go back to the app (its toast shows
    // them) and to the log, so `npx wrangler tail bandsix` says why a mark failed.
    const status = Number(error && error.status) || 0;
    const message = String((error && error.message) || (error && error.code) || '').replace(/\s+/g, ' ').slice(0, 160);
    console.error('mark failed', key, status, message);
    if (error instanceof Anthropic.RateLimitError) return json(503, { code: 'rate_limited' });
    if (Anthropic.APIConnectionTimeoutError && error instanceof Anthropic.APIConnectionTimeoutError) return json(504, { code: 'timeout' });
    if (Anthropic.AuthenticationError && error instanceof Anthropic.AuthenticationError) return json(502, { code: 'auth', status, message });
    if (error instanceof Anthropic.APIError) return json(502, { code: 'upstream', status, message });
    return json(502, { code: (error && error.code) || 'upstream', message });
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
  let rec = await planRecord(env, user.id);
  // Re-read the subscription from Stripe when the app asks (?refresh=1, sent on the way back from the Stripe portal) or when
  // a Plus record has not been checked against Stripe for 10 minutes. A cancellation or a card update then shows on the
  // next page load even if its webhook event was missed or arrived before a fix (the record is Stripe's state, not a guess).
  const now = Math.floor(Date.now() / 1000);
  const asked = new URL(request.url).searchParams.get('refresh');
  const stale = rec && rec.plan === 'plus' && now - Math.max(Number(rec.checked) || 0, Number(rec.updated) || 0) > 600;
  if ((asked || stale) && billingOn(env) && rec && rec.sub) {
    try { const sub = await stripe(env, 'GET', '/subscriptions/' + rec.sub); await applySubscription(env, sub, user.id, now, true); rec = await planRecord(env, user.id); }
    catch (e) { console.error('plan refresh failed', String((e && e.message) || e).slice(0, 160)); }
  }
  const a = await allowance(env, user.id);
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
    const session = await stripe(env, 'POST', '/billing_portal/sessions', { customer: rec.customer, return_url: siteOrigin(request, env) + '/app.html?billing=portal#home' });
    return json(200, { url: session.url });
  } catch (e) { return json(502, { code: 'stripe', message: String(e.message || '').slice(0, 200) }); }
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
// `force` marks a read straight from Stripe (the freshest state there is): it always applies, but it leaves the event clock
// `updated` alone and stamps `checked` instead, so a webhook event still on its way (say a new subscription's checkout) is
// not rejected as older afterwards.
async function applySubscription(env, sub, uid, at, force) {
  uid = uid || (sub.metadata && sub.metadata.uid) || (sub.customer ? await env.MARKS.get('cust:' + sub.customer) : null);
  if (!uid) return false;
  const cur = await planRecord(env, uid);
  if (!force && cur && cur.updated && at && at < cur.updated) return false;   // an older event arriving late never overwrites a newer state
  const now = Math.floor(Date.now() / 1000);
  const per = periodOf(sub);
  // Since Stripe's 2025 API versions a cancellation from the customer portal sets cancel_at (a timestamp) and leaves the
  // deprecated cancel_at_period_end false, so either means "ends at the period end".
  const cancelAt = Number(sub.cancel_at || 0);
  const cancelAtPeriodEnd = !!sub.cancel_at_period_end || (cancelAt > 0 && cancelAt <= per.end + 86400);
  const rec = { plan: 'plus', status: String(sub.status || ''), customer: String(sub.customer || ''), sub: String(sub.id || ''), periodStart: per.start, periodEnd: per.end, cancelAtPeriodEnd, cancelAt,
    updated: force ? ((cur && Number(cur.updated)) || now) : (at || now), checked: force ? now : ((cur && Number(cur.checked)) || 0) };
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
    } catch (e) {
      console.error('api failed', pathname, String((e && e.stack) || e).slice(0, 400));
      return json(500, { code: 'server_error', message: String((e && e.message) || '').slice(0, 160) });
    }
    if (pathname.startsWith('/api/')) return json(404, { code: 'not_found' });
    return env.ASSETS.fetch(request);
  },
};
