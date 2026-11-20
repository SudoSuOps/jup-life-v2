import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../web/data/catalog.json' with { type: 'json' };
import productsFile from '../web/data/products.json' with { type: 'json' };
import photos from '../web/data/photos.json' with { type: 'json' };
import shopify from '../web/data/shopify.json' with { type: 'json' };

const bySku = Object.fromEntries(productsFile.products.map((p) => [p.sku, p]));
const combos = (lists) => lists.reduce((acc, l) => acc.flatMap((a) => l.map((v) => [...a, v])), [[]]);

test('storefront lists the three coasters at their prices', () => {
  assert.deepEqual(catalog.listed, ['pop-coasters-6', 'flower-set-case', 'coastal-6']);
  assert.equal(bySku['pop-coasters-6'].price, 29);
  assert.equal(bySku['flower-set-case'].price, 39);
  assert.equal(bySku['coastal-6'].price, 39);
});

test('checkout goes to the Shopify store', () => {
  assert.equal(shopify.store, 'https://shop.juplifestudio.com');
});

test('every choice on every card maps to a Shopify variant ID', () => {
  for (const sku of catalog.listed) {
    const entry = shopify.products[sku];
    assert.ok(entry, `${sku} missing from shopify.json`);
    const options = bySku[sku].options;
    assert.deepEqual(options.map((o) => o.key), entry.options, sku);
    const all = combos(options.map((o) => o.choices.map((c) => c.value)));
    for (const combo of all) {
      const id = entry.variants[combo.join('|')];
      assert.match(String(id), /^\d{10,}$/, `${sku} ${combo.join(' / ')}`);
    }
    assert.equal(Object.keys(entry.variants).length, all.length, `${sku} has stray variants`);
  }
});

test('every coaster choice has a photo slot in photos.json', () => {
  for (const sku of catalog.listed) {
    const book = photos.products[sku];
    assert.ok(book.card.img.startsWith('img/'), book.card.img);
    assert.ok(book.card.alt.length > 10);
    for (const opt of bySku[sku].options) {
      for (const choice of opt.choices) {
        const shot = book[opt.key]?.[choice.value];
        assert.ok(shot, `${sku} ${opt.key} ${choice.value}`);
        assert.equal(typeof shot.img, 'string');
        assert.equal(typeof shot.alt, 'string');
      }
    }
  }
});
