// diagnostic for the X10 flake: the product's pageContainsVisibleText against the hidden-text.html fixture, launcher client A
// (passive observer) + product client B, REPS reps; on any non-"not-found" result log which frame step hung.
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const repoRoot = process.argv[2]; const REPS = Number(process.argv[3] ?? 30);
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const b = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const { startFr207Server } = await import(pathToFileURL(path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-07-server.mjs')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => process.exit(3), 900000);
const server = await startFr207Server();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-diagx10-'));
const A = await puppeteer.launch({ executablePath: new b.BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile, defaultViewport: { width: 1100, height: 900 } });
const B = await puppeteer.connect({ browserWSEndpoint: A.wsEndpoint(), defaultViewport: null });
const bp = (await B.pages())[0];
// instrument: which frame step never finishes?
const inflight = new Map(); let id = 0;
for (const name of ['evaluate', 'frameElement']) {
  const proto = Object.getPrototypeOf(bp.mainFrame());
  const orig = proto[name];
  proto[name] = function (...a) { const k = ++id; inflight.set(k, name + ' ' + this.url().slice(0, 70) + ' oopif=' + this.isOOPFrame?.()); const p = orig.apply(this, a); p.then(() => inflight.delete(k), () => inflight.delete(k)); return p; };
}
const rows = [];
for (let rep = 0; rep < REPS; rep++) {
  inflight.clear();
  await bp.goto(server.url('/hidden-text.html'), { waitUntil: 'load' });
  await bp.waitForFunction(() => window.__ht && window.__ht.ready, { timeout: 8000 });
  await delay(150);
  const t0 = performance.now();
  const r = await b.pageContainsVisibleText({ url: 'u', page: bp }, 'FR2-07 IFRAME-HIDDEN-SAME');
  const ms = Math.round(performance.now() - t0);
  const stuck = [...inflight.values()];
  rows.push({ rep, result: r.result, detail: r.detail, ms, stuck });
  console.log(rep, r.result, ms + 'ms', r.detail ?? '', stuck.length ? 'STUCK: ' + stuck.join(' ; ') : '');
  if (r.result !== 'not-found') {
    // does the silent frame EVER answer (this client)? time a 20 s evaluate on every non-main frame, and try again on a fresh navigation
    for (const f of bp.frames().filter((x) => x !== bp.mainFrame())) {
      const t1 = performance.now();
      const v = await Promise.race([f.evaluate(() => document.readyState).then((x) => 'ok:' + x, (e) => 'err:' + e.message.slice(0, 40)), delay(20000).then(() => 'STILL-HUNG-20s')]);
      console.log('   probe', f.url().slice(0, 70), v, Math.round(performance.now() - t1) + 'ms');
    }
  }
}
console.log('SUMMARY', rows.filter((x) => x.result !== 'not-found').length, 'non-not-found of', rows.length);
server.releaseHeld?.(); await server.close(); await B.disconnect(); await A.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); clearTimeout(HARD); process.exit(0);
