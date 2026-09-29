// FR2-04 audit-3, points 2/4: a popup opened with a TIMED alert (the warden tracks it, typed) makes
// its opener look blocked too (shared renderer), so the warden also reports the opener as an
// 'unknown' dialog. What does a gate running a --dialog policy do with that pair? It handles the
// real alert, then tries to "handle" the opener's phantom unknown -> warden recovery path.
// Outcomes to watch: exit code (false exit 3?), whether the opener is CLOSED, whether it ran.
// Usage: node policy-sibling-probe.mjs <trials> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 5);
const TAG = process.argv[3] ?? 'run';
const root = await makeRoot('polsib');
const cli = makeCli(root);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/pop') return s.end(`<!doctype html><title>pop</title><script>setTimeout(function(){alert('PS-${u.searchParams.get('n')}')},200)</script>pop`);
  s.end(`<!doctype html><title>opener ${u.searchParams.get('n')}</title><body>opener</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const cmd of [['snap', '--dialog', 'accept'], ['snap', '--dialog', 'dismiss'], ['dialog', 'accept']]) {
      const cd = path.join(root.R, `ps-${t}-${cmd.join('_')}`); dirs.push(cd);
      const n = `ps${t}x${Date.now() % 100000}`;
      const row = { t, cmd: cmd.join(' '), n };
      let b;
      try {
        await cli(['nav', `${BASE}/?n=${n}`], cd);
        const st = await readState(cd);
        b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
        const opener = pageTargets(b).find((x) => x.url().includes(n));
        const openerId = idOf(opener);
        const s = await opener.createCDPSession();
        await s.send('Runtime.evaluate', { expression: `void window.open('${BASE}/pop?n=${n}')`, userGesture: true });
        await s.detach().catch(() => {});
        await delay(1000);
        const wf = await readWarden(cd);
        try { const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) }); row.warden = (await r.json()).dialogs.map((d) => `${d.targetId === openerId ? 'OPENER' : 'POP'}:${d.type}`); } catch (e) { row.warden = 'ERR ' + e.message; }
        const r = await cli(cmd, cd, { capMs: 60000 });
        row.res = { code: r.code, ms: r.ms, out: r.stdout.trim().slice(0, 400), err: r.stderr.trim().slice(0, 300) };
        await delay(300);
        row.openerAlive = pageTargets(b).some((x) => idOf(x) === openerId);
        row.urls = pageTargets(b).map((x) => x.url().slice(0, 60));
        row.verdict = !row.openerAlive ? 'OPENER-CLOSED' : r.code === 0 ? 'OK' : `exit${r.code}`;
        console.log(JSON.stringify({ t, cmd: row.cmd, warden: row.warden, code: r.code, ms: r.ms, openerAlive: row.openerAlive, err: r.stderr.trim().split('\n')[0]?.slice(0, 170), out: r.stdout.trim().split('\n')[0]?.slice(0, 120), verdict: row.verdict }));
      } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  const sum = {};
  for (const r of rows) { (sum[r.cmd] ??= {})[r.verdict ?? 'ERR'] = (sum[r.cmd][r.verdict ?? 'ERR'] ?? 0) + 1; }
  await fs.writeFile(path.join(here, `policy-sibling-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, summary: sum, leftovers }, null, 2));
  console.log(JSON.stringify(sum)); console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
