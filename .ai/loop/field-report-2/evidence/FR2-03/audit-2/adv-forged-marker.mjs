// audit-2 ADV-7b: a NON-Chrome process whose command line merely CONTAINS a CLI marker pointing at an
// arbitrary JSON file outside every state root. Does GC read/trust it, delete that file (and its parent
// dir), and delete a grace-protected young profile dir named in it?
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a2-forge-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
const precious = path.join(R, 'user-data', 'project-notes'); mkdirSync(precious, { recursive: true });
const young = path.join(T, `sutradhar-cli-${Date.now()}-yNg0BB`); mkdirSync(young); writeFileSync(path.join(young, 'Local State'), '{}');
// a user's own JSON file that happens to have these two keys (e.g. another tool's session cache)
const target = path.join(precious, 'session-cache.json');
writeFileSync(target, JSON.stringify({ sessionId: 'abc', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/zzz', profileDir: young, profileDirOwned: true, note: 'not sutradhar' }));
const b64 = Buffer.from(target, 'utf8').toString('base64url');
const idle = path.join(here, 'ppid-reuse', 'idle.cjs');
const p = spawn(process.execPath, [idle, '--sutradhar-launch=cli', '--sutradhar-owner-pid=4', '--sutradhar-owner-start=1', `--sutradhar-state=${b64}`], { detached: true, stdio: 'ignore' }); p.unref();
await new Promise(r => setTimeout(r, 800));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
const dry = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--dry-run', '--json'], { env, cwd: R, encoding: 'utf8' }));
const real = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--json'], { env, cwd: R, encoding: 'utf8' }));
const res = { R, target, young, youngAgeMsAtGc: 'about 1-3s (grace is 120s)',
  dryActions: dry.actions, realActions: real.actions, realExit: real.exitCode,
  targetFileExistsAfter: existsSync(target), preciousDirExistsAfter: existsSync(precious), youngDirExistsAfter: existsSync(young) };
writeFileSync(path.join(here, 'adv-forged-marker.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 2));
try { process.kill(p.pid); } catch {}
