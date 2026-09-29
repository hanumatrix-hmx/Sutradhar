// GAP-256-fix exploration: what signals does a REAL renderer crash produce in CDP, vs a real
// open dialog and a busy script? Uses the CLI only to spawn Chrome (state.json holds the ws).
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here, CLI_DEFAULT, readState, puppeteer, live } from './lib.mjs';

const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><title>p</title>hi'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('explore');
const cli = makeCli(root, CLI_DEFAULT);
const dir = path.join(root.R, 's0');
const out = {};
try {
  await cli(['nav', `${BASE}/?a`], dir);
  await cli(['newtab', `${BASE}/?b`], dir);
  const st = await readState(dir);
  const browser = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  const conn = browser._connection;
  const events = [];
  for (const ev of ['Target.targetCrashed', 'Target.targetInfoChanged', 'Target.targetDestroyed']) conn.on(ev, (e) => events.push({ ev, e: JSON.stringify(e).slice(0, 300) }));
  const targets = browser.targets().filter((t) => t.type() === 'page');
  out.targets = targets.map((t) => ({ id: t._targetId, url: t.url() }));
  const victim = targets[targets.length - 1];
  const s = await victim.createCDPSession();
  const sev = [];
  s.on('Inspector.targetCrashed', () => sev.push('Inspector.targetCrashed'));
  await s.send('Inspector.enable').catch((e) => sev.push('enable-fail ' + e.message));
  await s.send('Page.enable').catch(() => {});
  await s.send('Runtime.runIfWaitingForDebugger').catch(() => {});
  out.preLive = await live(s);
  // crash it via a browser-level session so we do not depend on victim session
  const t0 = performance.now();
  s.send('Page.navigate', { url: 'chrome://crash' }).catch(() => {});
  await delay(2500);
  out.sessionEvents = sev;
  out.browserEvents = events;
  out.postLive = await live(s, 1500);
  const perf = await s.send('Performance.getMetrics', undefined, { timeout: 1000 }).then(() => 'answered').catch((e) => e.message.slice(0, 100));
  out.postPerf = perf;
  const gt = await conn.send('Target.getTargets');
  out.getTargets = gt.targetInfos.filter((t) => t.type === 'page').map((t) => ({ id: t.targetId, url: t.url, title: t.title, attached: t.attached }));
  out.ms = performance.now() - t0;
  await fs.writeFile(path.join(here, 'explore-crash.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.disconnect();
} finally {
  server.close();
  const lo = await cleanupRoot(root, cli, [dir]);
  console.log('leftovers', JSON.stringify(lo));
  process.exit(0);
}
