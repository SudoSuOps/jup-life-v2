// POST /api/checkout  { items: [{ sku, qty }] } -> { url }  (Stripe-hosted Checkout)
import { allow, clientIp, fail, json, sellables, siteUrl } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return fail(503, 'Checkout is not configured yet.');
  if (!allow('checkout', clientIp(request), 30)) return fail(429, 'Too many attempts. Try again in a bit.');

  let body;
  try { body = await request.json(); } catch { return fail(400, 'Bad request.'); }
  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) return fail(400, 'Your bag is empty.');

  const catalog = sellables(env);
  const merged = new Map();
  for (const line of items) {
    const sku = typeof line?.sku === 'string' ? line.sku : '';
    const qty = Number(line?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return fail(400, 'Invalid quantity.');
    if (!Object.hasOwn(catalog, sku)) return fail(400, `'${sku.slice(0, 40)}' isn't available for checkout. Ask about this batch instead.`);
    merged.set(sku, Math.min((merged.get(sku) || 0) + qty, catalog[sku].max));
  }

  const base = siteUrl(env, request);
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  [...merged].forEach(([sku, qty], i) => {
    form.set(`line_items[${i}][price]`, catalog[sku].price);
    form.set(`line_items[${i}][quantity]`, String(qty));
  });
  (env.SHIP_COUNTRIES || 'US').split(',').forEach((c, i) => form.set(`shipping_address_collection[allowed_countries][${i}]`, c.trim()));
  form.set('phone_number_collection[enabled]', 'true');
  form.set('success_url', `${base}/shop?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${base}/shop?checkout=cancel`);
  form.set('metadata[source]', 'juplifestudio.com');

  let res;
  try {
    res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': crypto.randomUUID() },
      body: form,
    });
  } catch (e) {
    console.error('stripe checkout fetch failed', String(e));
    return fail(502, 'Checkout is unavailable right now.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    console.error('stripe checkout failed', res.status, data?.error?.message);
    return fail(502, 'Checkout is unavailable right now.');
  }
  return json({ url: data.url });
}
