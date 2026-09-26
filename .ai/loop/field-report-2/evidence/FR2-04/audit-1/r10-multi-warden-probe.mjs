// FR2-04 audit-1: R10 under the multi-warden condition found by wardenLifecycle.f — after a warden
// dies, N concurrent commands each spawn their own warden (ensureWarden has no lock), and all N
// stay alive for the session's lifetime. With --dialog accept, every warden applies the policy to
// every between-commands dialog. Chain: confirm -> prompt(default 'dflt') -> confirm.
// Expected (single handler): [true, 'dflt', true].
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const CLI = path.join(root, 'packages/cli/dist/cli.js');
const puppeteer = createRequire(path.join(root, 'packages/browser/package.json'))('puppeteer-core');
const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-audit-r10-'));
const T = path.join(R, 'temp'); await fs.mkdir(T);
const PAGE = `<!doctype html><title>r10</title><script>var N=new URLSearchParams(location.search).get('n');var K='r10:'+N;function rec(e){var a=JSON.parse(localStorage.getItem(K)||'[]');a.push(e);localStorage.setItem(K,JSON.stringify(a));}
setTimeout(function(){rec(confirm('c1 '+N));rec(prompt('p1 '+N,'dflt'));rec(confirm('c2 '+N));},1200);</script>`;
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); s.end(PAGE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const cli = (args, dir) => new Promise((res) => { const c = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); let o = '', e = ''; c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d)); c.on('exit', (code) => res({ code, stdout: o, stderr: e })); });
const wardensFor = (dir) => { const o = JSON.parse(execSync('powershell -NoProfile -Command "@(Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Select ProcessId,CommandLine) | ConvertTo-Json"', { encoding: 'utf-8' })); return (Array.isArray(o) ? o : [o]).filter((p) => /__dialog-warden/.test(p.CommandLine || '')).filter((p) => { const m = /__dialog-warden\s+(\S+)/.exec(p.CommandLine); return JSON.parse(Buffer.from(m[1], 'base64url').toString()).stateFile.startsWith(dir); }).map((p) => p.ProcessId); };
const d = path.join(R, 'state');
const out = { rounds: [] };
try {
  await cli(['nav', BASE + '?n=setup', '--dialog', 'accept'], d);
  const st = JSON.parse(await fs.readFile(path.join(d, 'state.json'), 'utf-8'));
  const w0 = JSON.parse(await fs.readFile(path.join(d, 'warden.json'), 'utf-8'));
  execSync(`taskkill /PID ${w0.pid} /F`, { stdio: 'ignore' }); await delay(300);
  await Promise.all([cli(['snap'], d), cli(['snap'], d), cli(['snap'], d), cli(['snap'], d)]);
  await delay(1000);
  out.wardens = wardensFor(d);
  const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
  for (let i = 0; i < 10; i++) {
    const n = `r${i}-${Date.now()}`;
    // Navigate via the observer's own Runtime.evaluate (no CLI process alive during the chain),
    // so ONLY the wardens handle these dialogs.
    const t = b.targets().find((x) => x.type() === 'page' && x.url().startsWith(BASE));
    const s = await t.createCDPSession();
    await s.send('Runtime.evaluate', { expression: `location.href=${JSON.stringify(BASE + '?n=' + n)}` });
    let rec;
    for (let k = 0; k < 50; k++) { await delay(200); try { const r = await s.send('Runtime.evaluate', { expression: `localStorage.getItem('r10:${n}')`, returnByValue: true }, { timeout: 1500 }); rec = JSON.parse(r.result.value ?? 'null'); } catch {} if (rec?.length === 3) break; }
    out.rounds.push({ n, rec });
    await s.detach().catch(() => {});
  }
  await b.disconnect();
  out.exactRounds = out.rounds.filter((r) => JSON.stringify(r.rec) === JSON.stringify([true, 'dflt', true])).length;
  console.log('wardens alive for one session:', out.wardens.length, 'exact rounds:', out.exactRounds, '/', out.rounds.length);
  console.log(JSON.stringify(out.rounds.map((r) => r.rec)));
} finally {
  await cli(['close'], d); await delay(2500);
  out.wardensAfterClose = wardensFor(d);
  for (const p of out.wardensAfterClose) { try { execSync(`taskkill /PID ${p} /F`, { stdio: 'ignore' }); } catch {} }
  server.close();
  for (let i = 0; i < 8; i++) { try { await fs.rm(R, { recursive: true, force: true }); break; } catch { await delay(500 * (i + 1)); } }
  await fs.writeFile(path.join(here, 'r10-multi-warden-probe.json'), JSON.stringify(out, null, 2));
  console.log('wardens left after close:', out.wardensAfterClose);
}
