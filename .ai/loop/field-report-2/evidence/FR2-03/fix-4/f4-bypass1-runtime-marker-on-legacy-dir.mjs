// fix-4's own bypass hunt #1: a forged RUNTIME marker (not CLI) claiming a young, real,
// non-Puppeteer sutradhar-cli-* directory. dirsWithKilledBrowser.add(udd) at gc.ts:365 has NO
// naming-pattern check at all (unlike the CLI branch's isNamedProfileTarget gate) -- so this
// checks whether that asymmetry re-opens the grace bypass through the 'runtime' marker kind
// specifically, now that the grace check has been moved before dirsWithKilledBrowser.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const { planGc } = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/gc.js')));

const TEMP_ROOT = 'C:\\fake-temp';
const now = Date.now();
const youngDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000099001');

function mk(mtimeMs) {
  return {
    scope: { tempRoot: TEMP_ROOT, stateRoot: 'C:\\fake-state', extraStateDirs: [] },
    sessions: { stateRoot: 'C:\\fake-state', generatedAt: new Date().toISOString(), processEnumeration: { ok: true }, sessions: [] },
    processEnumeration: {
      ok: true,
      processes: [
        {
          pid: 9001,
          ppid: 1,
          startMs: now,
          commandLine: `node --user-data-dir=${youngDir} --sutradhar-launch=runtime --sutradhar-owner-pid=999995 --sutradhar-owner-start=1`,
        },
      ],
    },
    candidateDirs: [{ path: youngDir, mtimeMs, isSymlink: false, isDirectory: true }],
    lockProbes: {},
    now,
  };
}

const young = planGc(mk(now)); // dir age 0 -- inside grace
const old = planGc(mk(now - 200_000)); // dir age > grace

console.log('young (should be kept grace, NOT deleted):', JSON.stringify({ actions: young.actions, kept: young.kept }));
console.log('old (past grace -- may legitimately be deleted, same as an ordinary orphan-dir would be regardless of the forged marker):', JSON.stringify({ actions: old.actions, kept: old.kept }));

const youngDeleted = young.actions.some((a) => a.type === 'deleteDir' && a.path === youngDir);
console.log('YOUNG DIR WRONGLY DELETED:', youngDeleted);
