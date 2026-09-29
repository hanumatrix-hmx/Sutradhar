// FR2-04 audit-2: fix-1's GAP-220 defensive layer turns a missed popup dialog into an exit-3
// `type:"unknown"` block. Can the user actually RECOVER from that without killing the session?
// The exit-3 hint says: `sutradhar dialog accept|dismiss`, or --dialog accept|dismiss, or close.
// Each is tried in turn; after each we check (independently) whether the popup is still blocked.
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, pageTargets, waitBlocked, idOf, live } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const root = await makeRoot('unk');
const cli = makeCli(root);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  s.end(u.pathname === '/pop' ? `<!doctype html><title>pop</title><script>alert('U-${u.searchParams.get('n')}')</script>pop` : `<!doctype html><title>opener</title>opener`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    const cd = path.join(root.R, `u-${t}`); dirs.push(cd);
    const n = `u${t}x${Date.now() % 10000}`;
    await cli(['nav', `${BASE}/?n=${n}`], cd);
    const st = await readState(cd);
    const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    const before = new Set(pageTargets(b).map(idOf));
    const opener = pageTargets(b).find((x) => x.url().includes(n));
    const os_ = await opener.createCDPSession();
    await os_.send('Runtime.evaluate', { expression: `void window.open('${BASE}/pop?n=${n}')`, userGesture: true });
    await os_.detach();
    let pop; for (let i = 0; i < 60 && !pop; i++) { pop = pageTargets(b).find((x) => !before.has(idOf(x))); if (!pop) await delay(100); }
    const ps = await pop.createCDPSession();
    const steps = [];
    steps.push({ step: 'popup-blocked-initially', v: await waitBlocked(ps, 4000) });
    for (const args of [['snap'], ['dialog'], ['dialog', 'accept'], ['dialog', 'dismiss'], ['snap', '--dialog', 'accept'], ['closetab'], ['tabs']]) {
      const r = await cli(args, cd, { capMs: 40000 });
      const still = (await live(ps, 600)) === 'blocked';
      steps.push({ step: args.join(' '), code: r.code, ms: r.ms, cap: r.killedAtCap, out: r.stdout.trim().slice(0, 200), err: r.stderr.trim().slice(0, 300), popupStillBlocked: still });
      console.log(t, args.join(' '), '->', r.code, r.ms + 'ms', '| out:', r.stdout.trim().slice(0, 110).replace(/\n/g, ' / '), '| err:', r.stderr.trim().slice(0, 150).replace(/\n/g, ' / '), '| stillBlocked:', still);
    }
    const t0 = Date.now(); const cl = await cli(['close'], cd, { capMs: 40000 });
    steps.push({ step: 'close', code: cl.code, ms: Date.now() - t0, err: cl.stderr.trim().slice(0, 300) });
    console.log(t, 'close ->', cl.code, Date.now() - t0 + 'ms', cl.stderr.trim().slice(0, 200));
    rows.push({ t, steps });
    await b.disconnect().catch(() => {});
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, 'unknown-recovery-probe.json'), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
