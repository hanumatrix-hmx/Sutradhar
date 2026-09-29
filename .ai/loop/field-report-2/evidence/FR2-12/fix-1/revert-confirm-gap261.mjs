// FR2-12 fix-1, GAP-261 revert-and-confirm: proves the fix is load-bearing by reverting the exact
// stdout/stderr-routing change in packages/cli/src/cli.ts, rebuilding, and showing the live L21
// case (a default-policy dialog left over from an earlier command must block the NEXT
// `audit --json` with stdout still being exactly one parseable JSON document) fails under the
// reverted code, then restoring the real fix and confirming it passes again.
//
// CRLF/LF-aware: this repo's git config may check files out with CRLF on Windows, and `git show`
// always returns the blob's stored bytes verbatim -- normalize both to LF before editing/diffing
// so this works regardless of the working tree's line-ending config.
// sha-verified restore: the original file's sha256 is captured before touching anything and
// checked again after restore, so a bug in this script can't silently leave the tree modified.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const cliTsPath = path.join(repoRoot, 'packages', 'cli', 'src', 'cli.ts');
const cliDistPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const { startAuditFixtureServer } = await import(
  pathToFileURL(path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-12-audit-server.mjs'))
);

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const toLf = (s) => s.replace(/\r\n/g, '\n');

function runCli(args, env) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [cliDistPath, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    cp.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function buildCli() {
  const tscBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.CMD' : 'tsc');
  execFileSync(tscBin, ['-p', 'tsconfig.json'], {
    cwd: path.join(repoRoot, 'packages', 'cli'),
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
}

async function main() {
  const originalBuf = await fs.readFile(cliTsPath);
  const originalSha = sha256(originalBuf);
  const originalTextLf = toLf(originalBuf.toString('utf8'));
  const usesCrlf = originalBuf.toString('utf8').includes('\r\n');

  // The exact GAP-261 fix line exercised by the L21 repro below: `main().catch`'s
  // `DialogBlockedError` branch, which decides whether a default/report-policy dialog left open
  // by an earlier command prints the blocked-JSON shape (fixed) or the raw `dialogPending:` text
  // lines (the original bug) on stdout in `--json` mode. Reverting the condition to always take
  // the raw-lines branch reproduces the "JSON replaced by a dialogPending: text line" bug exactly
  // -- everything else in this fix-1 round stays in place, isolating this one change's effect.
  const target = 'if (jsonMode) {\n          console.log(dialogBlockedJsonDoc(err.message, err.dialogs, err.handledRecords));\n        } else {';
  const reverted = 'if (false) {\n          console.log(dialogBlockedJsonDoc(err.message, err.dialogs, err.handledRecords));\n        } else { // GAP-261 REVERTED for confirm test';
  if (!originalTextLf.includes(target)) {
    console.error('FATAL: could not find the GAP-261 fix line to revert -- aborting without touching the file.');
    process.exitCode = 2;
    return;
  }
  const revertedTextLf = originalTextLf.replace(target, reverted);
  const revertedText = usesCrlf ? revertedTextLf.replace(/\n/g, '\r\n') : revertedTextLf;

  const fixture = await startAuditFixtureServer();
  const out = { originalSha, origin: fixture.origin };
  try {
    await fs.writeFile(cliTsPath, revertedText, 'utf8');
    console.log('[revert] wrote reverted cli.ts, building...');
    buildCli();

    const tmp = path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-12', 'fix-1', 'tmp-revert-gap261');
    await fs.mkdir(tmp, { recursive: true });
    const stateDir = path.join(tmp, 'state');
    await fs.mkdir(stateDir, { recursive: true });

    // Reproduces L21's exact shape against a real Chrome: navigate to the clean fixture, fire an
    // alert that stays open (default/report policy), then run `audit --json` -- must fail (JSON
    // corrupted) on the reverted code.
    await runCli(['nav', `${fixture.origin}/clean?n=revert261a`], { SUTRADHAR_CLI_STATE_DIR: stateDir });
    await runCli(['eval', "setTimeout(()=>alert('revert-gap261'),0); 1"], { SUTRADHAR_CLI_STATE_DIR: stateDir });
    await new Promise((r) => setTimeout(r, 300));
    const rReverted = await runCli(['audit', `${fixture.origin}/clean?n=revert261b`, tmp, '--json'], { SUTRADHAR_CLI_STATE_DIR: stateDir });
    let parsedReverted = null;
    try {
      parsedReverted = JSON.parse(rReverted.stdout);
    } catch {}
    out.reverted = { code: rReverted.code, stdoutParses: parsedReverted !== null, stdoutHead: rReverted.stdout.slice(0, 300) };
    console.log('[revert] reverted-code result:', JSON.stringify(out.reverted));

    await runCli(['dialog', 'dismiss'], { SUTRADHAR_CLI_STATE_DIR: stateDir }).catch(() => {});
    await runCli(['close'], { SUTRADHAR_CLI_STATE_DIR: stateDir }).catch(() => {});
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  } finally {
    // Restore, sha-verified.
    await fs.writeFile(cliTsPath, originalBuf);
    const restoredSha = sha256(await fs.readFile(cliTsPath));
    out.restoredMatchesOriginal = restoredSha === originalSha;
    console.log('[restore] sha match:', out.restoredMatchesOriginal);
    console.log('[restore] rebuilding with the real fix...');
    buildCli();
  }

  // Confirm: same repro, now against the restored (real fix) build -- must pass.
  const tmp2 = path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-12', 'fix-1', 'tmp-revert-gap261-confirm');
  await fs.mkdir(tmp2, { recursive: true });
  const stateDir2 = path.join(tmp2, 'state');
  await fs.mkdir(stateDir2, { recursive: true });
  await runCli(['nav', `${fixture.origin}/clean?n=confirm261a`], { SUTRADHAR_CLI_STATE_DIR: stateDir2 });
  await runCli(['eval', "setTimeout(()=>alert('confirm-gap261'),0); 1"], { SUTRADHAR_CLI_STATE_DIR: stateDir2 });
  await new Promise((r) => setTimeout(r, 300));
  const rFixed = await runCli(['audit', `${fixture.origin}/clean?n=confirm261b`, tmp2, '--json'], { SUTRADHAR_CLI_STATE_DIR: stateDir2 });
  let parsedFixed = null;
  try {
    parsedFixed = JSON.parse(rFixed.stdout);
  } catch {}
  out.fixed = { code: rFixed.code, stdoutParses: parsedFixed !== null, dialogPending: parsedFixed?.dialogPending };
  console.log('[confirm] fixed-code result:', JSON.stringify(out.fixed));
  await runCli(['dialog', 'dismiss'], { SUTRADHAR_CLI_STATE_DIR: stateDir2 }).catch(() => {});
  await runCli(['close'], { SUTRADHAR_CLI_STATE_DIR: stateDir2 }).catch(() => {});
  await fs.rm(tmp2, { recursive: true, force: true }).catch(() => {});
  await fixture.close();

  out.pass = out.reverted.stdoutParses === false && out.restoredMatchesOriginal === true && out.fixed.stdoutParses === true && out.fixed.code === 3;
  await fs.writeFile(path.join(here, 'revert-confirm-gap261.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = out.pass ? 0 : 1;
}

main().catch(async (e) => {
  console.error('[fatal]', e);
  process.exitCode = 1;
});
