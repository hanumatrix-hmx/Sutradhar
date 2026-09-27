// FR2-12 fix-1, GAP-262 revert-and-confirm: proves the fix is load-bearing by reverting the exact
// scoping-boundary change in packages/capability-runtime/src/audit/site-audit.ts (since =
// navCommittedAt directly -> back to min(navCommittedAt, documentStartedAt), the ORIGINAL (B1)
// fix's own logic) and showing the noisy-interval + clean-delayed(150ms) repeat case leaks again,
// then restoring the real fix and confirming 0 leaks again.
//
// CRLF/LF-aware + sha-verified restore, same approach as revert-confirm-gap261.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const siteAuditTsPath = path.join(repoRoot, 'packages', 'capability-runtime', 'src', 'audit', 'site-audit.ts');
const { startAuditFixtureServer } = await import(
  pathToFileURL(path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-12-audit-server.mjs'))
);

// The `dist/` output is plain per-file `tsc` compilation (index.js re-exports from
// `audit/site-audit.js` via a normal relative import), NOT a single bundle -- so running both the
// "reverted" and "fixed" measurements in the same long-lived process via dynamic import would
// only get a fresh module identity for the entry file; the RELATIVE import of `site-audit.js`
// resolves to the exact same URL both times and Node's ESM cache would silently serve the STALE
// (pre-rebuild) compiled code for it. Each measurement runs in its OWN child process instead, so
// there is no possibility of a stale-module false result either way.
const REPEATS_SCRIPT = path.join(here, '_gap262-repeat-child.mjs');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const toLf = (s) => s.replace(/\r\n/g, '\n');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function buildCapabilityRuntime() {
  const tscBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.CMD' : 'tsc');
  execFileSync(tscBin, ['-p', 'tsconfig.json'], {
    cwd: path.join(repoRoot, 'packages', 'capability-runtime'),
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}

function runRepeats(origin, label, repeats) {
  // Hard ceiling so a hung child (this machine is shared and can be under real Chrome-count
  // contention from other concurrent sessions -- see this evidence dir's own process-baseline.txt
  // showing 130+ pre-existing Chrome processes) can never turn into the silent multi-hour hang
  // the orchestrator caught: execFileSync kills the child and throws instead of waiting forever.
  const out = execFileSync(process.execPath, [REPEATS_SCRIPT, origin, label, String(repeats)], {
    cwd: repoRoot,
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    killSignal: 'SIGTERM',
  });
  const lastLine = out.trim().split('\n').pop();
  return JSON.parse(lastLine);
}

async function main() {
  const originalBuf = await fs.readFile(siteAuditTsPath);
  const originalSha = sha256(originalBuf);
  const originalTextLf = toLf(originalBuf.toString('utf8'));
  const usesCrlf = originalBuf.toString('utf8').includes('\r\n');

  // The exact GAP-262 fix-1 line: `since = input.navCommittedAt ?? documentStartedAt;` (direct
  // commit-time scoping). Reverting to the ORIGINAL (B1) fix's own `min()` logic reproduces
  // audit-1's exact finding: min() picks `documentStartedAt` (performance.timeOrigin, which
  // reflects roughly when the navigation STARTED, not when it committed) whenever that's earlier
  // than the real commit -- which it systematically is for any response with real network
  // latency, reopening the contamination window.
  const target = '    since = input.navCommittedAt ?? documentStartedAt;';
  if (!originalTextLf.includes(target)) {
    console.error('FATAL: could not find the GAP-262 fix line to revert -- aborting without touching the file.');
    process.exitCode = 2;
    return;
  }
  const revertedLogicLf = [
    '    if (input.navCommittedAt !== null && documentStartedAt !== null) {',
    '      since = input.navCommittedAt <= documentStartedAt ? input.navCommittedAt : documentStartedAt;',
    '    } else {',
    '      since = input.navCommittedAt ?? documentStartedAt;',
    '    } // GAP-262 REVERTED for confirm test (original B1 min() logic)',
  ].join('\n');
  const revertedTextLf = originalTextLf.replace(target, revertedLogicLf);
  const revertedText = usesCrlf ? revertedTextLf.replace(/\n/g, '\r\n') : revertedTextLf;

  const fixture = await startAuditFixtureServer();
  const out = { originalSha, origin: fixture.origin };
  try {
    await fs.writeFile(siteAuditTsPath, revertedText, 'utf8');
    console.log('[revert] wrote reverted site-audit.ts, building capability-runtime...');
    buildCapabilityRuntime();

    const leaksReverted = await runRepeats(fixture.origin, 'revert262', 10);
    out.reverted = { repeats: 10, leaks: leaksReverted.length, sample: leaksReverted.slice(0, 2) };
    console.log('[revert] reverted-code result:', JSON.stringify({ leaks: out.reverted.leaks, repeats: 10 }));
  } finally {
    await fs.writeFile(siteAuditTsPath, originalBuf);
    const restoredSha = sha256(await fs.readFile(siteAuditTsPath));
    out.restoredMatchesOriginal = restoredSha === originalSha;
    console.log('[restore] sha match:', out.restoredMatchesOriginal);
    console.log('[restore] rebuilding with the real fix...');
    buildCapabilityRuntime();
  }

  const leaksFixed = await runRepeats(fixture.origin, 'confirm262', 10);
  out.fixed = { repeats: 10, leaks: leaksFixed.length, sample: leaksFixed.slice(0, 2) };
  console.log('[confirm] fixed-code result:', JSON.stringify({ leaks: out.fixed.leaks, repeats: 10 }));
  await fixture.close();

  out.pass = out.reverted.leaks > 0 && out.restoredMatchesOriginal === true && out.fixed.leaks === 0;
  await fs.writeFile(path.join(here, 'revert-confirm-gap262.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.pass ? 0 : 1;
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exitCode = 1;
});
