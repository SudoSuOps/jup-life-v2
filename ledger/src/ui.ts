import type { Env } from './env';
import { text } from './http';
import { nowIso } from './dates';
import { importTikTok, type TikTokKind } from './tiktok';
import { isViewName, viewByName, type Table } from './views';

const NAV: Array<[string, string]> = [
  ['/', 'Home'],
  ['/daily', 'Daily'],
  ['/weekly', 'Weekly'],
  ['/monthly', 'Monthly'],
  ['/margin', 'Margin'],
  ['/pnl', 'P&L'],
  ['/payouts', 'Payouts'],
  ['/tax', 'Tax'],
  ['/import/tiktok', 'TikTok import'],
];

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

function page(title: string, body: string): Response {
  const nav = NAV.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · JUP LIFE ledger</title>
<style>
  body { margin: 0; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; color: #1c1917; background: #fafaf9; }
  header { background: #1c1917; color: #fafaf9; padding: 16px 20px; }
  header p { margin: 4px 0 0; color: #d6d3d1; }
  nav a { color: #fafaf9; margin-right: 12px; }
  main { padding: 16px 20px 40px; }
  table { border-collapse: collapse; background: #fff; width: 100%; margin: 12px 0 24px; }
  th, td { border-bottom: 1px solid #e7e5e4; padding: 6px 8px; text-align: left; white-space: nowrap; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .note { color: #57534e; max-width: 42rem; }
  a.dl { display: inline-block; margin-bottom: 8px; }
  form { display: grid; gap: 8px; max-width: 28rem; }
</style>
</head>
<body>
<header><strong>JUP LIFE ledger</strong><p>Private sales book. Read only.</p><nav>${nav}</nav></header>
<main>
${body}
</main>
</body>
</html>`;
  return text(html, 200, 'text/html; charset=utf-8');
}

function renderTable(table: Table, numericFrom = 3): string {
  const head = table.headers.map((header, index) => `<th${index >= numericFrom ? ' class="num"' : ''}>${esc(header)}</th>`).join('');
  const body = table.rows
    .map((row) => {
      const cells = row
        .map((value, index) => {
          const cls = value === 'PENDING' ? ' class="num pending"' : index >= numericFrom ? ' class="num"' : '';
          return `<td${cls}>${esc(value)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<h2>${esc(table.title)}</h2><p class="note">${esc(table.note)}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function toCsv(tables: Table[]): string {
  const blocks = tables.map((table) => {
    const lines = [table.headers.map(csvCell).join(',')];
    for (const row of table.rows) lines.push(row.map(csvCell).join(','));
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n`;
}

async function home(env: Env): Promise<Response> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n, MAX(imported_at) AS latest FROM entries`).first<{
    n: number;
    latest: string | null;
  }>();
  const body = `<h1>JUP LIFE sales ledger</h1>
<p class="note">One row per order line. Money is integer cents. Unsettled fees stay PENDING. Corrections are new rows. JUP LIFE only: other brands on the shared Stripe account are dropped and not stored.</p>
<p>${Number(row?.n ?? 0)} rows. Last import ${esc(row?.latest ?? 'never')}.</p>`;
  return page('Home', body);
}

function importForm(message = ''): Response {
  const body = `<h1>TikTok Shop CSV</h1>
<p class="note">Column names are provisional until a real Seller Center export is confirmed. Orders and settlements are separate files.</p>
${message}
<form method="post" action="/import/tiktok" enctype="multipart/form-data">
  <label>Kind <select name="kind"><option value="orders">Orders</option><option value="settlement">Settlement</option></select></label>
  <label>CSV <input type="file" name="file" accept=".csv,text/csv" required></label>
  <button type="submit">Import</button>
</form>`;
  return page('TikTok import', body);
}

async function importUpload(request: Request, env: Env): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return text('Bad upload', 400);
  }
  const kind = form.get('kind');
  const file = form.get('file');
  if (kind !== 'orders' && kind !== 'settlement') return text('Bad kind', 400);
  if (!(file instanceof File)) return text('Missing file', 400);
  if (file.size > 2_000_000) return text('File too large', 413);
  const csv = await file.text();
  const counts = await importTikTok(env.DB, csv, kind as TikTokKind, nowIso());
  return importForm(
    `<p>Stored ${counts.stored}, duplicate ${counts.duplicate}, dropped ${counts.dropped}.</p>`,
  );
}

export async function routeUi(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path === '/import/tiktok' && request.method === 'GET') return importForm();
  if (path === '/import/tiktok' && request.method === 'POST') return importUpload(request, env);
  if (path === '/' && request.method === 'GET') return home(env);
  const csv = path.endsWith('.csv');
  const name = csv ? path.slice(1, -4) : path.slice(1);
  if (!isViewName(name) || request.method !== 'GET') return null;
  const tables = await viewByName(env.DB, name);
  if (csv) {
    return text(toCsv(tables), 200, 'text/csv; charset=utf-8');
  }
  const download = `<a class="dl" href="/${name}.csv">Download CSV</a>`;
  const numericFrom = name === 'pnl' || name === 'payouts' || name === 'tax' ? 2 : 3;
  const body = `${download}${tables.map((table) => renderTable(table, numericFrom)).join('')}`;
  return page(tables[0]?.title ?? name, body);
}
