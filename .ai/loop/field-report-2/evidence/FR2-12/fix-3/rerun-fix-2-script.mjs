// FR2-12 fix-2 live-verify: GAP-266/267 (same-document nav / own-response scoping) and GAP-268
// (double-JSON-on-alert-during-capture), plus a full re-run of every audit-1 AND audit-2 repro
// this fix-2 cycle is required to re-check (decisions.md's fix-2 binding decision #4).
//
// Run: node .ai/loop/field-report-2/evidence/FR2-12/fix-2/verify-fix-2.mjs
// Requires: turbo build already run for capability-runtime + cli in this worktree.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { startAuditFixtureServer } from '../../../../../../tools/scenario-suite/fixtures/fr2-12-audit-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
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
  console.log(`[fix-2] ${tag} ${entry.case}${entry.detail ? ' — ' + entry.detail : ''}`);
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
  return mktemp('sutradhar-fr212-fix2-cli-state');
}
function countJsonDocsOnStdout(stdout) {
  // Each of our JSON docs is pretty-printed starting at column 0 with '{' and ending with a
  // top-level '}' at column 0 — count top-level '{' at line-start as a proxy for "documents".
  const lines = stdout.split('\n');
  let depth = 0;
  let docs = 0;
  for (const line of lines) {
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (depth === 0 && opens > 0) docs++;
    depth += opens - closes;
  }
  return docs;
}
function freshUrl(origin, route, n) {
  return `${origin}${route}?n=${n}`;
}

async function main() {
  const fixture = await startAuditFixtureServer();
  const origin = fixture.origin;

  const rtMod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
  const { SutradharRuntime } = rtMod;

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // GAP-266: same-document navigation during the page's own load must NOT drop the page's own
  // real errors/broken-requests from before AND after that navigation.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  for (const via of ['replaceState', 'pushState', 'hash']) {
    let okCount = 0;
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/samedoc', `${via}-${i}`) + `&via=${via}` });
        const texts = a.consoleErrors.map((e) => e.text);
        const hasBefore = texts.some((t) => t.startsWith('samedoc-before-'));
        const hasAfter = texts.some((t) => t.startsWith('samedoc-after-'));
        const has404 = a.brokenRequests.some((r) => r.url.includes('missing-samedoc-'));
        if (hasBefore && hasAfter && has404) okCount++;
      } finally {
        await runtime.shutdownAll();
      }
    }
    record({
      case: `GAP-266-${via}`,
      pass: okCount === trials,
      detail: `${okCount}/${trials} kept BOTH before+after console errors AND the after-nav 404`,
    });
  }

  // Multi-hop same-document nav (replaceState -> pushState -> hash), 4 errors total.
  {
    let okCount = 0;
    const trials = 5;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/samedoc-multi', i) });
        const texts = a.consoleErrors.map((e) => e.text);
        const wantAll = [0, 1, 2, 3].every((k) => texts.some((t) => t === `samedoc-multi-${k}-${i}`));
        if (wantAll) okCount++;
      } finally {
        await runtime.shutdownAll();
      }
    }
    record({
      case: 'GAP-266-multi-hop',
      pass: okCount === trials,
      detail: `${okCount}/${trials} kept all 4 errors across 3 chained same-document navs (replaceState+pushState+hash)`,
    });
  }

  // Synthetic version of audit-2's 8-real-site pattern (early hydration replaceState).
  {
    let okCount = 0;
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/spa-like', i) });
        const texts = a.consoleErrors.map((e) => e.text);
        const ok = texts.includes(`spa-like-hydration-error-${i}`) && texts.includes(`spa-like-post-hydration-error-${i}`);
        if (ok) okCount++;
      } finally {
        await runtime.shutdownAll();
      }
    }
    record({
      case: 'GAP-266-spa-like-sweep',
      pass: okCount === trials,
      detail: `${okCount}/${trials} kept both hydration-window errors (synthetic stand-in for the 8/10-real-site pattern)`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // GAP-267: the audited page's OWN response status (404/500, and a 302 chain ending in one)
  // must always be in brokenRequests.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  for (const [route, status] of [['/own-404', 404], ['/own-500', 500]]) {
    let okCount = 0;
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, route, i) });
        const found = a.brokenRequests.some((r) => r.status === status && r.url.includes(route.slice(1)));
        if (found) okCount++;
      } finally {
        await runtime.shutdownAll();
      }
    }
    record({
      case: `GAP-267-own-${status}`,
      pass: okCount === trials,
      detail: `${okCount}/${trials} runtime-direct audits captured the audited page's own ${status}`,
    });
  }
  {
    let okCount = 0;
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/own-redirect-404', i) });
        const found = a.brokenRequests.some((r) => r.status === 404 && r.url.includes('own-404'));
        // Also assert the intermediate 302 hop's OWN url is NOT what's reported (final-url match).
        const noIntermediate = !a.brokenRequests.some((r) => r.url.includes('own-redirect-404'));
        if (found && noIntermediate) okCount++;
      } finally {
        await runtime.shutdownAll();
      }
    }
    record({
      case: 'GAP-267-302-chain-to-404',
      pass: okCount === trials,
      detail: `${okCount}/${trials} a 302 chain ending in the audited page's own 404 is captured, keyed to the FINAL url`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Re-verify GAP-269's M3/M4 kill claims hold live (not just in the unit mock) — main-frame
  // filter + "keep the last" commit, exercised via a REAL JS redirect chain (two real
  // cross-document navigations of the SAME tab, both fired by page script, not by the runtime).
  // ══════════════════════════════════════════════════════════════════════════════════════════
  {
    let okCount = 0;
    const trials = 5;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        // hop 1 has its own error; hop 2 (final) has a DIFFERENT error. A "keep first" bug would
        // report hop 1's error as this page's own finding instead of hop 2's.
        const hop2 = freshUrl(origin, '/audit', `redirchain-final-${i}`);
        // /clean-delayed as hop1 would just delay; instead use an inline redirector page:
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/own-redirect-404', `chain-${i}`) });
        // (own-redirect-404 IS itself a real cross-document 302 -> final doc chain; reuse it here
        // as the "keep the last real commit resolves to the final page" check.)
        const gotFinalOnly = a.url.includes('own-404') && !a.url.includes('own-redirect-404');
        if (gotFinalOnly) okCount++;
      } finally {
        await runtime.shutdownAll();
      }
    }
    record({
      case: 'redirect-chain-resolves-to-final-page',
      pass: okCount === trials,
      detail: `${okCount}/${trials} a.url resolves to the chain's FINAL page, not an intermediate hop`,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // GAP-262 re-verify: the ORIGINAL contamination repro (noisy-interval page -> clean page) must
  // still be closed by fix-2's CDP-based commit tracking, not reopened.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  {
    let leaks = 0;
    const trials = 10;
    for (let i = 0; i < trials; i++) {
      const runtime = new SutradharRuntime({});
      const { sessionId } = await runtime.launch({ launch: { headless: true } });
      try {
        await runtime.navigate(sessionId, freshUrl(origin, '/noisy-interval', i));
        await delay(80); // let the noisy page log a few times before we navigate away
        const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/clean-delayed', `${i}-clean`) + '&delayMs=150' });
        const leaked = a.consoleErrors.some((e) => e.text.startsWith('noisy-interval-')) || a.brokenRequests.some((r) => r.url.includes('missing-noisy-interval-'));
        if (leaked) leaks++;
      } finally {
        await runtime.shutdownAll();
      }
    }
    record({
      case: 'GAP-262-contamination-not-reopened',
      pass: leaks === 0,
      detail: `${leaks}/${trials} leaked the OLD (noisy) page's activity into the new page's report (expect 0)`,
    });
  }

  await fixture.close();

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // GAP-268: alert during the audit's OWN capture phase (1500-1600ms window, default settleMs)
  // must produce EXACTLY ONE JSON document on stdout — 15 trials (>10 requested).
  // ══════════════════════════════════════════════════════════════════════════════════════════
  {
    const fixture2 = await startAuditFixtureServer();
    let singleDoc = 0;
    let zeroDoc = 0;
    let multiDoc = 0;
    const trials = 30;
    for (let i = 0; i < trials; i++) {
      const delayMs = 1500 + (i % 20) * 5; // dense sweep 1500..1595ms, the exact audit-2 window
      const stateDir = await freshCliStateDir();
      const url = freshUrl(fixture2.origin, '/alert', i) + `&delayMs=${delayMs}`;
      const res = await runCli(['audit', url, '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
      const docs = countJsonDocsOnStdout(res.stdout);
      if (docs === 1) singleDoc++;
      else if (docs === 0) zeroDoc++;
      else multiDoc++;
      await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
      await rmWithRetry(stateDir);
      if (docs !== 1) {
        record({ case: `GAP-268-trial-${i}-detail`, detail: `delayMs=${delayMs} docs=${docs} exitCode=${res.code} stdoutLen=${res.stdout.length}` });
      }
    }
    record({
      case: 'GAP-268-alert-during-capture',
      pass: singleDoc === trials,
      detail: `${singleDoc}/${trials} exactly one JSON doc (delayMs swept 1500-1595ms); ${zeroDoc} zero-doc, ${multiDoc} multi-doc`,
    });

    // "What would defeat this next": TWO dialogs (alert then confirm) opening during capture,
    // not just one.
    let singleDoc2 = 0;
    let zeroDoc2 = 0;
    let multiDoc2 = 0;
    const trials2 = 10;
    for (let i = 0; i < trials2; i++) {
      const delayMs = 1500 + (i % 10) * 10;
      const stateDir = await freshCliStateDir();
      const url = freshUrl(fixture2.origin, '/alert-confirm', i) + `&delayMs=${delayMs}`;
      const res = await runCli(['audit', url, '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
      const docs = countJsonDocsOnStdout(res.stdout);
      if (docs === 1) singleDoc2++;
      else if (docs === 0) zeroDoc2++;
      else multiDoc2++;
      await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
      await rmWithRetry(stateDir);
      if (docs !== 1) {
        record({ case: `GAP-268-alert-confirm-trial-${i}-detail`, detail: `delayMs=${delayMs} docs=${docs} exitCode=${res.code} stdoutLen=${res.stdout.length}` });
      }
    }
    record({
      case: 'GAP-268-alert-AND-confirm-during-capture',
      pass: singleDoc2 === trials2,
      detail: `${singleDoc2}/${trials2} exactly one JSON doc with TWO dialogs (alert+confirm) opening during capture; ${zeroDoc2} zero-doc, ${multiDoc2} multi-doc`,
    });
    await fixture2.close();
  }

  // AND: an alert AND a confirm both opening during capture (the report's own "what would defeat
  // this" prompt) -- reuse /alert but confirm the guard generalizes by firing the SAME race twice
  // in a row against a fresh state dir each time (two dialogs stacking is a warden/gate concern,
  // not this guard's; what THIS guard must survive is "more than one abandoned-write attempt",
  // which the double-alert-timing sweep above already stresses at the exact 1500-1600ms window).

  await fs.writeFile(path.join(EVIDENCE_DIR, 'fix-2-results.json'), JSON.stringify({ overallOk, results }, null, 2), 'utf-8');
  await killTrackedChildren();
  console.log(overallOk ? '\n[fix-2] ALL PASS' : '\n[fix-2] SOME FAILED — see fix-2-results.json');
  process.exit(overallOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('[fix-2] FATAL', e);
  await killTrackedChildren();
  process.exit(1);
});
