// FR2-12 audit-4: independent live repro of GAP-274 (Page.enable hang) against HEAD 2d69701.
// Based on audit-3's probe-hang.mjs (same server shapes, same sequences), plus:
//  - instrumentation that keeps timing each CDP send AFTER audit() returns (so we can see whether
//    the hang CONDITION occurred -- Page.enable slow -- even though audit() itself was bounded);
//  - dialog policy variants (auto = audit-3's default, report = fix-3's choice);
//  - contamination / own-status correctness checks on the degraded (bound-expired) path.
// Per-step cap 200s, whole-script watchdog 290s, Chrome killed by own PID only.
// Usage: node probe-hang4.mjs <order> [trials]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-4')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const ORDER = process.argv[2] ?? 'dialog-auto';
const TRIALS = Number(process.argv[3] ?? '1');
const OUT = path.join(here, `probe-hang4-${ORDER}${process.argv[4] ? '-' + process.argv[4] : ''}.json`);
const cap = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`CAP ${l} ${ms}ms`)), ms))]);
const hung = new Set();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/hang') { hung.add(res); return; }
  if (u.pathname === '/alertload') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>al</title><h1>alert</h1><script>setTimeout(function(){alert("a4-open")},100)</script></html>'); }
  if (u.pathname === '/alertnow') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>al</title><h1>alert</h1><script>alert("a4-open-sync")</script></html>'); }
  if (u.pathname === '/noisy') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>n</title><script>var i=0;setInterval(function(){i++;console.error("noisy-"+i)},25)</script></html>'); }
  if (u.pathname === '/okslow') { setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html lang=en><title>ok</title><h1>ok slow</h1></html>'); }, 400); return; }
  if (u.pathname === '/ok') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>ok</title><h1>ok</h1></html>'); }
  if (u.pathname === '/own404hash') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>nf</title><h1>nf</h1><script>location.hash="top"</script></html>'); }
  if (u.pathname === '/own404empty') { res.writeHead(404, { 'Content-Type': 'text/html', 'Content-Length': '0' }); return res.end(); }
  if (u.pathname === '/own404') { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><title>nf</title><h1>nf</h1></html>'); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { order: ORDER, trials: TRIALS, startedAt: new Date().toISOString(), steps: [], cdp: [] };
const pids = new Set();
const kill = () => { for (const pid of pids) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const wd = setTimeout(async () => { out.watchdog = true; await save(); kill(); process.exit(2); }, 290 * 1000);

let runtime, sid;
async function freshRuntime(policy) {
  if (runtime) { try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {} }
  runtime = new SutradharRuntime({});
  ({ sessionId: sid } = await runtime.launch({ launch: { headless: true } }));
  if (policy) runtime.setDialogPolicy(sid, { mode: policy });
  const page = runtime['requirePage'](runtime['resolveTab'](sid).tab);
  try { const p = page.browser().process()?.pid; if (p) pids.add(p); } catch {}
  const orig = page.createCDPSession.bind(page);
  page.createCDPSession = async () => {
    const t0 = Date.now(); const s = await orig();
    const rec = { createdAt: new Date(t0).toISOString(), createMs: Date.now() - t0, sends: {}, events: [] };
    out.cdp.push(rec);
    const send = s.send.bind(s), detach = s.detach.bind(s);
    s.send = (m, ...a) => { const t = Date.now(); const p = send(m, ...a); p.then(() => { rec.sends[m] = { ms: Date.now() - t, ok: true }; }, (e) => { rec.sends[m] = { ms: Date.now() - t, err: String(e?.message ?? e).slice(0, 120) }; }); rec.sends[m] = { pending: true, startedAt: t - t0 }; return p; };
    s.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) rec.events.push({ ev: 'frameNavigated', at: Date.now() - t0, url: e.frame.url }); });
    s.on('Network.responseReceived', (e) => { if (e.type === 'Document') rec.events.push({ ev: 'docResponse', at: Date.now() - t0, status: e.response.status, url: e.response.url }); });
    s.detach = async () => { const t = Date.now(); rec.detachAt = t - t0; try { await detach(); rec.detach = 'ok'; } catch (e) { rec.detach = 'err ' + e.message; throw e; } };
    return s;
  };
}
async function step(label, fn) {
  const t0 = Date.now();
  try { const r = await cap(fn(), 200000, label); out.steps.push({ label, ms: Date.now() - t0, ok: true, r }); }
  catch (e) { out.steps.push({ label, ms: Date.now() - t0, error: String(e.message ?? e).slice(0, 300) }); }
  await save();
}
const aud = (u) => async () => { const a = await runtime.audit(sid, { url: u }); return { url: a.url, broken: a.brokenRequests, consoleErrors: a.consoleErrors.length, sample: a.consoleErrors.slice(0, 3).map((e) => e.text), covers: a.observation.coversWholeDocument }; };
const nav = (u) => async () => { const r = await runtime.navigate(sid, u); return r.url; };
const openAlert = (route, n, wait = 600) => async () => { await runtime.navigate(sid, `${origin}/${route}?n=${n}`); await new Promise((r) => setTimeout(r, wait)); return runtime.getPendingDialog(sid) ?? null; };
const pageGotoTimeout = (u, ms) => async () => { const page = runtime['requirePage'](runtime['resolveTab'](sid).tab); try { await page.goto(u, { waitUntil: 'domcontentloaded', timeout: ms }); return 'loaded?!'; } catch (e) { return 'timeout: ' + String(e.message).slice(0, 80); } };

try {
  for (let t = 0; t < TRIALS; t++) {
    if (ORDER === 'dialog-auto' || ORDER === 'dialog-report') {
      await freshRuntime(ORDER === 'dialog-report' ? 'report' : undefined);
      await step(`t${t} open alertload`, openAlert('alertload', t));
      await step(`t${t} audit ok while alert open`, aud(`${origin}/ok?d${t}`));
      await step(`t${t} open alertload again`, openAlert('alertload', `${t}b`));
      await step(`t${t} audit own404hash while alert open`, aud(`${origin}/own404hash?d${t}`));
      await step(`t${t} open alertload again`, openAlert('alertload', `${t}c`));
      await step(`t${t} audit own404empty while alert open`, aud(`${origin}/own404empty?d${t}`));
      await step(`t${t} audit ok baseline`, aud(`${origin}/ok?base${t}`));
    } else if (ORDER === 'dialog-timing') {
      // vary when the alert opens relative to audit(): alert pending since {50, 600, 3000}ms
      await freshRuntime(t % 2 ? 'report' : undefined);
      for (const w of [50, 250, 600, 3000]) {
        await step(`t${t} ${t % 2 ? 'report' : 'auto'} alertnow wait${w}`, openAlert('alertnow', `${t}-${w}`, w));
        await step(`t${t} audit ok after wait${w}`, aud(`${origin}/ok?w${w}t${t}`));
      }
    } else if (ORDER === 'audit-first') {
      await freshRuntime();
      await step('audit hang#0 (expected nav timeout)', aud(`${origin}/hang?n=0`));
      await step('audit hang#1', aud(`${origin}/hang?n=1`));
      await step('audit ok', aud(`${origin}/ok`));
      await step('audit own404 after hang', aud(`${origin}/own404?x=1`));
      await step('audit ok 2', aud(`${origin}/ok?2`));
    } else if (ORDER === 'nav-timeout-then-audit') {
      await freshRuntime();
      for (let i = 0; i < 3; i++) {
        await step(`i${i} goto hang timeout 2000`, pageGotoTimeout(`${origin}/hang?i=${i}`, 2000));
        await step(`i${i} audit ok`, aud(`${origin}/ok?i=${i}`));
      }
      await step('runtime.navigate hang (30s timeout)', nav(`${origin}/hang?rt=1`));
      await step('audit ok after 30s nav timeout', aud(`${origin}/ok?rt=1`));
      await step('runtime.navigate hang (30s timeout) #2', nav(`${origin}/hang?rt=2`));
      await step('audit own404hash after 30s nav timeout', aud(`${origin}/own404hash?rt=2`));
    } else if (ORDER === 'hangcontam') {
      await freshRuntime();
      await step('nav noisy', nav(`${origin}/noisy?n=0`));
      await step('nav hang (times out; noisy page keeps running)', nav(`${origin}/hang?n=0`));
      await step('audit okslow (clean page)', aud(`${origin}/okslow?n=0`));
      await step('control: nav noisy', nav(`${origin}/noisy?n=1`));
      await step('control: audit okslow', aud(`${origin}/okslow?n=1`));
    }
  }
} finally {
  clearTimeout(wd);
  try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
  kill(); for (const r of hung) try { r.destroy(); } catch {}
  server.close();
  out.finishedAt = new Date().toISOString();
  await save();
  const brief = out.steps.map((s) => `${s.ms}ms ${s.label} ${s.error ? 'ERR ' + s.error : JSON.stringify(s.r)}`);
  console.log(brief.join('\n'));
  console.log('CDP:', out.cdp.map((c) => JSON.stringify({ s: c.sends, d: c.detach, ev: c.events.length })).join('\n'));
  process.exit(0);
}
