// fix-4 follow-up: R176 (from f4-regressions.mjs, reusing the SAME leftover scratch root) showed
// the orphaned dir survives the IMMEDIATE gc run now -- expected and correct, since GAP-193's
// grace-period fix means dirsWithKilledBrowser can no longer bypass the 120s grace window. This
// confirms the dir is NOT permanently leaked: it gets reclaimed on a LATER run, once grace has
// genuinely expired, with no orphan-killing needed a second time (the browser was already killed
// in the first run).
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = process.argv[2];
const T = path.join(R, 'temp'); const SR = path.join(R, 'sr');
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: SR }; delete env.SUTRADHAR_CLI_STATE_DIR;
const orphanDir = process.argv[3];
console.log('waiting for grace to fully expire (125s from the earlier run)...');
await new Promise((r) => setTimeout(r, 125_000));
console.log('before second gc run, dir exists:', existsSync(orphanDir));
const real = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--json'], { env, cwd: path.join(R, 'temp'), encoding: 'utf8' }));
const res = { orphanDir, existsBefore: true, existsAfter: existsSync(orphanDir), deletedIt: real.actions.some((a) => a.type === 'deleteDir' && a.path === orphanDir && a.result === 'deleted') };
writeFileSync(path.join(here, 'f4-r176-eventual-reclaim-followup.json'), JSON.stringify({ res, real }, null, 2));
console.log(JSON.stringify(res, null, 2));
