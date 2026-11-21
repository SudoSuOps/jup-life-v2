// node --test runs files in parallel. Both copy and socials rebuild dist/, so they share one lock.
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function withBuiltDist(root, fn) {
  const lock = join(root, '.dist-build.lock');
  const start = Date.now();
  for (;;) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      if (Date.now() - start > 180_000) throw new Error('timed out waiting to build dist/');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      continue;
    }
    try {
      execFileSync('python3', ['tools/build.py'], { cwd: root, stdio: 'pipe' });
      return fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(lock); } catch { /* the waiter retries */ }
    }
  }
}
