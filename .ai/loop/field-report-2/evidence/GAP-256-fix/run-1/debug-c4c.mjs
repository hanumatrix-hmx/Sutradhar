// Debug: after `closetab <holder>` (browser-level, from the CLI process) does the WARDEN's own view
// of the browser drop the closed popup? Polls the warden's real HTTP API + an independent
// Target.getTargets read at several delays.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { makeRoot, delay, cleanupRoot, here, CLI_DEFAULT, readState, readWarden, puppeteer, spawnedPids, taskkill } from './lib.mjs';

let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html' });
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>inline</title><script>alert('inline')</script><body>inline</body>`);
  if (u.pathname === '/type-two-popups') return s.end(`<!doctype html><title>type</title><body><input id="in"><script>let k=0;document.getElementById('in').addEventListener('keydown',()=>{k++;open('http://localhost:${PORT}/'+(k===1?'?n=first-innocent':'alert-inline?n=second-holder'));});</script></body>`);
  return s.end('<!doctype html><title>p</title>p');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
const root = await makeRoot('dbg');
const dir = path.join(root.R, 's0');
function runCli(args, capMs = 45000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [CLI_DEFAULT, ...args], { env: { ...process.env, TEMP: root.TEMP, TMP: root.TEMP, SUTRADHAR_CLI_STATE_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    spawnedPids.add(child.pid);
    let out = '', err = '', killed = false;
    child.stdout.on('data', (x) => (out += x)); child.stderr.on('data', (x) => (err += x));
    const cap = setTimeout(() => { killed = true; taskkill(child.pid); }, capMs);
    child.on('exit', (code) => { clearTimeout(cap); spawnedPids.delete(child.pid); resolve({ args: args.join(' ').replace(BASE, '<B>'), code, ms: Math.round(performance.now() - t0), out: out.trim(), err: err.trim() }); });
  });
}
const log = [];
async function wardenView() {
  const w = await readWarden(dir);
  const r = await fetch(`http://127.0.0.1:${w.port}/v1/dialogs`, { headers: { authorization: `Bearer ${w.token}` } }).then((x) => x.json());
  return { dialogs: r.dialogs.map((d) => `${d.type}:${d.targetId.slice(0,6)}:${d.url.slice(-22)}`), crashed: r.crashed };
}
async function liveT() {
  const st = await readState(dir);
  const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  try { return (await b._connection.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page').map((t) => t.targetId.slice(0,6) + ':' + t.url.slice(-22)); } finally { await b.disconnect().catch(() => {}); }
}
try {
  await runCli(['nav', `${BASE}/type-two-popups`]);
  await runCli(['type', '#in', 'ab']);
  await delay(1200);
  log.push({ step: 'before', warden: await wardenView(), live: await liveT() });
  const tabs = await runCli(['tabs']);
  const id = /([0-9A-F]{32})\s+inline/i.exec(tabs.out)?.[1];
  log.push({ step: 'tabs', code: tabs.code, id });
  const cl = await runCli(['closetab', id]);
  log.push({ step: 'closetab', code: cl.code, out: cl.out });
  for (const d of [0, 1000, 3000]) {
    await delay(d);
    log.push({ step: `after+${d}`, warden: await wardenView(), live: await liveT() });
  }
  await runCli(['close'], 30000);
} catch (e) { log.push({ error: String(e?.stack ?? e) }); }
finally {
  await fs.writeFile(path.join(here, 'debug-c4c.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify(log, null, 1));
  server.close();
  console.log('leftovers', JSON.stringify(await cleanupRoot(root, (a, d, o) => runCli(a, 20000), [dir])));
  process.exit(0);
}
