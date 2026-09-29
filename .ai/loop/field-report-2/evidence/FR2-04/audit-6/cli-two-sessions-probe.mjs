// FR2-04 audit-6: two SEPARATE CLI sessions (separate state dirs => separate Chrome + separate
// warden) each opening popups with dialogs at the same time. Confirms no cross-session
// interference: each session's `dialog accept` only ever acts inside its own Chrome, each warden
// only lists its own targets, and a tracked (typed) dialog in session A is untouched by session B's
// recovery.
// usage: node cli-two-sessions-probe.mjs [trials]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here, readWarden, readState, procs, wardensUnder } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  const n = u.searchParams.get('n') ?? '';
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>inline ${n}</title><script>alert('inline-${n}')</script><body>inline</body>`);
  return s.end(`<!doctype html><title>opener ${n}</title><body>
<button id="pop" onclick="window.w=window.open('/alert-inline?n=${n}-popup')">pop</button>
<button id="al" onclick="alert('tracked-${n}')">al</button></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('twosess');
const cli = makeCli(root);
const dirs = [];
const results = [];
const outFile = path.join(here, 'cli-two-sessions.json');
const short = (r) => ({ args: r.args, code: r.code, ms: r.ms, out: r.stdout.trim().slice(0, 500), err: r.stderr.trim().slice(0, 400) });

try {
  for (let t = 0; t < TRIALS; t++) {
    const A = path.join(root.R, `A-${t}`), B = path.join(root.R, `B-${t}`);
    dirs.push(A, B);
    const rec = { trial: t, steps: [] };
    const run = async (d, args) => { const r = await cli(args, d, { capMs: 45000 }); rec.steps.push({ s: d === A ? 'A' : 'B', ...short(r) }); return r; };
    await Promise.all([run(A, ['nav', `${BASE}/?n=A${t}`]), run(B, ['nav', `${BASE}/?n=B${t}`])]);
    // both sessions open an untracked-dialog popup at the same time
    await Promise.all([run(A, ['click', '#pop']), run(B, ['click', '#pop'])]);
    await delay(1000);
    const [la, lb] = await Promise.all([run(A, ['dialog']), run(B, ['dialog'])]);
    // session A additionally gets a TRACKED alert on its opener? (opener shares the popup renderer -> it is blocked; skip)
    const [aa, ab] = await Promise.all([run(A, ['dialog', 'accept']), run(B, ['dialog', 'accept'])]);
    const [ta, tb] = await Promise.all([run(A, ['tabs']), run(B, ['tabs'])]);
    // now a tracked alert in A's opener, and B runs dialog accept while A's alert is open
    await run(A, ['click', '#al']);
    const bAcc = await run(B, ['dialog', 'accept']);
    const aList = await run(A, ['dialog']);
    const aAcc = await run(A, ['dialog', 'accept']);
    const wa = await readWarden(A), wb = await readWarden(B), sa = await readState(A), sb = await readState(B);
    const ws = wardensUnder(root, procs());
    rec.summary = {
      distinctChrome: sa?.wsEndpoint !== sb?.wsEndpoint,
      distinctWardens: wa?.pid !== wb?.pid,
      wardenCountUnderRoot: ws.length,
      aListOnlyA: /A\d-popup/.test(la.stdout) && !/B\d/.test(la.stdout),
      bListOnlyB: /B\d-popup/.test(lb.stdout) && !/A\d/.test(lb.stdout),
      aClosedOwn: /was closed/.test(aa.stdout), bClosedOwn: /was closed/.test(ab.stdout),
      aTabsHasOpener: /opener A/.test(ta.stdout) && !/B\d/.test(ta.stdout),
      bTabsHasOpener: /opener B/.test(tb.stdout) && !/A\d/.test(tb.stdout),
      bAcceptWhileATrackedOpen: { code: bAcc.code, out: bAcc.stdout.trim().slice(0, 120), err: bAcc.stderr.trim().slice(0, 120) },
      aStillListsTracked: /tracked-A/.test(aList.stdout),
      aAcceptedTracked: /Accepted alert "tracked-A/.test(aAcc.stdout),
    };
    results.push(rec);
    console.log(JSON.stringify({ t, ...rec.summary }));
    await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    await Promise.all([run(A, ['close']), run(B, ['close'])]);
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
