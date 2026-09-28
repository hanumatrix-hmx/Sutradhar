// FR2-12 audit-6: after escalation-2 clears the tab capture on every bfcache restore, current-page
// own-status falls to the ring-buffer URL-match fallback. Characterize whether that fallback can
// attribute a LATER load's error status (same URL) to an earlier, healthy, bfcache-restored load.
// Sequence: /flaky (1st hit 200) -> /other -> /flaky (2nd hit 500) -> back -> back (restores the 200 load).
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, sleep, watchdog, killAll, outPath, cap, H, html } from './lib.mjs';
const TR = Number(process.argv[2] ?? '5');
const OUT = outPath('probe-a6-bfcache-urlmatch.json');
const out = { rows: [] };
const stopWd = watchdog(600000, async () => { out.watchdog = true; await fs.writeFile(OUT, JSON.stringify(out, null, 2)); });
const hitsBy = new Map();
const PS = '<script>window.__ps=[];addEventListener("pageshow",e=>window.__ps.push(e.persisted))</script>';
const { server, origin } = await startServer((req, res, u) => {
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/flaky') { const k = u.search; const n = (hitsBy.get(k) ?? 0) + 1; hitsBy.set(k, n); res.writeHead(n === 1 ? 200 : 500, H); return res.end(html(PS + '<h1>flaky ' + n + '</h1>')); }
  res.writeHead(200, H); res.end(html(PS + '<h1>other</h1>'));
});
const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
for (let t = 0; t < TR; t++) {
  const { id: tabId } = await runtime.createTab(sid);
  await sleep(800);
  await runtime.navigate(sid, `${origin}/flaky?t=${t}`, tabId); await sleep(200);
  await runtime.navigate(sid, `${origin}/other?t=${t}`, tabId); await sleep(200);
  await runtime.navigate(sid, `${origin}/flaky?t=${t}`, tabId); await sleep(200);
  await runtime.goBack(sid, tabId); await sleep(200);
  await runtime.goBack(sid, tabId); await sleep(300);
  const heading = await runtime.eval(sid, 'document.querySelector("h1").textContent + " " + JSON.stringify(window.__ps)', tabId);
  const a = await cap(runtime.audit(sid, { tabId }), 60000, 'a');
  out.rows.push({ heading, url: a.url, reported500: a.brokenRequests.some((b) => b.status === 500), covers: a.observation.coversWholeDocument, broken: a.brokenRequests });
  await runtime.closeTab(sid, tabId).catch(() => {});
}
out.summary = { n: out.rows.length, restoredHealthy200: out.rows.filter((r) => String(r.heading).includes('flaky 1')).length, false500: out.rows.filter((r) => r.reported500).length, coversTrue: out.rows.filter((r) => r.covers).length };
try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await fs.writeFile(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary), JSON.stringify(out.rows[0]));
process.exit(0);
