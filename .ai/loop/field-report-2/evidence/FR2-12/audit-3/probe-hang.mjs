// FR2-12 audit-3: why does audit() on a hung main document exceed 70s? Instrument fix-2's dedicated
// CDP session (create / Page.enable / detach) and compare against plain runtime.navigate on the
// same shapes. Per-step hard cap 200s; watchdog 20 min; Chrome killed by own PID only.
// Usage: node probe-hang.mjs <order>   order: audit-first | nav-first
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-3')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const ORDER = process.argv[2] ?? 'audit-first';
const OUT = path.join(here, `probe-hang-${ORDER}.json`);
const cap = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`CAP ${l} ${ms}ms`)), ms))]);
const hung = new Set();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/hang') { hung.add(res); return; }
  if (u.pathname === '/hang-404-body') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.write('<html><body><h1>partial'); hung.add(res); return; }
  if (u.pathname === '/hangimg') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>hi</title><h1>loads, but an image never finishes</h1><img src="/hang?img=1" alt=x><script>console.error("hangimg-own")</script></html>'); }
  if (u.pathname === '/stream') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('<html lang=en><title>st</title><h1>streaming</h1><script>console.error("stream-own")</script>' + ' '.repeat(2048)); hung.add(res); return; }
  if (u.pathname === '/alertload') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>al</title><h1>alert</h1><script>setTimeout(function(){alert("a3-open")},100)</script></html>'); }
  if (u.pathname === '/noisy') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>n</title><script>var i=0;setInterval(function(){i++;console.error("noisy-"+i)},25)</script></html>'); }
  if (u.pathname === '/okslow') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html lang=en><title>ok</title><h1>ok slow</h1></html>'); }, 400); return; }
  if (u.pathname === '/ok') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>ok</title><h1>ok</h1></html>'); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { order: ORDER, steps: [], cdp: [] };
let pid = null;
const kill = () => { if (pid) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
const wd = setTimeout(async () => { out.watchdog = true; await fs.writeFile(OUT, JSON.stringify(out, null, 2)); kill(); process.exit(2); }, 20 * 60 * 1000);
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
const page = runtime['requirePage'](runtime['resolveTab'](sid).tab);
try { pid = page.browser().process()?.pid ?? null; } catch {}
const orig = page.createCDPSession.bind(page);
page.createCDPSession = async () => {
  const t0 = Date.now(); const s = await orig(); const rec = { createMs: Date.now() - t0 }; out.cdp.push(rec);
  const send = s.send.bind(s), detach = s.detach.bind(s);
  s.send = async (m, ...a) => { const t = Date.now(); try { return await send(m, ...a); } finally { rec[`send ${m} ms`] = Date.now() - t; } };
  s.detach = async () => { const t = Date.now(); rec.detachStarted = new Date().toISOString(); try { await detach(); rec.detach = 'ok'; } catch (e) { rec.detach = 'err ' + e.message; throw e; } finally { rec.detachMs = Date.now() - t; } };
  return s;
};
async function step(label, fn) {
  const t0 = Date.now();
  try { const r = await cap(fn(), 200000, label); out.steps.push({ label, ms: Date.now() - t0, ok: true, r }); }
  catch (e) { out.steps.push({ label, ms: Date.now() - t0, error: String(e.message ?? e) }); }
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
}
const aud = (u) => async () => { const a = await runtime.audit(sid, { url: u }); return { url: a.url, broken: a.brokenRequests.length, consoleErrors: a.consoleErrors.length, sample: a.consoleErrors.slice(0, 2).map((e) => e.text), covers: a.observation.coversWholeDocument }; };
const nav = (u) => async () => { const r = await runtime.navigate(sid, u); return r.url; };
try {
  const seq = ORDER === 'audit-first'
    ? [['audit hang#0', aud(`${origin}/hang?n=0`)], ['audit hang#1', aud(`${origin}/hang?n=1`)], ['audit ok', aud(`${origin}/ok`)], ['audit 404-partial#0', aud(`${origin}/hang-404-body?n=0`)], ['audit ok 2', aud(`${origin}/ok?2`)]]
    : ORDER === 'hangcontam'
    ? [['nav noisy', nav(`${origin}/noisy?n=0`)], ['nav hang (times out; noisy page keeps running)', nav(`${origin}/hang?n=0`)], ['audit okslow (clean page)', aud(`${origin}/okslow?n=0`)],
       ['control: nav noisy', nav(`${origin}/noisy?n=1`)], ['control: audit okslow', aud(`${origin}/okslow?n=1`)]]
    : ORDER === 'dialog'
    ? [['nav alertload#0', async () => { await runtime.navigate(sid, `${origin}/alertload?n=0`); await new Promise((r) => setTimeout(r, 600)); return runtime.getPendingDialog(sid) ?? null; }], ['audit ok while alert open', aud(`${origin}/ok?d0`)],
       ['nav alertload#1', async () => { await runtime.navigate(sid, `${origin}/alertload?n=1`); await new Promise((r) => setTimeout(r, 600)); return runtime.getPendingDialog(sid) ?? null; }], ['plain nav ok while alert open', nav(`${origin}/ok?d1`)],
       ['audit ok baseline', aud(`${origin}/ok?d2`)]]
    : ORDER === 'loading'
    ? [['audit hangimg#0', aud(`${origin}/hangimg?n=0`)], ['audit hangimg#1', aud(`${origin}/hangimg?n=1`)], ['audit ok after hangimg', aud(`${origin}/ok?a`)], ['nav stream', nav(`${origin}/stream?n=0`)], ['audit ok after stream', aud(`${origin}/ok?b`)], ['audit ok 3', aud(`${origin}/ok?c`)]]
    : [['nav hang#0', nav(`${origin}/hang?n=0`)], ['nav hang#1', nav(`${origin}/hang?n=1`)], ['nav ok', nav(`${origin}/ok`)], ['nav 404-partial#0', nav(`${origin}/hang-404-body?n=0`)], ['nav ok 2', nav(`${origin}/ok?2`)]];
  for (const [l, f] of seq) await step(l, f);
} finally {
  clearTimeout(wd);
  try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
  kill(); for (const r of hung) try { r.destroy(); } catch {}
  server.close();
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
