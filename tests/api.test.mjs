import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { onRequestPost as checkout } from '../functions/api/checkout.js';
import { onRequestPost as webhook, verifyStripe } from '../functions/api/stripe/webhook.js';
import { onRequestPost as sample } from '../functions/api/sample-request.js';
import { resetThrottle } from '../functions/_lib.js';

const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_SIX_SET_CASE: 'price_six', STRIPE_PRICE_READERS: '', SITE_URL: 'https://juplifestudio.com' };
const post = (url, body, headers = {}) => new Request(`https://x.test${url}`, { method: 'POST', body, headers });
const jsonReq = (b) => post('/api/checkout', JSON.stringify(b), { 'Content-Type': 'application/json' });

test.beforeEach(() => resetThrottle());

test('checkout: unpriced / unknown sku is rejected', async () => {
  for (const sku of ['gigi', 'readers', '__proto__']) {
    const r = await checkout({ request: jsonReq({ items: [{ sku, qty: 1 }] }), env });
    assert.equal(r.status, 400, sku);
  }
});

test('checkout: bad qty rejected, not configured -> 503', async () => {
  assert.equal((await checkout({ request: jsonReq({ items: [{ sku: 'six-set-case', qty: 0 }] }), env })).status, 400);
  assert.equal((await checkout({ request: jsonReq({ items: [{ sku: 'six-set-case', qty: 1 }] }), env: {} })).status, 503);
});

test('checkout: sends only server-side price id to Stripe and returns the hosted url', async () => {
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, body: new URLSearchParams(init.body) }; return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/x' }), { status: 200 }); };
  const r = await checkout({ request: jsonReq({ items: [{ sku: 'six-set-case', qty: 2 }, { sku: 'six-set-case', qty: 1 }], price: 1 }), env });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).url, 'https://checkout.stripe.com/c/x');
  assert.equal(sent.body.get('line_items[0][price]'), 'price_six');
  assert.equal(sent.body.get('line_items[0][quantity]'), '3');
  assert.equal(sent.body.get('success_url'), 'https://juplifestudio.com/shop?checkout=success&session_id={CHECKOUT_SESSION_ID}');
});

const sign = (payload, secret, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

test('webhook: signature verification', async () => {
  const now = Math.floor(Date.now() / 1000);
  const p = '{"a":1}';
  assert.equal(await verifyStripe(p, sign(p, 'whsec_a', now), 'whsec_a'), true);
  assert.equal(await verifyStripe(p, sign(p, 'whsec_b', now), 'whsec_a'), false);
  assert.equal(await verifyStripe(p + ' ', sign(p, 'whsec_a', now), 'whsec_a'), false);
  assert.equal(await verifyStripe(p, sign(p, 'whsec_a', now - 1000), 'whsec_a'), false);
  assert.equal(await verifyStripe(p, '', 'whsec_a'), false);
});

test('webhook: bad signature 400, good signature 200', async () => {
  const p = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', amount_total: 2900, currency: 'usd', customer_details: { email: 'a@b.co' } } } });
  const e = { STRIPE_WEBHOOK_SECRET: 'whsec_t' };
  assert.equal((await webhook({ request: post('/api/stripe/webhook', p, { 'stripe-signature': 't=1,v1=00' }), env: e })).status, 400);
  const ok = await webhook({ request: post('/api/stripe/webhook', p, { 'stripe-signature': sign(p, 'whsec_t', Math.floor(Date.now() / 1000)) }), env: e });
  assert.equal(ok.status, 200);
});

function form(o = {}, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ name: 'A', business: 'B', city: 'C', email: 'a@b.co', ...o })) fd.set(k, v);
  if (file) fd.set('logo', file);
  return post('/api/sample-request', fd);
}

test('sample: valid, missing field, honeypot, throttle', async () => {
  assert.equal((await sample({ request: form(), env: {} })).status, 200);
  assert.equal((await sample({ request: form({ city: '' }), env: {} })).status, 422);
  assert.equal((await sample({ request: form({ email: 'nope' }), env: {} })).status, 422);
  const hp = await sample({ request: form({ website: 'spam', name: '' }), env: {} });
  assert.equal(hp.status, 200);
  resetThrottle();
  const env2 = { RATE_LIMIT_PER_HOUR: '2' };
  await sample({ request: form(), env: env2 }); await sample({ request: form(), env: env2 });
  assert.equal((await sample({ request: form(), env: env2 })).status, 429);
});

test('sample: logo type, size, magic bytes, svg scripts', async () => {
  const f = (bytes, name, type) => new File([bytes], name, { type });
  assert.equal((await sample({ request: form({}, f(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), 'l.png', 'image/png')), env: {} })).status, 200);
  assert.equal((await sample({ request: form({}, f('x', 'l.exe', 'application/octet-stream')), env: {} })).status, 400);
  assert.equal((await sample({ request: form({}, f('notpng', 'l.png', 'image/png')), env: {} })).status, 400);
  assert.equal((await sample({ request: form({}, f('<svg><script>1</script></svg>', 'l.svg', 'image/svg+xml')), env: {} })).status, 400);
  assert.equal((await sample({ request: form({}, f(new Uint8Array(4 * 1024 * 1024 + 1), 'l.pdf', 'application/pdf')), env: {} })).status, 413);
});
