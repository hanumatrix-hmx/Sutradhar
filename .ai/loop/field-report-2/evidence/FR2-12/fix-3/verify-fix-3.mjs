// FR2-12 fix-3 live-verify: GAP-273 (own-status match must survive hash/replaceState/chrome-error
// shapes) and GAP-274 (the audit() CDP session must never block on Page.enable/Network.enable
// under an open dialog or a timed-out prior navigation, and must never leak the session on any
// error path). Also re-runs the audit-1 AND audit-2 attack surface via the shared fixture server.
//
// Run: node .ai/loop/field-report-2/evidence/FR2-12/fix-3/verify-fix-3.mjs
// Requires: capability-runtime and cli already built (tsc) in this worktree.
//
// Process hygiene: this script only ever touches its own spawned Chrome (via
// runtime.shutdownAll()/browser.process().kill()) and its own spawned `sutradhar` CLI child
// processes (tracked in `spawnedChildren`, killed by PID). It never kills by image name. An
// overall watchdog aborts the whole script well above the worst-case expected duration.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { startAuditFixtureServer } from '../../../../../../tools/scenario-suite/fixtures/fr2-12-audit-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/fix-3')) throw new Error('wrong dir: ' + here);
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const EVIDENCE_DIR = here;
const CLI_PATH = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
const results = [];
let overallOk = true;
function record(entry) {
  results.push(entry);
  const tag = entry.pass === undefined ? 'INFO' : entry.pass ? 'PASS' : 'FAIL';
  if (entry.pass === false) overallOk = false;
  console.log(`[fix-3] ${tag} ${entry.case}${entry.detail ? ' — ' + entry.detail : ''}`);
}

async function mktemp(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
async function rmWithRetry(dir, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      if (i === attempts - 1) return;
      await delay(300);
    }
  }
}

const spawnedChildren = new Set();
function trackChild(cp) {
  spawnedChildren.add(cp);
  cp.on('exit', () => spawnedChildren.delete(cp));
  return cp;
}
async function killTrackedChildren() {
  for (const cp of [...spawnedChildren]) {
    try {
      if (cp.pid && !cp.killed) process.kill(cp.pid);
    } catch {
      /* already gone */
    }
  }
}

function runCli(args, opts = {}) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd ?? repoRoot,
    });
    trackChild(cp);
    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    cp.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
async function freshCliStateDir() {
  return mktemp('sutradhar-fr212-fix3-cli-state');
}
function freshUrl(origin, route, n) {
  return `${origin}${route}?n=${n}`;
}
function cap(p, ms, label) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`CAP ${label} ${ms}ms`)), ms))]);
}

/** Instruments a runtime's CDP session creation so leak/latency can be verified directly,
 *  mirroring the exact technique audit-3's own probe-hang.mjs used to find the GAP-274 leak. */
function instrumentCdp(runtime, sessionId) {
  const { tab } = runtime['resolveTab'](sessionId);
  const page = runtime['requirePage'](tab);
  const orig = page.createCDPSession.bind(page);
  const log = [];
  page.createCDPSession = async () => {
    const t0 = Date.now();
    const s = await orig();
    const rec = { createdAt: new Date().toISOString(), detached: false, createMs: Date.now() - t0 };
    log.push(rec);
    const detach = s.detach.bind(s);
    s.detach = async () => {
      try {
        await detach();
      } finally {
        rec.detached = true;
      }
    };
    return s;
  };
  return log;
}

// A tiny local server used only for the two hang shapes (GAP-274) — never responds, so any
// navigation against it stalls until its own timeout. Kept separate from the shared fixture
// server so the fixture's routes stay untouched by this item's process-hygiene concerns.
function startHangServer() {
  const hungResponses = new Set();
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    if (u.pathname === '/favicon.ico') {
      res.writeHead(200);
      return res.end();
    }
    if (u.pathname === '/hang') {
      hungResponses.add(res);
      return; // never respond
    }
    if (u.pathname === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html lang="en"><head><title>ok</title></head><body><h1>ok</h1></body></html>');
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
            for (const res of hungResponses) {
              try {
                res.destroy();
              } catch {
                /* already gone */
              }
            }
            server.close(() => r(undefined));
          }),
      });
    });
  });
}

async function main() {
  const startedAt = Date.now();
  const fixture = await startAuditFixtureServer();
  const origin = fixture.origin;
  const hangSrv = await startHangServer();

  const rtMod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
  const { SutradharRuntime } = rtMod;

  // ════════════════════════════════════════════════════════════════════════════════════════
  // GAP-273: the audited page's OWN error status must survive when the final page.url() no
  // longer equals the response URL. Four exact audit-3 repro shapes.
  // ════════════════════════════════════════════════════════════════════════════════════════
  const gap273Shapes = [
    { name: 'hash-404', route: '/own-404-samedoc', extra: '&via=hash', wantStatus: 404 },
    { name: 'replaceState-404', route: '/own-404-samedoc', extra: '&via=replaceState', wantStatus: 404 },
    { name: 'emptybody-404', route: '/own-404-emptybody', extra: '', wantStatus: 404 },
    { name: 'emptybody-500', route: '/own-500-emptybody', extra: '', wantStatus: 500 },
  ];
  // Controls, expected to already pass (must not regress): plain own-404, and a URL that
  // already carries a #fragment before the audit even starts.
  const controls = [
    { name: 'control-plain-own-404', route: '/own-404', extra: '', wantStatus: 404 },
    { name: 'control-own-404-with-fragment', route: '/own-404', extra: '#already-there', wantStatus: 404 },
  ];

  for (const shape of [...gap273Shapes, ...controls]) {
    const trials = 10;
    let okCount = 0;
    const samples = [];
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const url = freshUrl(origin, shape.route, `${shape.name}-${i}`) + shape.extra;
        const a = await cap(runtime.audit(sessionId, { url }), 20000, `audit ${shape.name}`);
        const hit = a.brokenRequests.some((b) => b.status === shape.wantStatus);
        if (hit) okCount++;
        if (i === 0) samples.push({ finalUrl: a.url, brokenRequests: a.brokenRequests });
      } catch (e) {
        samples.push({ error: String(e?.message ?? e) });
      } finally {
        await cap(runtime.shutdownAll(), 15000, 'shutdown').catch(() => {});
      }
    }
    record({
      case: `GAP-273 runtime.audit ${shape.name}`,
      pass: okCount === trials,
      detail: `${okCount}/${trials} — sample=${JSON.stringify(samples[0] ?? {})}`,
    });
  }

  // Same shapes via the CLI's --json path (fewer trials — matches the established "N runtime +
  // fewer CLI" convention from audit-2/audit-3 for this exact class of case).
  for (const shape of gap273Shapes) {
    const trials = 6;
    let okCount = 0;
    for (let i = 0; i < trials; i++) {
      const stateDir = await freshCliStateDir();
      const url = freshUrl(origin, shape.route, `${shape.name}-cli-${i}`) + shape.extra;
      // NB: found live while writing process-hygiene evidence -- the correct override is
      // `SUTRADHAR_CLI_STATE_DIR` (see packages/cli/src/state.ts), not `SUTRADHAR_STATE_DIR`.
      // An earlier version of this script used the wrong name, so every trial silently shared
      // the repo-cwd-scoped default state dir instead of an isolated temp one, leaking one
      // `__dialog-warden` background process tied to that shared session (found and killed by
      // PID during this cycle's process-hygiene check; see process-after.txt). The results were
      // still correct (each trial still ran a real, fresh audit against a fresh URL), but the
      // isolation was not what was intended -- fixed here.
      const { code, stdout, stderr } = await runCli(['audit', url, '--json'], {
        env: { SUTRADHAR_CLI_STATE_DIR: stateDir },
      });
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        /* leave null */
      }
      const hit = !!parsed?.brokenRequests?.some((b) => b.status === shape.wantStatus);
      if (hit) okCount++;
      else if (i === 0) record({ case: `GAP-273 CLI ${shape.name} first-failure-detail`, detail: `code=${code} stdout=${stdout.slice(0, 400)} stderr=${stderr.slice(0, 300)}` });
      await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
      await rmWithRetry(stateDir);
    }
    record({ case: `GAP-273 CLI --json ${shape.name}`, pass: okCount === trials, detail: `${okCount}/${trials}` });
  }

  // ════════════════════════════════════════════════════════════════════════════════════════
  // GAP-274 (a): an open dialog on the CURRENT page must not make the NEXT audit() (a new URL)
  // stall beyond a short bounded window.
  // ════════════════════════════════════════════════════════════════════════════════════════
  {
    const trials = 3;
    const BOUND_MS = 15000; // generous vs. AUDIT_CDP_SETUP_BOUND_MS=1000; must be nowhere near the
    // old ~31s (dialog) / 180-200s (timed-out nav) hangs this item is fixing.
    let okCount = 0;
    const timings = [];
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      const cdpLog = instrumentCdp(runtime, sessionId);
      try {
        await runtime.navigate(sessionId, freshUrl(origin, '/alert', `dlg-${i}`) + '&delayMs=100');
        await delay(600); // let the alert actually open
        const pendingBefore = runtime.getPendingDialog(sessionId);
        const t0 = Date.now();
        const a = await cap(runtime.audit(sessionId, { url: freshUrl(origin, '/clean', `dlg-audit-${i}`) }), BOUND_MS, 'audit-under-dialog');
        const ms = Date.now() - t0;
        timings.push(ms);
        const leaked = cdpLog.filter((r) => !r.detached).length;
        if (a && ms < BOUND_MS && leaked === 0 && pendingBefore) okCount++;
        else record({ case: `GAP-274a trial ${i} detail`, detail: `ms=${ms} leaked=${leaked} pendingBefore=${!!pendingBefore} title=${a?.title}` });
      } catch (e) {
        record({ case: `GAP-274a trial ${i} error`, detail: String(e?.message ?? e) });
      } finally {
        await cap(runtime.shutdownAll(), 15000, 'shutdown').catch(() => {});
      }
    }
    record({ case: 'GAP-274a dialog-open-before-audit no longer stalls', pass: okCount === trials, detail: `${okCount}/${trials}, timings=${JSON.stringify(timings)}ms (bound ${BOUND_MS}ms)` });
  }

  // ════════════════════════════════════════════════════════════════════════════════════════
  // GAP-274 (b): a previous navigation that timed out with no response must not make audit() on
  // a healthy next target stall beyond a short bounded window, and must not leak the CDP
  // session on that path (audit-3's exact "67 created / 66 detached" leak).
  // ════════════════════════════════════════════════════════════════════════════════════════
  {
    const trials = 3;
    const BOUND_MS = 15000;
    let okCount = 0;
    const timings = [];
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      const { tab } = runtime['resolveTab'](sessionId);
      const page = runtime['requirePage'](tab);
      const cdpLog = instrumentCdp(runtime, sessionId);
      try {
        // Produce "a previous navigation that timed out with no response" quickly (2s, not the
        // production 30s default) by going around runtime.navigate's fixed 30000ms timeout
        // directly on the same underlying Puppeteer page — the resulting browser/frame state
        // (a navigation attempt left in flight against a target that never responds) is what
        // actually matters for GAP-274, not the specific timeout duration used to produce it.
        await page.goto(`${hangSrv.origin}/hang?n=${i}`, { waitUntil: 'domcontentloaded', timeout: 2000 }).catch(() => {});
        const t0 = Date.now();
        const a = await cap(runtime.audit(sessionId, { url: freshUrl(origin, '/clean', `nav-timeout-${i}`) }), BOUND_MS, 'audit-after-timed-out-nav');
        const ms = Date.now() - t0;
        timings.push(ms);
        const leaked = cdpLog.filter((r) => !r.detached).length;
        if (a && ms < BOUND_MS && leaked === 0) okCount++;
        else record({ case: `GAP-274b trial ${i} detail`, detail: `ms=${ms} leaked=${leaked} createdCount=${cdpLog.length} title=${a?.title}` });
      } catch (e) {
        record({ case: `GAP-274b trial ${i} error`, detail: String(e?.message ?? e) });
      } finally {
        await cap(runtime.shutdownAll(), 15000, 'shutdown').catch(() => {});
      }
    }
    record({ case: 'GAP-274b timed-out-prior-nav-before-audit no longer stalls, no leak', pass: okCount === trials, detail: `${okCount}/${trials}, timings=${JSON.stringify(timings)}ms (bound ${BOUND_MS}ms)` });
  }

  // ════════════════════════════════════════════════════════════════════════════════════════
  // Adversarial follow-up named explicitly in the brief: a dialog opening WHILE the new
  // bounded Page.enable call is in flight, not before it. Race the alert's open against the
  // CDP setup window (AUDIT_CDP_SETUP_BOUND_MS=1000ms) by starting the audit on a page that
  // opens its alert ~50-300ms after navigation starts (well inside that window).
  // ════════════════════════════════════════════════════════════════════════════════════════
  {
    const trials = 5;
    const BOUND_MS = 15000;
    let okCount = 0;
    const timings = [];
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      const cdpLog = instrumentCdp(runtime, sessionId);
      try {
        const t0 = Date.now();
        // /alert with a short delayMs means the alert opens DURING this very audit()'s own
        // navigation+settle window, i.e. potentially while the CDP setup above is still racing
        // its own bound — not before audit() was even called (that's GAP-274a).
        const a = await cap(
          runtime.audit(sessionId, { url: freshUrl(origin, '/alert', `race-${i}`) + '&delayMs=150' }),
          BOUND_MS,
          'audit-racing-dialog',
        );
        const ms = Date.now() - t0;
        timings.push(ms);
        const leaked = cdpLog.filter((r) => !r.detached).length;
        // The audit itself may legitimately throw D11's "a dialog is open" error if the alert
        // won the race and is already open by the time the dialog check runs — that's correct,
        // documented behavior, not a failure. What must NEVER happen is exceeding BOUND_MS or
        // leaking the session.
        if (ms < BOUND_MS && leaked === 0) okCount++;
        else record({ case: `GAP-274 race trial ${i} detail`, detail: `ms=${ms} leaked=${leaked} threw=${a === undefined}` });
      } catch (e) {
        // The audit itself may legitimately throw D11's "a dialog is open" error if the alert
        // won the race — correct, documented behavior. Only a leak or an unbounded stall (the
        // CAP() timeout rejecting with 'CAP audit-racing-dialog...') counts as a failure here.
        const leaked = cdpLog.filter((r) => !r.detached).length;
        const isCapTimeout = /^CAP /.test(String(e?.message ?? ''));
        timings.push(isCapTimeout ? `>=${BOUND_MS}(CAP)` : 'threw');
        if (!isCapTimeout && leaked === 0) okCount++;
        else record({ case: `GAP-274 race trial ${i} leak-or-stall`, detail: `leaked=${leaked} error=${String(e?.message ?? e)}` });
      } finally {
        await cap(runtime.shutdownAll(), 15000, 'shutdown').catch(() => {});
      }
    }
    record({ case: 'GAP-274 dialog-races-CDP-setup adversarial follow-up', pass: okCount === trials, detail: `${okCount}/${trials}, timings=${JSON.stringify(timings)}ms` });
  }

  // ════════════════════════════════════════════════════════════════════════════════════════
  // Re-run: does the fix for GAP-273/274 reopen anything audit-1/audit-2/audit-3 already
  // confirmed? Same-document nav (GAP-266), own-status (GAP-267 base cases), redirect chains,
  // repeated audits (session-leak sanity at higher volume), GAP-262 contamination.
  // ════════════════════════════════════════════════════════════════════════════════════════
  for (const via of ['replaceState', 'pushState', 'hash']) {
    let okCount = 0;
    const trials = 5;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/samedoc', `regress-${via}-${i}`) + `&via=${via}` });
        const texts = a.consoleErrors.map((e) => e.text);
        if (texts.some((t) => t.startsWith('samedoc-before-')) && texts.some((t) => t.startsWith('samedoc-after-'))) okCount++;
      } finally {
        await cap(runtime.shutdownAll(), 15000, 'shutdown').catch(() => {});
      }
    }
    record({ case: `Regress GAP-266 same-doc (${via})`, pass: okCount === trials, detail: `${okCount}/${trials}` });
  }
  {
    let okCount = 0;
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        await runtime.navigate(sessionId, freshUrl(origin, '/noisy', `contam-${i}`));
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/clean', `contam-${i}`) });
        const clean = a.consoleErrors.length === 0 && a.brokenRequests.length === 0;
        if (clean) okCount++;
      } finally {
        await cap(runtime.shutdownAll(), 15000, 'shutdown').catch(() => {});
      }
    }
    record({ case: 'Regress GAP-262 contamination (noisy then clean)', pass: okCount === trials, detail: `${okCount}/${trials}` });
  }
  {
    // 25 repeated audits in one long-lived session — session-leak sanity at higher volume than
    // the two targeted GAP-274 cases above, this time on the HEALTHY (non-hanging) path.
    const runtime = new SutradharRuntime({});
    const { sessionId } = await runtime.launch({ launch: { headless: true } });
    const cdpLog = instrumentCdp(runtime, sessionId);
    let ok = true;
    try {
      for (let i = 0; i < 25; i++) {
        await cap(runtime.audit(sessionId, { url: freshUrl(origin, '/clean', `repeat-${i}`) }), 20000, `repeat-${i}`);
      }
    } catch (e) {
      ok = false;
      record({ case: 'Regress 25x repeated audits error', detail: String(e?.message ?? e) });
    } finally {
      await cap(runtime.shutdownAll(), 15000, 'shutdown').catch(() => {});
    }
    const leaked = cdpLog.filter((r) => !r.detached).length;
    record({ case: '25x repeated audits, no CDP session leak', pass: ok && leaked === 0, detail: `created=${cdpLog.length} leaked=${leaked}` });
  }

  await fixture.close();
  await hangSrv.close();
  await killTrackedChildren();

  const summary = { startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, overallOk, results };
  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[fix-3] ${overallOk ? 'ALL PASS' : 'SOME FAILED'} — ${results.filter((r) => r.pass === true).length} pass / ${results.filter((r) => r.pass === false).length} fail / ${results.filter((r) => r.pass === undefined).length} info`);
  process.exit(overallOk ? 0 : 1);
}

// Outer hard timeout: this script deliberately exercises what used to be 30-200s+ hangs. If the
// fix regressed, individual `cap()` calls above already bound each step, but as a last line of
// defense the WHOLE script self-aborts well beyond its own expected worst case (~3-4 minutes).
const WATCHDOG_MS = 15 * 60 * 1000;
const watchdog = setTimeout(async () => {
  console.error('[fix-3] WATCHDOG: script exceeded 15 minutes — aborting.');
  process.exit(3);
}, WATCHDOG_MS);
watchdog.unref?.();

main()
  .then(() => clearTimeout(watchdog))
  .catch((e) => {
    clearTimeout(watchdog);
    console.error('[fix-3] FATAL', e);
    process.exit(2);
  });
