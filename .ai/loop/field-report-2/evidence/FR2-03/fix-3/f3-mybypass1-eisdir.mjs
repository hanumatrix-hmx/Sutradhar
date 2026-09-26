// fix-3 own bypass attempt #1 against GAP-188's structural fix: instead of a locked file
// (EBUSY), make `state.json` a DIRECTORY (not a plain file) so `stat` succeeds (it's a real
// filesystem entry) but `readFile` throws EISDIR -- a different OS error code than the
// FileShare.None repro (EBUSY) and than a parse failure. If the unification only special-cased
// EBUSY, this should slip through; if it's truly unified on ANY read failure, it should also be
// protected as `unreadable`, never treated as an orphan.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-fix3-mb1-')); const T = path.join(R, 'temp'); mkdirSync(T);
const sr = path.join(R, 'sr'); const sub = path.join(sr, 'abc123'); mkdirSync(sub, { recursive: true });
const sf = path.join(sub, 'state.json');
mkdirSync(sf); // state.json is a DIRECTORY, not a file
// A young, owned CLI profile dir the (nonexistent) session's chromePid can't reference at all --
// nothing to actually protect via referencedPids/Dirs here since the file doesn't parse, but the
// STATE FILE PATH ITSELF (and the fact that GC didn't fall through to a dead-owner-style
// "cleared"/"deleted" action against a path that looks like a real session dir) is the thing
// under test: does `sessions`/`doctor --gc` treat this as `unreadable` (protected), or silently
// drop it (old GAP-188 behavior) and potentially misclassify?
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: sr }; delete env.SUTRADHAR_CLI_STATE_DIR;
const sessOut = JSON.parse(execFileSync(process.execPath, [CLI, 'sessions', '--json'], { env, cwd: R, encoding: 'utf8' }));
const dry = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--dry-run', '--json'], { env, cwd: R, encoding: 'utf8' }));
const real = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--json'], { env, cwd: R, encoding: 'utf8' }));
const res = {
  R, stateFileIsDir: true,
  sessionsStatus: sessOut.sessions.map((s) => ({ stateFile: s.stateFile, status: s.status })),
  dryKept: dry.kept, dryActions: dry.actions,
  realActions: real.actions, realKept: real.kept, realExit: real.exitCode,
  stateDirStillExistsAfter: existsSync(sf),
  verdict: null,
};
res.verdict = res.sessionsStatus.every((s) => s.status === 'unreadable')
  && real.actions.length === 0
  && res.stateDirStillExistsAfter
  ? 'PROTECTED (unreadable, no actions)' : 'NOT PROTECTED — investigate';
writeFileSync(path.join(here, 'f3-mybypass1-eisdir.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
