// FR2-04 fix-2: gate overhead vs a pre-FR2-04 baseline (never reached by audit-2 or fix-1).
// Compares command latency for `nav` then repeated `snap` between master (7073142, no dialog
// gate/warden at all) and this branch's built CLI (fix-2), same fixture page, same machine.
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { spawn } from 'node:child_process';
import os from 'node:os';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
function makeCli(cliPath, tempDir) {
  return (args, dir) => new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, TEMP: tempDir, TMP: tempDir, SUTRADHAR_CLI_STATE_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => resolve({ code, ms: Date.now() - t0, out, err }));
  });
}

const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<title>go</title><body>go <button id="b">b</button></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/`;
const N = Number(process.argv[2] ?? 8);

async function measure(label, cliPath) {
  const R = await fs.mkdtemp(path.join(os.tmpdir(), `fr2-04-gateoverhead-${label}-`));
  const T = path.join(R, 'temp'); await fs.mkdir(T);
  const cli = makeCli(cliPath, T);
  const d = path.join(R, 'state');
  const navRow = await cli(['nav', URL_], d);
  const snapMs = [];
  for (let i = 0; i < N; i++) {
    const r = await cli(['snap'], d);
    snapMs.push(r.ms);
  }
  await cli(['close'], d);
  await delay(500);
  await fs.rm(R, { recursive: true, force: true }).catch(() => {});
  return { navMs: navRow.ms, snapMs, avgSnapMs: snapMs.reduce((a, b) => a + b, 0) / snapMs.length, medianSnapMs: [...snapMs].sort((a, b) => a - b)[Math.floor(snapMs.length / 2)] };
}

const out = {};
try {
  out.masterBaseline = await measure('master', path.resolve(process.argv[3]));
  out.fix2 = await measure('fix2', path.resolve(process.argv[4]));
  out.deltaAvgSnapMs = out.fix2.avgSnapMs - out.masterBaseline.avgSnapMs;
  out.deltaMedianSnapMs = out.fix2.medianSnapMs - out.masterBaseline.medianSnapMs;
  console.log(JSON.stringify(out, null, 2));
} finally {
  server.close();
  await fs.writeFile(path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'gate-overhead-vs-master.json'), JSON.stringify(out, null, 2));
}
