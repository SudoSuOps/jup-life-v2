// Shared helpers for the Pages Functions (underscore prefix = not routed).

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

// Known live price IDs for older boxes. New coaster SKUs must never charge these.
const HALF_DOZEN_PRICE_ID = 'price_1UTVSJHYwaTbul7MyxtILxOz';
const BAKERS_DOZEN_PRICE_ID = 'price_1UTVOYHYwaTbul7M7QJo4iye';
const RESERVED_PRICE_IDS = new Set([HALF_DOZEN_PRICE_ID, BAKERS_DOZEN_PRICE_ID]);

// A missing, blank, or borrowed price ID means the SKU is not for sale.
function coasterPrice(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (!id || RESERVED_PRICE_IDS.has(id)) return '';
  return id;
}

// Choices the server will accept as line-item metadata. Keep in step with web/data/products.json.
export const OPTION_SPEC = {
  'pop-coasters-6': {
    style: ['Flat', 'Edge'],
    tray: ['Mixed', 'Pumpkin', 'Coconut (clear)', 'Rhubarb', 'Key Lime', 'Peach', 'Sea Salt'],
  },
  'flower-set-case': {
    flower: ['Sunflower', 'Hibiscus'],
  },
};

const OPTION_KEYS = ['style', 'tray', 'flower'];

// {} when the line's choices are valid. null when a required choice is missing or not allowed.
export function lineOptions(sku, line) {
  const spec = OPTION_SPEC[sku];
  if (!spec) {
    for (const key of OPTION_KEYS) {
      const raw = line?.[key];
      if (raw != null && raw !== '') return null;
    }
    return {};
  }
  const out = {};
  for (const key of Object.keys(spec)) {
    const raw = line?.[key];
    if (typeof raw !== 'string' || !spec[key].includes(raw)) return null;
    out[key] = raw;
  }
  for (const key of OPTION_KEYS) {
    if (spec[key]) continue;
    const raw = line?.[key];
    if (raw != null && raw !== '') return null;
  }
  return out;
}

// Server-side catalog: the ONLY source of what can be charged. Items with no price ID are not purchasable.
export function sellables(env) {
  const items = [
    // Older SKUs stay mapped so their checkout code remains. The shop hides them via web/data/catalog.json.
    { sku: 'six-set-case', name: 'The Hibiscus Set (6 coasters + case)', price: env.STRIPE_PRICE_SIX_SET_CASE, max: 20 },
    { sku: 'fall-pop-coasters', name: 'Holiday Tray Pop Coasters (12, no case)', price: env.STRIPE_PRICE_FALL_POP_COASTERS, max: 20 },
    { sku: 'gigi', name: 'The Gigi', price: env.STRIPE_PRICE_GIGI, max: 20 },
    { sku: 'tide-soap-dish', name: 'Tide Soap Dish', price: env.STRIPE_PRICE_TIDE_SOAP_DISH, max: 20 },
    { sku: 'tide-dispenser', name: 'Tide Hand Soap Dispenser', price: env.STRIPE_PRICE_TIDE_DISPENSER, max: 20 },
    { sku: 'half-dozen', name: 'The Half Dozen (6 Assorted Coasters)', price: env.STRIPE_PRICE_HALF_DOZEN || HALF_DOZEN_PRICE_ID, max: 20 },
    { sku: 'bakers-dozen', name: "The Baker's Dozen (13 Assorted Coasters)", price: env.STRIPE_PRICE_BAKERS_DOZEN || BAKERS_DOZEN_PRICE_ID, max: 20 },
    { sku: 'readers', name: 'The Reader', price: env.STRIPE_PRICE_READERS, max: 20 },
    // Own env vars only. No fallback to another product's price.
    { sku: 'pop-coasters-6', name: 'Pop Coasters 6-Pack', price: coasterPrice(env.STRIPE_PRICE_POP_COASTERS_6), max: 20 },
    { sku: 'flower-set-case', name: 'Flower Coaster Set with Case', price: coasterPrice(env.STRIPE_PRICE_FLOWER_SET_CASE), max: 20 },
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
