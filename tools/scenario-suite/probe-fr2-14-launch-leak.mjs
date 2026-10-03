// FR2-14 fix-1 (F8) probe: does a CLI command whose post-spawn setup FAILS leave a Chrome behind?
//
// Since fix-1 an out-of-range viewport is rejected BEFORE any Chrome starts, so with the shipped code this probe cannot reach the
// post-spawn failure path. It exists to test that path with a MUTANT that removes the bound (the CDP limit then fails
// `Emulation.setDeviceMetricsOverride` AFTER Chrome was spawned): with the kill in place no Chrome may survive; with the kill
// removed one must (the positive control that shows this probe can see a leak).
//
//   node tools/scenario-suite/probe-fr2-14-launch-leak.mjs [cli-entry.js]    (default packages/cli/dist/cli.js)
//
// Only Chrome processes whose command line contains THIS probe's own scratch directory are ever counted or killed, by PID, never
// by image name. Prints one JSON line. Hard timeout 90 s for the CLI process.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = process.argv[2] ?? path.join(here, '..', '..', 'packages', 'cli', 'dist', 'cli.js');
const R = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fr214-leak-')));
fs.mkdirSync(path.join(R, 'temp'));
fs.mkdirSync(path.join(R, 'state'));
fs.mkdirSync(path.join(R, 'proj', '.git'), { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function pidsReferencing(needle) {
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'],
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    return out
      .split('\n')
      .filter((l) => l.toLowerCase().includes(needle.toLowerCase()) && !l.includes('Get-CimInstance'))
      .map((l) => Number(l.split('\t')[0]))
      .filter((n) => Number.isInteger(n) && n !== process.pid);
  } catch {
    return [];
  }
}

const env = { ...process.env, TEMP: path.join(R, 'temp'), TMP: path.join(R, 'temp'), TMPDIR: path.join(R, 'temp'), SUTRADHAR_CLI_STATE_DIR: path.join(R, 'state') };
for (const k of ['SUTRADHAR_CONFIG', 'SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS']) delete env[k];
const res = await new Promise((resolve) => {
  const cp = spawn(process.execPath, [cliEntry, 'nav', 'about:blank', '--viewport', '1000000000x1000000000'], { env, cwd: path.join(R, 'proj') });
  let stdout = '', stderr = '';
  cp.stdout.on('data', (d) => (stdout += d));
  cp.stderr.on('data', (d) => (stderr += d));
  const t = setTimeout(() => { try { cp.kill(); } catch { /* gone */ } }, 90_000);
  cp.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
});
await delay(3000); // taskkill is asynchronous
const leaked = pidsReferencing(R);
const stateExists = fs.existsSync(path.join(R, 'state', 'state.json'));
for (const pid of leaked) {
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
}
await delay(1500);
const stillAlive = pidsReferencing(R);
let removed = false;
for (let i = 0; i < 10 && !removed; i++) {
  try { fs.rmSync(R, { recursive: true, force: true }); removed = !fs.existsSync(R); } catch { /* retry */ }
  if (!removed) await delay(500);
}
console.log(JSON.stringify({
  cliEntry: cliEntry.replace(/\\/g, '/').split('/').slice(-3).join('/'),
  exitCode: res.code,
  firstErrorLine: (res.stderr.split('\n')[0] ?? '').slice(0, 200),
  stateFileWritten: stateExists,
  leakedChromePids: leaked,
  stillAliveAfterKill: stillAlive,
  scratchRemoved: removed,
}));
