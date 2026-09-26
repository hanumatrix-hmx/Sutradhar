// Fix-1 targeted live repro for GAP-176: an orphaned CLI Chrome's profile dir must be reclaimed
// in the SAME `doctor --gc` run that kills its browser tree, even though a child process
// (crashpad-handler on Windows) still carries its own --user-data-dir pointing at that same dir
// at snapshot time (before the tree kill actually runs). This is the exact defect audit-1 found
// live: gc.ts only excluded the killed browser's OWN pid from the "still in use" check, never
// its children, so the dir was reported "in-use" forever.
import { mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  makeScratch, runCli, observeAll, observeFor, isAlive, taskkill, waitUntil, stateForCwd,
  startFixtureServer, killEverythingUnder,
} from './common.mjs';

const { srv, base } = await startFixtureServer();
const S = await makeScratch('fr2-03-fix1-gap176-');
const out = { steps: [] };
try {
  const nav = await runCli(['nav', `${base}?c=gap176`], S.env, S.cwd(1));
  out.steps.push({ step: 'nav', code: nav.code });
  const st = await stateForCwd(S.stateRoot, S.cwd(1));
  const dir = st.state.profileDir;
  const browserPid = st.state.chromePid;

  // Confirm a real crashpad-handler (or other child) is on this dir's process tree BEFORE we
  // orphan it -- this is the exact evidence audit-1's ADV-crashpad case recorded.
  const before = observeFor(dir);
  out.childrenBeforeOrphan = before.map((p) => ({ pid: p.pid, cmd: p.cmd.slice(0, 40) + '...' }));

  // Orphan the session the same way a wiped ~/.sutradhar-cli or deleted SUTRADHAR_CLI_STATE_DIR
  // would (spec §3.5 leg B, sessions 3-4): delete the STATE directory, leaving Chrome (and its
  // children) running. The marker's owner (this exited-by-then CLI run) reads back dead, so the
  // browser is a genuine orphan-cli target.
  await rm(st.dir, { recursive: true, force: true });
  out.steps.push({ step: 'orphaned (state dir removed, chrome still running)', browserAlive: isAlive(browserPid) });

  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(2));
  const dj = JSON.parse(dry.stdout);
  const killAction = dj.actions.find((a) => a.type === 'kill' && a.pid === browserPid);
  const delAction = dj.actions.find((a) => a.type === 'deleteDir' && a.path.toLowerCase() === dir.toLowerCase());
  out.dryRun = { killPlanned: !!killAction, deletePlanned: !!delAction, deleteReason: delAction?.reason, keptInstead: dj.kept.find((k) => k.path?.toLowerCase() === dir.toLowerCase())?.reason };

  const run = await runCli(['doctor', '--gc', '--json'], S.env, S.cwd(2));
  const rj = JSON.parse(run.stdout);
  const killResult = rj.actions.find((a) => a.type === 'kill' && a.pid === browserPid);
  const delResult = rj.actions.find((a) => a.type === 'deleteDir' && a.path.toLowerCase() === dir.toLowerCase());
  await waitUntil(() => observeFor(dir).length === 0, 10000, 300);
  out.realRun = {
    exitCode: run.code,
    killResult,
    delResult,
    dirExistsAfter: existsSync(dir),
    remainingProcessesOnDir: observeFor(dir).length,
    remaining: rj.remaining,
  };
  out.pass =
    !!killAction && !!delAction && delAction.reason === 'orphan-browser' &&
    killResult?.result === 'killed' && delResult?.result === 'deleted' &&
    !out.realRun.dirExistsAfter && out.realRun.remainingProcessesOnDir === 0;
} catch (e) {
  out.error = String(e?.stack ?? e);
  out.pass = false;
} finally {
  await killEverythingUnder(S.R);
  await new Promise((r) => setTimeout(r, 500));
  await rm(S.R, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
  srv.close();
}

console.log(JSON.stringify(out, null, 2));
process.exit(out.pass ? 0 : 1);
