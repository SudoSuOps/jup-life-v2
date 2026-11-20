export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const bad = (msg) => json({ error: msg }, 400);

export async function body(request) {
  try { const b = await request.json(); return b && typeof b === 'object' && !Array.isArray(b) ? b : null; } catch { return null; }
}

export const GROUPS = ['Stock', 'Pop', 'Flower', 'Coastal', 'Other'];
export const MATERIALS = ['', 'TPU', 'PLA', 'PETG', 'Other'];
export const MAKERS = ['', 'SUNLU', 'QIDI', 'Bambu Lab', 'Other'];
// temps as text ranges in °C: "210-230" or "215"
export const temp = (v) => { const s = String(v ?? '').trim().replace(/\s+/g, '').replace(/[–—]/g, '-').replace(/°?c$/i, ''); return s === '' || /^\d{2,3}(-\d{2,3})?$/.test(s) ? s : undefined; };

export function rowToFilament(r) {
  return { id: r.id, name: r.name, hex: r.hex, usedIn: r.used_in, group: r.grp, order: r.sort, clear: !!r.clear,
    full: r.full, partialG: r.partial_g, material: r.material, maker: r.maker, brand: r.brand, nozzle: r.nozzle, bed: r.bed, note: r.note, updatedAt: r.updated_at };
}
export function rowToDeal(r) {
  return { id: r.id, supplier: r.supplier, what: r.what, material: r.material, price: r.price, sizeG: r.size_g,
    minQty: r.min_qty, expires: r.expires, link: r.link, notes: r.notes, addedAt: r.added_at };
}

export async function getSettings(db) {
  const { results } = await db.prepare('SELECT k, v FROM settings').all();
  const s = { spoolG: 1000, lowSpools: 1, targetSpools: 3 };
  for (const r of results) s[r.k] = r.v;
  return s;
}

// Same rule the page uses.
export function stock(f, s) {
  const full = f.full, part = f.partialG;
  if (full == null && part == null) return { counted: false, grams: 0, status: 'count', toOrder: 0 };
  const grams = (full || 0) * s.spoolG + (part || 0);
  const low = grams < s.lowSpools * s.spoolG;
  const toOrder = low ? Math.max(0, Math.ceil((s.targetSpools * s.spoolG - grams) / s.spoolG)) : 0;
  return { counted: true, grams, spools: +(grams / s.spoolG).toFixed(2), status: low ? 'order' : 'ok', toOrder };
}

// Take grams off a color: open spool first, then crack sealed spools.
export function deduct(full, partialG, grams, spoolG) {
  let f = full || 0, p = partialG || 0, g = grams;
  while (g > 0) {
    if (p >= g) { p -= g; g = 0; break; }
    g -= p; p = 0;
    if (f > 0) { f -= 1; p = spoolG; } else break; // shelf is empty
  }
  return { full: f, partialG: Math.round(p * 10) / 10, short: Math.round(g * 10) / 10 };
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));
export function optNum(v) { if (v === null || v === '' || v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : undefined; }
