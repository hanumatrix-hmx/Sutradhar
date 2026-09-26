// FR2-04 audit-3, point 2: attack the new probe signal. fix-2's rule: Performance.getMetrics
// answering within 400 ms == "no dialog", timing out (or ANY other error) == "unknown dialog"
// (warden listWithLiveness: `state !== 'responsive'`). For each NON-dialog page state below we
// measure (a) raw getMetrics latency on the target, (b) what the warden's /v1/dialogs reports,
// (c) what a real `snap` does (exit 3 == false block), and (d) for false blocks, whether the
// suggested recovery (`dialog accept`) would close a perfectly healthy user tab.
// Usage: node signal-attack-probe.mjs <trials> <caseRegex> <tag> [--headed]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, metrics, live } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 1);
const FILTER = new RegExp(process.argv[3] ?? '.');
const TAG = process.argv[4] ?? 'run';
const HEADED = process.argv.includes('--headed');
const root = await makeRoot('sig');
const cli = makeCli(root);
const server = http.createServer(async (q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/slow') { await delay(Number(u.searchParams.get('ms') || 5000)); s.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); return s.end('slow-ok'); }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  s.end(`<!doctype html><title>sig ${u.searchParams.get('n')}</title><body><input id="work" value="unsaved user work"><div id="root"></div></body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// Each state: expr run in the page (fire-and-forget via setTimeout so the observer never blocks),
// or a special action. `settleMs`: wait before measuring. `dialog`: true only for the control.
const STATES = [
  { name: 'control/idle', expr: '0', settleMs: 200 },
  { name: 'control/alert(dialog)', expr: `setTimeout(()=>alert('real dialog'),0)`, settleMs: 400, dialog: true },
  { name: 'busy-js-6s', expr: `setTimeout(()=>{const t=Date.now();while(Date.now()-t<6000){}},0)`, settleMs: 300 },
  { name: 'sync-xhr-10s', expr: `setTimeout(()=>{const x=new XMLHttpRequest();x.open('GET','/slow?ms=10000',false);try{x.send()}catch(e){}},0)`, settleMs: 400 },
  { name: 'huge-dom-parse+layout', expr: `setTimeout(()=>{const t=Date.now();const h='<div style="display:flex;flex-wrap:wrap">'+'<span style="padding:1px;border:1px solid red;display:inline-block">x</span>'.repeat(250000)+'</div>';document.getElementById('root').innerHTML=h;document.body.offsetHeight;window.__busy=Date.now()-t;},0)`, settleMs: 250, busyVar: true },
  { name: 'huge-dom-big(600k)-snap-now', expr: `setTimeout(()=>{const t=Date.now();const h='<div style="display:flex;flex-wrap:wrap">'+'<span style="padding:1px;border:1px solid red;display:inline-block">x</span>'.repeat(600000)+'</div>';document.getElementById('root').innerHTML=h;document.body.offsetHeight;window.__busy=Date.now()-t;},0)`, settleMs: 0, busyVar: true },
  { name: 'repeated-forced-layout', expr: `setTimeout(()=>{const r=document.getElementById('root');r.innerHTML='<div>'+'<p>y</p>'.repeat(60000)+'</div>';const t=Date.now();while(Date.now()-t<5000){r.style.width=(100+Math.random()*500)+'px';void r.offsetHeight;}window.__busy=Date.now()-t;},0)`, settleMs: 600, busyVar: true },
  { name: 'alloc-heavy-gc', expr: `setTimeout(()=>{const t=Date.now();let keep=[];while(Date.now()-t<5000){let a=[];for(let i=0;i<2e5;i++)a.push({i,s:'x'+i});keep.push(a);if(keep.length>40)keep=[];}window.__busy=Date.now()-t;},0)`, settleMs: 400, busyVar: true },
  { name: 'mid-navigation-slow-response', expr: `setTimeout(()=>{location.href='/slow?ms=6000'},0)`, settleMs: 500 },
  { name: 'debugger-paused', special: 'debugger', settleMs: 300 },
  { name: 'print-preview', expr: `setTimeout(()=>{window.print();window.__printed=1},0)`, settleMs: 800 },
  { name: 'background-tab-busy', special: 'background', settleMs: 300 },
  { name: 'renderer-crashed(aw-snap)', special: 'crash', settleMs: 800 },
  { name: 'renderer-hung(chrome://hang)', special: 'hang', settleMs: 1500 },
];

const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const st of STATES) {
      if (!FILTER.test(st.name)) continue;
      const cd = path.join(root.R, `s-${t}-${st.name.replace(/\W/g, '_')}`); dirs.push(cd);
      const n = `g${t}x${Date.now() % 100000}`;
      const row = { t, state: st.name, n };
      let b;
      try {
        const nav = await cli(['nav', `${BASE}/?n=${n}`, ...(HEADED ? ['--headed'] : [])], cd);
        if (nav.code !== 0) throw new Error('nav failed ' + nav.stderr.slice(0, 200));
        const s0 = await readState(cd);
        b = await puppeteer.connect({ browserWSEndpoint: s0.wsEndpoint, defaultViewport: null });
        let tgt = pageTargets(b).find((x) => x.url().includes(n));
        const tgtId = idOf(tgt);
        const s = await tgt.createCDPSession();
        if (st.special === 'debugger') {
          await s.send('Debugger.enable');
          await s.send('Runtime.evaluate', { expression: 'setTimeout(()=>{debugger;},0)' });
        } else if (st.special === 'background') {
          await s.send('Runtime.evaluate', { expression: `setInterval(()=>{const t=Date.now();while(Date.now()-t<300){}},310)` });
          const nt = await cli(['newtab', `${BASE}/?n=${n}-fg`], cd);
          row.newtab = nt.code;
        } else if (st.special === 'crash') {
          s.send('Page.crash').catch(() => {});
        } else if (st.special === 'hang') {
          const r = await b.target().createCDPSession();
          r.send('Target.activateTarget', { targetId: tgtId }).catch(() => {});
          s.send('Page.navigate', { url: 'chrome://hang' }).catch(() => {});
        } else {
          await s.send('Runtime.evaluate', { expression: st.expr, userGesture: true }, { timeout: 3000 }).catch((e) => { row.triggerErr = String(e.message).slice(0, 100); });
        }
        await delay(st.settleMs);
        const tStart = Date.now();
        // (a) raw signal, three samples at the product's 400 ms budget
        row.getMetrics = [];
        for (let i = 0; i < 3; i++) row.getMetrics.push(await metrics(s, 400));
        row.runtimeEval = await live(s, 400);
        // (b) the warden's own verdict
        const wf = await readWarden(cd);
        if (wf) {
          try {
            const t0 = Date.now();
            const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) });
            const j = await r.json();
            row.warden = { ms: Date.now() - t0, dialogs: j.dialogs.map((x) => `${x.targetId === tgtId ? 'TGT' : 'other'}:${x.type}`) };
          } catch (e) { row.warden = 'ERR ' + e.message; }
        } else row.warden = 'no warden.json';
        // (c) the product outcome for a normal command
        const snap = await cli(['snap'], cd, { capMs: 60000 });
        row.snap = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, first: snap.stdout.split('\n').slice(0, 2).join(' | ').slice(0, 200), err: snap.stderr.trim().slice(0, 250) };
        row.elapsedSinceMeasureStart = Date.now() - tStart;
        // (d) false block? then follow the hint and see whether a healthy tab gets closed
        if (snap.code === 3 && !st.dialog) {
          const acc = await cli(['dialog', 'accept'], cd, { capMs: 30000 });
          row.recovery = { code: acc.code, ms: acc.ms, out: acc.stdout.trim().slice(0, 250), err: acc.stderr.trim().slice(0, 200) };
          row.targetStillExists = pageTargets(b).some((x) => idOf(x) === tgtId);
          // Target.closeTarget on a renderer that is busy may complete only once the renderer
          // frees up: poll for up to 15 s and record when (if ever) the tab disappears.
          const tc0 = Date.now();
          while (Date.now() - tc0 < 15000 && pageTargets(b).some((x) => idOf(x) === tgtId)) await delay(250);
          row.targetGoneAfterMs = pageTargets(b).some((x) => idOf(x) === tgtId) ? null : Date.now() - tc0;
          row.targetStillExistsAfter15s = row.targetGoneAfterMs === null;
        }
        if (st.busyVar) {
          await delay(6000);
          const r = await s.send('Runtime.evaluate', { expression: 'window.__busy', returnByValue: true }, { timeout: 8000 }).catch(() => undefined);
          row.pageBusyMs = r?.result?.value;
        }
        const falseBlock = !st.dialog && snap.code === 3;
        row.verdict = st.dialog ? (snap.code === 3 ? 'DIALOG-CAUGHT' : 'DIALOG-MISSED') : falseBlock ? (row.targetStillExistsAfter15s === false ? `FALSE-BLOCK+TAB-CLOSED(${row.targetGoneAfterMs}ms)` : 'FALSE-BLOCK') : 'OK';
        console.log(JSON.stringify({ t, state: st.name, gm: row.getMetrics.map((m) => `${m.state[0]}${m.ms}`).join(','), rt: row.runtimeEval, warden: row.warden, snap: `${snap.code}${snap.killedAtCap ? '(CAP)' : ''}/${snap.ms}ms`, rec: row.recovery?.out?.slice(0, 80), busy: row.pageBusyMs, verdict: row.verdict }));
        await s.detach().catch(() => {});
      } catch (e) { row.error = String(e?.stack || e).slice(0, 500); console.log('ERR', st.name, row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  const sum = {};
  for (const r of rows) { (sum[r.state] ??= {})[r.verdict ?? 'ERROR'] = (sum[r.state][r.verdict ?? 'ERROR'] ?? 0) + 1; }
  await fs.writeFile(path.join(here, `signal-attack-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), headed: HEADED, rows, summary: sum, leftovers }, null, 2));
  console.log(JSON.stringify(sum, null, 1)); console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
