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

// Server-side catalog: the ONLY source of what can be charged. Items with no price ID are not purchasable.
export function sellables(env) {
  const items = [
    { sku: 'six-set-case', name: '6-Coaster Set + Case', price: env.STRIPE_PRICE_SIX_SET_CASE, max: 20 },
    { sku: 'fall-pop-coasters', name: 'Fall Tray Pop Coasters', price: env.STRIPE_PRICE_FALL_POP_COASTERS, max: 20 },
    { sku: 'gigi', name: 'The Gigi', price: env.STRIPE_PRICE_GIGI, max: 20 },
    { sku: 'tide-soap-dish', name: 'Tide Soap Dish', price: env.STRIPE_PRICE_TIDE_SOAP_DISH, max: 20 },
    { sku: 'tide-dispenser', name: 'Tide Hand Soap Dispenser', price: env.STRIPE_PRICE_TIDE_DISPENSER, max: 20 },
    { sku: 'half-dozen', name: 'The Half Dozen (6 Assorted Coasters)', price: env.STRIPE_PRICE_HALF_DOZEN || 'price_1UTVSJHYwaTbul7MyxtILxOz', max: 20 },
    { sku: 'bakers-dozen', name: "The Baker's Dozen (13 Assorted Coasters)", price: env.STRIPE_PRICE_BAKERS_DOZEN || 'price_1UTVOYHYwaTbul7M7QJo4iye', max: 20 },
    { sku: 'readers', name: 'The Readers', price: env.STRIPE_PRICE_READERS, max: 20 },
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
