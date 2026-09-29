// FR2-05 revert-and-confirm: proves two load-bearing pieces of the download/upload sandbox fix
// are actually load-bearing, by reverting each to its old (pre-FR2-05) broken behavior, showing
// real tests (and a real live case for the containment fix) fail, then restoring byte-for-byte
// (sha256-verified) and confirming both pass again.
//
// CRLF/LF-aware: reads/writes each file as a raw Buffer (never through a string round-trip that
// could normalize line endings), and verifies the restore with sha256 rather than trusting that
// "we wrote back what we read" was faithful.
//
// Covers:
//   1. path-containment.ts's canonicalizePath — the B2 fix (symlink/junction escape via a
//      not-yet-created tail). Reverted to the old "fall back to the literal path on any error"
//      behavior that let a link with a nonexistent tail escape an allowed root.
//   2. browser-action-engine.ts's constructor default — the B12-adjacent fix for an explicit
//      empty allowedDownloadRoots array (used to crash on `this.allowedDownloadRoots[0]!`).
//
// Run: node tools/scenario-suite/revert-confirm-fr2-05.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import { symlinkSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const CONTAINMENT_FILE = path.join(repoRoot, 'packages', 'browser', 'src', 'actions', 'path-containment.ts');
const ENGINE_FILE = path.join(repoRoot, 'packages', 'browser', 'src', 'actions', 'browser-action-engine.ts');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function run(cmd, args, opts = {}) {
  const out = spawnSync(cmd, args, { cwd: repoRoot, encoding: 'utf-8', shell: true, ...opts });
  return { code: out.status ?? 1, out: (out.stdout ?? '') + (out.stderr ?? '') };
}

function buildBrowser() {
  return run(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), ['-p', '.'], {
    cwd: path.join(repoRoot, 'packages', 'browser'),
  });
}

function runVitest(testFileRelativeToBrowser, grep) {
  const args = ['run', testFileRelativeToBrowser];
  if (grep) args.push('-t', grep);
  return run(path.join(repoRoot, 'node_modules', '.bin', 'vitest'), args, {
    cwd: path.join(repoRoot, 'packages', 'browser'),
  });
}

let overallOk = true;

// ── Part 1: canonicalizePath (B2 fix) ──────────────────────────────────────────────────────
const originalContainment = fs.readFileSync(CONTAINMENT_FILE);
const originalContainmentSha = sha256(originalContainment);
console.log(`[revert-confirm] original sha256(path-containment.ts) = ${originalContainmentSha}`);

const containmentText = originalContainment.toString('utf-8');
const CONTAINMENT_NEEDLE = 'export async function canonicalizePath(p: string): Promise<string> {';
if (!containmentText.includes(CONTAINMENT_NEEDLE)) {
  console.error('[revert-confirm] FATAL: could not find canonicalizePath\'s declaration. Aborting without touching the file.');
  process.exit(1);
}

// Find the function body between the declaration and its matching closing brace (the function is
// the last top-level export in the file at write time — locate by counting braces instead of a
// hand-written end marker, which would rot if the body is ever edited).
function extractFunctionSource(source, declNeedle) {
  const start = source.indexOf(declNeedle);
  if (start === -1) return null;
  let depth = 0;
  let i = source.indexOf('{', start);
  const bodyStart = i;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return { start, end: i + 1, full: source.slice(start, i + 1) };
    }
  }
  return null;
}

const containmentFn = extractFunctionSource(containmentText, CONTAINMENT_NEEDLE);
if (!containmentFn) {
  console.error('[revert-confirm] FATAL: could not isolate canonicalizePath\'s full body. Aborting.');
  process.exit(1);
}

const REVERTED_CANONICALIZE =
  'export async function canonicalizePath(p: string): Promise<string> {\n' +
  '  // REVERT-CONFIRM: reintroduces B2 — falls back to the literal resolved path on ANY error,\n' +
  '  // including a not-yet-created tail behind a link that escapes the root.\n' +
  '  void lstat; // keep the (now otherwise-unused) import referenced so the reverted file still compiles\n' +
  '  const abs = path.resolve(p);\n' +
  '  try {\n' +
  '    return await realpath(abs);\n' +
  '  } catch {\n' +
  '    return abs;\n' +
  '  }\n' +
  '}';

function restoreContainmentAndVerify() {
  fs.writeFileSync(CONTAINMENT_FILE, originalContainment);
  const restored = fs.readFileSync(CONTAINMENT_FILE);
  const restoredSha = sha256(restored);
  const match = restoredSha === originalContainmentSha;
  console.log(`[revert-confirm] restored sha256(path-containment.ts) = ${restoredSha} (${match ? 'MATCHES original' : 'MISMATCH!!'})`);
  if (!match) {
    console.error('[revert-confirm] FATAL: restore of path-containment.ts did not reproduce the original byte-for-byte.');
    overallOk = false;
  }
  return match;
}

let tmpRoot;
try {
  const mutated = containmentText.slice(0, containmentFn.start) + REVERTED_CANONICALIZE + containmentText.slice(containmentFn.end);
  fs.writeFileSync(CONTAINMENT_FILE, mutated, 'utf-8');
  console.log('[revert-confirm] applied revert to canonicalizePath (now falls back to the literal path on any error)');

  const build = buildBrowser();
  if (build.code !== 0) {
    console.error('[revert-confirm] unexpected: reverted build failed to compile:\n' + build.out);
    overallOk = false;
  } else {
    console.log('[revert-confirm] reverted build compiled OK');

    const pc4 = runVitest('tests/unit/path-containment.spec.ts', 'PC4');
    const pc4Failed = pc4.code !== 0;
    console.log(`[revert-confirm] PC4 (junction escape, not-yet-created tail) with the fix reverted: ${pc4Failed ? 'FAILED as expected' : 'unexpectedly still passed'}`);
    if (!pc4Failed) overallOk = false;

    const e1 = runVitest('tests/unit/browser-action-engine.spec.ts', 'E1:');
    const e1Failed = e1.code !== 0;
    console.log(`[revert-confirm] E1 (download_file rejects a junction escape) with the fix reverted: ${e1Failed ? 'FAILED as expected' : 'unexpectedly still passed'}`);
    if (!e1Failed) overallOk = false;

    // A real LIVE case (not just a unit test): reproduce the escape directly against the
    // reverted, rebuilt dist by importing it fresh (bypassing the module cache) and driving
    // findContainingRoot the same way resolveDownloadDir does.
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fr2-05-revert-live-'));
    const root = path.join(tmpRoot, 'root');
    const outside = path.join(tmpRoot, 'outside');
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');

    const distPath = path.join(repoRoot, 'packages', 'browser', 'dist', 'actions', 'path-containment.js');
    const distUrl = pathToFileURL(distPath).href;
    const mod = await import(`${distUrl}?revert-confirm-fr2-05=${Date.now()}`);
    const hit = await mod.findContainingRoot(path.join(root, 'jn', 'newsub'), [root]);
    const liveEscapes = hit !== undefined; // with the fix reverted, this WRONGLY reports "contained"
    console.log(`[revert-confirm] live case: findContainingRoot(<root>/jn/newsub, [<root>]) with the fix reverted returned ${JSON.stringify(hit)} (escape ${liveEscapes ? 'REPRODUCED (bad, as expected of the reverted code)' : 'did NOT reproduce — unexpected'})`);
    if (!liveEscapes) overallOk = false;
  }
} finally {
  restoreContainmentAndVerify();
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });

  const rebuild = buildBrowser();
  if (rebuild.code !== 0) {
    console.error('[revert-confirm] FATAL: rebuild after restoring path-containment.ts failed:\n' + rebuild.out);
    overallOk = false;
  }
  const pc4After = runVitest('tests/unit/path-containment.spec.ts', 'PC4');
  const e1After = runVitest('tests/unit/browser-action-engine.spec.ts', 'E1:');
  console.log(`[revert-confirm] after restore: PC4 ${pc4After.code === 0 ? 'PASSES' : 'still fails (BAD)'}, E1 ${e1After.code === 0 ? 'PASSES' : 'still fails (BAD)'}`);
  if (pc4After.code !== 0 || e1After.code !== 0) overallOk = false;
}

// ── Part 2: engine constructor's empty-array default (E10) ────────────────────────────────
const originalEngine = fs.readFileSync(ENGINE_FILE);
const originalEngineSha = sha256(originalEngine);
console.log(`\n[revert-confirm] original sha256(browser-action-engine.ts) = ${originalEngineSha}`);

const engineText = originalEngine.toString('utf-8');
const ENGINE_NEEDLE =
  'this.allowedDownloadRoots = (allowedDownloadRoots?.length ? allowedDownloadRoots : [defaultDownloadRoot()]).map(';
const ENGINE_REPLACEMENT = 'this.allowedDownloadRoots = (allowedDownloadRoots ?? [defaultDownloadRoot()]).map(';

if (!engineText.includes(ENGINE_NEEDLE)) {
  console.error('[revert-confirm] FATAL: could not find the constructor\'s default-roots line. Aborting without touching the file.');
  overallOk = false;
} else {
  function restoreEngineAndVerify() {
    fs.writeFileSync(ENGINE_FILE, originalEngine);
    const restored = fs.readFileSync(ENGINE_FILE);
    const restoredSha = sha256(restored);
    const match = restoredSha === originalEngineSha;
    console.log(`[revert-confirm] restored sha256(browser-action-engine.ts) = ${restoredSha} (${match ? 'MATCHES original' : 'MISMATCH!!'})`);
    if (!match) {
      console.error('[revert-confirm] FATAL: restore of browser-action-engine.ts did not reproduce the original byte-for-byte.');
      overallOk = false;
    }
    return match;
  }

  try {
    const mutated = engineText.replace(ENGINE_NEEDLE, ENGINE_REPLACEMENT);
    fs.writeFileSync(ENGINE_FILE, mutated, 'utf-8');
    console.log('[revert-confirm] applied revert to the constructor default (an explicit [] now crashes again, per the pre-fix `?? default` semantics)');

    const build = buildBrowser();
    if (build.code !== 0) {
      console.error('[revert-confirm] unexpected: reverted build failed to compile:\n' + build.out);
      overallOk = false;
    } else {
      const e10 = runVitest('tests/unit/browser-action-engine.spec.ts', 'E10:');
      const e10Failed = e10.code !== 0;
      console.log(`[revert-confirm] E10 (explicit [] behaves like the default) with the fix reverted: ${e10Failed ? 'FAILED as expected' : 'unexpectedly still passed'}`);
      if (!e10Failed) overallOk = false;
    }
  } finally {
    restoreEngineAndVerify();
    const rebuild = buildBrowser();
    if (rebuild.code !== 0) {
      console.error('[revert-confirm] FATAL: rebuild after restoring browser-action-engine.ts failed:\n' + rebuild.out);
      overallOk = false;
    }
    const e10After = runVitest('tests/unit/browser-action-engine.spec.ts', 'E10:');
    console.log(`[revert-confirm] after restore: E10 ${e10After.code === 0 ? 'PASSES' : 'still fails (BAD)'}`);
    if (e10After.code !== 0) overallOk = false;
  }
}

console.log(overallOk ? '\n[revert-confirm] RESULT: OK — both pieces are load-bearing and the restores are verified.' : '\n[revert-confirm] RESULT: FAILED — see above.');
process.exitCode = overallOk ? 0 : 1;
