import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../web/data/catalog.json' with { type: 'json' };
import productsFile from '../web/data/products.json' with { type: 'json' };
import photos from '../web/data/photos.json' with { type: 'json' };
import { OPTION_SPEC } from '../functions/_lib.js';

const HIDDEN = [
  'fall-pop-coasters', 'stack-bands-fall', 'six-set-case', 'half-dozen', 'bakers-dozen',
  'gigi', 'tide-soap-dish', 'tide-dispenser', 'readers',
  'pop-tray-1-season-colors', 'pop-tray-2-pop-flowers', 'pop-tray-3-coastal',
];

test('storefront lists only the two coasters', () => {
  assert.equal(catalog.show_legacy, false);
  assert.deepEqual(catalog.listed, ['pop-coasters-6', 'flower-set-case']);
  const bySku = Object.fromEntries(productsFile.products.map((p) => [p.sku, p]));
  for (const sku of catalog.listed) {
    assert.equal(bySku[sku].home, false);
    assert.equal(bySku[sku].shop, false);
    assert.ok(bySku[sku].price > 0);
  }
  assert.equal(bySku['pop-coasters-6'].price, 29);
  assert.equal(bySku['flower-set-case'].price, 39);
  for (const sku of HIDDEN) assert.equal(catalog.listed.includes(sku), false, sku);
});

test('checkout allowlist matches the choices on the cards', () => {
  const bySku = Object.fromEntries(productsFile.products.map((p) => [p.sku, p]));
  for (const sku of catalog.listed) {
    const spec = OPTION_SPEC[sku];
    assert.ok(spec, sku);
    const options = bySku[sku].options;
    assert.deepEqual(options.map((o) => o.key), Object.keys(spec));
    for (const opt of options) assert.deepEqual(opt.choices.map((c) => c.value), spec[opt.key]);
  }
});

test('every coaster choice has a photo slot in photos.json', () => {
  const bySku = Object.fromEntries(productsFile.products.map((p) => [p.sku, p]));
  for (const sku of catalog.listed) {
    const book = photos.products[sku];
    assert.equal(typeof book.card.img, 'string');
    assert.ok(book.card.img.startsWith('img/'), book.card.img);
    assert.equal(typeof book.card.alt, 'string');
    assert.ok(book.card.alt.length > 10);
    for (const opt of bySku[sku].options) {
      assert.ok(book[opt.key], opt.key);
      for (const choice of opt.choices) {
        const shot = book[opt.key][choice.value];
        assert.ok(shot, `${sku} ${opt.key} ${choice.value}`);
        assert.equal(typeof shot.img, 'string');
        assert.equal(typeof shot.alt, 'string');
      }
    }
  }
});
