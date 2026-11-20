import { json, bad, body, rowToDeal, str, optNum, MATERIALS } from '../_lib.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT * FROM deals ORDER BY added_at DESC').all();
  return json({ deals: results.map(rowToDeal) });
}

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  if (!b) return bad('Send the deal as JSON.');
  const supplier = str(b.supplier, 120).trim();
  const price = optNum(b.price);
  if (!supplier) return bad('Who is the supplier?');
  if (price == null) return bad('Add the price per spool.');
  const sizeG = optNum(b.sizeG) || 1000;
  const minQty = optNum(b.minQty);
  if (minQty === undefined) return bad('Minimum order must be a number.');
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(b.expires || '') ? b.expires : null;
  const link = /^https?:\/\//i.test(b.link || '') ? str(b.link, 500) : '';
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO deals (id,supplier,what,material,price,size_g,min_qty,expires,link,notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, supplier, str(b.what), MATERIALS.includes(b.material) ? b.material : '', price, sizeG, minQty == null ? null : Math.floor(minQty), expires, link, str(b.notes, 400)).run();
  return json(rowToDeal(await env.DB.prepare('SELECT * FROM deals WHERE id=?').bind(id).first()), 201);
}
