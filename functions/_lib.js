// Shared helpers for the Pages Functions (underscore prefix = not routed).
import productsDoc from '../web/data/products.json' with { type: 'json' };
import batchDoc from '../web/data/batch.json' with { type: 'json' };

// One place to change what a single-color 6-pack costs. Owner should confirm before launch.
// Checkout charges this many dollars via Stripe price_data. The page reads the same constant.
export const SINGLE_COLOR_SIX_PACK_USD = 29;

// A tray sells a 6-pack of one color when it has color_pack set, exactly six flavors, and is not
// marked concept or coming_soon. Holiday Tray colors come from Today's Batch; Pop Trays from pops.
export function colorPackCatalog(products, batch) {
  const out = {};
  const flavorsOf = (p) => (p.swatches === 'batch' ? batch?.flavors : p.pops) || [];
  for (const p of products) {
    if (!p || !p.color_pack || p.concept || p.coming_soon) continue;
    const flavors = flavorsOf(p).slice(0, 6);
    const colors = flavors.map((f) => f?.name);
    if (colors.length !== 6 || colors.some((c) => typeof c !== 'string' || !c.trim()) || new Set(colors).size !== 6) continue;
    out[p.sku] = { name: p.color_pack, colors };
  }
  return out;
}

export const COLOR_PACKS = colorPackCatalog(productsDoc.products, batchDoc);

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export const fail = (status, detail) => json({ detail }, status);

export const clientIp = (req) => req.headers.get('CF-Connecting-IP') || 'unknown';

// Best-effort sliding-window throttle, per isolate. Cloudflare may run several isolates, so this
// slows bots rather than guaranteeing a limit. For a hard cap, add a Rate Limiting rule in the dashboard.
const hits = new Map();
export function allow(bucket, ip, limit, windowMs = 3600_000, now = Date.now()) {
  const key = `${bucket}:${ip}`;
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
  return true;
}
export const resetThrottle = () => hits.clear();

// Server-side catalog: the ONLY source of what can be charged. Items with no price ID are not purchasable.
export function sellables(env) {
  const items = [
    // TODO(Smash): which $29 product is primary (6+case, The Half Dozen box, or 12 with no case) is unresolved. Do not pick one or change prices.
    { sku: 'six-set-case', name: 'The Hibiscus Set (6 coasters + case)', price: env.STRIPE_PRICE_SIX_SET_CASE, max: 20 },
    { sku: 'fall-pop-coasters', name: 'Holiday Tray Pop Coasters (12, no case)', price: env.STRIPE_PRICE_FALL_POP_COASTERS, max: 20 },
    { sku: 'gigi', name: 'The Gigi', price: env.STRIPE_PRICE_GIGI, max: 20 },
    { sku: 'tide-soap-dish', name: 'Tide Soap Dish', price: env.STRIPE_PRICE_TIDE_SOAP_DISH, max: 20 },
    { sku: 'tide-dispenser', name: 'Tide Hand Soap Dispenser', price: env.STRIPE_PRICE_TIDE_DISPENSER, max: 20 },
    { sku: 'half-dozen', name: 'The Half Dozen (6 Assorted Coasters)', price: env.STRIPE_PRICE_HALF_DOZEN || 'price_1UTVSJHYwaTbul7MyxtILxOz', max: 20 },
    { sku: 'bakers-dozen', name: "The Baker's Dozen (13 Assorted Coasters)", price: env.STRIPE_PRICE_BAKERS_DOZEN || 'price_1UTVOYHYwaTbul7M7QJo4iye', max: 20 },
    { sku: 'readers', name: 'The Reader', price: env.STRIPE_PRICE_READERS, max: 20 },
  ];
  return Object.fromEntries(items.filter((i) => i.price).map((i) => [i.sku, i]));
}

export const siteUrl = (env, req) => (env.SITE_URL || new URL(req.url).origin).replace(/\/$/, '');

export const recipients = (env) =>
  (env.NOTIFY_TO || 'hello@juplifestudio.com,dee@juplifestudio.com').split(',').map((s) => s.trim()).filter(Boolean);

// Email via Resend's HTTP API when configured; otherwise log. Never throws.
export async function notify(env, { subject, text, replyTo, attachments }) {
  if (!env.RESEND_API_KEY) {
    console.log('NOTIFY (no email provider configured)', subject, '\n' + text);
    return false;
  }
  const payload = { from: env.NOTIFY_FROM || 'JUP LIFE <hello@juplifestudio.com>', to: recipients(env), subject, text };
  if (replyTo) payload.reply_to = replyTo;
  if (attachments?.length) payload.attachments = attachments;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error('notify failed', r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) {
    console.error('notify error', String(e));
    return false;
  }
}
