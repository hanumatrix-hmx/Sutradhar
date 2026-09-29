// FR2-12 fix-2 revert-and-confirm harness: proves each of the 3 fixes actually causes the
// live case to fail when reverted, CRLF/LF-aware, sha256-verified restore. Hard-timeout wrapped
// (child process build/test calls) so a hang can't block the whole probe for hours (the fix-1
// harness's own known failure mode, per decisions.md's 2026-09-27 entry).
//
// Run: node .ai/loop/field-report-2/evidence/FR2-12/fix-2/revert-confirm.mjs
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startAuditFixtureServer } from '../../../../../../tools/scenario-suite/fixtures/fr2-12-audit-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const RUNTIME_TS = path.join(repoRoot, 'packages', 'capability-runtime', 'src', 'runtime.ts');
const ROUTING_TS = path.join(repoRoot, 'packages', 'cli', 'src', 'dialog-json-routing.ts');
const CLI_PATH = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function readFileRaw(p) {
  return fs.readFile(p); // Buffer -- preserves CRLF/LF exactly, no normalization
}

const TSC_BIN = path.join(repoRoot, 'node_modules', '.pnpm', 'typescript@5.4.2', 'node_modules', 'typescript', 'bin', 'tsc');

function runSync(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { cwd: repoRoot, encoding: 'utf-8', timeout: 60000, ...opts });
  } catch (e) {
    const out = [e.stdout, e.stderr].filter(Boolean).join('\n');
    if (out) e.message = `${e.message}\n--- output ---\n${out}`;
    throw e;
  }
}

function withHardTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`HARD TIMEOUT after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

async function rebuild() {
  // Invoke tsc's own JS entry directly via `node` -- bypasses turbo/pnpm's .cmd shims entirely,
  // which choke on execFileSync (EINVAL without shell:true, and shell:true's own arg-concatenation
  // then mis-handles the `--filter=@scope/name` args). Straight `tsc -p <tsconfig>` per package is
  // exactly what each package's own `"build": "tsc"` script runs anyway.
  for (const pkg of ['capability-runtime', 'cli']) {
    runSync(process.execPath, [TSC_BIN, '-p', path.join(repoRoot, 'packages', pkg, 'tsconfig.json')]);
  }
}

function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [CLI_PATH, ...args], { env: { ...process.env, ...opts.env }, cwd: repoRoot });
    let stdout = '', stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    cp.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
async function mktemp(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
function countJsonDocsOnStdout(stdout) {
  const lines = stdout.split('\n');
  let depth = 0, docs = 0;
  for (const line of lines) {
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (depth === 0 && opens > 0) docs++;
    depth += opens - closes;
  }
  return docs;
}

const report = [];
function log(line) {
  report.push(line);
  console.log(line);
}

async function main() {
  // ── Case 1: GAP-266 -- revert the CDP-based main-frame-only listener back to fix-1's
  // Puppeteer page.on('framenavigated') (which fires on same-document navs too). ────────────
  {
    const original = await readFileRaw(RUNTIME_TS);
    const originalSha = sha256(original);
    log(`[revert-confirm] runtime.ts original sha256=${originalSha} bytes=${original.length}`);

    const text = original.toString('utf8');
    const start = text.indexOf('let navCommittedAt: string | null = null;');
    const anchor = 'await this.navigate(sessionId, options.url, options.tabId);';
    const anchorIdx = text.indexOf(anchor);
    if (start === -1 || anchorIdx === -1) throw new Error('could not locate the fix-2 CDP-listener block to revert');
    // Back up from the anchor to the start of its enclosing "if (options.url) {" line.
    const end = text.lastIndexOf('if (options.url) {', anchorIdx);
    if (end === -1 || end <= start) throw new Error('could not locate the enclosing if(options.url) block');
    const before = text.slice(0, start);
    const after = text.slice(end);
    // fix-1-equivalent: plain Puppeteer framenavigated, no main-frame CDP filter, no
    // same-document exclusion -- reintroduces GAP-266/267's exact root cause. `navCdpSession`
    // is kept declared (always null) purely so the UNCHANGED `finally` block later in `after`
    // (which references it) still compiles -- its detach() branch is simply never taken.
    const reverted =
      before +
      `let navCommittedAt: string | null = null;\n` +
      `    let navCdpSession = null as any;\n` +
      `    const onFrameNavigated = (_frame: unknown) => { navCommittedAt = new Date().toISOString(); };\n` +
      `    const canListenForCommit = options.url !== undefined && typeof (page as unknown as { on?: unknown }).on === 'function';\n` +
      `    if (canListenForCommit) (page as unknown as { on: (e: string, cb: (f: unknown) => void) => void }).on('framenavigated', onFrameNavigated);\n` +
      `    try {\n      ` +
      after;
    await fs.writeFile(RUNTIME_TS, reverted, 'utf8');

    let liveResult;
    try {
      await withHardTimeout(rebuild(), 60000, 'rebuild after runtime.ts revert');
      const rtMod = await import(
        `${pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')).href}?bust=${Date.now()}`
      );
      const { SutradharRuntime } = rtMod;
      const fixture = await startAuditFixtureServer();
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const a = await withHardTimeout(
          runtime.audit(sessionId, { url: `${fixture.origin}/samedoc?n=revert1&via=replaceState` }),
          20000,
          'audit() under reverted runtime.ts',
        );
        const texts = a.consoleErrors.map((e) => e.text);
        liveResult = { hasBefore: texts.includes('samedoc-before-revert1'), hasAfter: texts.includes('samedoc-after-revert1'), texts };
      } finally {
        await runtime.shutdownAll();
        await fixture.close();
      }
    } catch (e) {
      liveResult = { error: e.message };
    } finally {
      // R-F: restore from the ORIGINAL in-memory buffer (not a re-read), then verify sha256.
      await fs.writeFile(RUNTIME_TS, original);
      const restored = await readFileRaw(RUNTIME_TS);
      const restoredSha = sha256(restored);
      if (restoredSha !== originalSha) {
        throw new Error(`FATAL: runtime.ts restore sha256 mismatch! original=${originalSha} restored=${restoredSha}`);
      }
      log(`[revert-confirm] runtime.ts restored, sha256 verified match (${restoredSha})`);
    }
    const regressed = liveResult && liveResult.hasBefore === false; // GAP-266's exact symptom: the before-nav error dropped
    log(
      `[revert-confirm] GAP-266 CASE: reverted to fix-1's plain framenavigated listener -> ${
        liveResult?.error ? `ERROR: ${liveResult.error}` : JSON.stringify(liveResult)
      } -- regression reproduced=${regressed}`,
    );
  }

  await withHardTimeout(rebuild(), 60000, 'rebuild after runtime.ts restore');

  // ── Case 2: GAP-268 -- remove the shared guard in writeJsonStdoutOnce (dialog-json-routing.ts)
  // so both writers can fire again. ─────────────────────────────────────────────────────────
  {
    const original = await readFileRaw(ROUTING_TS);
    const originalSha = sha256(original);
    log(`[revert-confirm] dialog-json-routing.ts original sha256=${originalSha} bytes=${original.length}`);

    const text = original.toString('utf8');
    const reverted = text.replace(
      `export function writeJsonStdoutOnce(text: string, sink: typeof console.log = console.log): boolean {\n  if (guardState.printed) return false;\n  guardState.printed = true;\n  sink(text);\n  return true;\n}`,
      `export function writeJsonStdoutOnce(text: string, sink: typeof console.log = console.log): boolean {\n  void guardState; // GUARD REMOVED for revert-confirm -- both writers fire again (kept as a no-op read so this still compiles)\n  sink(text);\n  return true;\n}`,
    );
    if (reverted === text) throw new Error('could not locate writeJsonStdoutOnce to revert');
    await fs.writeFile(ROUTING_TS, reverted, 'utf8');

    let liveResult;
    try {
      await withHardTimeout(rebuild(), 60000, 'rebuild after dialog-json-routing.ts revert');
      const fixture = await startAuditFixtureServer();
      let multiDoc = 0;
      const trials = 10;
      for (let i = 0; i < trials; i++) {
        const stateDir = await mktemp('revertconfirm268');
        const delayMs = 1500 + (i % 10) * 10;
        const url = `${fixture.origin}/alert?n=revert2-${i}&delayMs=${delayMs}`;
        const res = await withHardTimeout(
          runCli(['audit', url, '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }),
          20000,
          `runCli trial ${i} under reverted guard`,
        );
        if (countJsonDocsOnStdout(res.stdout) > 1) multiDoc++;
        await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
        await fs.rm(stateDir, { recursive: true, force: true }).catch(() => {});
      }
      await fixture.close();
      liveResult = { multiDoc, trials };
    } catch (e) {
      liveResult = { error: e.message };
    } finally {
      await fs.writeFile(ROUTING_TS, original);
      const restored = await readFileRaw(ROUTING_TS);
      const restoredSha = sha256(restored);
      if (restoredSha !== originalSha) {
        throw new Error(`FATAL: dialog-json-routing.ts restore sha256 mismatch! original=${originalSha} restored=${restoredSha}`);
      }
      log(`[revert-confirm] dialog-json-routing.ts restored, sha256 verified match (${restoredSha})`);
    }
    const regressed = liveResult && liveResult.multiDoc > 0;
    log(
      `[revert-confirm] GAP-268 CASE: guard removed from writeJsonStdoutOnce -> ${
        liveResult?.error ? `ERROR: ${liveResult.error}` : JSON.stringify(liveResult)
      } -- regression reproduced=${regressed}`,
    );
  }

  await withHardTimeout(rebuild(), 60000, 'final rebuild after all restores');
  log('[revert-confirm] final rebuild with restored sources OK');

  await fs.writeFile(path.join(here, 'revert-confirm-report.txt'), report.join('\n') + '\n', 'utf-8');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[revert-confirm] FATAL', e);
    process.exit(1);
  });
