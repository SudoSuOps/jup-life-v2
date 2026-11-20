// GET /api/summary -> what to order, for the page header and automations (daily email, Slack, etc.)
import { json, rowToFilament, getSettings, stock } from './_lib.js';

export async function onRequestGet({ env }) {
  const s = await getSettings(env.DB);
  const { results } = await env.DB.prepare('SELECT * FROM filaments ORDER BY sort, name').all();
  const all = results.map((r) => { const f = rowToFilament(r); return { ...f, stock: stock(f, s) }; });
  const order = all.filter((f) => f.stock.status === 'order').map((f) => ({ id: f.id, name: f.name, group: f.group, grams: f.stock.grams, toOrder: f.stock.toOrder, brand: f.brand, material: f.material }));
  const today = new Date().toISOString().slice(0, 10);
  const deals = (await env.DB.prepare('SELECT supplier, what, material, price, size_g, min_qty, expires, link FROM deals').all()).results
    .filter((d) => !d.expires || d.expires >= today)
    .map((d) => ({ ...d, perKg: +(d.price / (d.size_g / 1000)).toFixed(2) }))
    .sort((a, b) => a.perKg - b.perKg);
  return json({
    settings: s,
    colorsToOrder: order.length,
    spoolsToOrder: order.reduce((n, f) => n + f.toOrder, 0),
    notCounted: all.filter((f) => !f.stock.counted).map((f) => f.name),
    onShelfKg: +(all.reduce((g, f) => g + f.stock.grams, 0) / 1000).toFixed(2),
    order,
    bestDeal: deals[0] || null,
  });
}
