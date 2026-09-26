import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, pageTargets } from './lib.mjs';

const root = await makeRoot('g230dbg2');
const cli = makeCli(root);
const FX = await fs.readFile(path.resolve('../../../../../../tools/scenario-suite/fixtures/fr2-04-dialogs.html'), 'utf-8');
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(FX); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/fx.html`;
try {
  for (let t = 0; t < 3; t++) {
    const cd = path.join(root.R, `st${t}`);
    const n = `dbg2-${t}`;
    await cli(['nav', `${BASE}?n=${n}`], cd);
    const st = await readState(cd);
    const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    const opener = pageTargets(b).find((x) => x.url().includes(n));
    const os_ = await opener.createCDPSession();
    await os_.send('Runtime.evaluate', { expression: `void window.open('${BASE}?n=${n}-pop&onloadAlert=1')`, userGesture: true }).catch(() => {});
    await delay(800);
    const acc = await cli(['dialog', 'accept'], cd, { capMs: 20000 });
    console.log(t, 'accept', acc.code, acc.ms, acc.stdout.trim());
    const tabs = await cli(['tabs'], cd, { capMs: 15000 });
    console.log(t, 'tabs', tabs.code, tabs.ms, tabs.killedAtCap, tabs.stdout.trim(), tabs.stderr.trim().slice(0,200));
    await os_.detach().catch(() => {});
    await b.disconnect().catch(() => {});
    await cli(['close'], cd, { capMs: 15000 });
  }
} finally {
  server.close();
  const lo = await cleanupRoot(root, cli, []);
  console.log('leftovers', JSON.stringify(lo));
}
