// FR2-04 audit-2, 2(c) follow-up. signal-probe.mjs showed that from a FRESH session every
// renderer-side method times out under BOTH a busy loop and a dialog. Hypothesis: Blink dispatches
// a few "interrupting" methods (Performance.getMetrics, Debugger.setBreakpointsActive, ...) via a
// V8 interrupt, which fires inside running JS (busy loop) but not while the main thread is blocked
// in the dialog's sync IPC — but only on a session the renderer already knows about (session
// attach itself needs the main thread). So: PRE-establish one session per candidate method
// (warm it with Runtime.evaluate) BEFORE the page goes busy / opens a dialog, then probe.
// This is exactly the situation of a warden session that attached (and whose Page.enable acked)
// before the dialog opened.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, puppeteer, delay, live, cleanupRoot, here, idOf } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 4);
const root = await makeRoot('signal2');
const cli = makeCli(root);
const PAGE = `<!doctype html><title>sig</title><body>sig<script>
onbeforeunload=function(e){ if(window.ARM_BU){ e.preventDefault(); e.returnValue='x'; return 'x'; } };
</script></body>`;
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(PAGE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const TRIGGERS = {
  idle: null,
  busy: 'setTimeout(function(){var t=Date.now();while(Date.now()-t<20000){}},200)',
  busyAsyncChurn: 'setTimeout(function(){var t=Date.now();(function f(){var s=Date.now();while(Date.now()-s<400){} if(Date.now()-t<20000) setTimeout(f,0);})()},200)',
  alert: "setTimeout(function(){alert('sig-alert')},200)",
  confirm: "setTimeout(function(){confirm('sig-confirm')},200)",
  prompt: "setTimeout(function(){prompt('sig-prompt','dv')},200)",
  beforeunload: "window.ARM_BU=1; setTimeout(function(){location.href='" + BASE + "?left'},200)",
};
const METHODS = [
  ['Runtime.evaluate', { expression: '1', returnByValue: true }],
  ['Performance.getMetrics', {}],
  ['Debugger.setBreakpointsActive', { active: true }],
  ['Page.getFrameTree', {}],
  ['Runtime.getIsolateId', {}],
];
const PROBE_MS = 600;
const dirs = [];
const out = { at: new Date().toISOString(), probeMs: PROBE_MS, rows: [] };
try {
  const d = path.join(root.R, 'state-sig2'); dirs.push(d);
  const nav = await cli(['nav', BASE + '?setup'], d);
  if (nav.code !== 0) throw new Error('setup nav failed ' + nav.stderr);
  const st = await readState(d);
  const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  const bs = await b.target().createCDPSession();
  for (let trial = 0; trial < TRIALS; trial++) {
    for (const [state, trig] of Object.entries(TRIGGERS)) {
      const { targetId } = await bs.send('Target.createTarget', { url: `${BASE}?s=${state}&t=${trial}` });
      let target; for (let i = 0; i < 50 && !target; i++) { target = b.targets().find((t) => idOf(t) === targetId); if (!target) await delay(100); }
      await delay(500);
      // pre-establish + warm one session per method, plus one Page-enabled "holder" (like the warden)
      const pre = {};
      for (const [m] of METHODS) { const s = await target.createCDPSession(); await s.send('Runtime.evaluate', { expression: '0' }); pre[m] = s; }
      const holder = await target.createCDPSession(); await holder.send('Page.enable'); const events = []; holder.on('Page.javascriptDialogOpening', (e) => events.push(e.type));
      if (trig) {
        const setup = await target.createCDPSession();
        await setup.send('Runtime.evaluate', { expression: trig, userGesture: true }, { timeout: 3000 }).catch(() => {});
        await setup.detach().catch(() => {});
      }
      await delay(1200);
      const row = { trial, state, holderSawDialog: events.slice(), methods: {} };
      for (const [m, params] of METHODS) {
        const t0 = Date.now(); let res;
        try { await pre[m].send(m, params, { timeout: PROBE_MS }); res = 'ANSWERED'; }
        catch (e) { res = /timed out/i.test(e.message) ? 'TIMEOUT' : 'ERROR: ' + e.message.replace(/^Protocol error \([^)]*\): /, '').slice(0, 80); }
        row.methods[m] = { res, ms: Date.now() - t0 };
      }
      console.log(JSON.stringify({ state, trial, holder: row.holderSawDialog, ...Object.fromEntries(Object.entries(row.methods).map(([k, v]) => [k, `${v.res}/${v.ms}`])) }));
      out.rows.push(row);
      if (events.length) await holder.send('Page.handleJavaScriptDialog', { accept: true }, { timeout: 2000 }).catch(() => {});
      for (const s of [...Object.values(pre), holder]) await s.detach().catch(() => {});
      await bs.send('Target.closeTarget', { targetId }).catch(() => {});
      await delay(300);
    }
  }
  await b.disconnect();
} catch (e) { out.error = String(e?.stack || e); console.error(e); }
finally {
  server.close();
  out.leftovers = await cleanupRoot(root, cli, dirs);
  const sum = {};
  for (const r of out.rows) for (const [m, v] of Object.entries(r.methods)) { const k = `${r.state}|${m}`; (sum[k] ??= {})[v.res] = (sum[k][v.res] ?? 0) + 1; }
  out.summary = sum;
  await fs.writeFile(path.join(here, 'signal-probe-2.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(sum));
  process.exit(0);
}
