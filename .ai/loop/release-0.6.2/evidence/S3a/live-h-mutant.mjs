// M-048h live: the six invalid-flag cases mid-session against env CLI (a mutant bundle). Run under the isolation preamble.
import os from 'node:os'; import path from 'node:path'; import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'; import { spawn, spawnSync } from 'node:child_process';
const SP = process.env.SP, WT = process.env.WT, CLI = process.env.CLI, ISO = os.tmpdir().split(path.sep).join('/');
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase();
if (!norm(ISO).startsWith(norm(SP) + '/')) process.exit(97);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const child = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S3a/fixture-main.mjs`], { env: { ...process.env, SP, WT }, stdio: ['pipe', 'pipe', 'inherit'] });
const url = await new Promise((r) => { let b = ''; child.stdout.on('data', (d) => { b += d; const i = b.indexOf('\n'); if (i >= 0) r(JSON.parse(b.slice(0, i)).url); }); });
const env = { ...process.env, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CLI_STATE_DIR: `${ISO}/state`, SUTRADHAR_CONFIG: 'none' };
const cli = (a) => spawnSync(process.execPath, [CLI, ...a], { cwd: ISO, env, encoding: 'utf8', timeout: 120000 });
const stateFile = `${ISO}/state/state.json`;
const dirs = () => readdirSync(ISO).filter((n) => n.startsWith('sutradhar-cli-')).join(',');
const out = { cli: CLI, cases: [] };
cli(['nav', `${url}/short`]);
for (const args of [['text', '--offset', '-1'], ['text', '--max-chars', '0'], ['text', '--max-chars', '100001'], ['text', '--offset', 'abc'], ['text', '--offset'], ['snap', '--offset', '5']]) {
  const b = { s: sha(stateFile), d: dirs() }; const r = cli(args); const a = { s: sha(stateFile), d: dirs() };
  out.cases.push({ args: args.join(' '), code: r.status, stdoutEmpty: r.stdout === '', stateUnchanged: b.s === a.s, noNewDir: b.d === a.d, errLine: r.stderr.split('\n').find((l) => l.startsWith('Error:')) });
}
out.passesCheckH = out.cases.every((c) => c.code === 1 && c.stdoutEmpty && c.stateUnchanged && c.noNewDir && c.errLine);
cli(['close']); child.stdin.write('quit\n');
console.log('HRESULT ' + JSON.stringify(out));
