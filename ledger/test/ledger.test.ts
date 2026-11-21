import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { isJupLifeSession, priceAllowlist } from '../src/brand';
import { insertEntry } from '../src/db';
import { reconcilePayout } from '../src/reconcile';
import { ingestStripeSession } from '../src/stripe';
import { importTikTok } from '../src/tiktok';

const STRIPE_SECRET = 'whsec_test_secret';
const SHOPIFY_SECRET = 'shpss_test_secret';
const ALLOW = priceAllowlist('price_jup_1,price_jup_2');
const SALE_UNIX = Math.floor(Date.parse('2026-01-15T15:00:00Z') / 1000);
const REFUND_UNIX = Math.floor(Date.parse('2026-01-16T15:00:00Z') / 1000);
const DISPUTE_UNIX = Math.floor(Date.parse('2026-01-17T15:00:00Z') / 1000);

let privateKey: CryptoKey;
let accessToken = '';

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  if (!('privateKey' in pair)) throw new Error('expected a key pair');
  privateKey = pair.privateKey;
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (exported instanceof ArrayBuffer) throw new Error('expected a jwk');
  const jwk: JsonWebKey & { kid?: string; alg?: string; use?: string } = exported;
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/cdn-cgi/access/certs')) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('api.stripe.com') || url.includes('myshopify.com')) {
      const body = url.includes('myshopify.com')
        ? { data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }
        : { object: 'list', data: [], has_more: false };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(`unmocked ${url}`, { status: 599, ...(init ? {} : {}) });
  };
  accessToken = await signJwt({
    iss: 'https://juplife.cloudflareaccess.com',
    aud: 'test-aud',
    exp: Math.floor(Date.now() / 1000) + 3600,
    nbf: Math.floor(Date.now() / 1000) - 10,
    sub: 'ledger-test',
  });
});

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function signJwt(claims: Record<string, unknown>, kid = 'test-key'): Promise<string> {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = `${header}.${payload}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function stripeHeader(body: string, secret = STRIPE_SECRET): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}

async function shopifyHeader(body: string, secret = SHOPIFY_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  let binary = '';
  for (const byte of new Uint8Array(mac)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function jupSession(id = 'cs_test_jup_1') {
  return {
    id,
    object: 'checkout.session',
    amount_subtotal: 3000,
    amount_total: 3560,
    currency: 'usd',
    payment_status: 'paid',
    status: 'complete',
    created: SALE_UNIX,
    success_url: 'https://juplifestudio.com/shop?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'https://juplifestudio.com/shop?checkout=cancel',
    metadata: { source: 'juplifestudio.com' },
    payment_intent: { id: 'pi_test_jup_1', object: 'payment_intent', latest_charge: 'ch_test_jup_1' },
    total_details: { amount_discount: 200, amount_shipping: 500, amount_tax: 260 },
    line_items: {
      object: 'list',
      data: [
        {
          id: 'li_test_1',
          object: 'item',
          description: 'Pop Coasters',
          quantity: 2,
          amount_subtotal: 3000,
          amount_discount: 200,
          price: {
            id: 'price_jup_coaster',
            object: 'price',
            unit_amount: 1500,
            nickname: 'Flat',
            metadata: { sku: 'pop-coasters-6' },
            product: { id: 'prod_test', name: 'Pop Coasters' },
          },
        },
      ],
    },
  };
}

function swarmSession() {
  return {
    id: 'cs_test_swarm_1',
    object: 'checkout.session',
    amount_subtotal: 15000,
    amount_total: 15000,
    currency: 'usd',
    payment_status: 'paid',
    created: SALE_UNIX,
    success_url: 'https://legal.swarmandbee.ai/booked',
    cancel_url: 'https://legal.swarmandbee.ai/cancel',
    metadata: { brand: 'swarmandbee' },
    line_items: { data: [{ id: 'li_legal', quantity: 1, price: { id: 'price_legal_session', unit_amount: 15000 } }] },
  };
}

async function postStripe(event: unknown, header?: string): Promise<Response> {
  const body = JSON.stringify(event);
  return SELF.fetch('https://ledger.local/hook/stripe', {
    method: 'POST',
    headers: { 'Stripe-Signature': header ?? (await stripeHeader(body)), 'content-type': 'application/json' },
    body,
  });
}

async function countWhere(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe('brand filter', () => {
  it('drops a Swarm & Bee session and keeps a JUP LIFE session', async () => {
    expect(isJupLifeSession(swarmSession(), ALLOW)).toBe(false);
    expect(isJupLifeSession(jupSession(), ALLOW)).toBe(true);
    expect(
      isJupLifeSession(
        { success_url: 'https://shop.juplifestudio.com/thanks', cancel_url: 'https://example.com/no' },
        ALLOW,
      ),
    ).toBe(true);
    expect(
      isJupLifeSession(
        { success_url: 'https://juplifestudio.com.evil.com/phish', cancel_url: 'https://notjuplifestudio.com/' },
        ALLOW,
      ),
    ).toBe(false);
    expect(
      isJupLifeSession(
        { success_url: 'https://example.com/a', cancel_url: 'https://example.com/b', metadata: { brand: 'JupLife' } },
        ALLOW,
      ),
    ).toBe(true);
    expect(
      isJupLifeSession(
        {
          success_url: 'https://example.com/a',
          cancel_url: 'https://example.com/b',
          line_items: { data: [{ price: { id: 'price_jup_1' } }, { price: { id: 'price_jup_2' } }] },
        },
        ALLOW,
      ),
    ).toBe(true);
    expect(
      isJupLifeSession(
        {
          success_url: 'https://example.com/a',
          cancel_url: 'https://example.com/b',
          line_items: { data: [{ price: { id: 'price_jup_1' } }, { price: { id: 'price_other' } }] },
        },
        ALLOW,
      ),
    ).toBe(false);
    expect(
      isJupLifeSession({ success_url: 'https://example.com/a', cancel_url: 'https://example.com/b', line_items: { data: [] } }, ALLOW),
    ).toBe(false);

    const before = await countWhere(`SELECT COUNT(*) AS n FROM entries`);
    const dropped = await postStripe({ id: 'evt_swarm', type: 'checkout.session.completed', data: { object: swarmSession() } });
    expect(dropped.status).toBe(200);
    const droppedBody = (await dropped.json()) as { dropped: number; stored: number };
    expect(droppedBody.dropped).toBe(1);
    expect(droppedBody.stored).toBe(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries`)).toBe(before);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE source_id = ?`, 'cs_test_swarm_1')).toBe(0);
  });

  it('dedupes a Shopify-origin Stripe session only when configured', async () => {
    const session = {
      ...jupSession('cs_test_shopify_dup'),
      metadata: { brand: 'juplife', shopify_order_id: '1001' },
      payment_intent: 'pi_shopify_dup',
    };
    const skipped = await ingestStripeSession(env.DB, session, {
      allowlist: ALLOW,
      dedupeShopify: true,
      importedAt: '2026-01-15T00:00:00.000Z',
    });
    expect(skipped.dropped).toBe(1);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE source_id = ?`, 'cs_test_shopify_dup')).toBe(0);
    const kept = await ingestStripeSession(env.DB, { ...session, id: 'cs_test_shopify_keep' }, {
      allowlist: ALLOW,
      dedupeShopify: false,
      importedAt: '2026-01-15T00:00:00.000Z',
    });
    expect(kept.stored).toBeGreaterThan(0);
  });
});

async function postJup(): Promise<Response> {
  return postStripe({ id: 'evt_jup', type: 'checkout.session.completed', data: { object: jupSession() } });
}

describe('stripe book', () => {
  it('inserts a paid JUP LIFE session once, with pending processor fees', async () => {
    const event = { id: 'evt_jup', type: 'checkout.session.completed', data: { object: jupSession() } };
    const first = await postStripe(event);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { stored: number };
    expect(firstBody.stored).toBeGreaterThan(0);
    const second = await postStripe(event);
    const secondBody = (await second.json()) as { stored: number; duplicate: number };
    expect(secondBody.stored).toBe(0);
    expect(secondBody.duplicate).toBeGreaterThan(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE source_id = ? AND line_id = ?`, 'cs_test_jup_1', 'li_test_1')).toBe(1);

    const sale = await env.DB
      .prepare(`SELECT gross_cents, discounts_cents, net_cents, refunds_cents, raw_json, date FROM entries WHERE source_id = ? AND line_id = ?`)
      .bind('cs_test_jup_1', 'li_test_1')
      .first<{ gross_cents: number; discounts_cents: number; net_cents: number; refunds_cents: number; raw_json: string; date: string }>();
    expect(sale?.gross_cents).toBe(3000);
    expect(sale?.discounts_cents).toBe(200);
    expect(sale?.net_cents).toBe(2800);
    expect(sale?.refunds_cents).toBe(0);
    expect(sale?.date).toBe('2026-01-15');
    expect(sale?.raw_json).toContain('cs_test_jup_1');

    const fee = await env.DB
      .prepare(`SELECT processor_fee_cents, platform_fee_cents, fees_status, net_cents, tax_collected_cents FROM entries WHERE source_id = ? AND line_id = '_order_fee'`)
      .bind('cs_test_jup_1')
      .first<{ processor_fee_cents: number | null; platform_fee_cents: number | null; fees_status: string; net_cents: number | null; tax_collected_cents: number }>();
    expect(fee?.processor_fee_cents).toBeNull();
    expect(fee?.fees_status).toBe('pending');
    expect(fee?.net_cents).toBeNull();
    expect(fee?.tax_collected_cents).toBe(260);
  });

  it('posts a refund as a negative row and leaves the sale row alone', async () => {
    await postJup();
    const body = {
      id: 'evt_refund',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_test_jup_1',
          object: 'charge',
          amount: 3560,
          amount_refunded: 1000,
          currency: 'usd',
          payment_intent: 'pi_test_jup_1',
          metadata: {},
          refunds: {
            data: [
              {
                id: 're_test_1',
                object: 'refund',
                amount: 1000,
                created: REFUND_UNIX,
                currency: 'usd',
                status: 'succeeded',
                balance_transaction: { id: 'txn_re_1', amount: -1000, fee: 0, net: -1000 },
              },
            ],
          },
        },
      },
    };
    const response = await postStripe(body);
    expect(response.status).toBe(200);
    const refund = await env.DB
      .prepare(`SELECT date, refunds_cents, net_cents, order_id, status, row_kind FROM entries WHERE source_id = ?`)
      .bind('re_test_1')
      .first<{ date: string; refunds_cents: number; net_cents: number; order_id: string; status: string; row_kind: string }>();
    expect(refund?.date).toBe('2026-01-16');
    expect(refund?.refunds_cents).toBe(1000);
    expect(refund?.net_cents).toBe(-1000);
    expect(refund?.order_id).toBe('cs_test_jup_1');
    expect(refund?.status).toBe('refunded');
    expect(refund?.row_kind).toBe('refund');
    const sale = await env.DB
      .prepare(`SELECT gross_cents, refunds_cents FROM entries WHERE source_id = ? AND line_id = ?`)
      .bind('cs_test_jup_1', 'li_test_1')
      .first<{ gross_cents: number; refunds_cents: number }>();
    expect(sale?.gross_cents).toBe(3000);
    expect(sale?.refunds_cents).toBe(0);
  });

  it('posts a chargeback as negative gross plus the dispute fee', async () => {
    await postJup();
    const response = await postStripe({
      id: 'evt_dispute',
      type: 'charge.dispute.created',
      data: {
        object: {
          id: 'dp_test_1',
          object: 'dispute',
          amount: 3560,
          charge: 'ch_test_jup_1',
          currency: 'usd',
          created: DISPUTE_UNIX,
          status: 'needs_response',
          balance_transactions: [{ id: 'txn_dp_1', amount: -3560, fee: 1500, net: -5060 }],
        },
      },
    });
    expect(response.status).toBe(200);
    const row = await env.DB
      .prepare(`SELECT date, gross_cents, chargebacks_cents, net_cents, order_id, status FROM entries WHERE source_id = ?`)
      .bind('dp_test_1')
      .first<{ date: string; gross_cents: number; chargebacks_cents: number; net_cents: number; order_id: string; status: string }>();
    expect(row?.date).toBe('2026-01-17');
    expect(row?.gross_cents).toBe(-3560);
    expect(row?.chargebacks_cents).toBe(1500);
    expect(row?.net_cents).toBe(-5060);
    expect(row?.order_id).toBe('cs_test_jup_1');
    expect(row?.status).toBe('disputed');

    const unknown = await postStripe({
      id: 'evt_dispute_other',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_other', object: 'dispute', amount: 500, charge: 'ch_not_jup', currency: 'usd', created: DISPUTE_UNIX, balance_transactions: [] } },
    });
    const unknownBody = (await unknown.json()) as { dropped: number };
    expect(unknownBody.dropped).toBe(1);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE source_id = ?`, 'dp_other')).toBe(0);
  });

  it('rejects a bad Stripe signature and a bad Shopify HMAC', async () => {
    const event = { id: 'evt_bad', type: 'checkout.session.completed', data: { object: jupSession('cs_test_bad_sig') } };
    const denied = await postStripe(event, 't=1,v1=deadbeef');
    expect(denied.status).toBe(400);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE source_id = ?`, 'cs_test_bad_sig')).toBe(0);

    const order = JSON.stringify({ id: 1, created_at: '2026-01-15T15:00:00Z', currency: 'USD', line_items: [] });
    const shopify = await SELF.fetch('https://ledger.local/hook/shopify', {
      method: 'POST',
      headers: {
        'X-Shopify-Hmac-Sha256': 'not-a-signature',
        'X-Shopify-Topic': 'orders/paid',
        'X-Shopify-Shop-Domain': 'yvvpu5-3p.myshopify.com',
        'content-type': 'application/json',
      },
      body: order,
    });
    expect(shopify.status).toBe(401);
  });

  it('records a payout shell without inventing a variance before transactions are linked', async () => {
    const response = await postStripe({
      id: 'evt_po',
      type: 'payout.paid',
      data: { object: { id: 'po_shell', object: 'payout', amount: 5000, currency: 'usd', arrival_date: SALE_UNIX, status: 'paid' } },
    });
    expect(response.status).toBe(200);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE payout_id = ? AND row_kind = 'variance'`, 'po_shell')).toBe(0);
  });
});

describe('payout reconciliation', () => {
  it('matches to the cent and writes a variance row when the payout is off by one cent', async () => {
    const importedAt = '2026-01-20T00:00:00.000Z';
    for (const [orderId, gross] of [
      ['ord_exact_1', 4000],
      ['ord_exact_2', 6000],
    ] as const) {
      await insertEntry(env.DB, blankSale(orderId, gross, 'po_exact'), importedAt);
    }
    const exact = await reconcilePayout(env.DB, 'stripe_direct', 'po_exact', '2026-01-20', 10000, null, importedAt, true);
    expect(exact.status).toBe('matched');
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE payout_id = ? AND row_kind = 'variance'`, 'po_exact')).toBe(0);

    for (const [orderId, gross] of [
      ['ord_off_1', 4000],
      ['ord_off_2', 6000],
    ] as const) {
      await insertEntry(env.DB, blankSale(orderId, gross, 'po_off'), importedAt);
    }
    const off = await reconcilePayout(env.DB, 'stripe_direct', 'po_off', '2026-01-20', 10001, null, importedAt, true);
    expect(off.status).toBe('variance');
    if (off.status === 'variance') expect(off.gap).toBe(1);
    const again = await reconcilePayout(env.DB, 'stripe_direct', 'po_off', '2026-01-20', 10001, null, importedAt, true);
    expect(again.status).toBe('matched');
    const variances = await env.DB
      .prepare(`SELECT net_cents FROM entries WHERE payout_id = ? AND row_kind = 'variance'`)
      .bind('po_off')
      .all<{ net_cents: number }>();
    expect(variances.results).toHaveLength(1);
    expect(variances.results[0]?.net_cents).toBe(1);
  });
});

describe('shopify', () => {
  it('records a paid order once and a refund as its own negative row', async () => {
    const order = {
      id: 1001,
      name: '#1001',
      created_at: '2026-02-01T15:00:00Z',
      currency: 'USD',
      financial_status: 'paid',
      total_discounts: '1.00',
      total_tax: '0.80',
      total_shipping_price_set: { shop_money: { amount: '4.00', currency_code: 'USD' } },
      line_items: [
        { id: 501, sku: 'pop-coasters-6', title: 'Pop Coasters', variant_title: 'Flat', quantity: 1, price: '12.00', total_discount: '1.00' },
      ],
    };
    const raw = JSON.stringify(order);
    const headers = {
      'X-Shopify-Hmac-Sha256': await shopifyHeader(raw),
      'X-Shopify-Topic': 'orders/paid',
      'X-Shopify-Shop-Domain': 'yvvpu5-3p.myshopify.com',
      'content-type': 'application/json',
    };
    const first = await SELF.fetch('https://ledger.local/hook/shopify', { method: 'POST', headers, body: raw });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { stored: number }).stored).toBeGreaterThan(0);
    const second = await SELF.fetch('https://ledger.local/hook/shopify', { method: 'POST', headers, body: raw });
    expect(((await second.json()) as { duplicate: number }).duplicate).toBeGreaterThan(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE channel = 'shopify' AND source_id = ? AND line_id = ?`, '1001', '501')).toBe(1);

    const refund = {
      id: 900,
      order_id: 1001,
      created_at: '2026-02-02T16:00:00Z',
      refund_line_items: [{ id: 77, line_item_id: 501, quantity: 1, subtotal: '12.00' }],
    };
    const refundRaw = JSON.stringify(refund);
    const refunded = await SELF.fetch('https://ledger.local/hook/shopify', {
      method: 'POST',
      headers: {
        'X-Shopify-Hmac-Sha256': await shopifyHeader(refundRaw),
        'X-Shopify-Topic': 'refunds/create',
        'X-Shopify-Shop-Domain': 'yvvpu5-3p.myshopify.com',
        'content-type': 'application/json',
      },
      body: refundRaw,
    });
    expect(refunded.status).toBe(200);
    const row = await env.DB
      .prepare(`SELECT date, refunds_cents, net_cents, order_id FROM entries WHERE source_id = ? AND line_id = ?`)
      .bind('900', '77')
      .first<{ date: string; refunds_cents: number; net_cents: number; order_id: string }>();
    expect(row?.date).toBe('2026-02-02');
    expect(row?.refunds_cents).toBe(1200);
    expect(row?.net_cents).toBe(-1200);
    expect(row?.order_id).toBe('1001');
  });
});

describe('tiktok csv', () => {
  it('maps the provisional order and settlement headers without double counting', async () => {
    const orders = [
      'Order ID,SKU ID,Seller SKU,Product Name,Variation,Quantity,SKU Subtotal Before Discount,SKU Seller Discount,Shipping Fee After Discount,Taxes,Paid Time,Order Status',
      'TT100,sku-1,pop-coasters-6,Pop Coasters,Flat,2,30.00,2.00,5.00,1.50,2026-01-15 10:00:00,Completed',
    ].join('\n');
    const first = await importTikTok(env.DB, orders, 'orders', '2026-01-15T00:00:00.000Z');
    expect(first.stored).toBeGreaterThan(0);
    const second = await importTikTok(env.DB, orders, 'orders', '2026-01-15T00:00:00.000Z');
    expect(second.duplicate).toBeGreaterThan(0);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE channel = 'tiktok' AND source_id = ? AND line_id = ?`, 'TT100', 'sku-1')).toBe(1);
    const sale = await env.DB
      .prepare(`SELECT gross_cents, discounts_cents, shipping_charged_cents, tax_collected_cents, sku FROM entries WHERE source_id = ? AND line_id = ?`)
      .bind('TT100', 'sku-1')
      .first<{ gross_cents: number; discounts_cents: number; shipping_charged_cents: number; tax_collected_cents: number; sku: string }>();
    expect(sale).toMatchObject({ gross_cents: 3000, discounts_cents: 200, shipping_charged_cents: 500, tax_collected_cents: 150, sku: 'pop-coasters-6' });

    const settlement = [
      'Related order ID,Statement ID,Statement Date,Platform commission,Transaction fee,Settlement Amount',
      'TT100,st_1,2026-01-20,1.20,0.90,30.90',
    ].join('\n');
    await importTikTok(env.DB, settlement, 'settlement', '2026-01-20T00:00:00.000Z');
    const fee = await env.DB
      .prepare(`SELECT platform_fee_cents, processor_fee_cents, fees_status, net_cents FROM effective_entries WHERE channel = 'tiktok' AND order_id = ? AND row_kind = 'order_fee'`)
      .bind('TT100')
      .first<{ platform_fee_cents: number; processor_fee_cents: number; fees_status: string; net_cents: number }>();
    expect(fee?.fees_status).toBe('settled');
    expect(fee?.platform_fee_cents).toBe(120);
    expect(fee?.processor_fee_cents).toBe(90);
    expect(fee?.net_cents).toBe(-210);
    expect(await countWhere(`SELECT COUNT(*) AS n FROM entries WHERE channel = 'tiktok' AND payout_id = ? AND row_kind = 'variance'`, 'st_1')).toBe(0);
  });
});

describe('access and views', () => {
  const pages = ['/', '/daily', '/weekly', '/monthly', '/margin', '/pnl', '/payouts', '/tax', '/import/tiktok', '/daily.csv', '/weekly.csv', '/monthly.csv', '/margin.csv', '/pnl.csv', '/payouts.csv', '/tax.csv'];

  it('rejects missing and invalid Access JWTs on UI routes', async () => {
    for (const path of pages) {
      const missing = await SELF.fetch(`https://ledger.local${path}`);
      expect(missing.status, path).toBe(403);
    }
    const wrongAud = await signJwt({
      iss: 'https://juplife.cloudflareaccess.com',
      aud: 'someone-else',
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: 'nope',
    });
    const rejected = await SELF.fetch('https://ledger.local/daily', { headers: { 'Cf-Access-Jwt-Assertion': wrongAud } });
    expect(rejected.status).toBe(403);
    const junk = await SELF.fetch('https://ledger.local/', { headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } });
    expect(junk.status).toBe(403);
    const webhook = await postStripe({ id: 'evt_no_access', type: 'checkout.session.completed', data: { object: swarmSession() } });
    expect(webhook.status).toBe(200);
  });

  it('serves every view to a valid Access JWT', async () => {
    await postJup();
    for (const path of pages) {
      const response = await SELF.fetch(`https://ledger.local${path}`, {
        headers: { 'Cf-Access-Jwt-Assertion': accessToken },
      });
      expect(response.status, path).toBe(200);
      const body = await response.text();
      expect(body.length, path).toBeGreaterThan(0);
    }
    const daily = await SELF.fetch('https://ledger.local/daily', { headers: { 'Cf-Access-Jwt-Assertion': accessToken } });
    const html = await daily.text();
    expect(html).toContain('pop-coasters-6');
    expect(html).toContain('PENDING');
    const csv = await SELF.fetch('https://ledger.local/daily.csv', { headers: { 'Cf-Access-Jwt-Assertion': accessToken } });
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('pop-coasters-6');
  });
});

function blankSale(orderId: string, gross: number, payoutId: string) {
  return {
    channel: 'stripe_direct' as const,
    source_id: orderId,
    line_id: 'sale',
    date: '2026-01-15',
    order_id: orderId,
    sku: 'pop-coasters-6',
    product: 'Pop Coasters',
    variant: 'Flat',
    qty: 1,
    gross_cents: gross,
    discounts_cents: 0,
    shipping_charged_cents: 0,
    tax_collected_cents: 0,
    platform_fee_cents: 0,
    processor_fee_cents: 0,
    shipping_label_cost_cents: null,
    refunds_cents: 0,
    chargebacks_cents: 0,
    payout_id: payoutId,
    payout_date: '2026-01-20',
    source_url: null,
    source_tag: 'stripe_api',
    status: 'paid_out',
    row_kind: 'sale',
    link_charge_id: null,
    link_payment_intent: null,
    raw_json: JSON.stringify({ orderId, gross }),
  };
}
