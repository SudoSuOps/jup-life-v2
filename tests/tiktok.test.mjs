import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BAD = /tiktok\.com\/@juplifestudio(?!s)/;
const GOOD = 'https://www.tiktok.com/@juplifestudios';

function filesUnder(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

test('built site and functions use the TikTok handle @juplifestudios', () => {
  execFileSync('python3', ['tools/build.py'], { cwd: ROOT, stdio: 'pipe' });
  const hits = [];
  for (const path of [...filesUnder(join(ROOT, 'dist')), ...filesUnder(join(ROOT, 'functions'))]) {
    const text = readFileSync(path).toString('latin1');
    if (BAD.test(text)) hits.push(path.slice(ROOT.length));
  }
  assert.deepEqual(hits, [], `old TikTok handle in ${hits.join(', ')}`);
  const home = readFileSync(join(ROOT, 'dist/index.html'), 'utf8');
  const footer = home.slice(home.indexOf('<footer'), home.indexOf('</footer>'));
  assert.ok(footer.includes(GOOD), 'footer is missing https://www.tiktok.com/@juplifestudios');
});
