import type { Env } from './env';
import { text } from './http';

type Jwk = JsonWebKey & { kid?: string; alg?: string };

type AccessClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
};

const cache = new Map<string, { keys: Jwk[]; expires: number }>();

export function teamOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return null;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) return null;
  return `https://${trimmed}.cloudflareaccess.com`;
}

function b64urlToBytes(segment: string): Uint8Array | null {
  try {
    const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function decodeJson<T>(segment: string): T | null {
  const bytes = b64urlToBytes(segment);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function loadKeys(origin: string): Promise<Jwk[]> {
  const hit = cache.get(origin);
  if (hit && hit.expires > Date.now()) return hit.keys;
  const response = await fetch(`${origin}/cdn-cgi/access/certs`);
  if (!response.ok) return [];
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter((key) => key.kty === 'RSA' && typeof key.kid === 'string');
  cache.set(origin, { keys, expires: Date.now() + 10 * 60 * 1000 });
  return keys;
}

export async function verifyAccessJwt(
  token: string,
  opts: { audience: string; issuer: string; nowSec?: number },
): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return false;
  const header = decodeJson<{ alg?: string; kid?: string }>(headerPart);
  const payload = decodeJson<AccessClaims>(payloadPart);
  const signature = b64urlToBytes(signaturePart);
  if (!header || !payload || !signature) return false;
  if (header.alg !== 'RS256' || !header.kid) return false;
  if (payload.iss !== opts.issuer) return false;
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audiences.includes(opts.audience)) return false;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now - 60) return false;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return false;
  const keys = await loadKeys(opts.issuer);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return false;
  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const copy = new Uint8Array(signature.byteLength);
  copy.set(signature);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, copy, signed);
}

export async function requireAccess(request: Request, env: Env): Promise<Response | null> {
  const issuer = teamOrigin(env.ACCESS_TEAM_DOMAIN);
  if (!env.ACCESS_AUD || !issuer) return text('Forbidden', 403);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return text('Forbidden', 403);
  const ok = await verifyAccessJwt(token, { audience: env.ACCESS_AUD, issuer });
  if (!ok) return text('Forbidden', 403);
  return null;
}
