// POST /api/stripe/webhook : verifies Stripe's signature, then emails the order.
import { fail, json, notify } from '../../_lib.js';

const enc = new TextEncoder();
const TOLERANCE_S = 300;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Stripe-Signature: t=<unix>,v1=<hmac_sha256(secret, `${t}.${payload}`)>[,v1=...]
export async function verifyStripe(payload, header, secret, now = Date.now() / 1000) {
  if (!secret || !header) return false;
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now - Number(t)) > TOLERANCE_S) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${payload}`)));
  return sigs.some((s) => safeEqual(s, expected));
}

const money = (cents, cur) => `${((cents || 0) / 100).toFixed(2)} ${String(cur || 'usd').toUpperCase()}`;

// Line items are not in the webhook payload; ask Stripe. Returns [] if that fails, so the email still goes out.
async function lineItems(id, env) {
  if (!env.STRIPE_SECRET_KEY || !id) return [];
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}/line_items?limit=50`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!r.ok) { console.error('line_items failed', r.status); return []; }
    return (await r.json()).data || [];
  } catch (e) { console.error('line_items error', String(e)); return []; }
}

export function orderEmail(s, items = []) {
  const who = s.customer_details || {};
  const sd = s.shipping_details || s.collected_information?.shipping_details || {};
  const a = sd.address || who.address || {};
  const cityLine = [[a.city, a.state].filter(Boolean).join(', '), a.postal_code].filter(Boolean).join(' ');
  const shipTo = [sd.name || who.name, a.line1, a.line2, cityLine, a.country].filter(Boolean);
  const what = items.length
    ? items.map((i) => `${i.quantity} x ${i.description}  (${money(i.amount_total, s.currency)})`)
    : ['(line items unavailable, see the Stripe dashboard)'];
  const colorLines = typeof s.metadata?.color_lines === 'string' ? s.metadata.color_lines : '';
  const short = items.length ? items.map((i) => (i.quantity > 1 ? `${i.quantity}x ` : '') + i.description).join(', ') : 'order';
  const dash = s.payment_intent ? `https://dashboard.stripe.com/${s.livemode === false ? 'test/' : ''}payments/${s.payment_intent}` : '';
  const text = [
    'NEW JUP LIFE ORDER', '',
    'ITEMS', ...what, '',
    ...(colorLines ? ['COLORS', colorLines, ''] : []),
    `TOTAL  ${money(s.amount_total, s.currency)}${s.livemode === false ? '  (TEST MODE)' : ''}`, '',
    'SHIP TO', ...shipTo, who.phone ? `Phone: ${who.phone}` : '', '',
    'CUSTOMER', [who.name, who.email].filter(Boolean).join(' · '), '',
    `Order ${s.id}`, dash,
  ].filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n').trim();
  return { subject: `New order: ${short} · ${money(s.amount_total, s.currency)}`, text };
}

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  if (!(await verifyStripe(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return fail(400, 'bad signature');

  let event;
  try { event = JSON.parse(payload); } catch { return fail(400, 'bad payload'); }

  if (event.type === 'checkout.session.completed') {
    const s = event.data?.object || {};
    console.log('order paid', s.id, s.amount_total, s.customer_details?.email);
    const items = await lineItems(s.id, env);
    const { subject, text } = orderEmail(s, items);
    await notify(env, { subject, text, replyTo: s.customer_details?.email || undefined });
  }
  return json({ received: true });
}
