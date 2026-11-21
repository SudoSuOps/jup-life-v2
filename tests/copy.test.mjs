// Customer-facing build output must read like a print shop.
// Scans dist/ HTML, llms.txt, CSS, JS and JSON-LD. Word boundaries skip
// unrelated substrings such as "placeholder", "place" and "template".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBuiltDist } from './dist-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const TEXT = new Set(['.html', '.txt', '.css', '.js', '.xml', '.json', '.svg', '.webmanifest']);
// bake / baked / baking / bakery, plus a trailing s (ovens, bakes).
const FORBIDDEN = /\b(?:oven|bakery|baking|baked|bake|tpu|95a|pla|dishwasher)s?\b/gi;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function textFiles() {
  return walk(DIST).filter((path) => {
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (base === '_headers' || base === '_redirects') return true;
    const dot = base.lastIndexOf('.');
    return dot !== -1 && TEXT.has(base.slice(dot));
  });
}

test('built pages, llms.txt and JSON-LD do not name the oven, bakery or material', { timeout: 180_000 }, () => {
  withBuiltDist(ROOT, () => {
  const hits = [];
  for (const path of textFiles()) {
    const body = readFileSync(path, 'utf8');
    const rel = path.slice(DIST.length + 1);
    for (const line of body.split('\n')) {
      FORBIDDEN.lastIndex = 0;
      if (FORBIDDEN.test(line)) hits.push(`${rel}: ${line.trim().slice(0, 180)}`);
    }
    if (!rel.endsWith('.html')) continue;
    for (const block of body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(block[1]);
      const stack = [data];
      while (stack.length) {
        const node = stack.pop();
        if (Array.isArray(node)) stack.push(...node);
        else if (node && typeof node === 'object') {
          assert.equal(Object.hasOwn(node, 'material'), false, `${rel} JSON-LD still has a material field`);
          stack.push(...Object.values(node));
        }
      }
    }
  }

  assert.equal(hits.length, 0, `forbidden customer copy:\n${hits.join('\n')}`);
  const llms = readFileSync(join(DIST, 'llms.txt'), 'utf8');
  assert.match(llms, /washable/i);
  assert.doesNotMatch(llms, FORBIDDEN);
  });
});
