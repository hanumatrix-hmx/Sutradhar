// FR2-04 audit-2, question 2(c): is there a DECIDABLE CDP signal that separates "a JS dialog is
// open on this target" from "this target is running a long script"? For each page state
// (idle / busy JS loop / alert / confirm / prompt / beforeunload), a FRESH CDP session (like the
// gate's or a late-attaching warden's) sends each candidate method with a short timeout, and we
// record answer / error text / timeout. One fresh session per method, so a queued (hung) request
// can never delay the next candidate. Page.handleJavaScriptDialog runs LAST (it may be destructive).
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, puppeteer, delay, live, cleanupRoot, here, idOf } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const root = await makeRoot('signal');
const cli = makeCli(root);
const PAGE = `<!doctype html><title>sig</title><body>sig<script>
onbeforeunload=function(e){ if(window.ARM_BU){ e.preventDefault(); e.returnValue='x'; return 'x'; } };
</script></body>`;
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(PAGE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const TRIGGERS = {
  idle: null,
  busy: 'setTimeout(function(){var t=Date.now();while(Date.now()-t<25000){}},200)',
  alert: "setTimeout(function(){alert('sig-alert')},200)",
  confirm: "setTimeout(function(){confirm('sig-confirm')},200)",
  prompt: "setTimeout(function(){prompt('sig-prompt','dv')},200)",
  beforeunload: "window.ARM_BU=1; setTimeout(function(){location.href='" + BASE + "?left'},200)",
};
const METHODS = [
  ['Runtime.evaluate', { expression: '1', returnByValue: true }],
  ['Performance.getMetrics', {}],
  ['Debugger.setBreakpointsActive', { active: true }],
  ['Runtime.terminateExecution__SKIP', null], // placeholder: destructive for a busy script, tested separately below
  ['Page.getFrameTree', {}],
  ['Page.getNavigationHistory', {}],
  ['Page.getLayoutMetrics', {}],
  ['DOM.getDocument', { depth: 0 }],
  ['Runtime.getIsolateId', {}],
  ['Runtime.getHeapUsage', {}],
  ['Page.captureScreenshot', { format: 'png' }],
  ['Page.enable', {}],
];
const PROBE_MS = 800;
const dirs = [];
const out = { at: new Date().toISOString(), probeMs: PROBE_MS, trials: [] };
try {
  const d = path.join(root.R, 'state-sig'); dirs.push(d);
  const nav = await cli(['nav', BASE + '?setup'], d);
  if (nav.code !== 0) throw new Error('setup nav failed ' + nav.stderr);
  const st = await readState(d);
  const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  const bs = await b.target().createCDPSession();
  for (let trial = 0; trial < TRIALS; trial++) {
    for (const [state, trig] of Object.entries(TRIGGERS)) {
      const url = `${BASE}?s=${state}&t=${trial}&r=${Math.random().toString(36).slice(2, 6)}`;
      const { targetId } = await bs.send('Target.createTarget', { url });
      let target;
      for (let i = 0; i < 50 && !target; i++) { target = b.targets().find((t) => idOf(t) === targetId); if (!target) await delay(100); }
      await delay(500); // let it load
      if (trig) {
        const setup = await target.createCDPSession();
        await setup.send('Runtime.evaluate', { expression: trig, userGesture: true }, { timeout: 3000 }).catch((e) => ({ err: e.message }));
        await setup.detach().catch(() => {});
      }
      await delay(1200);
      const row = { trial, state, methods: {} };
      for (const [m, params] of METHODS) {
        if (!params) continue;
        const s = await target.createCDPSession();
        const events = [];
        s.on('Page.javascriptDialogOpening', (e) => events.push(e.type));
        const t0 = Date.now();
        let res;
        try { await s.send(m, params, { timeout: PROBE_MS }); res = 'ANSWERED'; }
        catch (e) { res = /timed out/i.test(e.message) ? 'TIMEOUT' : 'ERROR: ' + e.message.replace(/^Protocol error \([^)]*\): /, '').slice(0, 90); }
        if (m === 'Page.enable') { await delay(1500); row.pageEnableReplayedDialogEvent = events.length > 0 ? events : false; }
        row.methods[m] = { res, ms: Date.now() - t0 };
        await s.detach().catch(() => {});
      }
      // Target-level (browser session) info
      try { const ti = await bs.send('Target.getTargetInfo', { targetId }); row.targetInfo = { attached: ti.targetInfo.attached, url: ti.targetInfo.url, title: ti.targetInfo.title }; } catch (e) { row.targetInfo = 'ERR ' + e.message; }
      // Last: handleJavaScriptDialog from a FRESH session (O2), then did the state change?
      {
        const s = await target.createCDPSession();
        const t0 = Date.now();
        try { await s.send('Page.handleJavaScriptDialog', { accept: false }, { timeout: PROBE_MS }); row.handleFresh = 'ANSWERED(ok)'; }
        catch (e) { row.handleFresh = /timed out/i.test(e.message) ? 'TIMEOUT' : 'ERROR: ' + e.message.replace(/^Protocol error \([^)]*\): /, '').slice(0, 90); }
        row.handleFreshMs = Date.now() - t0;
        await s.detach().catch(() => {});
        const s2 = await target.createCDPSession();
        row.liveAfterHandle = await live(s2, 600);
        await s2.detach().catch(() => {});
      }
      console.log(JSON.stringify({ state, trial, ...Object.fromEntries(Object.entries(row.methods).map(([k, v]) => [k, v.res])), replay: row.pageEnableReplayedDialogEvent, handleFresh: row.handleFresh, liveAfterHandle: row.liveAfterHandle }));
      out.trials.push(row);
      await bs.send('Target.closeTarget', { targetId }).catch(() => {});
      await delay(300);
    }
  }
  // Runtime.terminateExecution: destructive for the busy script (that's the point) — does it
  // ANSWER under busy vs under dialog?
  out.terminate = [];
  for (const state of ['busy', 'alert']) {
    const { targetId } = await bs.send('Target.createTarget', { url: `${BASE}?term=${state}` });
    let target; for (let i = 0; i < 50 && !target; i++) { target = b.targets().find((t) => idOf(t) === targetId); if (!target) await delay(100); }
    await delay(500);
    const setup = await target.createCDPSession();
    await setup.send('Runtime.evaluate', { expression: TRIGGERS[state] }, { timeout: 3000 }).catch(() => {});
    await setup.detach().catch(() => {});
    await delay(1200);
    const s = await target.createCDPSession();
    const t0 = Date.now(); let res;
    try { await s.send('Runtime.terminateExecution', {}, { timeout: PROBE_MS }); res = 'ANSWERED'; } catch (e) { res = /timed out/i.test(e.message) ? 'TIMEOUT' : 'ERROR ' + e.message.slice(0, 80); }
    const after = await live(s, 800);
    out.terminate.push({ state, res, ms: Date.now() - t0, liveAfter: after });
    console.log('terminate', state, res, after);
    await bs.send('Target.closeTarget', { targetId }).catch(() => {});
  }
  await b.disconnect();
} catch (e) {
  out.error = String(e?.stack || e);
  console.error(e);
} finally {
  server.close();
  out.leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, 'signal-probe.json'), JSON.stringify(out, null, 2));
  // summary table
  const sum = {};
  for (const r of out.trials) for (const [m, v] of Object.entries(r.methods)) { const k = `${r.state}|${m}`; (sum[k] ??= {})[v.res] = (sum[k][v.res] ?? 0) + 1; }
  console.log(JSON.stringify(sum, null, 1));
  process.exit(0);
}
