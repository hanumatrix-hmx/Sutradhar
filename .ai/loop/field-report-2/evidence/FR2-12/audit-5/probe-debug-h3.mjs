// FR2-12 audit-5: step-logged debug of (a) the stale-own-status probe hang and (b) tracking-session detach accounting.
import fs from 'node:fs/promises';
import { loadRuntime, installCdpCounters, cdpStats, cdpSummary, startServer, chromePidOf, cap, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';
const OUT = outPath('probe-debug-h3.json');
const out = { steps: [] };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(300000, async () => { out.watchdog = true; await save(); });
await installCdpCounters();
const { SutradharRuntime } = await loadRuntime();
const { server, origin } = await startServer((req, res, u) => {
  if (u.pathname === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1>', 'nf'));
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  res.writeHead(200, H); res.end(html('<h1>ok</h1>'));
});
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const step = async (label, p, ms = 45000) => { const t0 = Date.now(); try { const r = await cap(p, ms, label); out.steps.push({ label, ms: Date.now() - t0, ok: true, r: r === undefined ? null : JSON.stringify(r).slice(0, 400) }); return r; } catch (e) { out.steps.push({ label, ms: Date.now() - t0, ok: false, err: String(e.message).slice(0, 300) }); return undefined; } finally { await save(); } };
const tabOf = (id) => runtime['resolveTab'](sid, id).tab;

// (b) detach accounting
const { id: tabId } = await runtime.createTab(sid);
await sleep(500);
const tab = tabOf(tabId);
out.trackerIsCounted = cdpStats.open.has(tab['commitTrackingCdpClient']);
out.trackerClass = tab['commitTrackingCdpClient']?.constructor?.name;
await step('closeTab', runtime.closeTab(sid, tabId));
out.afterClose = { ...cdpSummary(), trackerRef: tab['commitTrackingCdpClient'] === null ? 'null' : 'set' };

// (a) each stale-own-status step individually
const { id: t2 } = await runtime.createTab(sid);
await sleep(300);
for (const target of ['about:blank', 'data:text/html,<title>d</title><h1>data</h1>']) {
  await step(`nav own404 before ${target.slice(0, 10)}`, runtime.navigate(sid, `${origin}/own404?x=${target.length}`, t2));
  await step(`nav ${target.slice(0, 10)}`, runtime.navigate(sid, target, t2));
  await step(`state after ${target.slice(0, 10)}`, Promise.resolve({ commit: tabOf(t2).getLastMainFrameCommitAt(), resp: tabOf(t2).getLastMainDocumentResponse(), url: tabOf(t2).url }));
  const a = await step(`audit on ${target.slice(0, 10)}`, runtime.audit(sid, { tabId: t2 }));
  if (a) out.steps.push({ label: `result ${target.slice(0, 10)}`, url: a.url, brokenRequests: a.brokenRequests, covers: a.observation.coversWholeDocument });
  await save();
}
await step('nav own404 before neterror', runtime.navigate(sid, `${origin}/own404?n=1`, t2));
await step('nav neterror', runtime.navigate(sid, 'http://127.0.0.1:1/', t2));
await step('pending dialog?', Promise.resolve(runtime.getPendingDialog(sid, t2)));
const a3 = await step('audit on neterror', runtime.audit(sid, { tabId: t2 }));
if (a3) out.steps.push({ label: 'result neterror', url: a3.url, brokenRequests: a3.brokenRequests, covers: a3.observation.coversWholeDocument });
out.cdp = cdpSummary();
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out, null, 1).slice(0, 5000));
process.exit(0);
