import { json, bad, body, getSettings } from './_lib.js';
const KEYS = { spoolG: [100, 10000], lowSpools: [0, 100], targetSpools: [0, 100] };

export async function onRequestGet({ env }) { return json(await getSettings(env.DB)); }

export async function onRequestPut({ request, env }) {
  const b = await body(request);
  if (!b) return bad('Send settings as JSON.');
  const stmts = [];
  for (const [k, [lo, hi]] of Object.entries(KEYS)) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) return bad(`${k} must be between ${lo} and ${hi}.`);
    stmts.push(env.DB.prepare('INSERT INTO settings (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, n));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json(await getSettings(env.DB));
}
