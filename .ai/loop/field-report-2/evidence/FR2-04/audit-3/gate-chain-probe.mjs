// FR2-04 audit-2: the gate's OWN policy application can un-block a page that then immediately
// opens ANOTHER dialog (a chain: alert -> confirm on the fixture's #chain button). runDialogGate
// handles only the dialogs it listed, then returns 'handled' and withSessionFlow goes straight to
// runtime.attach() — with no re-list. The persisted policy is still 'report' at that moment
// (afterAttach persists the new flag only AFTER attach), so the warden will not auto-handle the
// second dialog either. Hypothesis: attach() then blocks on the second dialog (GAP-017 shape).
// Variants: gate via `snap --dialog accept` / `snap --dialog dismiss`; control: `dialog accept`.
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, pageTargets, waitBlocked, repoRoot } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const CAP = Number(process.argv[3] ?? 200000);
const root = await makeRoot('chain');
const cli = makeCli(root);
const FX = await fs.readFile(path.join(repoRoot, 'tools/scenario-suite/fixtures/fr2-04-dialogs.html'), 'utf-8');
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(FX); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/fx.html`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const variant of ['snap --dialog accept', 'snap --dialog dismiss', 'eval 1 --dialog accept', 'CONTROL dialog accept']) {
      const cd = path.join(root.R, `c-${t}-${variant.replace(/\W/g, '_')}`); dirs.push(cd);
      const n = `ch${t}${variant.replace(/\W/g, '')}${Date.now() % 10000}`;
      await cli(['nav', `${BASE}?n=${n}`], cd);
      const click = await cli(['click', '#chain'], cd);
      const st = await readState(cd);
      const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
      const tgt = pageTargets(b).find((x) => x.url().includes(n));
      const args = variant.replace('CONTROL ', '').split(' ');
      const r = await cli(args, cd, { capMs: CAP });
      const s = await tgt.createCDPSession();
      const stillBlocked = await waitBlocked(s, 1500);
      const urls = pageTargets(b).map((x) => x.url());
      const row = { t, variant, click: { code: click.code, out: click.stdout.trim().slice(0, 200) }, cmd: { code: r.code, ms: r.ms, killedAtCap: r.killedAtCap, out: r.stdout.slice(0, 400), err: r.stderr.slice(0, 300) }, pageStillBlockedAfter: stillBlocked, tabUrls: urls, reportedAboutBlank: /URL: about:blank/.test(r.stdout) };
      rows.push(row);
      console.log(JSON.stringify({ t, variant, click: click.code, code: r.code, ms: r.ms, cap: r.killedAtCap, first: r.stdout.split('\n').slice(0, 2).join(' | ').slice(0, 160), stillBlocked, blankTabs: urls.filter((u) => u === 'about:blank').length }));
      await s.detach().catch(() => {});
      await b.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, 'gate-chain-probe-' + (process.argv[4] ?? 'run') + '.json'), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
