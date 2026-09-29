// audit-3: GAP-184 bypass hunt. fix-2 scoped marker trust to a carrier that (a) isBrowserProcess (== "no --type=" on
// the command line) and (b) has --user-data-dir=<tempRoot>\sutradhar-cli-* and (c) --sutradhar-state basename === state.json.
// All three are plain command-line STRINGS. Case A: a plain node process (not Chrome) that simply adds those strings.
// Case B (control): identical, but the carrier's --user-data-dir sits outside tempRoot -> fix-2's check should reject.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const idle = path.join(here, 'idle.cjs');
async function runCase(name, carrierUddInsideTemp) {
  const R = mkdtempSync(path.join(os.tmpdir(), `fr2-03-a3-${name}-`)); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
  const precious = path.join(R, 'user-data', 'project-notes'); mkdirSync(precious, { recursive: true });
  // a young (1-3s old, grace is 120s) CLI-looking dir, e.g. one a real CLI just mkdtemp'd and hasn't launched Chrome into yet
  const young = path.join(T, `sutradhar-cli-${Date.now()}-yNg0CC`); mkdirSync(young); writeFileSync(path.join(young, 'Local State'), '{}');
  // the carrier's own claimed profile dir (also young); inside T for case A, outside T for case B
  const carrierUdd = carrierUddInsideTemp ? path.join(T, `sutradhar-cli-${Date.now() + 1}-fOrGeD`) : path.join(R, `sutradhar-cli-${Date.now() + 1}-fOrGeD`);
  mkdirSync(carrierUdd); writeFileSync(path.join(carrierUdd, 'Local State'), '{}');
  const target = path.join(precious, 'state.json'); // only change vs audit-2's payload: the file is literally named state.json
  writeFileSync(target, JSON.stringify({ sessionId: 'abc', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/zzz', profileDir: young, profileDirOwned: true, note: 'not sutradhar' }));
  const b64 = Buffer.from(target, 'utf8').toString('base64url');
  const p = spawn(process.execPath, [idle, `--user-data-dir=${carrierUdd}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=4', '--sutradhar-owner-start=1', `--sutradhar-state=${b64}`], { detached: true, stdio: 'ignore' }); p.unref();
  await new Promise(r => setTimeout(r, 1000));
  const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
  const t0 = Date.now();
  const dry = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--dry-run', '--json'], { env, cwd: R, encoding: 'utf8' }));
  const real = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--json'], { env, cwd: R, encoding: 'utf8' }));
  const res = { case: name, carrierIsPlainNode: true, carrierPid: p.pid, R, target, young, carrierUdd, youngAgeMsAtGc: t0 - Number(path.basename(young).split('-')[2]),
    dryActions: dry.actions, realActions: real.actions, realKept: real.kept, realExit: real.exitCode,
    targetFileExistsAfter: existsSync(target), preciousDirExistsAfter: existsSync(precious), youngDirExistsAfter: existsSync(young), carrierUddExistsAfter: existsSync(carrierUdd) };
  try { process.kill(p.pid); } catch {}
  return res;
}
const out = [await runCase('A-inside', true), await runCase('B-outside-control', false)];
writeFileSync(path.join(here, 'gap184-bypass.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2));
