import test from 'node:test';
import assert from 'node:assert/strict';
import { deduct, stock } from '../functions/api/_lib.js';
import { verifyAccessJwt } from '../functions/_middleware.js';

const S = { spoolG: 1000, lowSpools: 1, targetSpools: 3 };

test('deduct takes from the open spool, then cracks sealed ones', () => {
  assert.deepEqual(deduct(2, 350, 100, 1000), { full: 2, partialG: 250, short: 0 });
  assert.deepEqual(deduct(2, 350, 500, 1000), { full: 1, partialG: 850, short: 0 });
  assert.deepEqual(deduct(1, 0, 2500, 1000), { full: 0, partialG: 0, short: 1500 });
});

test('stock flags ORDER under the reorder line and fills to target', () => {
  assert.equal(stock({ full: null, partialG: null }, S).status, 'count');
  assert.deepEqual(stock({ full: 2, partialG: 0 }, S).status, 'ok');
  const low = stock({ full: 0, partialG: 400 }, S);
  assert.equal(low.status, 'order');
  assert.equal(low.toOrder, 3); // 400 g -> needs 2600 g -> 3 spools
});

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function makeJwt(payload, kid = 'k1') {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const head = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(head + '.' + body));
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid };
  return { token: `${head}.${body}.${b64url(sig)}`, keys: [jwk] };
}
const env = { ACCESS_TEAM_DOMAIN: 'jup.cloudflareaccess.com', ACCESS_AUD: 'aud123' };
const now = () => Math.floor(Date.now() / 1000);

test('Access JWT: valid token passes', async () => {
  const { token, keys } = await makeJwt({ aud: ['aud123'], exp: now() + 600, iss: 'https://jup.cloudflareaccess.com', email: 'hello@juplifestudio.com' });
  assert.equal(await verifyAccessJwt(token, env, async () => keys), 'hello@juplifestudio.com');
});

test('Access JWT: wrong audience, expired, tampered, or unconfigured all fail', async () => {
  const good = { aud: ['aud123'], exp: now() + 600, iss: 'https://jup.cloudflareaccess.com', email: 'a@b.c' };
  let j = await makeJwt({ ...good, aud: ['other'] });
  assert.equal(await verifyAccessJwt(j.token, env, async () => j.keys), null);
  j = await makeJwt({ ...good, exp: now() - 5 });
  assert.equal(await verifyAccessJwt(j.token, env, async () => j.keys), null);
  j = await makeJwt(good);
  const [h, , s] = j.token.split('.');
  const forged = `${h}.${b64url(JSON.stringify({ ...good, email: 'evil@x.y' }))}.${s}`;
  assert.equal(await verifyAccessJwt(forged, env, async () => j.keys), null);
  assert.equal(await verifyAccessJwt(j.token, {}, async () => j.keys), null);
  const other = await makeJwt(good);
  assert.equal(await verifyAccessJwt(j.token, env, async () => other.keys), null);
});

import { temp } from '../functions/api/_lib.js';
test('temps accept a number or a range, normalised', () => {
  assert.equal(temp('210-230'), '210-230');
  assert.equal(temp(' 215 °C '), '215');
  assert.equal(temp('210–230'), '210-230');
  assert.equal(temp(''), '');
  assert.equal(temp('hot'), undefined);
  assert.equal(temp('2100'), undefined);
});
