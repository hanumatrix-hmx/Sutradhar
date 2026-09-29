// fix-2 regression check for GAP-175: a session launched with a custom SUTRADHAR_CLI_STATE_DIR
// (outside stateRoot) must still be protected by a LATER, separate `doctor --gc` invocation that
// does NOT have that env var set -- i.e. discoverMarkerStateFiles must still find it via the
// marker on its own real, CLI-owned Chrome process, even after GAP-184's tightened scoping.
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { makeScratch, runCli, isAlive } from './common.mjs';

const S = await makeScratch('fr2-03-fix2-gap175-');
const customDir = path.join(S.R, 'custom-state-dir');
await mkdir(customDir, { recursive: true });
const env = { ...S.env, SUTRADHAR_CLI_STATE_DIR: customDir };

const out = { steps: [] };
try {
  const nav = await runCli(['nav', 'data:text/html,<title>gap175-fix2</title>'], env, S.cwd(1));
  out.steps.push({ step: 'nav', code: nav.code });
  const st = JSON.parse(await readFile(path.join(customDir, 'state.json'), 'utf-8'));
  out.chromePid = st.chromePid;
  out.browserAliveBeforeGc = isAlive(st.chromePid);

  // GC invocation from elsewhere, deliberately WITHOUT SUTRADHAR_CLI_STATE_DIR set -- this
  // process has no idea the custom dir exists except via marker discovery.
  const gcEnv = { ...S.env };
  delete gcEnv.SUTRADHAR_CLI_STATE_DIR;

  const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], gcEnv, S.cwd(2));
  const dj = JSON.parse(dry.stdout);
  out.dryRun = {
    killPlanned: !!dj.actions.find((a) => a.type === 'kill' && a.pid === st.chromePid),
    keptAsLiveSession: dj.kept.some((k) => k.path && k.path.toLowerCase() === path.join(customDir, 'state.json').toLowerCase() && k.reason === 'live-session'),
  };

  const run = await runCli(['doctor', '--gc', '--json'], gcEnv, S.cwd(2));
  const rj = JSON.parse(run.stdout);
  out.realRun = {
    exitCode: run.code,
    killed: !!rj.actions.find((a) => a.type === 'kill' && a.pid === st.chromePid),
    browserStillAliveAfter: isAlive(st.chromePid),
    stateFileStillExists: existsSync(path.join(customDir, 'state.json')),
  };
  out.pass =
    out.browserAliveBeforeGc &&
    !out.dryRun.killPlanned && out.dryRun.keptAsLiveSession &&
    !out.realRun.killed && out.realRun.browserStillAliveAfter && out.realRun.stateFileStillExists;
} finally {
  // cleanup: kill the real Chrome and remove the scratch tree regardless of pass/fail.
  const { rm } = await import('node:fs/promises');
  if (out.chromePid) { try { process.kill(out.chromePid); } catch {} }
  await rm(S.R, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(out, null, 2));
