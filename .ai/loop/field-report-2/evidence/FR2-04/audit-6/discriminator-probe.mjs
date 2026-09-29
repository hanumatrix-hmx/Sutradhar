// FR2-04 audit-6, residual sub-question 2: is there ANY CDP signal that tells "blocked from birth by
// a real (untracked) dialog" apart from "blocked from birth by a non-dialog (sync XHR)"? For four
// states, a FRESH observer session (attached after the block) sends a battery of browser-side and
// renderer-side commands and records answered/timeout/error + latency + payload digest:
//   A  blank popup, opener alerts into it synchronously (w=open('');w.alert())      -> real dialog
//   B  blank popup, opener then does a 20s sync XHR (w=open('');syncXHR)            -> no dialog
//   C  URL popup whose own inline script alerts on load                              -> real dialog
//   D  URL popup whose own inline script does a 20s sync XHR                         -> no dialog
// Candidate signals: Target.getTargetInfo (all fields), Page.getNavigationHistory, Page.captureScreenshot,
// Page.handleJavaScriptDialog (fresh session), Page.enable ack, Performance.getMetrics, Runtime.evaluate,
// DOM.getDocument, Page.getFrameTree, SystemInfo.getProcessInfo (browser-level, renderer CPU time delta),
// Memory.getDOMCounters, Page.getLayoutMetrics, Network.enable ack.
// usage: node discriminator-probe.mjs [trials]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here, readState, puppeteer, idOf } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 2);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/slow') { setTimeout(() => { s.writeHead(200); s.end('ok'); }, 20000); return; }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>C</title><script>alert('C')</script><body>c</body>`);
  if (u.pathname === '/xhr-inline') return s.end(`<!doctype html><title>D</title><script>var x=new XMLHttpRequest();x.open('GET','/slow',false);x.send();</script><body>d</body>`);
  return s.end(`<!doctype html><title>opener</title><body>opener</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('discr');
const cli = makeCli(root);
const dirs = [];
const results = [];
const outFile = path.join(here, 'discriminator.json');
const STATES = {
  A: `window.w=open('');w.alert('A')`,
  B: `window.w=open('');var x=new XMLHttpRequest();x.open('GET','/slow',false);x.send();`,
  C: `open(location.origin+'/alert-inline')`,
  D: `open(location.origin+'/xhr-inline')`,
};
async function timed(p, ms) {
  const t0 = Date.now(); let tm;
  try { const v = await Promise.race([p, new Promise((_, rej) => { tm = setTimeout(() => rej(new Error('__to')), ms); })]); return { r: 'ok', ms: Date.now() - t0, v }; }
  catch (e) { return { r: /__to|timed out/i.test(String(e.message)) ? 'TIMEOUT' : 'ERR', ms: Date.now() - t0, e: String(e.message).slice(0, 90) }; }
  finally { clearTimeout(tm); }
}
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const [st, js] of Object.entries(STATES)) {
      const cd = path.join(root.R, `${st}-${t}`);
      dirs.push(cd);
      await cli(['nav', `${BASE}/?n=${st}${t}`], cd, { capMs: 45000 });
      const s0 = await readState(cd);
      const b = await puppeteer.connect({ browserWSEndpoint: s0.wsEndpoint, defaultViewport: null });
      const opener = b.targets().find((x) => x.type() === 'page' && x.url().includes(`n=${st}${t}`));
      const os = await opener.createCDPSession();
      const before = new Set(b.targets().map(idOf));
      os.send('Runtime.evaluate', { expression: js, userGesture: true }).catch(() => {});
      await delay(2500);
      const pop = b.targets().find((x) => x.type() === 'page' && !before.has(idOf(x)));
      const row = { state: st, trial: t, popupFound: !!pop };
      if (pop) {
        const root2 = await b.target().createCDPSession();
        const pid = idOf(pop);
        row.targetInfo = await timed(root2.send('Target.getTargetInfo', { targetId: pid }).then((x) => x.targetInfo), 1500);
        const cpu0 = await timed(root2.send('SystemInfo.getProcessInfo'), 2000);
        const s = await pop.createCDPSession();
        const cmds = [
          ['Page.getNavigationHistory', {}], ['Page.captureScreenshot', { format: 'png' }], ['Page.handleJavaScriptDialog', { accept: false }],
          ['Performance.getMetrics', {}], ['Runtime.evaluate', { expression: '1' }], ['DOM.getDocument', {}], ['Page.getFrameTree', {}],
          ['Memory.getDOMCounters', {}], ['Page.getLayoutMetrics', {}], ['Network.enable', {}], ['Page.enable', {}],
        ];
        row.cmds = {};
        await Promise.all(cmds.map(async ([m, p]) => {
          const x = await timed(s.send(m, p), 1500);
          row.cmds[m] = `${x.r}${x.r === 'ERR' ? ':' + x.e : ''}/${x.ms}ms${m === 'Page.captureScreenshot' && x.v ? `/${x.v.data.length}b` : ''}${m === 'Page.getNavigationHistory' && x.v ? `/${x.v.entries.length}e:${x.v.entries.map((e) => e.url.replace(BASE, '')).join(',')}` : ''}`;
        }));
        await delay(1000);
        const cpu1 = await timed(root2.send('SystemInfo.getProcessInfo'), 2000);
        if (cpu0.v && cpu1.v) {
          const m0 = new Map(cpu0.v.processInfo.filter((p) => p.type === 'renderer').map((p) => [p.id, p.cpuTime]));
          row.rendererCpuDeltaSec = cpu1.v.processInfo.filter((p) => p.type === 'renderer').map((p) => +(p.cpuTime - (m0.get(p.id) ?? p.cpuTime)).toFixed(3));
        } else row.rendererCpuDeltaSec = cpu0.r + '/' + cpu1.r;
        row.targetInfo = row.targetInfo.v ? { url: row.targetInfo.v.url.replace(BASE, ''), title: row.targetInfo.v.title, attached: row.targetInfo.v.attached, canAccessOpener: row.targetInfo.v.canAccessOpener, openerFrameId: !!row.targetInfo.v.openerFrameId } : row.targetInfo;
      }
      results.push(row);
      console.log(JSON.stringify(row));
      await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
      await b.disconnect();
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
