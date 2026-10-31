// Phase C Worker checks: plans, entitlements and Stripe billing with a fake Stripe (no network, no keys).
import worker from './worker.js';
import { createHmac } from 'node:crypto';
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const kv = new Map(); const MARKS = { async get(k) { return kv.has(k) ? kv.get(k) : null; }, async put(k, v) { kv.set(k, v); } };
const bank = { 'nesa2025|21': { max: 4, pre: 'PRE ', post: ' POST' } };
const ASSETS = { async fetch(u) { return new Response(JSON.stringify(bank), { status: String(u).includes('mark-bank.json') ? 200 : 404 }); } };
const base = { ANTHROPIC_API_KEY: 'x', SUPA_URL: 'https://supa.test', SUPA_KEY: 'k', DAILY_LIMIT: '5', GLOBAL_DAILY_CAP: '300', PLUS_MONTHLY: '3', MARKS, ASSETS };
const off = { ...base };
const env = { ...base, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_ID: 'price_1' };
const now = Math.floor(Date.now() / 1000), DAY = 86400;
let sub = { id: 'sub_1', status: 'active', customer: 'cus_1', current_period_start: now - DAY, current_period_end: now + 29 * DAY, cancel_at_period_end: false, metadata: { uid: 'user-1' } };
const stripeCalls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'user-1', email: 'b1@example.com' }), { status: 200 });
  if (u.startsWith('https://api.stripe.com/v1')) {
    stripeCalls.push({ path: u.slice('https://api.stripe.com/v1'.length), method: (init && init.method) || 'GET', body: init && init.body, auth: init && init.headers && init.headers.authorization });
    if (u.endsWith('/checkout/sessions')) return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }), { status: 200 });
    if (u.endsWith('/billing_portal/sessions')) return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/x' }), { status: 200 });
    if (u.includes('/subscriptions/')) return new Response(JSON.stringify(sub), { status: 200 });
    return new Response(JSON.stringify({ error: { message: 'no such route' } }), { status: 404 });
  }
  return new Response('{}', { status: 404 });
};
globalThis.__claude = async () => ({ stop_reason: 'end_turn', model: 'claude-test', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text: JSON.stringify({ mark: 3, band: '3', verdict: 'v', strengths: [], improvements: [], evidence: ['q'], missing: [], next: 'n', confidence: 'high', model: 'm' }) }] });
const req = (path, init = {}, tok = 'tok', e = env) => worker.fetch(new Request('https://bandsfordays.com' + path, { ...init, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(init.headers || {}) } }), e);
const J = async r => [r.status, await r.json()];
const sign = (body, secret = 'whsec_test', t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
let evn = 0; const event = (type, object, created = Math.floor(Date.now() / 1000), id) => JSON.stringify({ id: id || 'evt_' + (++evn), type, created, data: { object } });
const hook = (body, sig) => req('/api/billing/webhook', { method: 'POST', body, headers: { 'stripe-signature': sig === undefined ? sign(body) : sig } }, '');
const answer = 'Outsourcing passes production to a specialist which lowers costs but reduces control over quality.';
const mark = (suffix = '') => req('/api/mark', { method: 'POST', body: JSON.stringify({ key: 'nesa2025|21', answer: answer + suffix }) });

// billing off
let [s, d] = await J(await req('/api/plan', {}, 'tok', off));
ok(s === 200 && d.billing === false && d.plan === 'free' && d.limit === 5 && d.period === 'day' && /T/.test(d.resets), 'billing off: plan is free, 5 a day, no upgrade offered');
[s, d] = await J(await req('/api/billing/checkout', { method: 'POST' }, 'tok', off)); ok(s === 503 && d.code === 'billing_off', 'billing off: checkout refused');
[s, d] = await J(await req('/api/billing/webhook', { method: 'POST', body: '{}' }, '', off)); ok(s === 503, 'billing off: webhook refused');

// billing on, free user
[s, d] = await J(await req('/api/plan')); ok(s === 200 && d.billing === true && d.plan === 'free' && d.price === 'A$9.99 a month' && d.plusMonthly === 3 && d.signedIn === true, 'billing on: free plan with the Plus offer details');
[s, d] = await J(await req('/api/plan', {}, '')); ok(s === 200 && d.signedIn === false && d.plan === 'free', 'signed out: free, no error');
[s, d] = await J(await req('/api/billing/checkout', { method: 'POST' }));
ok(s === 200 && d.url === 'https://checkout.stripe.com/c/pay/cs_1', 'checkout returns the hosted Stripe page');
const co = stripeCalls.find(c => c.path === '/checkout/sessions');
ok(co && co.method === 'POST' && co.auth === 'Bearer sk_test_x' && /mode=subscription/.test(co.body) && /client_reference_id=user-1/.test(co.body) && /line_items%5B0%5D%5Bprice%5D=price_1/.test(co.body) && /customer_email=b1%40example.com/.test(co.body) && /success_url=https%3A%2F%2Fbandsfordays.com%2Fapp.html%3Fbilling%3Dsuccess/.test(co.body) && /metadata%5Buid%5D=user-1/.test(co.body), 'checkout session: subscription, price, student id, email, return addresses');
[s, d] = await J(await req('/api/billing/portal', { method: 'POST' })); ok(s === 404 && d.code === 'no_customer', 'portal needs a customer first');

// webhook: signature, checkout completed, plan becomes Plus
const body1 = event('checkout.session.completed', { id: 'cs_1', mode: 'subscription', customer: 'cus_1', subscription: 'sub_1', client_reference_id: 'user-1' });
[s, d] = await J(await hook(body1, 't=1,v1=00')); ok(s === 400 && d.code === 'bad_signature', 'bad signature rejected');
[s, d] = await J(await hook(body1, sign(body1, 'whsec_test', Math.floor(Date.now() / 1000) - 900))); ok(s === 400, 'stale signature (15 min old) rejected');
[s, d] = await J(await hook(body1, sign(body1, 'wrong'))); ok(s === 400, 'wrong secret rejected');
[s, d] = await J(await hook(body1)); ok(s === 200 && d.applied === true, 'checkout.session.completed applied');
ok(stripeCalls.some(c => c.path === '/subscriptions/sub_1' && c.method === 'GET'), 'the subscription was fetched from Stripe');
ok(kv.get('cust:cus_1') === 'user-1' && JSON.parse(kv.get('plan:user-1')).status === 'active', 'customer mapped and plan record stored');
[s, d] = await J(await hook(body1)); ok(s === 200 && d.duplicate === true, 'the same event again is ignored');
[s, d] = await J(await req('/api/plan'));
ok(d.plan === 'plus' && d.limit === 3 && d.left === 3 && d.period === 'month' && d.resets === new Date(sub.current_period_end * 1000).toISOString() && d.hasCustomer === true, 'plan: Plus, 3 a month, resets on the renewal date');
[s, d] = await J(await req('/api/billing/checkout', { method: 'POST' })); ok(s === 409 && d.code === 'already_plus', 'no second subscription');

// marks come off the monthly allowance, not the daily one
[s, d] = await J(await mark()); ok(s === 200 && d.plan === 'plus' && d.left === 2 && d.period === 'month', 'Plus mark: 2 of 3 left this period');
await mark(' two'); [s, d] = await J(await mark(' three')); ok(s === 200 && d.left === 0, 'third mark: 0 left');
[s, d] = await J(await mark(' four')); ok(s === 429 && d.code === 'plan_limit' && d.left === 0 && d.period === 'month', 'fourth: plan_limit with the reset date');
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
ok(kv.get('pm:user-1:' + sub.current_period_start) === '3' && !kv.has('u:user-1:' + day), 'monthly counter used, daily counter untouched');
[s, d] = await J(await req('/api/quota')); ok(d.on === true && d.plan === 'plus' && d.left === 0 && d.billing === true, 'quota reports the Plus allowance');
const led = [...kv.entries()].find(([k]) => k.startsWith('l:' + day + ':')); ok(led && JSON.parse(led[1]).plan === 'plus', 'ledger records the plan');

// out-of-order and later events
const rec1 = JSON.parse(kv.get('plan:user-1'));
let old = event('customer.subscription.updated', { ...sub, status: 'canceled' }, rec1.updated - 60);
[s, d] = await J(await hook(old)); ok(s === 200 && d.applied === false && JSON.parse(kv.get('plan:user-1')).status === 'active', 'an older event arriving late does not overwrite');
let later = event('customer.subscription.updated', { ...sub, cancel_at_period_end: true }, rec1.updated + 60);
[s, d] = await J(await hook(later)); [s, d] = await J(await req('/api/plan'));
ok(d.plan === 'plus' && d.cancelAtPeriodEnd === true, 'cancel at period end: still Plus, flagged');
let del = event('customer.subscription.deleted', { ...sub, status: 'canceled', cancel_at_period_end: false }, rec1.updated + 120);
[s, d] = await J(await hook(del)); [s, d] = await J(await req('/api/plan'));
ok(d.plan === 'plus' && d.status === 'canceled', 'cancelled but paid: Plus until the period ends');
let gone = event('customer.subscription.deleted', { ...sub, status: 'canceled', current_period_end: now - 10 }, rec1.updated + 180);
[s, d] = await J(await hook(gone)); [s, d] = await J(await req('/api/plan'));
ok(d.plan === 'free' && d.status === 'canceled' && d.limit === 5 && d.period === 'day', 'period over: back to Free, 5 a day');
[s, d] = await J(await mark(' after')); ok(s === 200 && d.plan === 'free' && d.left === 4, 'free marks work again after the downgrade');
// past due: a week of grace from the failed renewal
sub = { ...sub, status: 'past_due', current_period_start: now - DAY, current_period_end: now + 29 * DAY };
[s, d] = await J(await hook(event('invoice.payment_failed', { id: 'in_1', subscription: 'sub_1' }, rec1.updated + 240)));
[s, d] = await J(await req('/api/plan')); ok(d.plan === 'plus' && d.status === 'past_due', 'payment failed yesterday: still Plus (grace week)');
sub = { ...sub, current_period_start: now - 8 * DAY };
[s, d] = await J(await hook(event('invoice.payment_failed', { id: 'in_2', subscription: 'sub_1' }, rec1.updated + 300)));
[s, d] = await J(await req('/api/plan')); ok(d.plan === 'free' && d.status === 'past_due', 'payment failed 8 days ago: Free until the card is fixed');
// invoice.paid with the period on the subscription item (newer Stripe API shape)
sub = { id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false, metadata: {}, items: { data: [{ current_period_start: now, current_period_end: now + 30 * DAY }] } };
[s, d] = await J(await hook(event('invoice.paid', { id: 'in_3', parent: { subscription_details: { subscription: 'sub_1' } } }, rec1.updated + 360)));
[s, d] = await J(await req('/api/plan')); ok(d.plan === 'plus' && d.left === 3 && d.resets === new Date((now + 30 * DAY) * 1000).toISOString(), 'renewal paid (item-level period, uid from the customer map): fresh allowance');
[s, d] = await J(await req('/api/billing/portal', { method: 'POST' }));
ok(s === 200 && /billing\.stripe\.com/.test(d.url) && stripeCalls.some(c => c.path === '/billing_portal/sessions' && /customer=cus_1/.test(c.body)), 'portal session for the customer');
[s, d] = await J(await hook('{not json', sign('{not json'))); ok(s === 400, 'unparseable body rejected');
console.log(fails ? `${fails} check(s) failed` : 'billing checks passed'); process.exit(fails ? 1 : 0);
