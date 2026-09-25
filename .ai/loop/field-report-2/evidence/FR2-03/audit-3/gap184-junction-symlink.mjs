// audit-3: does a junction/symlink at the marker's state.json path give a forged carrier MORE reach than pointing at the
// target directly? C1: marker -> <junction>\state.json where junction -> a real dir holding a CliState-shaped state.json
// plus a sibling precious file. C2: marker -> state.json which is a FILE symlink to a CliState-shaped file with another name.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, readdirSync, lstatSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js'); const idle = path.join(here, 'idle.cjs');
const cliState = (extra = {}) => JSON.stringify({ sessionId: 'abc', wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/zzz', ...extra });
async function gc(R, T, stateFile, name) {
  const carrierUdd = path.join(T, `sutradhar-cli-${Date.now()}-${name.padEnd(6, 'x').slice(0, 6)}`); mkdirSync(carrierUdd);
  const b64 = Buffer.from(stateFile, 'utf8').toString('base64url');
  const p = spawn(process.execPath, [idle, `--user-data-dir=${carrierUdd}`, '--sutradhar-launch=cli', '--sutradhar-owner-pid=4', '--sutradhar-owner-start=1', `--sutradhar-state=${b64}`], { detached: true, stdio: 'ignore' }); p.unref();
  await new Promise(r => setTimeout(r, 1000));
  const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete env.SUTRADHAR_CLI_STATE_DIR;
  const real = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--json'], { env, cwd: R, encoding: 'utf8' }));
  try { process.kill(p.pid); } catch {}
  return real.actions;
}
const out = {};
{ // C1 junction
  const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-junc-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
  const realDir = path.join(R, 'real-target'); mkdirSync(realDir); writeFileSync(path.join(realDir, 'state.json'), cliState()); writeFileSync(path.join(realDir, 'precious.txt'), 'keep me');
  const junc = path.join(R, 'junc'); symlinkSync(realDir, junc, 'junction');
  const actions = await gc(R, T, path.join(junc, 'state.json'), 'JuncAA');
  out.C1_junction = { actions, realStateJsonExistsAfter: existsSync(path.join(realDir, 'state.json')), preciousExistsAfter: existsSync(path.join(realDir, 'precious.txt')), realDirExistsAfter: existsSync(realDir), junctionExistsAfter: (() => { try { lstatSync(junc); return true; } catch { return false; } })() };
}
{ // C1b junction, target dir has ONLY state.json -> after clear, parent (the junction) is "empty" and gets rm -r'd
  const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-junc2-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
  const realDir = path.join(R, 'real-target'); mkdirSync(realDir); writeFileSync(path.join(realDir, 'state.json'), cliState());
  const junc = path.join(R, 'junc'); symlinkSync(realDir, junc, 'junction');
  const actions = await gc(R, T, path.join(junc, 'state.json'), 'JuncBB');
  out.C1b_junction_emptying = { actions, realDirExistsAfter: existsSync(realDir), junctionExistsAfter: (() => { try { lstatSync(junc); return true; } catch { return false; } })() };
}
{ // C2 file symlink
  const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-fsym-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
  const other = path.join(R, 'other'); mkdirSync(other); const targetFile = path.join(other, 'important-config.json'); writeFileSync(targetFile, cliState({ note: 'foreign' }));
  const linkDir = path.join(R, 'linkdir'); mkdirSync(linkDir); const link = path.join(linkDir, 'state.json');
  try { symlinkSync(targetFile, link, 'file'); const actions = await gc(R, T, link, 'FsymCC');
    out.C2_file_symlink = { actions, targetFileExistsAfter: existsSync(targetFile), linkExistsAfter: (() => { try { lstatSync(link); return true; } catch { return false; } })() };
  } catch (e) { out.C2_file_symlink = { skipped: `symlink creation failed: ${e.code} (file symlinks need Developer Mode/admin on Windows)` }; }
}
writeFileSync(path.join(here, 'gap184-junction-symlink.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out, null, 2));
