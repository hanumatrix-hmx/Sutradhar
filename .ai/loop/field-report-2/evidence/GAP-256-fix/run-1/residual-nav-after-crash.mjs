// Residual probe: after a crash of the ACTIVE tab, what do gated verbs do if the user does NOT
// closetab first? (cur build vs master build). Records exit codes and monotonic durations.
// usage: node residual-nav-after-crash.mjs <cliPath> <label> <outFile>
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { makeRoot, delay, cleanupRoot, here, spawnedPids, taskkill } from './lib.mjs';

const CLI_PATH = process.argv[2];
const LABEL = process.argv[3];
const OUT = path.join(here, process.argv[4]);
const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(`<!doctype html><title>page</title><body>page ${q.url}</body>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('resid');
const dir = path.join(root.R, 's0');
function runCli(args, d, capMs = 45000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [CLI_PATH, ...args], { env: { ...process.env, TEMP: root.TEMP, TMP: root.TEMP, SUTRADHAR_CLI_STATE_DIR: d }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    spawnedPids.add(child.pid);
    let out = '', err = '', killed = false;
    child.stdout.on('data', (x) => (out += x)); child.stderr.on('data', (x) => (err += x));
    const cap = setTimeout(() => { killed = true; taskkill(child.pid); }, capMs);
    child.on('exit', (code) => { clearTimeout(cap); spawnedPids.delete(child.pid); resolve({ args: args.join(' ').replace(BASE, '<B>'), code, ms: Math.round(performance.now() - t0), cap: killed, out: out.trim().slice(0, 200), err: err.trim().slice(0, 200) }); });
  });
}
const rec = [];
try {
  for (const verb of ['nav', 'snap']) {
    const d = dir + '-' + verb;
    rec.push(await runCli(['nav', `${BASE}/?keep`], d));
    rec.push(await runCli(['newtab', `${BASE}/?victim`], d));
    await delay(1200);
    rec.push(await runCli(['nav', 'chrome://crash'], d));
    await delay(1500);
    rec.push(await runCli(verb === 'nav' ? ['nav', `${BASE}/?after`] : ['snap'], d));
    rec.push(await runCli(['close'], d, 30000));
    await fs.writeFile(OUT, JSON.stringify({ label: LABEL, rec }, null, 2));
  }
} finally {
  server.close();
  console.log(JSON.stringify(rec.map((r) => `${r.args.split(' ')[0]}=${r.code}/${r.ms}ms${r.cap ? '/CAP' : ''}`)));
  console.log('leftovers', JSON.stringify(await cleanupRoot(root, (a, d, o) => runCli(a, d, 20000), [dir + '-nav', dir + '-snap'])));
  process.exit(0);
}
