// FR2-04 audit-2, question 2(a): GAP-220 residual hunt. Each case: fresh CLI session, open a new
// target that raises a dialog (various openers / timings / types), confirm independently that the
// target is dialog-blocked, then ask the product: warden /v1/dialogs, `sutradhar dialog`, `snap`.
// A MISS = the target is blocked but snap does not exit 3 within the cap (hang), or exits 0.
// Usage: node gap220-matrix.mjs <trials> [caseFilterRegex] [longCapCount]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, waitBlocked, live, taskkill } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const FILTER = new RegExp(process.argv[3] ?? '.');
let LONG_CAPS = Number(process.argv[4] ?? 1); // how many misses get the full 200s cap (to see the final outcome)
const TAG = process.argv[5] ?? 'run';
const root = await makeRoot('m220');
const cli = makeCli(root);

const POP = (q) => {
  const N = q.get('n'), dlg = q.get('dlg') || 'alert', kind = q.get('kind') || 'inline';
  if (dlg === 'beforeunload') {
    return `<!doctype html><title>pop ${N}</title><script>onbeforeunload=function(e){e.preventDefault();e.returnValue='x';return 'x';};setTimeout(function(){location.href='/pop?dlg=none&n=${N}-left'},${kind === 'inline' ? 0 : 150});</script><body>pop</body>`;
  }
  if (dlg === 'none') return `<!doctype html><title>pop ${N}</title><body>left</body>`;
  const call = dlg === 'prompt' ? `prompt('M-${N}','dv')` : `${dlg}('M-${N}')`;
  const body = kind === 'inline' ? call + ';' : kind === 'onload' ? `onload=function(){${call}};` : `setTimeout(function(){${call}},${kind.slice(1)});`;
  return `<!doctype html><title>pop ${N}</title><script>${body}</script><body>pop ${N}</body>`;
};
const OPENER = (q) => `<!doctype html><title>opener ${q.get('n')}</title><body>opener ${q.get('n')}
<a id="lnk" target="_blank" href="/pop?kind=inline&dlg=alert&n=${q.get('n')}-lnk">lnk</a>
<button id="btn" onclick="window.open('/pop?kind=inline&dlg=alert&n=${q.get('n')}-btn')">btn</button>
<button id="btnblank" onclick="var w=window.open('');w.document.write('<title>w</title><script>alert(\\'M-${q.get('n')}-bb\\')<\\/script>')">bb</button>
</body>`;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  s.end(u.pathname === '/pop' ? POP(u.searchParams) : OPENER(u.searchParams));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const popUrl = (n, kind, dlg) => `${BASE}/pop?kind=${kind}&dlg=${dlg}&n=${n}`;

// Each case: how the dialog-raising target comes to exist. `mode`: 'observer' (between commands,
// observer Runtime.evaluate with userGesture on the opener), 'cli' (a CLI command opens it).
const CASES = [];
for (const dlg of ['confirm', 'prompt', 'beforeunload']) for (const kind of ['inline', 't0']) CASES.push({ name: `open/${kind}/${dlg}`, mode: 'observer', expr: (n) => `void window.open(${JSON.stringify(popUrl(n, kind, dlg))})` });
CASES.push({ name: 'existing-tab/beforeunload-selfnav', mode: 'observer-self', expr: (n) => `onbeforeunload=function(e){e.preventDefault();e.returnValue='x';return 'x';};setTimeout(function(){location.href='/pop?dlg=none&n=${n}-left'},150)` });
CASES.push({ name: 'blank/sync-w.prompt', mode: 'observer', expr: (n) => `(function(){var w=window.open('');w.prompt('M-${n}','dv');})()` });
CASES.push({ name: 'open/t200/alert', mode: 'observer', expr: (n) => `void window.open(${JSON.stringify(popUrl(n, 't200', 'alert'))})` });
CASES.push({ name: 'noopener/t200/alert', mode: 'observer', expr: (n) => `void window.open(${JSON.stringify(popUrl(n, 't200', 'alert'))},'_blank','noopener')` });
CASES.push({ name: 'blank/sync-w.alert', mode: 'observer', expr: (n) => `(function(){var w=window.open('');w.alert('M-${n}');})()` });
CASES.push({ name: 'blank/sync-w.confirm', mode: 'observer', expr: (n) => `(function(){var w=window.open('');w.confirm('M-${n}');})()` });
CASES.push({ name: 'blank/document.write-inline', mode: 'observer', expr: (n) => `(function(){var w=window.open('');w.document.write('<script>alert("M-${n}")<\\/script>');})()` });
CASES.push({ name: 'blank/w.setTimeout200', mode: 'observer', expr: (n) => `(function(){var w=window.open('');w.setTimeout(function(){w.alert('M-${n}')},200);})()` });
CASES.push({ name: 'blank/opener-timer-2s', mode: 'observer', expr: (n) => `(function(){var w=window.open('');setTimeout(function(){w.alert('M-${n}')},2000);})()` });
CASES.push({ name: 'cli-newtab/inline/alert', mode: 'cli', args: (n) => ['newtab', popUrl(n, 'inline', 'alert')] });
CASES.push({ name: 'cli-newtab/t200/confirm', mode: 'cli', args: (n) => ['newtab', popUrl(n, 't200', 'confirm')] });
CASES.push({ name: 'cli-click/link-blank-inline', mode: 'cli', args: () => ['click', '#lnk'] });
CASES.push({ name: 'cli-click/window.open-inline', mode: 'cli', args: () => ['click', '#btn'] });
CASES.push({ name: 'cli-click/blank-document.write', mode: 'cli', args: () => ['click', '#btnblank'] });
CASES.push({ name: 'warden-restart/blank-main-tab-alert', mode: 'restart-blank' });

const dirs = []; const rows = [];
try {
  for (let trial = 0; trial < TRIALS; trial++) {
    for (const c of CASES) {
      if (!FILTER.test(c.name)) continue;
      const cd = path.join(root.R, `st-${trial}-${c.name.replace(/[^a-z0-9]/gi, '_')}`); dirs.push(cd);
      const n = `${c.name.replace(/[^a-z0-9]/gi, '')}${trial}x${Date.now() % 100000}`;
      const row = { trial, case: c.name, n };
      let b;
      try {
        let popId, blocked = false, triggerRes;
        if (c.mode === 'restart-blank') {
          // A session that never navigated (its only tab is about:blank); a dialog opens on it
          // while the warden is down; the warden then respawns (next command) during the dialog.
          const r0 = await cli(['tabs'], cd); row.setup = r0.code;
          const st = await readState(cd); const wf = await readWarden(cd);
          b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
          taskkill(wf.pid); await delay(400);
          const t = pageTargets(b)[0]; popId = idOf(t);
          const s = await t.createCDPSession();
          await s.send('Runtime.evaluate', { expression: `setTimeout(function(){alert('M-${n}')},100)` });
          blocked = await waitBlocked(s, 3000); await s.detach().catch(() => {});
        } else {
          const nav = await cli(['nav', `${BASE}/?n=${n}`], cd);
          if (nav.code !== 0) throw new Error('nav failed ' + nav.stderr.slice(0, 200));
          const st = await readState(cd);
          b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
          const before = new Set(pageTargets(b).map(idOf));
          if (c.mode === 'observer-self') {
            const opener = pageTargets(b).find((t) => t.url().includes(`n=${n}`));
            popId = idOf(opener);
            const os_ = await opener.createCDPSession();
            await os_.send('Runtime.evaluate', { expression: c.expr(n), userGesture: true }, { timeout: 4000 }).catch(() => {});
            blocked = await waitBlocked(os_, 4000);
            await os_.detach().catch(() => {});
            row.selfBlocked = blocked;
          } else if (c.mode === 'observer') {
            const opener = pageTargets(b).find((t) => t.url().includes(`n=${n}`));
            const os_ = await opener.createCDPSession();
            await os_.send('Runtime.evaluate', { expression: c.expr(n), userGesture: true }, { timeout: 4000 }).catch((e) => { triggerRes = 'eval-err ' + e.message.slice(0, 60); });
            await os_.detach().catch(() => {});
          } else {
            const r = await cli(c.args(n), cd, { capMs: 60000 });
            triggerRes = { code: r.code, ms: r.ms, killedAtCap: r.killedAtCap, stdout: r.stdout.slice(0, 300), stderr: r.stderr.slice(0, 300) };
          }
          if (c.mode !== 'observer-self') {
            let pop; for (let i = 0; i < 60 && !pop; i++) { pop = pageTargets(b).find((t) => !before.has(idOf(t))); if (!pop) await delay(100); }
            popId = pop ? idOf(pop) : undefined;
            if (pop) { const ps = await pop.createCDPSession(); blocked = await waitBlocked(ps, 5000); await ps.detach().catch(() => {}); }
            row.popUrl = pop?.url();
          }
        }
        row.trigger = triggerRes; row.targetBlocked = blocked;
        await delay(500);
        const wf = await readWarden(cd);
        if (wf) {
          try { const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(5000) }); const j = await r.json(); row.warden = { dialogs: j.dialogs.map((x) => `${x.targetId === popId ? 'POP' : 'other'}:${x.type}`), busy: j.busy.length }; } catch (e) { row.warden = 'ERR ' + e.message; }
        } else row.warden = 'no warden.json';
        const status = await cli(['dialog'], cd, { capMs: 30000 });
        row.dialogStatus = { code: status.code, out: status.stdout.trim().slice(0, 160) };
        const long = LONG_CAPS > 0;
        const snap = await cli(['snap'], cd, { capMs: long ? 200000 : 30000 });
        const urlsAfter = pageTargets(b).map((t) => t.url());
        row.snap = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, cap: long ? 200000 : 30000, pending: (snap.stdout.match(/dialogPending: .*/g) || []).slice(0, 2), firstLine: snap.stdout.split('\n').slice(0, 3).join(' | ').slice(0, 200), heal: /previous session was unreachable/.test(snap.stderr), stderr: snap.stderr.slice(0, 300), newBlankTab: urlsAfter.filter((u) => u === 'about:blank').length };
        row.verdict = !blocked ? 'NOT-BLOCKED(no test)' : snap.code === 3 ? (row.snap.pending.some((p) => /"type":"unknown"/.test(p)) ? 'CAUGHT-unknown' : 'CAUGHT-typed') : 'MISS';
        if (row.verdict === 'MISS' && long) LONG_CAPS--;
        console.log(JSON.stringify({ t: trial, c: c.name, blocked, warden: row.warden, status: row.dialogStatus.out.slice(0, 50), snap: `${snap.code}${snap.killedAtCap ? '(CAP)' : ''}/${snap.ms}ms`, first: row.snap.firstLine.slice(0, 90), verdict: row.verdict }));
      } catch (e) { row.error = String(e?.stack || e).slice(0, 500); console.log('ERR', c.name, row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  const sum = {};
  for (const r of rows) { (sum[r.case] ??= {})[r.verdict ?? 'ERROR'] = (sum[r.case][r.verdict ?? 'ERROR'] ?? 0) + 1; }
  await fs.writeFile(path.join(here, `gap220-matrix-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, summary: sum, leftovers }, null, 2));
  console.log(JSON.stringify(sum, null, 1)); console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
