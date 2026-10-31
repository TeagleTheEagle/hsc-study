// Bands for Days Worker (Cloudflare Worker "bandsix"): serves the static site, plus /api/mark, which marks a typed past-paper
// answer with Claude for signed-in students (DAILY_LIMIT a day each, GLOBAL_DAILY_CAP site-wide).
// The Anthropic key is the ANTHROPIC_API_KEY secret (wrangler secret put); it never reaches the browser.
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
  const limit = Number(env.DAILY_LIMIT || 5), cap = Number(env.GLOBAL_DAILY_CAP || 300);
  const ukey = 'u:' + user.id + ':' + day, gkey = 'g:' + day;
  // The same answer sent again within 10 minutes (a double tap, a retry after a dropped connection) gets the
  // same result and is not counted twice (blueprint 14).
  const rkey = 'r:' + (await sha256(user.id + '|' + key + '|' + answer + '|' + (photo ? photo.source.data.length : 0)));
  const [used, total, repeat] = await Promise.all([env.MARKS.get(ukey), env.MARKS.get(gkey), env.MARKS.get(rkey)]).then(v => [Number(v[0] || 0), Number(v[1] || 0), v[2]]);
  if (repeat) { try { return json(200, { result: JSON.parse(repeat), limit, left: Math.max(0, limit - used), repeated: true }); } catch (e) { /* fall through and mark again */ } }
  if (used >= limit) return json(429, { code: 'daily_limit', limit, left: 0 });
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
    env.MARKS.put(ukey, String(used + 1), ttl), env.MARKS.put(gkey, String(total + 1), ttl),
    env.MARKS.put(rkey, JSON.stringify(result), { expirationTtl: 600 }),
    ledger(env, day, { t: Date.now(), u: user.id, k: key, mark: result.mark, max: entry.max, conf: result.confidence, in: usage.in, out: usage.out, ms: Date.now() - t0, model: modelUsed, photo: !!photo }).catch(() => {}),
  ]);
  return json(200, { result, limit, left: Math.max(0, limit - used - 1) });
}

async function quota(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const limit = Number(env.DAILY_LIMIT || 5);
  if (!env.ANTHROPIC_API_KEY) return json(200, { on: false, limit });
  if (!token) return json(200, { on: true, limit, left: null });
  const user = await userFromToken(env, token);
  if (!user) return json(200, { on: true, limit, left: null });
  const used = Number((await env.MARKS.get('u:' + user.id + ':' + sydneyDay())) || 0);
  return json(200, { on: true, limit, left: Math.max(0, limit - used) });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/api/mark') return await mark(request, env);
      if (pathname === '/api/quota') return await quota(request, env);
    } catch (e) {
      return json(500, { code: 'server_error' });
    }
    if (pathname.startsWith('/api/')) return json(404, { code: 'not_found' });
    return env.ASSETS.fetch(request);
  },
};
