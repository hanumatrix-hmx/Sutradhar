// Auditor-2: selected visibility cases over the BUILT CLI (packages/cli/dist/cli.js, real Chrome, own state dir)
// and the BUILT SDK bundle (packages/sutradhar/dist/index.js).
// Usage: node vis-cli-sdk.mjs <repoRoot> <outJsonl>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { startVisServer, cases } from './vis-server.mjs';
const repoRoot = process.argv[2];
const outFile = process.argv[3];
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const IDS = ['ctl-plain', 'shadow-host-none', 'iframe-srcdoc-none', 'xo-none', 'iframe-srcdoc-vis-hidden', 'xo-vis-hidden', 'shadow-direct-text'];
const rows = [];
const HARD = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 15 * 60 * 1000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const srv = await startVisServer();
const all = cases(srv.xo);
const tokFor = (id) => 'QZ' + String(all.findIndex((c) => c[0] === id) + 1).padStart(2, '0') + 'VXKWRT' + Math.random().toString(36).slice(2, 6).toUpperCase();
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-a2-clistate-'));
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-a2-cliwork-'));
const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir };
const cli = (argv) => new Promise((resolve) => {
  const c = spawn(process.execPath, [CLI, ...argv], { env, cwd: work, windowsHide: true });
  let out = '', err = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
  const timer = setTimeout(() => { try { c.kill(); } catch {} }, 120000);
  c.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim().slice(0, 400), err: err.trim().slice(0, 300) }); });
});
const want = (id) => all.find((c) => c[0] === id)[1];
try {
  for (const id of IDS) {
    const tok = tokFor(id);
    await cli(['nav', srv.origin + '/case?id=' + id + '&tok=' + tok]);
    await delay(1200);
    const r = await cli(['click', '#noop', '--expect-text', tok]);
    const w = want(id);
    const ok = w === 'hidden' ? r.code === 4 : r.code === 0;
    rows.push({ surface: 'cli', id, want: w, pass: ok, ...r });
    console.log((ok ? 'PASS' : 'FAIL') + ' cli ' + id + ' want=' + w + ' exit=' + r.code + ' ' + JSON.stringify(r.out.split(String.fromCharCode(10)).filter((l) => /Verification/.test(l))));
  }
} finally {
  const c = await cli(['close']);
  console.log('cli close exit', c.code);
}
const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')).href);
const browser = await sdk.launch({ headless: true });
try {
  for (const id of IDS) {
    const tok = tokFor(id);
    const page = await browser.newPage(srv.origin + '/case?id=' + id + '&tok=' + tok);
    await delay(1000);
    let res, err;
    try { res = await page.click('#noop', { expect: { text: tok } }); } catch (e) { err = e; }
    const w = want(id);
    const threw = err instanceof sdk.ExpectationFailedError;
    const ok = w === 'hidden' ? threw : (!err && res?.verification?.verified === true);
    rows.push({ surface: 'sdk', id, want: w, pass: ok, threw: err?.name, verified: (res ?? err?.result)?.verification?.verified, tier: (res ?? err?.result)?.verification?.evidence?.tier });
    console.log((ok ? 'PASS' : 'FAIL') + ' sdk ' + id + ' want=' + w + ' threw=' + (err?.name ?? 'none') + ' tier=' + (res ?? err?.result)?.verification?.evidence?.tier);
    await page.close?.();
  }
} finally {
  await browser.close();
}
await fs.writeFile(outFile, rows.map((x) => JSON.stringify(x)).join(String.fromCharCode(10)) + String.fromCharCode(10));
console.log('SUMMARY', rows.filter((x) => x.pass).length, '/', rows.length);
await srv.close();
await delay(800);
for (const d of [stateDir, work]) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
clearTimeout(HARD); process.exit(0);
