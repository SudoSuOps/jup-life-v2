import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost as drops } from '../functions/api/drops.js';
import { onRequestPost as sample } from '../functions/api/sample-request.js';
import { resetThrottle } from '../functions/_lib.js';

const env = { SITE_URL: 'https://juplifestudio.com' };
const post = (url, body, headers = {}) => new Request(`https://x.test${url}`, { method: 'POST', body, headers });

test.beforeEach(() => resetThrottle());

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
  const confirm = sent.filter((m) => /sample request is in/i.test(m.subject));
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
  assert.match(confirm[0].html, /Your sample request is in\./);
  assert.match(confirm[1].html, /Your sample request is in\./);
  // Samples are free, by request (owner, Nov 2026).
  assert.match(confirm[0].html, /Free samples · by request/);
  assert.match(confirm[1].html, /Free samples · by request/);
  assert.match(confirm[0].text, /Fresh print daily\. Built different\./);
  assert.match(confirm[1].text, /We'll reach out about your logo within one business day\./);
});

test('free sample form: name, company (optional), email, phone, ship to', async () => {
  const send = (o) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: 'Dee', email: 'dee@example.com', phone: '561-555-0100', address: '1 Ocean Way, Jupiter, FL 33477', request_type: 'Sample', source_page: '/', ...o })) fd.set(k, v);
    return sample({ request: post('/api/sample-request', fd), env: {} });
  };
  let logged = '';
  const orig = console.log;
  console.log = (...a) => { logged += a.join(' '); };
  try {
    assert.equal((await send({})).status, 200);
    assert.match(logged, /Sample request: Retail \(1\)/);
    logged = '';
    assert.equal((await send({ business: 'Square Grouper' })).status, 200);
    assert.match(logged, /Sample request: Venue \(6\)/);
    assert.match(logged, /business: Square Grouper/);
    assert.equal((await send({ address: '' })).status, 422);
    assert.equal((await send({ business: 'Square Grouper', address: '' })).status, 422);
  } finally { console.log = orig; }
});
