// POST /api/sample-request (multipart): validates, throttles, then emails the studio (logo attached).
import { allow, clientIp, fail, json, notify } from '../_lib.js';

const MAX_LOGO = 4 * 1024 * 1024;
const TYPES = new Set(['Half Dozen sample', 'Product question', 'Custom']);
const LOGO = {
  png: { mime: ['image/png'], magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: ['image/jpeg'], magic: [0xff, 0xd8] },
  jpeg: { mime: ['image/jpeg'], magic: [0xff, 0xd8] },
  pdf: { mime: ['application/pdf'], magic: [0x25, 0x50, 0x44, 0x46] },
  svg: { mime: ['image/svg+xml'], magic: null },
};
const SEGMENTS = new Set(['Restaurant or bar', 'Hotel or rental', 'Event or gifting', 'Custom', 'Just me']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(0, n) : '');

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function onRequestPost({ request, env }) {
  let fd;
  try { fd = await request.formData(); } catch { return fail(400, 'Bad request.'); }

  if (fd.get('website')) return json({ ok: true }); // honeypot: bots fill hidden fields; pretend success
  if (!allow('sample', clientIp(request), Number(env.RATE_LIMIT_PER_HOUR) || 8)) {
    return fail(429, 'Too many requests. Try again later or email hello@juplifestudio.com.');
  }

  const rec = {
    name: clean(fd.get('name'), 120), business: clean(fd.get('business'), 160), city: clean(fd.get('city'), 120),
    email: clean(fd.get('email'), 200), phone: clean(fd.get('phone'), 40), notes: clean(fd.get('notes'), 2000),
    product: clean(fd.get('product'), 120), source_page: clean(fd.get('source_page'), 200),
  };
  rec.request_type = TYPES.has(fd.get('request_type')) ? fd.get('request_type') : 'Half Dozen sample';
  const seg = fd.get('segment');
  if (SEGMENTS.has(seg)) rec.segment = seg;
  if (!rec.name || !rec.business || !rec.city || !EMAIL.test(rec.email)) return fail(422, 'Please fill in the required fields.');

  let attachments;
  const logo = fd.get('logo');
  if (logo && typeof logo === 'object' && logo.name) {
    const ext = logo.name.split('.').pop().toLowerCase();
    const rule = LOGO[ext];
    if (!rule || !rule.mime.includes(logo.type)) return fail(400, 'Logo must be PNG, JPG, SVG or PDF.');
    if (logo.size > MAX_LOGO) return fail(413, 'Logo must be 4 MB or smaller.');
    const bytes = new Uint8Array(await logo.arrayBuffer());
    if (rule.magic && !rule.magic.every((b, i) => bytes[i] === b)) return fail(400, "That file doesn't look like a valid logo.");
    if (ext === 'svg' && /<script|\son\w+\s*=|javascript:/i.test(new TextDecoder().decode(bytes))) return fail(400, "SVG logos can't contain scripts.");
    attachments = [{ filename: `logo.${ext}`, content: toBase64(bytes) }];
  }

  const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomUUID().slice(0, 6);
  const sent = await notify(env, {
    subject: `[${rec.request_type}${rec.segment ? ' · ' + rec.segment : ''}] ${rec.business} · ${rec.city}`,
    text: [`id: ${id}`, ...Object.entries(rec).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), attachments ? 'logo: attached' : ''].filter(Boolean).join('\n'),
    replyTo: rec.email,
    attachments,
  });
  // No email provider configured yet: the request is logged only (see Pages > Functions logs).
  return json({ ok: true, id, emailed: sent });
}
