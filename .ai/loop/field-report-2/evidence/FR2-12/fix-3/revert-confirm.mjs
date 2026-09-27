// FR2-12 fix-3 revert-and-confirm harness: proves each of the 2 fixes actually causes the live
// case to fail when reverted, CRLF/LF-aware, sha256-verified restore. Hard-timeout wrapped so a
// hang can't block the whole probe (fix-1's own known failure mode, per decisions.md).
//
// Run: node .ai/loop/field-report-2/evidence/FR2-12/fix-3/revert-confirm.mjs
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startAuditFixtureServer } from '../../../../../../tools/scenario-suite/fixtures/fr2-12-audit-server.mjs';

/** Never responds -- used to produce "a previous navigation that timed out with no response"
 *  (GAP-274 sub-case b), same technique as verify-fix-3.mjs's own startHangServer(). */
function startHangServer() {
  const hung = new Set();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/hang') {
      hung.add(res);
      return;
    }
    res.writeHead(404);
    res.end('not-found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({
        origin,
        close: () =>
          new Promise((r) => {
            for (const res of hung) {
              try {
                res.destroy();
              } catch {}
            }
            server.close(() => r(undefined));
          }),
      });
    });
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const RUNTIME_TS = path.join(repoRoot, 'packages', 'capability-runtime', 'src', 'runtime.ts');

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
  for (const pkg of ['capability-runtime']) {
    runSync(process.execPath, [TSC_BIN, '-p', path.join(repoRoot, 'packages', pkg, 'tsconfig.json')]);
  }
}
async function freshImport() {
  const mod = await import(
    `${pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')).href}?bust=${Date.now()}-${Math.random()}`
  );
  return mod.SutradharRuntime;
}

const report = [];
function log(line) {
  report.push(line);
  console.log(line);
}

async function main() {
  const original = await readFileRaw(RUNTIME_TS);
  const originalSha = sha256(original);
  log(`[revert-confirm] runtime.ts original sha256=${originalSha} bytes=${original.length}`);
  const originalText = original.toString('utf8');

  // ── Case 1: GAP-273 -- drop the live CDP-captured main-document response, falling back to
  // fix-2's exact final-page.url() string match. ─────────────────────────────────────────────
  {
    // NB: this worktree's runtime.ts uses CRLF line endings — the anchor is built with `\r\n`
    // (not `\n`) so the exact-byte match below actually finds it.
    const anchor = [
      'const mainDocumentResponse =',
      '      mainDocumentResponseCapture ??',
      "      [...tab.getNetworkLog()].reverse().find((n) => n.phase === 'response' && n.resourceType === 'document' && n.url === url);",
    ].join('\r\n');
    if (!originalText.includes(anchor)) throw new Error('could not locate the GAP-273 mainDocumentResponse assignment to revert');
    const reverted = originalText.replace(
      anchor,
      "void mainDocumentResponseCapture; // GAP-273 REVERTED: live capture ignored (kept as a no-op read so this still compiles), fix-2's string-match only\r\n    const mainDocumentResponse =\r\n      [...tab.getNetworkLog()].reverse().find((n) => n.phase === 'response' && n.resourceType === 'document' && n.url === url);",
    );
    if (reverted === originalText) throw new Error('GAP-273 revert produced no change');
    await fs.writeFile(RUNTIME_TS, reverted, 'utf8');

    let liveResult;
    try {
      await withHardTimeout(rebuild(), 60000, 'rebuild after GAP-273 revert');
      const SutradharRuntime = await freshImport();
      const fixture = await startAuditFixtureServer();
      const results = {};
      try {
        for (const [name, route, extra, wantStatus] of [
          ['hash-404', '/own-404-samedoc', '&via=hash', 404],
          ['emptybody-404', '/own-404-emptybody', '', 404],
        ]) {
          const runtime = new SutradharRuntime({});
          const { sessionId } = await runtime.launch({ launch: { headless: true } });
          try {
            const a = await withHardTimeout(
              runtime.audit(sessionId, { url: `${fixture.origin}${route}?n=revert-273-${name}${extra}` }),
              20000,
              `audit ${name} under reverted GAP-273`,
            );
            results[name] = { hit: a.brokenRequests.some((b) => b.status === wantStatus), finalUrl: a.url, brokenRequests: a.brokenRequests };
          } finally {
            await runtime.shutdownAll();
          }
        }
      } finally {
        await fixture.close();
      }
      liveResult = results;
    } catch (e) {
      liveResult = { error: e.message };
    } finally {
      await fs.writeFile(RUNTIME_TS, original);
      const restored = await readFileRaw(RUNTIME_TS);
      const restoredSha = sha256(restored);
      if (restoredSha !== originalSha) throw new Error(`FATAL: runtime.ts restore sha256 mismatch! original=${originalSha} restored=${restoredSha}`);
      log(`[revert-confirm] runtime.ts restored, sha256 verified match (${restoredSha})`);
    }
    const regressed = liveResult && !liveResult.error && liveResult['hash-404']?.hit === false && liveResult['emptybody-404']?.hit === false;
    log(`[revert-confirm] GAP-273 CASE: live capture removed, fallback to page.url() string-match only -> ${liveResult?.error ? `ERROR: ${liveResult.error}` : JSON.stringify(liveResult)} -- regression reproduced=${regressed}`);
  }

  await withHardTimeout(rebuild(), 60000, 'rebuild after GAP-273 restore');

  // ── Case 2: GAP-274 -- make the CDP setup unbounded again (plain awaited Page.enable /
  // Network.enable / Page.getFrameTree, no boundedFireAndForget). ────────────────────────────
  {
    // Located by start/end markers rather than a hand-transcribed literal (this worktree uses
    // CRLF line endings, which a hand-typed template literal would silently get wrong) — exact
    // bytes are sliced straight out of the live source, so no anchor drift is possible.
    const anchorStart = 'await boundedFireAndForget(';
    const anchorEndMarker = 'AUDIT_CDP_SETUP_BOUND_MS,\r\n          );';
    const sIdx = originalText.indexOf(anchorStart);
    const eIdx = originalText.indexOf(anchorEndMarker, sIdx);
    if (sIdx === -1 || eIdx === -1) throw new Error('could not locate the GAP-274 boundedFireAndForget call to revert');
    const anchor = originalText.slice(sIdx, eIdx + anchorEndMarker.length);
    const reverted = originalText.replace(
      anchor,
      "void AUDIT_CDP_SETUP_BOUND_MS; // GAP-274 REVERTED: no bound -- awaits Page.enable/Network.enable/getFrameTree directly (kept as a no-op read so this still compiles).\r\n          await client.send('Page.enable').catch(() => {});\r\n          await client.send('Network.enable').catch(() => {});\r\n          try {\r\n            const tree = (await client.send('Page.getFrameTree')) as { frameTree?: { frame?: { id?: string } } } | null;\r\n            const treeFrameId = tree?.frameTree?.frame?.id;\r\n            if (treeFrameId) mainFrameId = treeFrameId;\r\n          } catch {}",
    );
    if (reverted === originalText) throw new Error('GAP-274 revert produced no change');
    await fs.writeFile(RUNTIME_TS, reverted, 'utf8');

    let liveResult;
    let liveResultA;
    let liveResultB;
    try {
      await withHardTimeout(rebuild(), 60000, 'rebuild after GAP-274 revert');
      const SutradharRuntime = await freshImport();
      const fixture = await startAuditFixtureServer();
      const hangSrv = await startHangServer();
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        // dialogPolicy 'report': the default is 'auto', which resolves the dialog itself almost
        // immediately -- under 'auto' the dialog is gone before audit()'s own CDP session ever
        // gets to Page.enable, so no hang can occur regardless of this fix (found live: the
        // first version of this harness used the default and could NOT reproduce the hang even
        // with the bound removed). 'report' leaves the dialog genuinely open and pending, which
        // is what actually exercises the hazard.
        runtime.setDialogPolicy(sessionId, { mode: 'report' });
        await runtime.navigate(sessionId, `${fixture.origin}/alert?n=revert274a&delayMs=100`);
        await new Promise((r) => setTimeout(r, 600));
        const pending = runtime.getPendingDialog(sessionId);
        const t0 = Date.now();
        // Bounded at 8s here purely so THIS harness doesn't itself hang for 30s+ per the
        // process-hygiene rule -- under the fix this always returns in ~1-3s (see
        // verify-fix-3.mjs's own measured 2.5-2.6s), so racing it against 8s is a fair test:
        // if the revert reproduces the hang, this rejects with the CAP timeout below.
        let hung = false;
        try {
          await withHardTimeout(runtime.audit(sessionId, { url: `${fixture.origin}/clean?n=revert274a-audit` }), 8000, 'audit under reverted GAP-274a');
        } catch (e) {
          hung = /HARD TIMEOUT/.test(e.message);
          if (!hung) throw e;
        }
        liveResultA = { pendingWasSet: !!pending, elapsedAtLeastMs: Date.now() - t0, hungPast8s: hung };
      } finally {
        await runtime.shutdownAll();
      }

      // Sub-case (b): a previous navigation that timed out with no response, then audit() a
      // healthy next target -- audit-3's actual 180-200s+ shape (the dialog case above measured
      // ~31s; this is the more severe one).
      const runtimeB = new SutradharRuntime({});
      const { sessionId: sessionIdB } = await runtimeB.launch({ launch: { headless: true } });
      try {
        const { tab } = runtimeB['resolveTab'](sessionIdB);
        const page = runtimeB['requirePage'](tab);
        await page.goto(`${hangSrv.origin}/hang?n=revert274b`, { waitUntil: 'domcontentloaded', timeout: 2000 }).catch(() => {});
        const t0 = Date.now();
        let hung = false;
        try {
          await withHardTimeout(runtimeB.audit(sessionIdB, { url: `${fixture.origin}/clean?n=revert274b-audit` }), 8000, 'audit under reverted GAP-274b');
        } catch (e) {
          hung = /HARD TIMEOUT/.test(e.message);
          if (!hung) throw e;
        }
        liveResultB = { elapsedAtLeastMs: Date.now() - t0, hungPast8s: hung };
      } finally {
        await runtimeB.shutdownAll();
        await fixture.close();
        await hangSrv.close();
      }
      liveResult = { a: liveResultA, b: liveResultB };
    } catch (e) {
      liveResult = { error: e.message, a: liveResultA, b: liveResultB };
    } finally {
      await fs.writeFile(RUNTIME_TS, original);
      const restored = await readFileRaw(RUNTIME_TS);
      const restoredSha = sha256(restored);
      if (restoredSha !== originalSha) throw new Error(`FATAL: runtime.ts restore sha256 mismatch! original=${originalSha} restored=${restoredSha}`);
      log(`[revert-confirm] runtime.ts restored, sha256 verified match (${restoredSha})`);
    }
    const regressedA = liveResultA && liveResultA.pendingWasSet && liveResultA.hungPast8s;
    const regressedB = liveResultB && liveResultB.hungPast8s;
    log(`[revert-confirm] GAP-274 CASE: bounded setup removed, Page.enable/Network.enable/getFrameTree awaited directly -> ${liveResult?.error ? `ERROR: ${liveResult.error}` : JSON.stringify(liveResult)} -- regression reproduced: (a) dialog=${regressedA}, (b) timed-out-nav=${regressedB}`);
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
