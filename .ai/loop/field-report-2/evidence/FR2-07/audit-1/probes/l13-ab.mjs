// Auditor A/B for FR2-04 L13 (headed CLI click on an alert button) against two built CLIs.
// Usage: node l13-ab.mjs <cliA> <cliB> <out.json> [reps]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const [cliA, cliB, out, repsArg] = process.argv.slice(2);
const reps = Number(repsArg ?? 2);
const DEADLINE = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 18 * 60 * 1000);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><button id="alert" onclick="alert('audit l13 ' + location.search)">alert</button>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/fx.html`;
const cli = (CLI, args, stateDir) => new Promise((resolve) => {
  const t0 = performance.now();
  const c = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir }, windowsHide: true });
  let o = '', e = '';
  c.stdout.on('data', (d) => (o += d)); c.stderr.on('data', (d) => (e += d));
  const cap = setTimeout(() => { try { c.kill(); } catch {} }, 120000);
  c.on('exit', (code) => { clearTimeout(cap); resolve({ args, code, ms: Math.round(performance.now() - t0), stdout: o.trim().slice(0, 400), stderr: e.trim().slice(0, 300) }); });
});
const results = [];
for (let i = 0; i < reps; i++) {
  for (const [label, CLI] of [['base', cliA], ['head', cliB]]) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), `fr207-audit-l13-${label}-`));
    await cli(CLI, ['nav', `${base}?n=${label}-${i}`, '--headed'], dir);
    const click = await cli(CLI, ['click', '#alert'], dir);
    const snap = await cli(CLI, ['snap'], dir);
    await cli(CLI, ['dialog', 'accept'], dir);
    const close = await cli(CLI, ['close'], dir);
    results.push({ label, rep: i, click, snapCode: snap.code, closeCode: close.code });
    console.log(label, i, 'click exit', click.code, click.ms + 'ms', JSON.stringify(click.stdout).slice(0, 200), 'snap', snap.code);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
await fs.writeFile(out, JSON.stringify(results, null, 2));
server.close();
clearTimeout(DEADLINE);
