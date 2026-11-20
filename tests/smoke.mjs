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
for (const [from, to] of [['/restaurants', '/enterprise'], ['/wholesale', '/enterprise'], ['/collection/hibiscus', '/shop'], ['/weddings', '/shop'], ['/coming-soon', '/shop']]) {
  const r = await fetch(BASE + from, { redirect: 'manual' });
  assert.equal(r.status, 301, from); assert.ok(r.headers.get('location').endsWith(to), from);
}
ok('301 redirects');

for (const path of ['/', '/shop', '/enterprise']) {
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

// "Ask about a coaster" preselects Product question + product
await page.goto(BASE + '/shop', { waitUntil: 'networkidle0' });
await page.click('[data-type="Product question"][data-product="Coasters"]');
assert.equal(await page.$eval('#sample-dlg [name=request_type]', (e) => e.value), 'Product question');
assert.equal(await page.$eval('#sample-dlg [name=product]', (e) => e.value), 'Coasters');
await page.keyboard.press('Escape');
// free sample form: name, company, email, phone, ship to
await page.click('.site-header [data-open-sample]');
assert.equal(await page.$eval('#sample-dlg [name=request_type]', (e) => e.value), 'Sample');
assert.match(await page.$eval('#sample-dlg [data-dlg-title]', (e) => e.textContent), /free sample/i);
for (const f of ['name', 'business', 'email', 'phone', 'address']) {
  assert.equal(await page.$eval(`#sample-dlg [name=${f}]`, (e) => !e.disabled && e.offsetParent !== null), true, f);
}
await page.click('#sample-dlg [type=submit]');
assert.match(await page.$eval('#sample-dlg [data-form-error]', (e) => e.textContent), /required/i);
ok('free sample form: five fields, required check fires');
await page.keyboard.press('Escape');

// bag -> Shopify cart permalink (navigation intercepted)
await page.setRequestInterception(true);
let cart;
const intercept = (r) => {
  if (r.url().startsWith('https://shop.juplifestudio.com/cart/')) { cart = r.url(); r.respond({ status: 200, contentType: 'text/plain', body: 'shopify' }); }
  else r.continue();
};
page.on('request', intercept);
await page.goto(BASE + '/shop', { waitUntil: 'networkidle0' });
await page.click('[data-sku="pop-coasters-6"]');
await page.click('#bag-dlg [aria-label="One more"]');
assert.equal(await page.$eval('[data-bag-count]', (e) => e.textContent), '2');
await Promise.all([page.waitForNavigation(), page.click('[data-checkout]')]);
assert.match(cart, /\/cart\/50851712630946:2\?/); // Flat / Mixed 6 colors
await page.goto(BASE + '/shop', { waitUntil: 'networkidle0' });
assert.equal(await page.$eval('[data-bag-count]', (e) => e.textContent), '0');
ok('bag add/qty -> Shopify cart permalink, bag cleared');
page.off('request', intercept);
await page.setRequestInterception(false);

// enterprise inline form: same free sample form, segment preset, logo allowed
await page.goto(BASE + '/enterprise', { waitUntil: 'networkidle0' });
assert.equal(await page.$eval('#request [name=segment]', (e) => e.value), 'Restaurant or bar');
assert.equal(await page.$eval('#request [name=logo]', (e) => e.type), 'file');
await page.click('#request [type=submit]');
assert.match(await page.$eval('#request [data-form-error]', (e) => e.textContent), /required/i);
ok('enterprise form: required check fires, segment preset');

// above the fold at 375x667
await page.goto(BASE + '/', { waitUntil: 'networkidle0' });
const vis = await page.evaluate(() => [...document.querySelectorAll('.hero-note')].some((el) => { const r = el.getBoundingClientRect(); return el.textContent.trim() === 'Shipping included' && r.top >= 0 && r.bottom <= innerHeight && r.width > 0; }));
assert.equal(vis, true);
ok('"Shipping included" above the fold at 375x667');

assert.deepEqual(errors.filter((e) => !/api\/|Failed to load resource/.test(e)), []);
ok('no script errors');
await browser.close();
