// FR2-12 audit-6: attribution control for the fresh-tab own-status drop. Runs the same
// createTab -> immediate navigate -> audit() shapes with lib5's emulatePreFix() applied (BrowserTab's
// escalation-1 getters forced to null => current-page scoping falls back to documentStartedAt, i.e.
// fix-3-era behaviour). If the own 4xx/5xx is reported here but dropped on the real build, the drop is
// introduced by escalation-1's commit-time current-page scoping (GAP-278 fix), not pre-existing.
import fs from 'node:fs/promises';
import { loadRuntime, emulatePreFix, startServer, chromePidOf, cap, sleep, watchdog, killAll, outPath, H, html } from './lib5.mjs';
const TR = Number(process.argv[2] ?? '5');
const PREFIX = process.argv[3] === 'prefix';
const OUT = outPath(`probe-a6-freshtab-${PREFIX ? 'prefix' : 'current'}.json`);
const out = { prefixEmulated: PREFIX, rows: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(900000, async () => { out.watchdog = true; await save(); });
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/h404') return res.writeHead(404, H), res.end(html('<h1>nf</h1><script>location.hash="top"</script>'));
  if (p === '/e404') { res.writeHead(404, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/e500') { res.writeHead(500, { ...H, 'Content-Length': '0' }); return res.end(); }
  res.writeHead(200, H); res.end(html('<h1>ok</h1>'));
});
if (PREFIX) out.patched = await emulatePreFix();
const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
for (let t = 0; t < TR; t++) {
  for (const p of ['/h404', '/e404', '/e500']) {
    const { id: tabId } = await runtime.createTab(sid);
    try { await runtime.navigate(sid, `${origin}${p}?t=${t}`, tabId); } catch {}
    await sleep(400);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 'a');
    (out.rows[p] ??= []).push({ own: a.brokenRequests.some((b) => b.url.includes(p)), covers: a.observation.coversWholeDocument, url: a.url, broken: a.brokenRequests, nConsole: a.consoleErrors.length });
    await runtime.closeTab(sid, tabId).catch(() => {});
  }
  await save();
}
out.summary = Object.fromEntries(Object.entries(out.rows).map(([k, v]) => [k, { n: v.length, ownReported: v.filter((x) => x.own).length, coversTrue: v.filter((x) => x.covers).length }]));
try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out.summary));
process.exit(0);
