import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, delay, cleanupRoot, here } from './lib.mjs';

const root = await makeRoot('g230dbg');
const cli = makeCli(root);
const FX = await fs.readFile(path.resolve(here, '../../../../../../tools/scenario-suite/fixtures/fr2-04-dialogs.html'), 'utf-8');
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(FX); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/fx.html`;
const cd = path.join(root.R, 'st');
try {
  const nav = await cli(['nav', `${BASE}?n=dbg1`], cd);
  console.log('nav', nav.code, nav.ms);
  const click = await cli(['click', '#popup'], cd, { capMs: 20000 });
  console.log('click', click.code, click.ms, click.stdout, click.stderr);
  await delay(600);
  const acc = await cli(['dialog', 'accept'], cd, { capMs: 20000 });
  console.log('accept', acc.code, acc.ms, acc.stdout.slice(0,200));
  for (let i = 0; i < 1; i++) {
    await delay(1000);
    const tabs = await cli(['tabs'], cd, { capMs: 15000 });
    console.log('tabs try', i, tabs.code, tabs.ms, tabs.killedAtCap, tabs.stdout.slice(0,200), tabs.stderr.slice(0,200));
    if (tabs.code === 0) break;
  }
} finally {
  server.close();
  const lo = await cleanupRoot(root, cli, [cd]);
  console.log('leftovers', JSON.stringify(lo));
}
