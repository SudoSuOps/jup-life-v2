export type SessionLike = {
  success_url?: string | null;
  cancel_url?: string | null;
  metadata?: Record<string, string> | null;
  line_items?: { data?: Array<{ price?: unknown }> } | null;
};

const JUP_HOST = 'juplifestudio.com';

export function priceAllowlist(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
}

export function shopifyOnStripe(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1';
}

export function hostOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  try {
    return new URL(trimmed).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    const match = trimmed.match(/^https?:\/\/([^\/:?#\s]+)/i);
    return match ? match[1].toLowerCase().replace(/\.$/, '') : null;
  }
}

export function isJupHost(hostname: string | null): boolean {
  if (!hostname) return false;
  return hostname === JUP_HOST || hostname.endsWith(`.${JUP_HOST}`);
}

export function priceIdOf(price: unknown): string | null {
  if (typeof price === 'string' && price.startsWith('price_')) return price;
  if (price && typeof price === 'object' && 'id' in price) {
    const id = (price as { id?: unknown }).id;
    if (typeof id === 'string' && id.startsWith('price_')) return id;
  }
  return null;
}

export function lineItemPriceIds(session: SessionLike): string[] {
  const rows = session.line_items?.data ?? [];
  const ids: string[] = [];
  for (const row of rows) {
    const id = priceIdOf(row.price);
    if (id) ids.push(id);
  }
  return ids;
}

// A Checkout Session is JUP LIFE only when one of these is true:
// the success or cancel URL host is juplifestudio.com (or a subdomain),
// metadata.brand is juplife, or every line-item price id is on the allowlist.
// An empty line-item list does not satisfy the allowlist (fail closed).
export function isJupLifeSession(session: SessionLike, allowlist: Set<string>): boolean {
  if (isJupHost(hostOf(session.success_url)) || isJupHost(hostOf(session.cancel_url))) return true;
  const brand = session.metadata?.brand;
  if (typeof brand === 'string' && brand.trim().toLowerCase() === 'juplife') return true;
  const ids = lineItemPriceIds(session);
  if (ids.length > 0 && ids.every((id) => allowlist.has(id))) return true;
  return false;
}

export function isShopifyOrigin(obj: {
  metadata?: Record<string, string> | null;
  description?: string | null;
}): boolean {
  const metadata = obj.metadata ?? {};
  if (
    metadata.shopify_order_id ||
    metadata.shop_id ||
    metadata.shopify_shop_domain ||
    metadata.shopify_payment_session
  ) {
    return true;
  }
  return (obj.description ?? '').toLowerCase().includes('shopify');
}

export function metadataBrand(metadata: Record<string, string> | null | undefined): string | null {
  const brand = metadata?.brand;
  if (typeof brand !== 'string') return null;
  const trimmed = brand.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}
