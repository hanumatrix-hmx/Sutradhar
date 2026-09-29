// FR2-12 escalation-2: revert-and-confirm for the GAP-284 fix. Reverts browser-tab.ts's
// `Page.frameNavigated` handler back to pre-fix behavior (never invalidates
// `lastMainDocumentResponseCapture` on a commit with a different loaderId -- the ORIGINAL bug),
// tsc-builds @sutradhar/browser + capability-runtime + mcp-server, then runs the exact live
// GAP-284 repro (probe-gap284-runtime.mjs, this round's own script, unmodified) in a FRESH child
// process to show the leak returns. Restores from an in-memory copy and sha256-verifies
// afterward, then rebuilds. CRLF-aware (browser-tab.ts uses CRLF throughout).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/escalation-2')) throw new Error('wrong dir: ' + here);
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const PKG = path.join(root, 'packages', 'browser');
const FILE = path.join(PKG, 'src', 'session', 'browser-tab.ts');
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const origBuf = await fs.readFile(FILE);
const origSha = sha(origBuf);
const origText = origBuf.toString('utf8');

// The exact GAP-284 fix block (CRLF, as the file is stored) -- neutralize it back to "never
// clear", i.e. exactly the pre-escalation-2 bug.
const FROM =
  'if (this.lastMainDocumentResponseLoaderId !== newLoaderId) {\r\n' +
  '          this.lastMainDocumentResponseCapture = null;\r\n' +
  '          this.lastMainDocumentResponseLoaderId = null;\r\n' +
  '        }';
const TO =
  '// REVERTED for GAP-284 revert-confirm -- never invalidate (the original bug).\r\n' +
  '        void newLoaderId;\r\n' +
  '        void this.lastMainDocumentResponseLoaderId; // keep tsc happy about the now-write-only field';

const idx = origText.indexOf(FROM);
if (idx === -1) throw new Error('GAP-284 fix anchor not found -- has browser-tab.ts changed shape since this script was written?');
const mutated = origText.slice(0, idx) + TO + origText.slice(idx + FROM.length);
await fs.writeFile(FILE, mutated, 'utf8');

function run(args, opts = {}) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 300000, ...opts });
}

const out = {};
const buildBrowser = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
out.buildBrowserStatus = buildBrowser.status;
out.buildBrowserOutput = (buildBrowser.stdout ?? '') + (buildBrowser.stderr ?? '');

if (buildBrowser.status === 0) {
  // capability-runtime and mcp-server both consume @sutradhar/browser's dist via the workspace
  // link -- rebuild them too so the fresh child process actually picks up the mutated behavior.
  run([TSC, '-p', path.join(root, 'packages', 'capability-runtime', 'tsconfig.json')]);
  run([TSC, '-p', path.join(root, 'packages', 'mcp-server', 'tsconfig.json')]);

  // Fresh child process for the live measurement (never a same-process re-import).
  const live = run([path.join(here, 'probe-gap284-runtime.mjs'), '8'], { cwd: here, timeout: 280000 });
  out.liveStdout = live.stdout;
  out.liveStderr = (live.stderr ?? '').slice(-2000);
  out.liveStatus = live.status;

  // Deterministic, Chrome-version-independent confirmation: the fake-CDP-session unit tests
  // (CT10-CT13, CT17) exercise the exact same mechanism without depending on what a real Chrome
  // build happens to do for about:blank/net-error commits (the live probe above shows the
  // real-browser leak returns unambiguously for the bfcache shape, but not for about:blank/dead
  // host in THIS Chrome build -- see the results file's note). Also a fresh child process.
  const VITEST = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  const unit = run(
    [VITEST, 'run', path.join(PKG, 'tests', 'unit', 'browser-tab-observability.spec.ts'), '--root', PKG],
    { cwd: root, timeout: 120000 },
  );
  out.unitTestStatus = unit.status; // non-zero expected: CT10-13/CT17 should FAIL against the mutation
  out.unitTestOutput = ((unit.stdout ?? '') + (unit.stderr ?? '')).slice(-6000);
}

// Restore + sha-verify + rebuild dist back to the real (fixed) code.
await fs.writeFile(FILE, origBuf);
const restored = await fs.readFile(FILE);
out.restoredShaMatches = sha(restored) === origSha;
const rebuildBrowser = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
out.rebuildAfterRestoreStatus = rebuildBrowser.status;
run([TSC, '-p', path.join(root, 'packages', 'capability-runtime', 'tsconfig.json')]);
run([TSC, '-p', path.join(root, 'packages', 'mcp-server', 'tsconfig.json')]);

await fs.writeFile(path.join(here, 'revert-confirm-gap284-results.json'), JSON.stringify(out, null, 2));
console.log('build status (mutated):', out.buildBrowserStatus);
console.log('live output (mutated, should show the stale-404 leak return):');
console.log(out.liveStdout);
console.log('restoredShaMatches:', out.restoredShaMatches, 'rebuildAfterRestoreStatus:', out.rebuildAfterRestoreStatus);
process.exit(0);
