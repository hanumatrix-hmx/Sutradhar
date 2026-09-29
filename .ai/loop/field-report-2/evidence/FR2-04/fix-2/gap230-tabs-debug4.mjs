import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, pageTargets } from './lib.mjs';

const root = await makeRoot('g230dbg4');
const cli = makeCli(root);
const popupServer = http.createServer((req, res) => {
  const n = new URL(req.url, 'http://x').searchParams.get('n') ?? 'none';
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(`<!doctype html><title>pop</title><script>alert('gap230-${n}')</script>pop`);
});
await new Promise((r) => popupServer.listen(0, '127.0.0.1', r));
const popupBase = `http://127.0.0.1:${popupServer.address().port}/?n=`;
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>opener</title>opener'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const cd = path.join(root.R, 'st');
try {
  const n = 'dbg4';
  await cli(['nav', `${BASE}?n=${n}`], cd);
  const st = await readState(cd);
  const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  const opener = pageTargets(b).find((x) => x.url().includes(n));
  const os_ = await opener.createCDPSession();
  await os_.send('Runtime.evaluate', { expression: `void window.open('${popupBase}${n}')`, userGesture: true });
  await os_.detach().catch(() => {});
  let pop; for (let i = 0; i < 60 && !pop; i++) { pop = b.targets().find((x) => x.type() === 'page' && x.url().includes('pop?n=' + n)); if (!pop) await delay(100); }
  console.log('found pop target?', !!pop);
  const ps = pop ? await pop.createCDPSession() : undefined;
  await delay(500); // marker
  await delay(8000); const acc = await cli(['dialog', 'accept'], cd, { capMs: 20000 }); await delay(8000);
  console.log('accept', acc.code, acc.ms, acc.stdout.trim());
  const tabs = await cli(['tabs'], cd, { capMs: 15000 });
  console.log('tabs', tabs.code, tabs.ms, tabs.killedAtCap, tabs.stdout.trim());
  if (ps) await ps.detach().catch((e) => console.log('ps detach err', e.message));
  await b.disconnect().catch(() => {});
  await cli(['close'], cd, { capMs: 15000 });
} finally {
  server.close(); popupServer.close();
  const lo = await cleanupRoot(root, cli, [cd]);
  console.log('leftovers', JSON.stringify(lo));
}
