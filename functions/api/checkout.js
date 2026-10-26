// POST /api/checkout  { items: [{ sku, qty, color? }] } -> { url }  (Stripe-hosted Checkout)
// color is a single-color 6-pack. The charge is SINGLE_COLOR_SIX_PACK_USD, never the client price.
import { allow, clientIp, COLOR_PACKS, fail, json, sellables, SINGLE_COLOR_SIX_PACK_USD, siteUrl } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return fail(503, 'Checkout is not configured yet.');
  if (!allow('checkout', clientIp(request), 30)) return fail(429, 'Too many attempts. Try again in a bit.');

  let body;
  try { body = await request.json(); } catch { return fail(400, 'Bad request.'); }
  const items = body?.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 20) return fail(400, 'Your bag is empty.');

  const cents = SINGLE_COLOR_SIX_PACK_USD * 100;
  if (!Number.isInteger(cents) || cents < 50) return fail(503, 'Checkout is not configured yet.');

  const catalog = sellables(env);
  const merged = new Map();
  for (const line of items) {
    if (!line || typeof line !== 'object') return fail(400, 'Bad request.');
    const sku = typeof line.sku === 'string' ? line.sku : '';
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) return fail(400, 'Invalid quantity.');
    const colorSent = Object.hasOwn(line, 'color') && line.color != null;
    if (colorSent) {
      if (!Object.hasOwn(COLOR_PACKS, sku)) return fail(400, `'${sku.slice(0, 40)}' isn't sold as a single-color 6-pack.`);
      const pack = COLOR_PACKS[sku];
      const color = typeof line.color === 'string' ? line.color : '';
      if (!pack.colors.includes(color)) return fail(400, `'${color.slice(0, 40)}' isn't a color on this tray.`);
      const key = `${sku}\0${color}`;
      const prev = merged.get(key);
      merged.set(key, { sku, color, packName: pack.name, qty: Math.min((prev?.qty || 0) + qty, 20) });
    } else {
      if (!Object.hasOwn(catalog, sku)) return fail(400, `'${sku.slice(0, 40)}' isn't available for checkout. Ask about this batch instead.`);
      const prev = merged.get(sku);
      merged.set(sku, { sku, qty: Math.min((prev?.qty || 0) + qty, catalog[sku].max) });
    }
  }

  const base = siteUrl(env, request);
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  const colorBits = [];
  [...merged.values()].forEach((line, i) => {
    form.set(`line_items[${i}][quantity]`, String(line.qty));
    if (line.color) {
      const name = `${line.packName} · ${line.color}`;
      form.set(`line_items[${i}][price_data][currency]`, 'usd');
      form.set(`line_items[${i}][price_data][unit_amount]`, String(cents));
      form.set(`line_items[${i}][price_data][product_data][name]`, name);
      form.set(`line_items[${i}][price_data][product_data][metadata][sku]`, line.sku);
      form.set(`line_items[${i}][price_data][product_data][metadata][color]`, line.color);
      form.set(`line_items[${i}][price_data][product_data][metadata][pack]`, 'single-color-6');
      colorBits.push(`${name} x${line.qty}`);
    } else {
      form.set(`line_items[${i}][price]`, catalog[line.sku].price);
    }
  });
  if (colorBits.length) {
    const summary = colorBits.join('; ').slice(0, 500);
    form.set('metadata[color_lines]', summary);
    form.set('payment_intent_data[metadata][color_lines]', summary);
  }
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
