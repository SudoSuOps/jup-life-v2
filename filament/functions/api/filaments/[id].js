import { json, bad, body, rowToFilament, getSettings, stock, str, optNum, temp, GROUPS, MATERIALS, MAKERS } from '../_lib.js';

const FIELDS = {
  name: ['name', (v) => { const s = str(v, 80).trim(); return s || undefined; }],
  hex: ['hex', (v) => (v === '' || /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined)],
  usedIn: ['used_in', (v) => str(v)],
  group: ['grp', (v) => (GROUPS.includes(v) ? v : undefined)],
  order: ['sort', (v) => (Number.isInteger(v) ? v : undefined)],
  clear: ['clear', (v) => (v ? 1 : 0)],
  full: ['full', (v) => { const n = optNum(v); return n === null ? null : n === undefined ? undefined : Math.floor(n); }],
  partialG: ['partial_g', optNum],
  material: ['material', (v) => (MATERIALS.includes(v) ? v : undefined)],
  maker: ['maker', (v) => (MAKERS.includes(v) ? v : undefined)],
  brand: ['brand', (v) => str(v)],
  nozzle: ['nozzle', temp],
  bed: ['bed', temp],
  note: ['note', (v) => str(v, 400)],
};

export async function onRequestGet({ params, env }) {
  const r = await env.DB.prepare('SELECT * FROM filaments WHERE id=?').bind(params.id).first();
  if (!r) return json({ error: 'No color with that id.' }, 404);
  const f = rowToFilament(r);
  return json({ ...f, stock: stock(f, await getSettings(env.DB)) });
}

export async function onRequestPatch({ params, request, env }) {
  const b = await body(request);
  if (!b) return bad('Send the fields to change as JSON.');
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(b)) {
    const spec = FIELDS[k];
    if (!spec) continue;
    const val = spec[1](v);
    if (val === undefined) return bad(`"${k}" has a value I can't save.`);
    sets.push(`${spec[0]}=?`); vals.push(val);
  }
  if (!sets.length) return bad('Nothing to change.');
  sets.push(`updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  const res = await env.DB.prepare(`UPDATE filaments SET ${sets.join(',')} WHERE id=?`).bind(...vals, params.id).run();
  if (!res.meta.changes) return json({ error: 'No color with that id.' }, 404);
  const r = await env.DB.prepare('SELECT * FROM filaments WHERE id=?').bind(params.id).first();
  const f = rowToFilament(r);
  return json({ ...f, stock: stock(f, await getSettings(env.DB)) });
}

export async function onRequestDelete({ params, env }) {
  await env.DB.prepare('DELETE FROM filaments WHERE id=?').bind(params.id).run();
  return json({ ok: true });
}
