// FR2-12 audit-5: ONE GAP-274 hang measurement per process (spawned fresh by probe-hang-fresh.mjs so the
// ESM module cache can never serve a stale runtime.js -- the fix-3 mistake audit-4 found).
// Usage: node probe-hang-child.mjs <case> <outFile>. case: dialog | navtimeout
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, cap, sleep, killAll, outPath, H, html } from './lib.mjs';
const CASE = process.argv[2];
const OUT = outPath(process.argv[3]);
const hung = new Set();
const { server, origin } = await startServer((req, res, u) => {
  if (u.pathname === '/hang') { hung.add(res); return; }
  if (u.pathname === '/alertload') return res.writeHead(200, H), res.end(html('<script>setTimeout(function(){alert("hang-probe")},100)</script>'));
  if (u.pathname === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1><script>location.hash="top"</script>'));
  res.writeHead(200, H); res.end(html('<h1>ok</h1>'));
});
const out = { case: CASE, pid: process.pid };
const { SutradharRuntime } = await loadRuntime();
out.boundInLoadedModule = (await fs.readFile(new URL('../../../../../../packages/capability-runtime/dist/runtime.js', import.meta.url), 'utf8')).match(/AUDIT_CDP_SETUP_BOUND_MS = (\d+)/)?.[1];
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
try {
  if (CASE === 'dialog') {
    await runtime.navigate(sid, `${origin}/alertload`);
    for (let i = 0; i < 40 && !runtime.getPendingDialog(sid); i++) await sleep(50);
    out.pendingAtStart = !!runtime.getPendingDialog(sid);
  } else {
    const t = Date.now();
    try { await runtime.navigate(sid, `${origin}/hang`); } catch (e) { out.navErr = e.message.slice(0, 80); }
    out.navMs = Date.now() - t;
  }
  const t0 = Date.now();
  let a = null;
  try { a = await cap(runtime.audit(sid, { url: `${origin}/own404?x=1` }), 280000, 'audit'); } catch (e) { out.auditErr = e.message.slice(0, 200); }
  out.auditMs = Date.now() - t0;
  out.own404Reported = a ? a.brokenRequests.some((b) => b.status === 404) : null;
} finally {
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  for (const r of hung) try { r.destroy(); } catch {}
  try { await cap(runtime.shutdownAll(), 20000, 'sd'); } catch {}
  killAll(); server.close();
}
process.exit(0);
