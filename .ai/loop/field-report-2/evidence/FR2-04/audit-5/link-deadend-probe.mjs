// FR2-04 audit-4: pure-CLI reproduction (no observer connected at all) of the "isolated unknown
// dialog" dead end: a normal <a target=_blank> link (implicitly noopener since Chrome 88) opens a
// page that alert()s while it parses. Then follow every recovery path the CLI offers.
// usage: node link-deadend-probe.mjs [trials]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, delay, cleanupRoot, here } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') { s.end(`<!doctype html><title>inline</title><script>alert('on-load ${u.searchParams.get('n')}')</script><body>inline</body>`); return; }
  s.end(`<!doctype html><title>links</title><body>
<a id="xsite" href="http://localhost:${PORT}/alert-inline?n=xsite" target="_blank">cross-site new tab</a><br>
<a id="same" href="/alert-inline?n=same" target="_blank">same-origin new tab (implicit noopener)</a><br>
<a id="sameopener" href="/alert-inline?n=sameopener" target="_blank" rel="opener">same-origin new tab rel=opener</a>
</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const root = await makeRoot('linkdead');
const cli = makeCli(root);
const dirs = [];
const results = [];
const outFile = path.join(here, 'link-deadend.json');
const short = (r) => ({ args: r.args, code: r.code, ms: r.ms, cap: r.killedAtCap, out: r.stdout.trim().slice(0, 400), err: r.stderr.trim().slice(0, 400) });

try {
  for (const variant of ['xsite', 'same', 'sameopener']) {
    for (let t = 0; t < TRIALS; t++) {
      const cd = path.join(root.R, `d-${variant}-${t}`);
      dirs.push(cd);
      const rec = { variant, trial: t, steps: [] };
      const run = async (args, capMs = 45000) => { const r = await cli(args, cd, { capMs }); rec.steps.push(short(r)); return r; };
      await run(['nav', `${BASE}/?t=${t}`]);
      await run(['click', `#${variant}`]);
      await delay(1500);
      await run(['snap']);
      await run(['dialog']);
      await run(['dialog', 'accept']);
      await run(['dialog', 'dismiss']);
      await run(['snap', '--dialog', 'accept']);
      await run(['tabs']);
      const last = await run(['snap', '--dialog', 'report']);
      rec.deadEnd = last.code === 3;
      const st = await readState(cd);
      rec.chromePid = st?.chromePid;
      const c = await run(['close'], 30000);
      rec.closeCode = c.code;
      results.push(rec);
      console.log(JSON.stringify({ variant, t, codes: rec.steps.map((s) => `${s.args.split(' ')[0]}${s.args.includes('accept') ? '+a' : ''}=${s.code}`).join(' '), deadEnd: rec.deadEnd }));
      await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
