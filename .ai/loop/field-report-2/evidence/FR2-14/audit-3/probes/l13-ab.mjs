// AUDIT-3 isolated A/B of FR2-04 L13 (headed click that opens an alert): HEAD vs master, interleaved.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const [HEAD, MASTER, S0, ROUNDS] = process.argv.slice(2);
const srvCode = "const s=require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<button id=alert onclick=\"alert(1)\">a</button>')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));setTimeout(()=>process.exit(0),1200000)";
const srvP = spawn(process.execPath, ['-e', srvCode], { stdio: ['ignore', 'pipe', 'inherit'] });
const PORT = await new Promise((ok) => srvP.stdout.once('data', (d) => ok(Number(String(d).trim()))));
const rows = [];
const t0 = performance.now();
for (let i = 0; i < Number(ROUNDS); i++) {
  for (const [tag, root] of i % 2 ? [['master', MASTER], ['head', HEAD]] : [['head', HEAD], ['master', MASTER]]) {
    if (performance.now() - t0 > 1080000) break;
    const st = path.join(S0, 'l13', tag + i);
    const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: st, SUTRADHAR_CONFIG: 'none' };
    const cli = (...a) => spawnSync(process.execPath, [path.join(root, 'packages/cli/dist/cli.js'), ...a], { env, encoding: 'utf8', timeout: 90000 });
    cli('nav', 'http://127.0.0.1:' + PORT + '/?r=' + i, '--headed');
    const s = performance.now();
    const c = cli('click', '#alert');
    const ms = Math.round(performance.now() - s);
    cli('dialog', 'accept'); cli('close');
    rows.push({ round: i, tag, code: c.status, ms, out: (c.stdout || '').slice(0, 60) });
    console.error(tag, i, c.status, ms);
  }
}
srvP.kill();
const sum = (t) => { const r = rows.filter((x) => x.tag === t); return { runs: r.length, exit0: r.filter((x) => x.code === 0).length }; };
console.log(JSON.stringify({ head: sum('head'), master: sum('master'), rows }, null, 1));
