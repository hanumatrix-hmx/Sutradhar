// FR2-04 fix-2/GAP-233: build a fixture that REALLY triggers beforeunload in a popup. audit-2's
// gap220-matrix cases 'open/inline/beforeunload' and 'open/t0/beforeunload' both ended
// "NOT-BLOCKED(no test)" -- the popup never actually became dialog-blocked, so the product was
// never really exercised for this shape. Chrome only fires beforeunload on an ACTUAL navigation
// away/close of a page that has a handler AND (per Chrome's own sticky-activation rule) some user
// activation on that specific page. This fixture: opens a popup via a real CLI click (so the
// popup's own creation carries activation), the popup then clicks its OWN link (a second, popup-
// scoped user gesture) to navigate itself away, and ITS beforeunload handler is armed.
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, pageTargets, waitBlocked, idOf } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 5);
const root = await makeRoot('bu');
const cli = makeCli(root);
const OPENER = `<!doctype html><title>opener</title><body>
<button id="open" onclick="window.open('/pop')">open</button>
</body>`;
const POP = `<!doctype html><title>pop</title><body>
<a id="leave" href="/left">leave</a>
<script>onbeforeunload=function(e){e.preventDefault();e.returnValue='x';return 'x';};</script>
pop</body>`;
const server = http.createServer((q, s) => {
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  s.end(q.url === '/pop' ? POP : q.url === '/left' ? '<!doctype html><title>left</title>left' : OPENER);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    const cd = path.join(root.R, `bu-${t}`); dirs.push(cd);
    await cli(['nav', BASE], cd);
    const st = await readState(cd);
    const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    const before = new Set(pageTargets(b).map(idOf));
    const clickOpen = await cli(['click', '#open'], cd, { capMs: 15000 });
    let pop; for (let i = 0; i < 60 && !pop; i++) { pop = pageTargets(b).find((x) => !before.has(idOf(x))); if (!pop) await delay(100); }
    await delay(300);
    // Now click the popup's OWN link -- the CLI's `focustab`+`click` path gives the popup its own
    // real user gesture, then the link's navigation should trigger the popup's beforeunload.
    const tabs = await cli(['tabs'], cd, { capMs: 10000 });
    const popTabId = tabs.stdout.split('\n').find((l) => !l.includes('opener') && l.trim())?.trim().split(/\s+/)[1];
    let focusOut, clickOut;
    if (popTabId) {
      focusOut = await cli(['focustab', popTabId], cd, { capMs: 10000 });
      clickOut = await cli(['click', '#leave'], cd, { capMs: 15000 });
    }
    const ps = pop ? await pop.createCDPSession() : undefined;
    const blocked = ps ? await waitBlocked(ps, 3000) : false;
    const row = { t, clickOpenCode: clickOpen.code, popTabId, focusCode: focusOut?.code, clickLeaveCode: clickOut?.code, clickLeaveOut: clickOut?.stdout.trim().slice(0, 200), popupActuallyBlocked: blocked };
    console.log(JSON.stringify(row));
    rows.push(row);
    if (ps) await ps.detach().catch(() => {});
    await b.disconnect().catch(() => {});
    await cli(['close'], cd, { capMs: 20000 });
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, 'beforeunload-popup-fixture.json'), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
