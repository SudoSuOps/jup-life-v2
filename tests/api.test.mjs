import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { onRequestPost as checkout } from '../functions/api/checkout.js';
import { onRequestPost as webhook, verifyStripe, orderEmail } from '../functions/api/stripe/webhook.js';
import { onRequestPost as drops } from '../functions/api/drops.js';
import { onRequestPost as sample } from '../functions/api/sample-request.js';
import { readFileSync } from 'node:fs';
import { COLOR_PACKS, colorPackCatalog, resetThrottle, SINGLE_COLOR_SIX_PACK_USD } from '../functions/_lib.js';

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

function stripeLines(body) {
  const idx = new Set();
  for (const [key] of body) {
    const m = /^line_items\[(\d+)\]/.exec(key);
    if (m) idx.add(Number(m[1]));
  }
  return [...idx].sort((a, b) => a - b).map((i) => ({
    qty: body.get(`line_items[${i}][quantity]`),
    price: body.get(`line_items[${i}][price]`),
    amount: body.get(`line_items[${i}][price_data][unit_amount]`),
    currency: body.get(`line_items[${i}][price_data][currency]`),
    name: body.get(`line_items[${i}][price_data][product_data][name]`),
    color: body.get(`line_items[${i}][price_data][product_data][metadata][color]`),
    sku: body.get(`line_items[${i}][price_data][product_data][metadata][sku]`),
  }));
}

test('color packs follow each tray and skip concept or coming soon', () => {
  assert.equal(SINGLE_COLOR_SIX_PACK_USD, 29);
  assert.deepEqual(COLOR_PACKS['fall-pop-coasters'], {
    name: 'Holiday Tray 6-Pack',
    colors: ['Pumpkin', 'Coconut', 'Cranberry', 'Maple', 'Rhubarb', 'Sunflower'],
  });
  assert.equal(COLOR_PACKS['pop-tray-1-season-colors'].colors.length, 6);
  assert.ok(COLOR_PACKS['pop-tray-1-season-colors'].colors.includes('Coconut (clear)'));
  assert.equal(COLOR_PACKS['pop-tray-2-pop-flowers'].colors.length, 6);
  assert.equal(COLOR_PACKS['pop-tray-3-coastal'].colors.length, 6);
  assert.equal(COLOR_PACKS['stack-bands-fall'], undefined);
  assert.equal(COLOR_PACKS.gigi, undefined);
  const yaml = readFileSync(new URL('../tools/todays-batch/batch.yaml', import.meta.url), 'utf8');
  const yamlColors = [...yaml.matchAll(/\{name:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(yamlColors, COLOR_PACKS['fall-pop-coasters'].colors);
  const batch = { flavors: ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({ name })) };
  const packs = colorPackCatalog([
    { sku: 'soon', color_pack: 'Soon 6-Pack', coming_soon: true, pops: batch.flavors },
    { sku: 'concept', color_pack: 'Concept 6-Pack', concept: true, pops: batch.flavors },
    { sku: 'ok', color_pack: 'Ok 6-Pack', pops: batch.flavors },
  ], batch);
  assert.deepEqual(Object.keys(packs), ['ok']);
});

test('checkout: two colors are two line items, priced on the server', async () => {
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, body: new URLSearchParams(init.body) }; return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/colors' }), { status: 200 }); };
  const r = await checkout({
    request: jsonReq({
      items: [
        { sku: 'fall-pop-coasters', color: 'Cranberry', qty: 1, price: 1 },
        { sku: 'fall-pop-coasters', color: 'Sunflower', qty: 2, price: 5 },
      ],
    }),
    env,
  });
  assert.equal(r.status, 200);
  const lines = stripeLines(sent.body);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.name), ['Holiday Tray 6-Pack · Cranberry', 'Holiday Tray 6-Pack · Sunflower']);
  assert.deepEqual(lines.map((l) => l.color), ['Cranberry', 'Sunflower']);
  assert.deepEqual(lines.map((l) => l.sku), ['fall-pop-coasters', 'fall-pop-coasters']);
  assert.deepEqual(lines.map((l) => l.qty), ['1', '2']);
  assert.deepEqual(lines.map((l) => l.amount), ['2900', '2900']);
  assert.ok(lines.every((l) => l.currency === 'usd' && l.price == null));
  assert.equal(sent.body.get('metadata[color_lines]'), 'Holiday Tray 6-Pack · Cranberry x1; Holiday Tray 6-Pack · Sunflower x2');
  assert.equal(sent.body.get('payment_intent_data[metadata][color_lines]'), sent.body.get('metadata[color_lines]'));
  const note = orderEmail({ id: 'cs_c', amount_total: 8700, currency: 'usd', metadata: { color_lines: sent.body.get('metadata[color_lines]') } }, [
    { quantity: 1, description: 'Holiday Tray 6-Pack · Cranberry', amount_total: 2900 },
    { quantity: 2, description: 'Holiday Tray 6-Pack · Sunflower', amount_total: 5800 },
  ]);
  assert.match(note.subject, /Holiday Tray 6-Pack · Cranberry/);
  assert.match(note.text, /COLORS\nHoliday Tray 6-Pack · Cranberry x1; Holiday Tray 6-Pack · Sunflower x2/);
});

test('checkout: invalid color is rejected and the client price is ignored', async () => {
  const bad = await checkout({ request: jsonReq({ items: [{ sku: 'pop-tray-1-season-colors', color: 'Sunflower', qty: 1, price: 1 }] }), env });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).detail, /isn't a color on this tray/);
  const foreign = await checkout({ request: jsonReq({ items: [{ sku: 'gigi', color: 'Cranberry', qty: 1 }] }), env });
  assert.equal(foreign.status, 400);
  let sent;
  globalThis.fetch = async (url, init) => { sent = new URLSearchParams(init.body); return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/one' }), { status: 200 }); };
  const ok = await checkout({ request: jsonReq({ items: [{ sku: 'pop-tray-2-pop-flowers', color: 'Sunflower', qty: 1, price: 1 }] }), env });
  assert.equal(ok.status, 200);
  const [line] = stripeLines(sent);
  assert.equal(line.name, 'Pop Tray 2 6-Pack · Sunflower');
  assert.equal(line.amount, String(SINGLE_COLOR_SIX_PACK_USD * 100));
  assert.equal(line.price, null);
});

test('checkout: the Holiday Tray set still uses its Stripe price, separate from a color pack', async () => {
  let sent;
  globalThis.fetch = async (url, init) => { sent = new URLSearchParams(init.body); return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/set' }), { status: 200 }); };
  const priced = { ...env, STRIPE_PRICE_FALL_POP_COASTERS: 'price_tray_set' };
  const r = await checkout({ request: jsonReq({ items: [{ sku: 'fall-pop-coasters', qty: 1, price: 1 }, { sku: 'half-dozen', qty: 1, price: 1 }] }), env: priced });
  assert.equal(r.status, 200);
  const lines = stripeLines(sent);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].price, 'price_tray_set');
  assert.equal(lines[0].amount, null);
  assert.equal(lines[1].price, 'price_1UTVSJHYwaTbul7MyxtILxOz');
  assert.equal(sent.get('metadata[color_lines]'), null);
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

test('sample: segment kept when valid, dropped when not, goes in the email subject', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  const env = { RESEND_API_KEY: 'k' };
  await sample({ request: form({ segment: 'Hotel or rental', request_type: 'Product question' }), env });
  await sample({ request: form({ segment: '<b>x</b>' }), env });
  globalThis.fetch = realFetch;
  assert.equal(sent[0].subject, '[Product question · Hotel or rental] B · C');
  assert.match(sent[0].text, /segment: Hotel or rental/);
  assert.equal(sent[1].subject, 'Sample request: Venue (6)');
  assert.match(sent[1].text, /buyer_type: wholesale/);
  assert.match(sent[1].text, /qty: 6/);
  assert.doesNotMatch(sent[1].text, /segment/);
});

test('sample: address works in place of city, one of the two is required', async () => {
  assert.equal((await sample({ request: form({ city: '', address: '1 Main St, Jupiter FL' }), env: {} })).status, 200);
  assert.equal((await sample({ request: form({ city: '', address: '' }), env: {} })).status, 422);
});

test('sample: logo type, size, magic bytes, svg scripts', async () => {
  const f = (bytes, name, type) => new File([bytes], name, { type });
  assert.equal((await sample({ request: form({}, f(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]), 'l.png', 'image/png')), env: {} })).status, 200);
  assert.equal((await sample({ request: form({}, f('x', 'l.exe', 'application/octet-stream')), env: {} })).status, 400);
  assert.equal((await sample({ request: form({}, f('notpng', 'l.png', 'image/png')), env: {} })).status, 400);
  assert.equal((await sample({ request: form({}, f('<svg><script>1</script></svg>', 'l.svg', 'image/svg+xml')), env: {} })).status, 400);
  assert.equal((await sample({ request: form({}, f(new Uint8Array(4 * 1024 * 1024 + 1), 'l.pdf', 'application/pdf')), env: {} })).status, 413);
});

test('drops: validates email, honeypot, adds to audience and notifies', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: init.body }); return new Response('{}', { status: 200 }); };
  const form = (o) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return post('/api/drops', fd); };
  const e = { RESEND_API_KEY: 're_x', RESEND_SEGMENT_ID: 'seg_1' };
  assert.equal((await drops({ request: form({ email: 'nope' }), env: e })).status, 422);
  assert.equal((await drops({ request: form({ email: 'a@b.co', website: 'bot' }), env: e })).status, 200);
  assert.equal(calls.length, 0);
  const r = await drops({ request: form({ email: 'Dee@Example.com', source_page: '/shop' }), env: e });
  assert.equal(r.status, 200);
  assert.ok(calls[0].url.endsWith('/v1/contacts') || calls[0].url.endsWith('api.resend.com/contacts'));
  assert.deepEqual(JSON.parse(calls[0].body).segments, [{ id: 'seg_1' }]);
  assert.equal(JSON.parse(calls[0].body).email, 'dee@example.com');
  const mails = calls.filter((c) => c.url.endsWith('/emails')).map((c) => JSON.parse(c.body));
  const w = mails.find((m) => m.to.includes('dee@example.com') && /Drops list/.test(m.subject));
  assert.ok(w, 'welcome email to subscriber');
  assert.match(w.html, /You&#39;re|You're on the list/);
  assert.ok(w.html.includes('https://x.test/img/logo.png') && w.html.includes('/shop') && w.text.includes('/shop'), 'branded html + text');
  assert.ok(mails.some((m) => /Drops signup/.test(m.subject)), 'studio notification');
});

test('order email: lists items, ship-to name, total and a dashboard link', () => {
  const s = { id: 'cs_1', amount_total: 900, currency: 'usd', livemode: true, payment_intent: 'pi_9', customer_details: { name: 'Buyer', email: 'b@x.co', phone: '+15615550000' },
    shipping_details: { name: 'Gift Person', address: { line1: '1 Main St', city: 'Jupiter', state: 'FL', postal_code: '33469', country: 'US' } } };
  const { subject, text } = orderEmail(s, [{ quantity: 1, description: 'The Gigi', amount_total: 900 }]);
  assert.match(subject, /The Gigi · 9\.00 USD/);
  for (const bit of ['1 x The Gigi', 'Gift Person', '1 Main St', 'Jupiter, FL 33469', '+15615550000', 'dashboard.stripe.com/payments/pi_9']) assert.ok(text.includes(bit), bit);
  assert.ok(orderEmail(s, []).text.includes('line items unavailable'));
});

test('sample: retail Sample needs an address (no business), business types still need business + city', async () => {
  assert.equal((await sample({ request: form({ request_type: 'Sample', business: '', city: '', address: '1 Main St, Jupiter, FL 33469' }), env: {} })).status, 200);
  assert.equal((await sample({ request: form({ request_type: 'Sample', business: '', city: '', address: '' }), env: {} })).status, 422);
  assert.equal((await sample({ request: form({ request_type: 'Half Dozen sample', business: '', city: 'Jupiter' }), env: {} })).status, 422);
});

test('sample: qty is 1 for retail, 6 for wholesale, legacy types map, spoofed sample_qty is ignored', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); };
  const env = { RESEND_API_KEY: 'k', SITE_URL: 'https://juplifestudio.com' };
  const retail = { buyer_type: 'retail', request_type: 'Sample', business: '', city: '', address: '1 Main St', sample_qty: '50' };
  const venue = { buyer_type: 'wholesale', request_type: 'Sample', address: '1 Bar St', sample_qty: '50' };
  const legacyVenue = { request_type: 'Half Dozen sample', sample_qty: '50' };
  const legacyRetail = { request_type: 'Free sample (1 coaster)', business: '', city: '', address: '1 Main St', sample_qty: '50' };
  assert.equal((await sample({ request: form(retail), env })).status, 200);
  assert.equal((await sample({ request: form(venue), env })).status, 200);
  assert.equal((await sample({ request: form(legacyVenue), env })).status, 200);
  assert.equal((await sample({ request: form(legacyRetail), env })).status, 200);
  globalThis.fetch = realFetch;
  const studio = sent.filter((m) => String(m.subject).startsWith('Sample request:'));
  const confirm = sent.filter((m) => /free sample coaster|venue sample coasters/i.test(m.subject));
  assert.equal(studio.length, 4);
  assert.equal(studio[0].subject, 'Sample request: Retail (1)');
  assert.match(studio[0].text, /qty: 1/);
  assert.match(studio[0].text, /buyer_type: retail/);
  assert.doesNotMatch(studio[0].text, /sample_qty|qty: 50|\b50\b/);
  assert.equal(studio[1].subject, 'Sample request: Venue (6)');
  assert.match(studio[1].text, /qty: 6/);
  assert.match(studio[1].text, /buyer_type: wholesale/);
  assert.doesNotMatch(studio[1].text, /qty: 50/);
  assert.equal(studio[2].subject, 'Sample request: Venue (6)');
  assert.match(studio[2].text, /qty: 6/);
  assert.equal(studio[3].subject, 'Sample request: Retail (1)');
  assert.match(studio[3].text, /qty: 1/);
  assert.match(confirm[0].html, /Your free sample coaster is on the way\./);
  assert.match(confirm[1].html, /Your 6 free venue sample coasters are being baked\./);
  assert.match(confirm[1].text, /We'll reach out about your logo within one business day\./);
});
