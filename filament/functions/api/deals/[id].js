import { json } from '../_lib.js';
export async function onRequestDelete({ params, env }) {
  await env.DB.prepare('DELETE FROM deals WHERE id=?').bind(params.id).run();
  return json({ ok: true });
}
