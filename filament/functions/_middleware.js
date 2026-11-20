// Auth for /api/*. Two ways in:
//  1. Cloudflare Access (people): verify the Cf-Access-Jwt-Assertion JWT against the team's certs.
//  2. Bearer token (automations): Authorization: Bearer <API_TOKEN>.
// Fails closed when neither is configured. DEV_OPEN=1 is for `wrangler pages dev` only.
import { json } from './api/_lib.js';

let certCache = { at: 0, keys: null };

function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? 4 - (s.length % 4) : 0;
  const bin = atob(s + '='.repeat(pad));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const dec = (b) => JSON.parse(new TextDecoder().decode(b));

async function accessKeys(team) {
  if (certCache.keys && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  const { keys } = await r.json();
  certCache = { at: Date.now(), keys };
  return keys;
}

export async function verifyAccessJwt(token, env, fetchKeys = accessKeys) {
  const team = (env.ACCESS_TEAM_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!token || !team || !env.ACCESS_AUD) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = dec(b64urlToBytes(parts[0])); payload = dec(b64urlToBytes(parts[1])); } catch { return null; }
  if (header.alg !== 'RS256') return null;
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  if (payload.iss && payload.iss !== `https://${team}`) return null;
  const keys = await fetchKeys(team);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return ok ? (payload.email || payload.common_name || 'access') : null;
}

function tokenMatches(given, expected) {
  if (!given || !expected || given.length !== expected.length) return false;
  let d = 0;
  for (let i = 0; i < given.length; i++) d |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return d === 0;
}

export async function onRequest(ctx) {
  const { request, env, next, data } = ctx;
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return next();
  if (url.pathname === '/api/health') return next();

  if (env.DEV_OPEN === '1') { data.who = 'dev'; return next(); }

  const auth = request.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer && tokenMatches(bearer, env.API_TOKEN || '')) { data.who = 'token'; return next(); }

  try {
    const who = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), env);
    if (who) { data.who = who; return next(); }
  } catch (e) {
    return json({ error: 'Sign-in check is unavailable right now. Try again in a minute.' }, 503);
  }
  return json({ error: 'Sign in through filament.juplifestudio.com, or send a valid API token.' }, 401);
}
