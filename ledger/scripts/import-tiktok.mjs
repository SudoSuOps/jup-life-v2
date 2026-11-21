#!/usr/bin/env node
// Post a TikTok Seller Center CSV to a running ledger.
// The column map lives in src/tiktok.ts. This script does not remap columns.
//
// LEDGER_URL=http://127.0.0.1:8787 ACCESS_JWT=... node scripts/import-tiktok.mjs orders ./orders.csv

import { readFile } from 'node:fs/promises';

const [kind, file] = process.argv.slice(2);
const url = process.env.LEDGER_URL;
const jwt = process.env.ACCESS_JWT;

if ((kind !== 'orders' && kind !== 'settlement') || !file || !url || !jwt) {
  console.error('Usage: LEDGER_URL=... ACCESS_JWT=... node scripts/import-tiktok.mjs <orders|settlement> <file.csv>');
  process.exit(1);
}

const csv = await readFile(file);
const body = new FormData();
body.set('kind', kind);
body.set('file', new Blob([csv], { type: 'text/csv' }), file);
const response = await fetch(new URL('/import/tiktok', url), {
  method: 'POST',
  headers: { 'Cf-Access-Jwt-Assertion': jwt },
  body,
});
const text = await response.text();
console.log(response.status);
console.log(text);
process.exit(response.ok ? 0 : 1);
