// FR2-12 escalation-1: live re-run of audit-4's own GAP-278 repro (probe-b1-currentpage.mjs),
// AFTER the fix, at the two REALISTIC response times audit-4 named (150ms, 800ms), through BOTH
// the runtime directly AND the real MCP tool (browser.audit) over stdio. Own copy in this
// round's own evidence dir per the loop's standing rule -- audit-4's original probe/output are
// never touched. Watchdog 500s; Chrome/MCP killed by own PID only (never by image name).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/escalation-1')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const OUT = path.join(here, 'probe-gap278-fix-results.json');
const TR = Number(process.argv[2] ?? '5');
const cap = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`CAP ${l} ${ms}ms`)), ms))]);
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const H = { 'Content-Type': 'text/html' };
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/noisy') { res.writeHead(200, H); return res.end(`<html lang=en><title>noisy</title><script>setInterval(function(){console.error("OLDPAGE-err");fetch("/oldpage-missing-"+Math.random())},20)</script></html>`); }
  if (u.pathname === '/clean') { const d = Number(u.searchParams.get('d') ?? 0); setTimeout(() => { res.writeHead(200, H); res.end('<html lang=en><title>clean</title><h1>clean</h1></html>'); }, d); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { origin, runtime: {}, mcp: {} };
const pids = new Set();
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const killAll = () => { for (const p of pids) try { execFileSync('taskkill', ['/PID', String(p), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
const wd = setTimeout(async () => { out.watchdog = true; await save(); killAll(); process.exit(2); }, 500 * 1000);
const leak = (a) => ({ oldConsole: a.consoleErrors.filter((e) => e.text.includes('OLDPAGE')).length, oldBroken: a.brokenRequests.filter((b) => b.url.includes('oldpage-missing')).length, covers: a.observation.coversWholeDocument });

const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
try { const p = runtime['requirePage'](runtime['resolveTab'](sid).tab).browser().process()?.pid; if (p) pids.add(p); } catch {}
for (const d of [150, 800]) {
  out.runtime[`d${d}`] = { currentPage: [] };
  for (let t = 0; t < TR; t++) {
    await runtime.navigate(sid, `${origin}/noisy?t=${t}`); await new Promise((r) => setTimeout(r, 400));
    await runtime.navigate(sid, `${origin}/clean?d=${d}&t=${t}`);
    out.runtime[`d${d}`].currentPage.push(leak(await cap(runtime.audit(sid, {}), 60000, 'cp')));
    await save();
  }
}
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}

// MCP over stdio: browser.navigate x2 then browser.audit (no url)
const mcpEntry = path.join(root, 'packages', 'mcp-server', 'dist', 'cli.js');
try {
  await fs.access(mcpEntry);
  const cp = spawn(process.execPath, [mcpEntry], { stdio: ['pipe', 'pipe', 'pipe'] });
  pids.add(cp.pid);
  let buf = ''; const waiters = new Map(); let id = 0;
  cp.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch {} } });
  const rpc = (method, params) => new Promise((resolve) => { const i = ++id; waiters.set(i, resolve); cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args) => { const r = await cap(rpc('tools/call', { name, arguments: args }), 90000, name); return r.result; };
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'escalation1', version: '0' } });
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const launched = await call('browser.launch', { headless: true });
  const txt = launched.content[0].text; const msid = (txt.match(/sess_[0-9_]+/) || [])[0];
  out.mcp.sessionId = msid;
  for (const d of [150, 800]) {
    out.mcp[`d${d}`] = [];
    for (let t = 0; t < TR; t++) {
      await call('browser.navigate', { sessionId: msid, url: `${origin}/noisy?m=${t}` }); await new Promise((r) => setTimeout(r, 400));
      await call('browser.navigate', { sessionId: msid, url: `${origin}/clean?d=${d}&m=${t}` });
      const r = await call('browser.audit', { sessionId: msid, includeImages: false });
      try { out.mcp[`d${d}`].push(leak(JSON.parse(r.content[0].text))); } catch (e) { out.mcp[`d${d}`].push({ err: String(r?.content?.[0]?.text ?? e).slice(0, 200) }); }
      await save();
    }
  }
  try { await call('browser.shutdown', { sessionId: msid }); } catch {}
  cp.stdin.end();
  await new Promise((r) => setTimeout(r, 1500));
} catch (e) { out.mcp.error = String(e.message ?? e); }
clearTimeout(wd); killAll(); server.close(); await save();
const sum = (arr) => `${arr.filter((x) => x.oldConsole > 0 || x.oldBroken > 0).length}/${arr.length} leaked`;
for (const [k, v] of Object.entries(out.runtime)) console.log('runtime', k, 'current-page', sum(v.currentPage), JSON.stringify(v.currentPage[0]));
for (const [k, v] of Object.entries(out.mcp)) if (Array.isArray(v)) console.log('mcp current-page', k, sum(v), JSON.stringify(v[0]));
if (out.mcp.error) console.log('mcp error', out.mcp.error);
process.exit(0);
