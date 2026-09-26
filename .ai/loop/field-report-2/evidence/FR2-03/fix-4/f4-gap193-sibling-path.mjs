// audit-4: GAP-189 "structural" claim, novel attack. fix-3 gated the pass-1 (state-file) marker path. But pass 2 ALSO
// consults command-line marker text to authorize deletion: a process carrying `--sutradhar-launch=cli|runtime` plus a
// dead owner is killed as an "orphan browser" and its claimed `--user-data-dir` is added to `dirsWithKilledBrowser`,
// which pass 6 deletes as `orphan-browser` BEFORE the grace check (line ~497) and which also satisfies D2's
// Puppeteer-attribution gate (line ~471). The carrier's claimed --user-data-dir is just text: it need not be its own.
//   V1: carrier (plain node, NO --sutradhar-state at all) claims a VICTIM young (~1s, grace=120s) sutradhar-cli-* dir
//       (e.g. one a real CLI just mkdtemp'd and hasn't launched Chrome into yet) -- GAP-189's effect #3 via pass 2.
//   V1c: control, identical victim dir, no carrier -> must be kept 'grace'.
//   V2: carrier (runtime marker) claims an UNOWNED puppeteer_dev_chrome_profile-* dir (another tool's; no owner file,
//       old) -> D2 says "unmarked Puppeteer dirs are never touched".
//   V2c: control, identical dir, no carrier -> must be kept 'not-sutradhar'.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const idle = path.join(here, 'idle.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function env(R, T) { const e = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr') }; delete e.SUTRADHAR_CLI_STATE_DIR; return e; }
function gc(R, T, dry) { return JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', ...(dry ? ['--dry-run'] : []), '--json'], { env: env(R, T), cwd: R, encoding: 'utf8' })); }
const mine = (plan, R) => ({ actions: plan.actions, kept: plan.kept.filter((k) => k.path && k.path.startsWith(R)) , exitCode: plan.exitCode });

async function runCase(name, { kind, victimName, backdate, withCarrier }) {
  const R = mkdtempSync(path.join(os.tmpdir(), `fr2-03-a4-${name}-`)); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr'));
  const victim = path.join(T, victimName); mkdirSync(victim); writeFileSync(path.join(victim, 'precious.txt'), 'victim data');
  if (backdate) { const t = new Date(Date.now() - 3600_000); utimesSync(victim, t, t); }
  let p;
  if (withCarrier) {
    p = spawn(process.execPath, [idle, `--user-data-dir=${victim}`, `--sutradhar-launch=${kind}`, '--sutradhar-owner-pid=4', '--sutradhar-owner-start=1'], { detached: true, stdio: 'ignore' });
    p.unref(); await sleep(1000);
  }
  const t0 = Date.now();
  const dry = gc(R, T, true); const real = gc(R, T, false);
  const res = { case: name, kind, withCarrier, carrierPid: p?.pid ?? null, victim, victimAgeMsAtGc: backdate ? 3600_000 : null,
    dry: mine(dry, R), real: mine(real, R), victimExistsAfter: existsSync(victim), victimFileExistsAfter: existsSync(path.join(victim, 'precious.txt')), gcAt: new Date(t0).toISOString() };
  if (p) { try { process.kill(p.pid); } catch {} }
  return res;
}
const ts = Date.now();
const out = [
  await runCase('V1-young-cli-victim', { kind: 'cli', victimName: `sutradhar-cli-${ts}-vIcTm1`, backdate: false, withCarrier: true }),
  await runCase('V1c-control-no-carrier', { kind: 'cli', victimName: `sutradhar-cli-${ts + 1}-vIcTm2`, backdate: false, withCarrier: false }),
  await runCase('V2-unowned-puppeteer-victim', { kind: 'runtime', victimName: 'puppeteer_dev_chrome_profile-oThEr1', backdate: true, withCarrier: true }),
  await runCase('V2c-control-no-carrier', { kind: 'runtime', victimName: 'puppeteer_dev_chrome_profile-oThEr2', backdate: true, withCarrier: false }),
];
writeFileSync(path.join(here, 'f4-gap193-sibling-path.json'), JSON.stringify(out, null, 2));
for (const c of out) console.log(c.case, JSON.stringify({ realActions: c.real.actions.map((a) => `${a.type}:${a.reason ?? ''}:${a.path ?? a.pid}:${a.result}`), kept: c.real.kept.map((k) => `${k.reason}:${path.basename(k.path)}`), exit: c.real.exitCode, victimExistsAfter: c.victimExistsAfter }));
