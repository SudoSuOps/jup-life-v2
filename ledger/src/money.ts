export type FeeStatus = 'settled' | 'pending';

export type MoneyParts = {
  gross_cents: number | null;
  discounts_cents: number | null;
  shipping_charged_cents: number | null;
  platform_fee_cents: number | null;
  processor_fee_cents: number | null;
  refunds_cents: number | null;
  chargebacks_cents: number | null;
};

// Net = gross − discounts + shipping_charged − platform_fee − processor_fee − refunds − chargebacks.
// Tax and shipping-label cost stay out of net. A NULL fee is PENDING, so net stays NULL.
export function netFromParts(parts: MoneyParts): { net_cents: number | null; fees_status: FeeStatus } {
  if (parts.platform_fee_cents === null || parts.processor_fee_cents === null) {
    return { net_cents: null, fees_status: 'pending' };
  }
  const net =
    (parts.gross_cents ?? 0) -
    (parts.discounts_cents ?? 0) +
    (parts.shipping_charged_cents ?? 0) -
    parts.platform_fee_cents -
    parts.processor_fee_cents -
    (parts.refunds_cents ?? 0) -
    (parts.chargebacks_cents ?? 0);
  return { net_cents: net, fees_status: 'settled' };
}

export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    const neg = input < 0;
    const [whole, frac = ''] = Math.abs(input).toFixed(2).split('.');
    const cents = Number(whole) * 100 + Number(frac);
    return neg ? -cents : cents;
  }
  const trimmed = input.trim().replace(/[$,\s]/g, '');
  if (!trimmed) return null;
  const neg = trimmed.startsWith('-') || trimmed.startsWith('(');
  const cleaned = trimmed.replace(/[()]/g, '').replace(/^-/, '');
  const match = cleaned.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const frac = (match[2] ?? '').padEnd(2, '0').slice(0, 2);
  const cents = Number(match[1]) * 100 + Number(frac || '0');
  return neg ? -cents : cents;
}

export function formatCents(cents: number | null): string {
  if (cents === null) return '';
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${text}` : text;
}

export function displayCents(cents: number | null, pending = false): string {
  if (pending) return 'PENDING';
  if (cents === null) return '';
  const text = formatCents(cents);
  return text.startsWith('-') ? `-$${text.slice(1)}` : `$${text}`;
}
