import { json, bad, body, rowToFilament, getSettings, stock, slug, str, optNum, temp, GROUPS, MATERIALS, MAKERS } from '../_lib.js';

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare('SELECT * FROM filaments ORDER BY sort, name').all();
  const s = await getSettings(env.DB);
  return json({ settings: s, filaments: results.map((r) => { const f = rowToFilament(r); return { ...f, stock: stock(f, s) }; }) });
}

export async function onRequestPost({ request, env }) {
  const b = await body(request);
  if (!b || !str(b.name).trim()) return bad('Give the color a name.');
  const name = str(b.name, 80).trim();
  const id = (b.id && slug(b.id)) || `${slug(name)}-${Date.now().toString(36)}`;
  const group = GROUPS.includes(b.group) ? b.group : 'Other';
  const material = MATERIALS.includes(b.material) ? b.material : '';
  const hex = /^#[0-9a-fA-F]{6}$/.test(b.hex || '') ? b.hex : '';
  const full = optNum(b.full), partialG = optNum(b.partialG);
  if (full === undefined || partialG === undefined) return bad('Spools and grams must be zero or more.');
  const maker = MAKERS.includes(b.maker) ? b.maker : '';
  const nozzle = temp(b.nozzle), bed = temp(b.bed);
  if (nozzle === undefined || bed === undefined) return bad('Temps look like 210-230 or 215.');
  try {
    await env.DB.prepare(`INSERT INTO filaments (id,name,hex,used_in,grp,sort,clear,full,partial_g,material,maker,brand,nozzle,bed,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, name, hex, str(b.usedIn), group, Number.isInteger(b.order) ? b.order : 99, b.clear ? 1 : 0, full, partialG, material, maker, str(b.brand), nozzle, bed, str(b.note, 400)).run();
  } catch (e) {
    if (String(e).includes('UNIQUE')) return json({ error: 'A color with that id already exists.' }, 409);
    throw e;
  }
  const r = await env.DB.prepare('SELECT * FROM filaments WHERE id=?').bind(id).first();
  return json(rowToFilament(r), 201);
}
