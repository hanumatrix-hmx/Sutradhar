// FR2-04 audit-5: diagnose why the pure-CLI xhr-after-open repro (cli-repro-probe.mjs) never lists
// the popup as blocked. After a real CLI `click`, a raw CDP connection (no auto-attach, so it never
// pauses anything) lists every page target with its opener and probes Performance.getMetrics.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, delay, cleanupRoot, here } from './lib.mjs';

const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/slow') { setTimeout(() => { s.writeHead(200); s.end('/?n=popup-target'); }, 12000); return; }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/xhr') return s.end(`<!doctype html><title>x</title><body><button id="b" onclick="window.w=open('');setTimeout(()=>{var x=new XMLHttpRequest();x.open('GET','/slow',false);x.send();w.location=x.responseText;},100);">go</button></body>`);
  return s.end('<!doctype html><title>p</title><body>p</body>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('diag');
const cli = makeCli(root);
const out = [];
const cd = path.join(root.R, 'd');
try {
  for (let t = 0; t < 2; t++) {
    const dir = `${cd}${t}`;
    await cli(['nav', `${BASE}/xhr?t=${t}`], dir);
    const clickR = await cli(['click', '#b'], dir);
    const st = await readState(dir);
    const ws = new WebSocket(st.wsEndpoint);
    await new Promise((r) => (ws.onopen = r));
    let id = 0; const pend = new Map();
    ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } };
    const send = (method, params = {}, sessionId, ms = 3000) => new Promise((res) => { const i = ++id; const tm = setTimeout(() => { pend.delete(i); res({ timeout: true }); }, ms); pend.set(i, (j) => { clearTimeout(tm); res(j); }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { result } = await send('Target.getTargets');
    const pages = result.targetInfos.filter((x) => x.type === 'page');
    const rows = [];
    for (const p of pages) {
      const a = await send('Target.attachToTarget', { targetId: p.targetId, flatten: true });
      const sid = a.result?.sessionId;
      const m = await send('Performance.getMetrics', {}, sid, 700);
      rows.push({ id: p.targetId.slice(0, 8), url: p.url, opener: p.openerId?.slice(0, 8) ?? null, canAccessOpener: p.canAccessOpener, state: m.timeout ? 'blocked' : m.error ? 'error' : 'responsive' });
      await send('Target.detachFromTarget', { sessionId: sid });
    }
    ws.close();
    out.push({ trial: t, click: { code: clickR.code, ms: clickR.ms }, rows });
    console.log(JSON.stringify(out.at(-1)));
    await delay(12500);
    await cli(['close'], dir);
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, [`${cd}0`, `${cd}1`]);
  await fs.writeFile(path.join(here, 'cli-repro-diag.json'), JSON.stringify({ out, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
