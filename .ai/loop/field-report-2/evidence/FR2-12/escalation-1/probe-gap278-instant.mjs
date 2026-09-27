// FR2-12 escalation-1: instant-response-time (d=0) sub-case of GAP-278's repro -- audit-4 found
// this was the LOWEST leak rate before the fix (4/10 runtime), so it's the hardest case to prove
// clean. Runtime-direct only (MCP already covered by probe-gap278-fix.mjs), 15 trials.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const OUT = path.join(here, 'probe-gap278-instant-results.json');
const cap = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`CAP ${l} ${ms}ms`)), ms))]);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const H = { 'Content-Type': 'text/html' };
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/noisy') { res.writeHead(200, H); return res.end(`<html lang=en><title>noisy</title><script>setInterval(function(){console.error("OLDPAGE-err");fetch("/oldpage-missing-"+Math.random())},20)</script></html>`); }
  if (u.pathname === '/clean') { res.writeHead(200, H); return res.end('<html lang=en><title>clean</title><h1>clean</h1></html>'); }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { origin, currentPage: [] };
const pids = new Set();
const killAll = () => { for (const p of pids) try { execFileSync('taskkill', ['/PID', String(p), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
const wd = setTimeout(async () => { await fs.writeFile(OUT, JSON.stringify({ ...out, watchdog: true }, null, 2)); killAll(); process.exit(2); }, 280 * 1000);
const leak = (a) => ({ oldConsole: a.consoleErrors.filter((e) => e.text.includes('OLDPAGE')).length, oldBroken: a.brokenRequests.filter((b) => b.url.includes('oldpage-missing')).length, covers: a.observation.coversWholeDocument });
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
try { const p = runtime['requirePage'](runtime['resolveTab'](sid).tab).browser().process()?.pid; if (p) pids.add(p); } catch {}
for (let t = 0; t < 15; t++) {
  await runtime.navigate(sid, `${origin}/noisy?t=${t}`); await new Promise((r) => setTimeout(r, 400));
  await runtime.navigate(sid, `${origin}/clean?t=${t}`); // instant response
  out.currentPage.push(leak(await cap(runtime.audit(sid, {}), 60000, 'cp')));
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
}
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
clearTimeout(wd); killAll(); server.close();
await fs.writeFile(OUT, JSON.stringify(out, null, 2));
const leaked = out.currentPage.filter((x) => x.oldConsole > 0 || x.oldBroken > 0).length;
console.log(`instant-response current-page: ${leaked}/${out.currentPage.length} leaked`);
process.exit(0);
