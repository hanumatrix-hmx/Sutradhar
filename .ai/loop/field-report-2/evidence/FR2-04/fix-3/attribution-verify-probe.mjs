// FR2-04 fix-3: targeted end-to-end check that decision point 1's blockedBy attribution actually
// reaches the warden's real HTTP surface (not just the pure attributeDialogHolders unit tests) —
// same-origin popup+opener sharing a renderer, both genuinely blocked. Confirms exactly ONE of the
// two /v1/dialogs entries has no blockedBy (the holder) and the other's blockedBy points at it.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets } from './lib.mjs';

const root = await makeRoot('attrib');
const cli = makeCli(root);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  s.end(`<!doctype html><title>opener ${u.searchParams.get('n')}</title><body>opener</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const cd = path.join(root.R, 'attrib');
const n = `attr${Date.now() % 100000}`;
const out = { at: new Date().toISOString() };
try {
  await cli(['nav', `${BASE}/?n=${n}`], cd);
  const st = await readState(cd);
  const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  const opener = pageTargets(b).find((x) => x.url().includes(n));
  const openerId = idOf(opener);
  const s = await opener.createCDPSession();
  await s.send('Runtime.evaluate', { expression: `(function(){var w=window.open('');w.alert('CTL-${n}');})()`, userGesture: true }, { timeout: 3000 }).catch(() => {});
  await s.detach().catch(() => {});
  await delay(3000);
  const wf = await readWarden(cd);
  const res = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) });
  const body = await res.json();
  out.openerId = openerId;
  out.dialogs = body.dialogs.map((d) => ({ targetId: d.targetId, isOpener: d.targetId === openerId, type: d.type, url: d.url, blockedBy: d.blockedBy }));
  const holders = out.dialogs.filter((d) => !d.blockedBy);
  const collateral = out.dialogs.filter((d) => d.blockedBy);
  out.verdict =
    out.dialogs.length === 2 && holders.length === 1 && collateral.length === 1 && collateral[0].blockedBy === holders[0].targetId
      ? 'PASS: exactly one holder, one collateral pointing at it'
      : 'FAIL: attribution did not resolve to exactly one holder + one collateral';
  // Now recover via the CLI's actual `dialog accept` and confirm it closes the HOLDER, not the opener.
  const acc = await cli(['dialog', 'accept'], cd, { capMs: 30000 });
  out.acceptOut = acc.stdout.trim();
  const closedId = /Tab (\S+?)(?:\s|\))/.exec(acc.stdout)?.[1];
  out.closedId = closedId;
  out.closedWasOpener = closedId === openerId;
  out.recoveryVerdict = out.closedWasOpener ? 'FAIL: closed the opener (GAP-236 regression)' : 'PASS: did not close the opener';
  console.log(JSON.stringify(out, null, 2));
  await b.disconnect().catch(() => {});
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, [cd]);
  out.leftovers = leftovers;
  await fs.writeFile(path.join(here, 'attribution-verify.json'), JSON.stringify(out, null, 2));
  process.exit(0);
}
