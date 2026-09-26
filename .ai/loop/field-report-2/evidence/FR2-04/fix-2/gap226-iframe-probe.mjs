// FR2-04 fix-2: GAP-226 honesty check (never reached by audit-2). A dialog opened by a CROSS-
// ORIGIN iframe during a command is a known, disclosed, still-open gap (OOPIF dialogs need child-
// target attach plumbing this item never built). Required bar per decisions.md: it must be
// reported LATE (by the next command), never silently missed forever, and it must NEVER cause a
// wrong-tab result or a hang -- i.e. it must degrade the same safe way an "unknown, blocked"
// target already does elsewhere in this item, not regress into GAP-017.
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, pageTargets, waitBlocked, idOf } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const root = await makeRoot('gap226');
const cli = makeCli(root);
// Two distinct origins (different ports) so the iframe is genuinely cross-origin (out-of-process
// under site isolation).
const serverA = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(`<!doctype html><title>outer</title><body>outer<iframe id="f" src=""></iframe></body>`); });
await new Promise((r) => serverA.listen(0, '127.0.0.1', r));
const PORT_A = serverA.address().port;
const serverB = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(`<!doctype html><title>inner</title><script>alert('gap226-inner')</script>inner`); });
await new Promise((r) => serverB.listen(0, '127.0.0.1', r));
const PORT_B = serverB.address().port;
const BASE_A = `http://127.0.0.1:${PORT_A}/`;
const BASE_B = `http://localhost:${PORT_B}/`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    const cd = path.join(root.R, `g226-${t}`); dirs.push(cd);
    await cli(['nav', BASE_A], cd);
    const st = await readState(cd);
    const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    const outer = pageTargets(b)[0];
    const os_ = await outer.createCDPSession();
    // Point the iframe at the cross-origin inner page, which alerts on load, DURING what would be
    // the gap between two CLI commands (not inside a command's own dispatch).
    await os_.send('Runtime.evaluate', { expression: `document.getElementById('f').src=${JSON.stringify(BASE_B)}` });
    await os_.detach().catch(() => {});
    await delay(1500); // let the iframe load and alert() fire
    // Command #1: does it hang, or does it silently return a WRONG tab (about:blank)?
    const r1 = await cli(['snap'], cd, { capMs: 20000 });
    const urls1 = pageTargets(b).map((x) => x.url());
    // Command #2: is it (eventually) reported at all?
    const r2 = await cli(['dialog'], cd, { capMs: 20000 });
    const row = {
      t,
      cmd1: { code: r1.code, ms: r1.ms, cap: r1.killedAtCap, out: r1.stdout.trim().slice(0, 200), err: r1.stderr.trim().slice(0, 200) },
      cmd1UrlsAfter: urls1,
      cmd1WrongTab: urls1.some((u) => u === 'about:blank'),
      cmd1Hung: r1.ms > 15000,
      cmd2: { code: r2.code, out: r2.stdout.trim().slice(0, 200) },
      eventuallyReported: /gap226-inner|dialogPending/i.test(r1.stdout + r1.stderr + r2.stdout + r2.stderr),
    };
    console.log(JSON.stringify(row));
    rows.push(row);
    await b.disconnect().catch(() => {});
    await cli(['close'], cd, { capMs: 20000 });
  }
} finally {
  serverA.close(); serverB.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, 'gap226-iframe-probe.json'), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
