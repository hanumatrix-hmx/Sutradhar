// audit-3: GAP-185's protect-forever direction. A session whose state.json is PERSISTENTLY corrupt (not mid-write: its
// mtime backdated 1h, far outside any write window) -- is its Chrome ever reclaimable by GC? Then: what are the actual
// recovery paths (next CLI command in that cwd; manual deletion of the corrupt file)?
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, utimesSync, rmSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-other-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { env, cwd: R, encoding: 'utf8' });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
run(['nav', 'data:text/html,<title>other</title>']);
const sub = readdirSync(path.join(R, 'sr'))[0]; const sf = path.join(R, 'sr', sub, 'state.json'); const st = JSON.parse(readFileSync(sf, 'utf8'));
writeFileSync(sf, '{"sessionId": "trunc'); const old = new Date(Date.now() - 3600_000); utimesSync(sf, old, old);
const gc1 = JSON.parse(run(['doctor', '--gc', '--json'])); const gc2 = JSON.parse(run(['doctor', '--gc', '--json']));
const step1 = { gc1Actions: gc1.actions, gc1KeptForSession: gc1.kept.filter((k) => k.pid === st.chromePid || k.path === sf), gc2Actions: gc2.actions, chromeAliveAfter2Gcs: alive(st.chromePid), profileExists: existsSync(st.profileDir) };
const humanOut = run(['doctor', '--gc', '--dry-run']);
// recovery path A: the next ordinary CLI command in that cwd
run(['eval', '1+1']); const st2 = JSON.parse(readFileSync(sf, 'utf8'));
const gc3 = JSON.parse(run(['doctor', '--gc', '--json']));
const step2 = { newChromePid: st2.chromePid, oldChromeKilledByGc3: gc3.actions.some((a) => a.type === 'kill' && a.pid === st.chromePid && a.result === 'killed'), oldChromeAlive: alive(st.chromePid), oldProfileExists: existsSync(st.profileDir), newChromeAlive: alive(st2.chromePid) };
const res = { R, oldChromePid: st.chromePid, step1_persistentCorruption_twoRealGcs: step1, humanDryRunOutput: humanOut, step2_nextCliCommandInThatCwd_thenGc: step2 };
writeFileSync(path.join(here, 'gap185-other-direction.json'), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 2));
try { run(['close']); } catch {}
