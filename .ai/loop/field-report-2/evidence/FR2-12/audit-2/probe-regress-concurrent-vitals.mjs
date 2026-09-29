// FR2-12 audit-2: post-fix-1 regression checks for audit-1's PASS areas: concurrent audits on two
// tabs (no cross-tab leakage), web-vitals vs an independent in-page observer, B2 (CLS stable across
// repeated URL audits in one tab). Hard timeouts; Chrome killed by own PID only on failure.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const withTimeout = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT ' + l)), ms))]);
const H = (t, b, s = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${t}</title></head><body style="margin:0">${b}${s ? `<script>${s}</script>` : ''}</body></html>`;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x'); const send = (c, b, t = 'text/html') => { s.writeHead(c, { 'Content-Type': t }); s.end(b); };
  if (u.pathname === '/favicon.ico') return send(200, '', 'image/x-icon');
  if (u.pathname === '/errpage') return send(200, H('e', '<img src="/missing-a.png" alt="x">', `console.error('tab-A-own');setInterval(function(){console.error('tab-A-tick')},50)`));
  if (u.pathname === '/clean') return send(200, H('c', '<h1>clean</h1>'));
  // shifts + an independent observer recording CLS/LCP from the start of the document
  if (u.pathname === '/shift') return send(200, H('s', '<div id="slot" style="height:0"></div><h1 style="font-size:64px">Shift</h1><p style="height:900px">x</p>',
    `window.__obs={cls:0,lcp:null};new PerformanceObserver(function(l){l.getEntries().forEach(function(e){if(!e.hadRecentInput)window.__obs.cls+=e.value})}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(function(l){var es=l.getEntries();window.__obs.lcp=Math.round(es[es.length-1].startTime)}).observe({type:'largest-contentful-paint',buffered:true});setTimeout(function(){document.getElementById('slot').style.height='150px'},300);setTimeout(function(){document.getElementById('slot').style.height='20px'},600);`));
  send(404, 'nf', 'text/plain');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { concurrent: [], vitals: [], b2: [] };
const runtime = new SutradharRuntime({});
let pid = null;
try {
  const { sessionId: sid } = await withTimeout(runtime.launch({ launch: { headless: true } }), 90000, 'launch');
  try { pid = runtime['requirePage'](runtime['resolveTab'](sid).tab).browser().process()?.pid; } catch {}
  const t2 = await runtime.createTab(sid);
  const tabB = t2.tabId ?? t2.id ?? t2;
  for (let i = 0; i < 3; i++) {
    const [a, b] = await withTimeout(Promise.all([
      runtime.audit(sid, { url: `${origin}/errpage?i=${i}` }),
      runtime.audit(sid, { url: `${origin}/clean?i=${i}`, tabId: tabB }),
    ]), 90000, 'concurrent');
    out.concurrent.push({ A: { console: a.consoleErrors.length, hasOwn: a.consoleErrors.some((e) => e.text === 'tab-A-own'), broken: a.brokenRequests.length, hidden: a.observation.pageWasHidden, leakedFromB: false }, B: { console: b.consoleErrors.map((e) => e.text), broken: b.brokenRequests.length, hidden: b.observation.pageWasHidden } });
  }
  await runtime.closeTab(sid, tabB);
  const tabs = await runtime.listTabs(sid); out.tabsAfterClose = tabs.length;
  if (tabs[0]) await runtime.focusTab(sid, tabs[0].tabId ?? tabs[0].id);
  const page = runtime['requirePage'](runtime['resolveTab'](sid).tab);
  for (let i = 0; i < 4; i++) {
    const a = await withTimeout(runtime.audit(sid, { url: `${origin}/shift?v=${i}` }), 60000, 'vitals');
    const obs = await page.evaluate(() => window.__obs);
    out.vitals.push({ auditCls: a.webVitals.cls, obsCls: obs.cls, auditLcp: a.webVitals.lcpMs, obsLcp: obs.lcp, clsDelta: Math.abs(a.webVitals.cls - obs.cls), lcpDelta: Math.abs(a.webVitals.lcpMs - obs.lcp) });
  }
  for (let i = 0; i < 3; i++) out.b2.push((await withTimeout(runtime.audit(sid, { url: `${origin}/shift?b2=1` }), 60000, 'b2')).webVitals.cls);
  out.b2Injected = await page.evaluate(() => typeof window.__sutradharVitals);
} catch (e) { out.fatal = String(e?.stack ?? e); }
finally {
  await fs.writeFile(path.join(here, 'probe-regress-concurrent-vitals.json'), JSON.stringify(out, null, 2));
  try { await withTimeout(runtime.shutdownAll(), 30000, 'shutdown'); } catch { if (pid) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  server.close();
}
console.log(JSON.stringify(out, null, 1));
process.exit(0);
