// FR2-12 audit-4: GAP-273 re-verification + new attacks, via runtime.audit (dist) and the real CLI.
// Usage: node probe-273.mjs <runtimeTrials> <cliTrials> [quick]
// Watchdog 1300s. Chrome killed by own PID only; CLI children get TEMP/TMP pointed at an audit-4-owned
// temp dir so any leftover Chrome is identifiable by command line; that dir is removed at the end.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-4')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const CLI = path.join(root, 'packages', 'cli', 'dist', 'cli.js');
const RT = Number(process.argv[2] ?? '10');
const CT = Number(process.argv[3] ?? '10');
const QUICK = process.argv[4] === 'quick';
const OUT = path.join(here, QUICK ? `probe-273-quick-${process.argv[5] ?? 'x'}.json` : 'probe-273.json');
const TMPROOT = await fs.mkdtemp(path.join(os.tmpdir(), 'fr212-audit4-'));
const cap = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`CAP ${l} ${ms}ms`)), ms))]);
const html = (body, title = 't') => `<html lang=en><head><title>${title}</title></head><body>${body}</body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const H = { 'Content-Type': 'text/html' };
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/ok') { res.writeHead(200, H); return res.end(html('<h1>ok</h1>')); }
  if (p === '/h404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1><script>location.hash="top"</script>')); }
  if (p === '/rs404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1><script>history.replaceState(null,"","/rewritten-"+Math.random())</script>')); }
  if (p === '/e404') { res.writeHead(404, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/e500') { res.writeHead(500, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/own404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1>')); }
  // (a) redirect, then same-document nav after landing
  if (p === '/r302-rs404') { res.writeHead(302, { Location: '/rs404?from=r' }); return res.end(); }
  if (p === '/r302-h404') { res.writeHead(302, { Location: '/h404?from=r' }); return res.end(); }
  if (p === '/r302-ok-rs') { res.writeHead(302, { Location: '/ok-rs' }); return res.end(); }
  if (p === '/ok-rs') { res.writeHead(200, H); return res.end(html('<h1>ok</h1><script>history.replaceState(null,"","/ok-rs-rewritten")</script>')); }
  // JS redirect from a 200 page to a 404 page that then sets a hash
  if (p === '/js200-to-h404') { res.writeHead(200, H); return res.end(html('<script>location.replace("/h404?from=js")</script>')); }
  // JS redirect FROM a 404 page TO a 200 page (final doc is 200)
  if (p === '/js404-to-ok') { res.writeHead(404, H); return res.end(html('<script>location.replace("/ok?from=js404")</script>')); }
  // (b) slow / large main doc
  if (p === '/slow404') { res.writeHead(404, H); res.write('<html lang=en><title>s</title><body><h1>slow</h1>' + ' '.repeat(4096)); setTimeout(() => res.end('</body></html>'), 2500); return; }
  if (p === '/big404') { res.writeHead(404, H); return res.end(html('<h1>big</h1><!--' + 'x'.repeat(5 * 1024 * 1024) + '-->')); }
  if (p === '/slowhdr500') { setTimeout(() => { res.writeHead(500, H); res.end(html('<h1>late 500</h1>')); }, 1200); return; }
  // (c) intermediate hop is itself an error
  if (p === '/c1') { res.writeHead(302, { Location: '/mid500' }); return res.end(); }
  if (p === '/mid500') { res.writeHead(500, H); return res.end(html('<script>location.replace("/c2")</script>')); }
  if (p === '/c2') { res.writeHead(302, { Location: '/ok?from=chain' }); return res.end(); }
  if (p === '/d1') { res.writeHead(302, { Location: '/midb500' }); return res.end(); }
  if (p === '/midb500') { res.writeHead(500, H); return res.end(html('<script>location.replace("/d2")</script>')); }
  if (p === '/d2') { res.writeHead(302, { Location: '/own404?from=chain' }); return res.end(); }
  // main 200 with a 404 iframe (subframe Document response must not become the own-status)
  if (p === '/ok-iframe404') { res.writeHead(200, H); return res.end(html('<iframe src="/e404?frame=1"></iframe>')); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

// expect: exact set of statuses in brokenRequests that must appear (must) / must not appear (mustNot)
const SHAPES = [
  { name: 'hash-404', path: '/h404', must: [404] },
  { name: 'replaceState-404', path: '/rs404', must: [404] },
  { name: 'emptybody-404', path: '/e404', must: [404] },
  { name: 'emptybody-500', path: '/e500', must: [500] },
  { name: 'control-own404', path: '/own404', must: [404] },
  { name: 'control-ok', path: '/ok', must: [], mustNot: [404, 500] },
  { name: 'a-302-then-replaceState-404', path: '/r302-rs404', must: [404], urlIncludes: '/rs404?from=r' },
  { name: 'a-302-then-hash-404', path: '/r302-h404', must: [404], urlIncludes: '/h404?from=r' },
  { name: 'a-302-then-replaceState-200', path: '/r302-ok-rs', must: [], mustNot: [302, 404, 500] },
  { name: 'a-js200-to-hash404', path: '/js200-to-h404', must: [404], urlIncludes: '/h404?from=js' },
  { name: 'a-js404-to-200', path: '/js404-to-ok', must: [], note: 'final doc is 200; a reported 404 is the pre-redirect doc' },
  { name: 'b-slow-body-404', path: '/slow404', must: [404] },
  { name: 'b-5MB-body-404', path: '/big404', must: [404] },
  { name: 'b-slow-headers-500', path: '/slowhdr500', must: [500] },
  { name: 'c-302>500(js)>302>200', path: '/c1', must: [], note: 'intermediate 500 hop' },
  { name: 'c-302>500(js)>302>404', path: '/d1', must: [404], urlIncludes: '/own404?from=chain' },
  { name: 'subframe-emptybody-404', path: '/ok-iframe404', must: [], note: 'iframe 404 may appear as a subresource; must not be own-status for main' },
];
const QUICK_SHAPES = new Set(['hash-404', 'emptybody-404', 'a-302-then-hash-404', 'a-js200-to-hash404', 'control-ok']);
const shapes = QUICK ? SHAPES.filter((s) => QUICK_SHAPES.has(s.name)) : SHAPES;

function judge(shape, broken, finalUrl) {
  const statuses = broken.map((b) => b.status);
  const okMust = shape.must.every((s) => statuses.includes(s));
  const okNot = (shape.mustNot ?? []).every((s) => !statuses.includes(s));
  let okUrl = true;
  if (shape.urlIncludes) okUrl = broken.some((b) => b.url.includes(shape.urlIncludes) && shape.must.includes(b.status));
  return okMust && okNot && okUrl;
}
const out = { runtime: {}, cli: {}, samples: {} };
const pids = new Set();
const kids = new Set();
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
async function cleanup() {
  for (const k of kids) try { execFileSync('taskkill', ['/PID', String(k.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  for (const pid of pids) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}
const wd = setTimeout(async () => { out.watchdog = true; await save(); await cleanup(); process.exit(2); }, 1300 * 1000);

// ---- runtime.audit
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
try { const pg = runtime['requirePage'](runtime['resolveTab'](sid).tab); const p = pg.browser().process()?.pid; if (p) pids.add(p); } catch {}
for (const s of shapes) out.runtime[s.name] = { pass: 0, n: 0, fails: [] };
for (let t = 0; t < RT; t++) {
  for (const s of shapes) {
    const r = out.runtime[s.name]; r.n++;
    try {
      const a = await cap(runtime.audit(sid, { url: `${origin}${s.path}${s.path.includes('?') ? '&' : '?'}t=${t}` }), 60000, s.name);
      const ok = judge(s, a.brokenRequests, a.url);
      if (ok) r.pass++; else r.fails.push({ t, url: a.url, broken: a.brokenRequests });
      if (t === 0) out.samples[s.name] = { url: a.url, broken: a.brokenRequests };
    } catch (e) { r.fails.push({ t, error: String(e.message).slice(0, 200) }); }
  }
  await save();
}
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}

// ---- CLI --json (4 GAP-273 shapes + redirect-then-samedoc)
const CLI_SHAPES = shapes.filter((s) => ['hash-404', 'replaceState-404', 'emptybody-404', 'emptybody-500', 'a-302-then-hash-404'].includes(s.name));
function runCli(args, env, ms = 90000) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, cwd: TMPROOT });
    kids.add(cp);
    let so = '', se = '';
    cp.stdout.on('data', (d) => (so += d)); cp.stderr.on('data', (d) => (se += d));
    const t = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }, ms);
    cp.on('exit', (code) => { clearTimeout(t); kids.delete(cp); resolve({ code, so, se }); });
  });
}
for (const s of CLI_SHAPES) out.cli[s.name] = { pass: 0, n: 0, oneDoc: 0, fails: [] };
for (let t = 0; t < CT; t++) {
  for (const s of CLI_SHAPES) {
    const r = out.cli[s.name]; r.n++;
    const sd = path.join(TMPROOT, `st-${s.name}-${t}`);
    const tmp = path.join(TMPROOT, 'tmp'); await fs.mkdir(tmp, { recursive: true });
    const env = { SUTRADHAR_CLI_STATE_DIR: sd, TEMP: tmp, TMP: tmp };
    const res = await runCli(['audit', `${origin}${s.path}?cli=${t}`, path.join(TMPROOT, 'o'), '--json'], env);
    let parsed = null; try { parsed = JSON.parse(res.so); r.oneDoc++; } catch {}
    const ok = parsed && judge(s, parsed.brokenRequests ?? [], parsed.url);
    if (ok) r.pass++; else r.fails.push({ t, code: res.code, so: res.so.slice(0, 300), se: res.se.slice(0, 300) });
    await runCli(['close'], env, 30000);
  }
  await save();
}
clearTimeout(wd);
await cleanup();
server.close();
try { await fs.rm(TMPROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); out.tmpRemoved = true; } catch (e) { out.tmpRemoved = 'ERR ' + e.message + ' ' + TMPROOT; }
await save();
for (const k of ['runtime', 'cli']) for (const [n, r] of Object.entries(out[k])) console.log(k, n, `${r.pass}/${r.n}`, r.fails.length ? JSON.stringify(r.fails[0]).slice(0, 300) : '');
process.exit(0);
