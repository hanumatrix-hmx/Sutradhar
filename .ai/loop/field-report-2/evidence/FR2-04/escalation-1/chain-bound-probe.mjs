// FR2-04 audit-4, point 3: GAP-229 re-gate loop bounds. The gate handles at most 5 rounds / 3 s,
// then one final list decides. Chains longer than the bound, and a page that re-opens a dialog
// forever, must exit 3 (never run the command against a blocked page, never hang).
// Usage: node chain-bound-probe.mjs <trials> <caseRegex> <capMs> <tag>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, live, waitBlocked } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const FILTER = new RegExp(process.argv[3] ?? '.');
const CAP = Number(process.argv[4] ?? 200000);
const TAG = process.argv[5] ?? 'run';
const root = await makeRoot('chainb');
const cli = makeCli(root);
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  s.end(`<!doctype html><title>chain ${u.searchParams.get('n')}</title><body>
<button id="c2" onclick="for(let i=0;i<2;i++){alert('c2-'+i)};document.title='done2'">2</button>
<button id="c6" onclick="for(let i=0;i<6;i++){alert('c6-'+i)};document.title='done6'">6</button>
<button id="c12" onclick="for(let i=0;i<12;i++){confirm('c12-'+i)};document.title='done12'">12</button>
<button id="inf" onclick="let i=0;while(true){alert('inf-'+(i++))}">inf</button>
<button id="infslow" onclick="(function f(i){alert('slow-'+i);setTimeout(()=>f(i+1),400)})(0)">infslow</button>
</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const CASES = [];
for (const btn of ['c2', 'c6', 'c12', 'inf', 'infslow']) for (const cmd of [['snap', '--dialog', 'accept'], ['eval', 'document.title', '--dialog', 'dismiss']]) CASES.push({ name: `${btn}/${cmd[0]}-${cmd.at(-1)}`, btn, cmd });

const rows = []; const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const c of CASES) {
      if (!FILTER.test(c.name)) continue;
      const cd = path.join(root.R, `c-${t}-${c.name.replace(/\W/g, '_')}`); dirs.push(cd);
      const n = `cb${t}x${Date.now() % 100000}`;
      const row = { t, case: c.name, n };
      let b;
      try {
        await cli(['nav', `${BASE}/?n=${n}`], cd);
        const click = await cli(['click', `#${c.btn}`], cd, { capMs: 30000 });
        row.click = { code: click.code, ms: click.ms, out: click.stdout.trim().slice(0, 200) };
        const st = await readState(cd);
        b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
        const tgt = pageTargets(b).find((x) => x.url().includes(n));
        const s = await tgt.createCDPSession();
        row.blockedBefore = await waitBlocked(s, 2000);
        const r = await cli(c.cmd, cd, { capMs: CAP });
        row.cmd = { code: r.code, ms: r.ms, killedAtCap: r.killedAtCap, out: r.stdout.slice(0, 600), err: r.stderr.slice(0, 400) };
        row.handledLines = (r.stdout.match(/dialogHandled:/g) || []).length;
        row.ranCommand = /URL: |Title: |^done|^"?chain/m.test(r.stdout) || /^(done\d+|chain .*)$/m.test(r.stdout.trim());
        row.reportedAboutBlank = /about:blank/.test(r.stdout);
        row.blockedAfter = (await live(s, 800)) === 'blocked';
        row.urls = pageTargets(b).map((x) => x.url());
        const ok = r.code === 3 ? !row.ranCommand : (r.code === 0 && !row.blockedAfter && !row.reportedAboutBlank);
        row.verdict = r.killedAtCap ? 'HANG' : ok ? (r.code === 3 ? 'EXIT3-OK' : 'RAN-CLEAN') : 'BAD';
        console.log(JSON.stringify({ t, c: c.name, click: click.code, code: r.code, ms: r.ms, cap: r.killedAtCap, handled: row.handledLines, blockedAfter: row.blockedAfter, err: r.stderr.trim().split('\n')[0]?.slice(0, 140), first: r.stdout.trim().split('\n').filter((l) => !l.startsWith('dialogHandled')).slice(0, 1).join('').slice(0, 100), verdict: row.verdict }));
        await s.detach().catch(() => {});
      } catch (e) { row.error = String(e?.stack || e).slice(0, 400); console.log('ERR', c.name, row.error); }
      rows.push(row);
      await b?.disconnect().catch(() => {});
      const cl = await cli(['close'], cd, { capMs: 30000 });
      row.close = { code: cl.code, ms: cl.ms };
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  const sum = {};
  for (const r of rows) { (sum[r.case] ??= {})[r.verdict ?? 'ERROR'] = (sum[r.case][r.verdict ?? 'ERROR'] ?? 0) + 1; }
  await fs.writeFile(path.join(here, `chain-bound-${TAG}.json`), JSON.stringify({ at: new Date().toISOString(), rows, summary: sum, leftovers }, null, 2));
  console.log(JSON.stringify(sum, null, 1)); console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
