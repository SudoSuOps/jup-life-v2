// POST /api/usage  {"filament":"pumpkin","grams":84,"note":"Pop tray, Flat","source":"bambu"}
// Takes grams off the open spool, cracking sealed spools as needed, and logs it.
// Also accepts {"items":[{filament,grams,note}, ...]} for a multi-color print.
// GET /api/usage?filament=pumpkin&limit=50  -> recent log
import { json, bad, body, rowToFilament, getSettings, stock, deduct, str } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get('limit') || '50', 10) || 50));
  const f = u.searchParams.get('filament');
  const q = f
    ? env.DB.prepare('SELECT * FROM usage_log WHERE filament_id=? ORDER BY id DESC LIMIT ?').bind(f, limit)
    : env.DB.prepare('SELECT * FROM usage_log ORDER BY id DESC LIMIT ?').bind(limit);
  const { results } = await q.all();
  return json({ usage: results.map((r) => ({ id: r.id, filament: r.filament_id, grams: r.grams, note: r.note, source: r.source, at: r.at })) });
}

export async function onRequestPost({ request, env, data }) {
  const b = await body(request);
  if (!b) return bad('Send JSON like {"filament":"pumpkin","grams":84}.');
  const items = Array.isArray(b.items) ? b.items : [b];
  if (!items.length || items.length > 20) return bad('Send 1 to 20 items.');
  for (const it of items) {
    const g = Number(it?.grams);
    if (!it || !it.filament || !Number.isFinite(g) || g <= 0 || g > 20000) return bad('Each item needs a filament id and grams between 0 and 20000.');
  }
  const s = await getSettings(env.DB);
  const out = [], stmts = [], state = new Map();
  const source = str(b.source || data.who || '', 60);
  for (const it of items) {
    const fid = String(it.filament);
    let cur = state.get(fid);
    if (!cur) {
      const r = await env.DB.prepare('SELECT * FROM filaments WHERE id=?').bind(fid).first();
      if (!r) return json({ error: `No color with id "${it.filament}".` }, 404);
      cur = rowToFilament(r); state.set(fid, cur);
    }
    const grams = Number(it.grams);
    stmts.push(env.DB.prepare('INSERT INTO usage_log (filament_id, grams, note, source) VALUES (?,?,?,?)').bind(fid, grams, str(it.note || b.note, 200), source));
    if (cur.full == null && cur.partialG == null) {
      // not counted yet: keep the log, leave the shelf count alone
      out.push({ filament: fid, name: cur.name, used: grams, short: null, full: null, partialG: null, stock: stock(cur, s), note: 'Not counted yet, so nothing was taken off the shelf. Count it on the page.' });
      continue;
    }
    const d = deduct(cur.full, cur.partialG, grams, s.spoolG);
    cur.full = d.full; cur.partialG = d.partialG;
    out.push({ filament: fid, name: cur.name, used: grams, short: d.short, full: d.full, partialG: d.partialG, stock: stock(cur, s) });
  }
  for (const [fid, cur] of state) {
    if (cur.full == null && cur.partialG == null) continue;
    stmts.push(env.DB.prepare(`UPDATE filaments SET full=?, partial_g=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).bind(cur.full, cur.partialG, fid));
  }
  await env.DB.batch(stmts);
  return json({ ok: true, results: out });
}
