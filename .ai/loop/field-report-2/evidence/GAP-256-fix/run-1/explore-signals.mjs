// GAP-256-fix exploration 2: which CDP calls on a FRESH session (attached AFTER the event) tell a
// crashed renderer apart from an alert-blocked one and a busy-script one? Shapes: crash, alert, busy, healthy.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here, CLI_DEFAULT, readState, puppeteer } from './lib.mjs';

const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<!doctype html><title>p</title>hi'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('signals');
const cli = makeCli(root, CLI_DEFAULT);
const dir = path.join(root.R, 's0');
const out = {};
const CALLS = [
  ['Performance.getMetrics'], ['Runtime.evaluate', { expression: '1' }], ['Page.getNavigationHistory'], ['Page.getFrameTree'],
  ['Inspector.enable'], ['Target.getTargetInfo'], ['Page.enable'], ['Accessibility.getFullAXTree'], ['DOM.getDocument'],
  ['Page.captureScreenshot'], ['Browser.getVersion'],
];
async function probeAll(browser, target, label) {
  const s = await target.createCDPSession();
  const res = {};
  for (const [m, p] of CALLS) {
    const t0 = performance.now();
    const r = await s.send(m, p, { timeout: 1200 }).then(() => 'ok').catch((e) => (/timed out/i.test(e.message) ? 'TIMEOUT' : 'err:' + e.message.slice(0, 70)));
    res[m] = `${r} (${Math.round(performance.now() - t0)}ms)`;
  }
  out[label] = res;
  await s.detach().catch(() => {});
}
try {
  await cli(['nav', `${BASE}/?a`], dir);
  for (const n of ['crash', 'alert', 'busy', 'ok']) await cli(['newtab', `${BASE}/?${n}`], dir);
  const st = await readState(dir);
  const browser = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  const pages = browser.targets().filter((t) => t.type() === 'page');
  const by = (n) => pages.find((t) => t.url().endsWith('?' + n));
  const drive = async (n, expr) => { const s = await by(n).createCDPSession(); await s.send('Runtime.runIfWaitingForDebugger').catch(() => {}); await s.send('Page.enable').catch(() => {}); s.send('Runtime.evaluate', { expression: expr }).catch(() => {}); return s; };
  await drive('crash', "location.href='chrome://crash'");
  await drive('alert', 'setTimeout(()=>alert("x"),0)');
  await drive('busy', 'setTimeout(()=>{const e=Date.now()+20000;while(Date.now()<e);},0)');
  await delay(2500);
  for (const n of ['crash', 'alert', 'busy', 'ok']) await probeAll(browser, by(n), n);
  await fs.writeFile(path.join(here, 'explore-signals.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.disconnect();
} finally {
  server.close();
  const lo = await cleanupRoot(root, cli, [dir]);
  console.log('leftovers', JSON.stringify(lo));
  process.exit(0);
}
