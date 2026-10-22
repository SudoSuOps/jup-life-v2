// Browser smoke test. Needs a running site (wrangler pages dev dist --port 8788) and Chrome.
// BASE=http://localhost:8788 CHROME=/path/to/chrome node tests/smoke.mjs
import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:8788';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 667 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const ok = (name) => console.log('ok  -', name);

// redirects
for (const [from, to] of [['/restaurants', '/wholesale'], ['/collection/hibiscus', '/shop'], ['/weddings', '/shop'], ['/coming-soon', '/shop']]) {
  const r = await fetch(BASE + from, { redirect: 'manual' });
  assert.equal(r.status, 301, from); assert.ok(r.headers.get('location').endsWith(to), from);
}
ok('301 redirects');

for (const path of ['/', '/shop', '/wholesale']) {
  await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no sideways scroll ${path}`);
  const n = (await page.$$('[data-open-sample]')).length;
  for (let i = 0; i < n; i++) {
    const btn = (await page.$$('[data-open-sample]'))[i];
    await btn.evaluate((b) => { b.scrollIntoView(); b.focus(); });
    await btn.click();
    assert.equal(await page.$eval('#sample-dlg', (d) => d.open), true, `${path} opener ${i}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('#sample-dlg', (d) => d.open), false);
    assert.equal(await page.evaluate((el) => document.activeElement === el, btn), true, `${path} focus returns ${i}`);
  }
  ok(`modal opens/Esc closes/focus returns on ${path} (${n} openers)`);
}

// "Ask about this batch" preselects Product question + product
await page.goto(BASE + '/shop', { waitUntil: 'networkidle0' });
await page.click('[data-type="Product question"][data-product="The Gigi"]');
assert.equal(await page.$eval('#sample-dlg [name=request_type]', (e) => e.value), 'Product question');
assert.equal(await page.$eval('#sample-dlg [name=product]', (e) => e.value), 'The Gigi');
// required validation
await page.click('#sample-dlg [type=submit]');
assert.match(await page.$eval('#sample-dlg [data-form-error]', (e) => e.textContent), /required/i);
ok('ask-about preselect + required validation');
await page.keyboard.press('Escape');

// bag + checkout (mocked)
await page.setRequestInterception(true);
let posted;
page.on('request', (r) => {
  if (r.url().endsWith('/api/checkout')) { posted = JSON.parse(r.postData()); r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: BASE + '/shop?checkout=success' }) }); }
  else r.continue();
});
await page.click('[data-sku="six-set-case"]');
await page.click('#bag-dlg [aria-label="One more"]');
assert.equal(await page.$eval('[data-bag-count]', (e) => e.textContent), '2');
await Promise.all([page.waitForNavigation(), page.click('[data-checkout]')]);
assert.deepEqual(posted, { items: [{ sku: 'six-set-case', qty: 2 }] });
assert.equal(await page.$eval('[data-checkout-banner="success"]', (e) => !e.hidden), true);
assert.equal(await page.$eval('[data-bag-count]', (e) => e.textContent), '0');
ok('bag add/qty/checkout POST (only sku+qty), success banner, bag cleared');

// above the fold at 375x667
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
const vis = await page.$$eval('[data-open-sample]', (bs) => bs.some((b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width > 0; }));
assert.equal(vis, true);
ok('"Get a free Half Dozen" above the fold at 375x667');

assert.deepEqual(errors.filter((e) => !/api\/|Failed to load resource/.test(e)), []);
ok('no script errors');
await browser.close();
