// audit-2: does probeLock (self-rename) report 'in-use' for a LIVE Chrome's profile, and does it never mutate?
import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, existsSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path';
import { probeLock } from '../../../../../../packages/cli/dist/profile-cleanup.js';
import { BrowserLauncher } from '../../../../../../packages/browser/dist/index.js';
const exe = new BrowserLauncher().findExecutablePath();
const out = {};
for (const headless of [true, false]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a2-lock-'));
  const c = spawn(exe, [`--user-data-dir=${dir}`, '--no-first-run', '--remote-debugging-port=0', ...(headless ? ['--headless=new'] : []), 'about:blank'], { detached: true, stdio: 'ignore' });
  c.unref();
  await new Promise(r => setTimeout(r, 4000));
  const lock = path.join(dir, 'lockfile');
  const before = existsSync(lock) ? statSync(lock) : null;
  const r1 = await probeLock(dir);
  const r2 = await probeLock(dir);
  const after = existsSync(lock) ? statSync(lock) : null;
  try { execSync(`taskkill /PID ${c.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  await new Promise(r => setTimeout(r, 2000));
  const r3 = await probeLock(dir);
  out[headless ? 'headless' : 'headed'] = { dir, lockExistsWhileLive: !!before, probeWhileLive: [r1, r2], lockStillExistsAfterProbe: !!after, mtimeUnchanged: before && after ? before.mtimeMs === after.mtimeMs : null, probeAfterKill: r3, lockExistsAfterKill: existsSync(lock) };
}
console.log(JSON.stringify(out, null, 2));
