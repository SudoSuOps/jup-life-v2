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

export async function onRequestPost({ request, env }) {
  const payload = await request.text();
  if (!(await verifyStripe(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return fail(400, 'bad signature');

  let event;
  try { event = JSON.parse(payload); } catch { return fail(400, 'bad payload'); }

  if (event.type === 'checkout.session.completed') {
    const s = event.data?.object || {};
    const who = s.customer_details || {};
    const ship = s.shipping_details?.address || s.customer_details?.address || {};
    console.log('order paid', s.id, s.amount_total, who.email);
    await notify(env, {
      subject: `New order: ${s.id}`,
      text: [
        `Paid ${((s.amount_total || 0) / 100).toFixed(2)} ${String(s.currency || '').toUpperCase()}`,
        `Customer: ${who.name || ''} <${who.email || ''}> ${who.phone || ''}`.trim(),
        `Ship to: ${[ship.line1, ship.line2, ship.city, ship.state, ship.postal_code, ship.country].filter(Boolean).join(', ')}`,
        'See the Stripe dashboard for line items.',
      ].join('\n'),
      replyTo: who.email || undefined,
    });
  }
  return json({ received: true });
}
