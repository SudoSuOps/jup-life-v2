const ET = 'America/New_York';

export function etDate(input: number | string | Date): string {
  const date = typeof input === 'number' ? new Date(input * 1000) : new Date(input);
  if (Number.isNaN(date.getTime())) throw new Error('bad date');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('bad date');
  return `${year}-${month}-${day}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
