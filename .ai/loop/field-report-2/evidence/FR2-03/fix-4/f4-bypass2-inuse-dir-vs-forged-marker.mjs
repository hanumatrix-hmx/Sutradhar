// fix-4's own bypass hunt #2: does a forged marker claiming a dir that a SEPARATE, genuinely
// alive process is still actually using (its own real --user-data-dir) still get protected via
// referencedDirs (pass 4), regardless of dirsWithKilledBrowser? This exercises the interaction
// between the two independent protections rather than either fix in isolation.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const { planGc } = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/gc.js')));

const TEMP_ROOT = 'C:\\fake-temp';
const now = Date.now();
const sharedDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000099002');

const snapshot = {
  scope: { tempRoot: TEMP_ROOT, stateRoot: 'C:\\fake-state', extraStateDirs: [] },
  sessions: { stateRoot: 'C:\\fake-state', generatedAt: new Date().toISOString(), processEnumeration: { ok: true }, sessions: [] },
  processEnumeration: {
    ok: true,
    processes: [
      // Forged carrier: dead owner, claims sharedDir.
      {
        pid: 9101,
        ppid: 1,
        startMs: now,
        commandLine: `node --user-data-dir=${sharedDir} --sutradhar-launch=runtime --sutradhar-owner-pid=999994 --sutradhar-owner-start=1`,
      },
      // A SEPARATE, genuinely-alive real process (this test's own pid) that ALSO happens to
      // reference the same directory on its own real command line -- e.g. a real Chrome child
      // that survived, or simply another real process pointed at it for whatever reason.
      { pid: process.pid, ppid: 1, startMs: now, commandLine: `real-chrome --user-data-dir=${sharedDir}` },
    ],
  },
  // Old enough that grace alone wouldn't save it -- isolates the referencedDirs protection.
  candidateDirs: [{ path: sharedDir, mtimeMs: now - 200_000, isSymlink: false, isDirectory: true }],
  lockProbes: {},
  now,
};

const plan = planGc(snapshot);
console.log(JSON.stringify(plan, null, 2));
const deleted = plan.actions.some((a) => a.type === 'deleteDir' && a.path === sharedDir);
console.log('SHARED/IN-USE DIR WRONGLY DELETED:', deleted);
