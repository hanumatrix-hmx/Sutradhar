// FR2-12 escalation-1: revert-and-confirm for the GAP-278 fix itself. Reverts runtime.ts's
// current-page-mode scoping back to the pre-fix behavior (always documentStartedAt, never the
// tab's tracked commit time) by neutralizing the one line that sources `effectiveNavCommittedAt`
// from the tab for current-page mode, tsc-builds, then runs the exact live GAP-278 repro
// (probe-gap278-fix.mjs, unmodified, this round's own script) in a FRESH child process to show
// the leak returns. Restores from an in-memory copy and sha256-verifies afterward. CRLF-aware.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/escalation-1')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const PKG = path.join(root, 'packages', 'capability-runtime');
const FILE = path.join(PKG, 'src', 'runtime.ts');
const TSC = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const origBuf = await fs.readFile(FILE);
const origSha = sha(origBuf);
const origText = origBuf.toString('utf8');

const FROM = 'const effectiveNavCommittedAt = options.url\r\n      ? navCommittedAt\r\n      : (tab.getLastMainFrameCommitAt?.() ?? null);';
const TO = 'const effectiveNavCommittedAt = options.url\r\n      ? navCommittedAt\r\n      : null; // REVERTED for GAP-278 revert-confirm -- current-page mode never consults the tab';

const idx = origText.indexOf(FROM);
if (idx === -1) throw new Error('GAP-278 fix anchor not found -- has runtime.ts changed shape since this script was written?');
const mutated = origText.slice(0, idx) + TO + origText.slice(idx + FROM.length);
await fs.writeFile(FILE, mutated, 'utf8');

function run(args, opts = {}) {
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 300000, ...opts });
}
const build = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
const out = { buildStatus: build.status, buildOutput: (build.stdout ?? '') + (build.stderr ?? '') };

if (build.status === 0) {
  // Fresh child process for the live measurement (never a same-process re-import).
  const live = run([path.join(here, 'probe-gap278-fix.mjs'), '5'], { cwd: here, timeout: 280000 });
  out.liveStdout = live.stdout;
  out.liveStderr = (live.stderr ?? '').slice(0, 2000);
}

// Restore + sha-verify + rebuild dist back to the real (fixed) code.
await fs.writeFile(FILE, origBuf);
const restored = await fs.readFile(FILE);
out.restoredShaMatches = sha(restored) === origSha;
const rebuild = run([TSC, '-p', path.join(PKG, 'tsconfig.json')]);
out.rebuildAfterRestoreStatus = rebuild.status;
run([TSC, '-p', path.join(root, 'packages', 'mcp-server', 'tsconfig.json')]); // mcp-server's own dist also depends on capability-runtime's dist

await fs.writeFile(path.join(here, 'revert-confirm-gap278-results.json'), JSON.stringify(out, null, 2));
console.log('build status (mutated):', out.buildStatus);
console.log('live output (mutated, should show leaks):');
console.log(out.liveStdout);
console.log('restoredShaMatches:', out.restoredShaMatches, 'rebuildAfterRestoreStatus:', out.rebuildAfterRestoreStatus);
process.exit(0);
