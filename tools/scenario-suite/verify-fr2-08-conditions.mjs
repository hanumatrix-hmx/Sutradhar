// Live-verify script for FR2-08 (condition waits and settle everywhere). Drives the REAL BUILT worktree
// artifacts (packages/mcp-server/dist/cli.js over stdio, packages/cli/dist/cli.js, the SDK at
// packages/sutradhar/dist/index.js, and the npm bundle packages/sutradhar/dist/mcp-cli.js) against a real
// Chrome, with an INDEPENDENT puppeteer-core observer connection as ground truth. Never trusts `success`
// alone: a case passes only when what the tool reported agrees with what the observer read from the real
// page (its own event recorder `window.__fx8`, the server's request log, document.visibilityState).
// See .ai/loop/field-report-2/evidence/FR2-08/spec.md sections 3, 5, 6.
//
// Timing: sentAt/recvAt are Date.now() around each call and are compared with the page's own
// Date.now() event stamps (same OS clock). "Not yet" checks race the call against a delay that must win.
// No sleep stands in for a condition.
//
// Run:      node tools/scenario-suite/verify-fr2-08-conditions.mjs
// Baseline: node tools/scenario-suite/verify-fr2-08-conditions.mjs --baseline   (N18 only, against the
//           PRE-change build given by FR208_BASELINE_ROOT; records the old settle-vs-dialog hang)
// Filter:   --only=L1,N1   (case-id prefixes)   --surface=mcp,cli,sdk,bundle
// Requires: a build of this worktree (turbo run build --force).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { startFr208Server } from './fixtures/fr2-08-server.mjs';
import { startFr207Server } from './fixtures/fr2-07-server.mjs';
import { matrixCases } from './fixtures/fr2-07-matrix.mjs';
import { oracleTruth } from './fixtures/fr2-07-oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_08_EVIDENCE_DIR ??
  path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-08', 'run-1', 'live');
const args = process.argv.slice(2);
const BASELINE = args.includes('--baseline');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const SURFACES = (args.find((a) => a.startsWith('--surface=')) ?? '--surface=mcp,cli,sdk,bundle').slice(10).split(',');
const ROOT = BASELINE ? process.env.FR208_BASELINE_ROOT : repoRoot;
if (BASELINE && !ROOT) throw new Error('--baseline needs FR208_BASELINE_ROOT (a built pre-change tree)');

const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const informational = []; // recorded, never gating (baselines B-RAF/B-INT/B-CSP, R-perf numbers, ...)
let overallOk = true;
const tempDirs = [];
const spawned = []; // PIDs of every child this script started (never kill anything else)

const wanted = (id) => ONLY.length === 0 || ONLY.some((p) => id.startsWith(p));

function record(surface, id, pass, data = {}) {
  const entry = { surface, case: id, pass: !!pass, ...data };
  results.push(entry);
  if (!pass) overallOk = false;
  console.log(`[${surface}] ${pass ? 'PASS' : 'FAIL'} ${id}${pass ? '' : ' — ' + JSON.stringify(data.observed ?? data.detail ?? '').slice(0, 500)}`);
}
function info(surface, id, data) {
  informational.push({ surface, case: id, ...data });
  console.log(`[${surface}] INFO ${id} ${JSON.stringify(data).slice(0, 300)}`);
}

async function rmWithRetry(dir) {
  for (let i = 0; i < 15; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await delay(400);
    }
  }
}

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const r = spawnSync(process.execPath, [
    '-e',
    `import(${JSON.stringify(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href)}).then(m=>console.log(new m.BrowserLauncher().findExecutablePath()))`,
  ], { encoding: 'utf-8' });
  const p = (r.stdout || '').trim();
  if (!p) throw new Error('No Chrome/Edge executable found — set CHROME_PATH.');
  return p;
}

// ── MCP JSON-RPC stdio client ─────────────────────────────────────────────────────────────────
function makeMcpClient(serverPath, env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env });
  spawned.push(child.pid);
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params, timeoutMs = 90000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method} (id=${id})`));
        }
      }, timeoutMs);
    });
  return {
    child,
    call,
    notify: (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    callTool: (name, a, timeoutMs) => call('tools/call', { name, arguments: a }, timeoutMs),
  };
}
const textOf = (r) => r.content?.[0]?.text ?? '';
const jsonOf = (r) => JSON.parse(textOf(r));
const tierOf = (res) => res?.verification?.evidence?.tier;
const checkOf = (res, id) => res?.verification?.evidence?.checks?.find((c) => c.check === id);

// GAP-325 (FR2-07): a CDP client sometimes never attaches a cross-origin frame's target, so that frame stays
// silent and the product fails CLOSED (`unavailable`, detail names `hung:http://localhost:...`). wait_for
// shares that probe, so the harness tolerates exactly that outcome (never `met`), records it, and caps it.
const gap325 = { tolerated: [] };
const isGap325Detail = (d) => /hung:http:\/\/localhost:/.test(d ?? '');

// ── CLI driver (records when the first stdout byte arrived) ───────────────────────────────────────
const CLI_JS = (root) => path.join(root, 'packages', 'cli', 'dist', 'cli.js');
function runCli(argv, env, timeout = 120000, root = repoRoot) {
  // Async spawn (NOT spawnSync): the fixture HTTP servers run in this same process.
  return spawnCli(argv, env, timeout, root).done;
}
/** Starts a CLI child and returns {child, done:Promise<result>} so the caller can race it against a delay. */
function spawnCli(argv, env, timeout = 120000, root = repoRoot) {
  const t0 = Date.now();
  const child = spawn(process.execPath, [CLI_JS(root), ...argv], { env, windowsHide: true, cwd: env.__CWD ?? repoRoot });
  spawned.push(child.pid);
  let stdout = '';
  let stderr = '';
  let firstStdoutAt;
  const done = new Promise((resolve) => {
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code, ms: Date.now() - t0, startedAt: t0, firstStdoutAt, exitAt: Date.now() });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish(null); }, timeout);
    child.stdout.on('data', (x) => { firstStdoutAt ??= Date.now(); stdout += x.toString('utf8'); });
    child.stderr.on('data', (x) => (stderr += x.toString('utf8')));
    child.on('close', (code) => finish(code));
  });
  return { child, done };
}

// ── observer helpers (read ground truth from the page's OWN recorder, never from the tool) ────────
const fxState = (page) => page.evaluate(() => ({ events: window.__fx8?.events ?? [], mutations: window.__fx8?.mutations ?? [], loadAt: window.__fx8?.loadAt ?? 0 }));
const evAt = (events, what) => events.find((e) => e.what === what)?.at;
const evLastAt = (events, what) => events.filter((e) => e.what === what).at(-1)?.at;
const NON_PAGE_REQUESTS = /^\/favicon\.ico/; // the browser's own favicon fetch is not page activity

async function pageFor(observer, urlPrefix, timeoutMs = 10000) {
  const t0 = performance.now();
  for (;;) {
    const p = (await observer.pages()).find((x) => x.url().startsWith(urlPrefix));
    if (p) return p;
    if (performance.now() - t0 > timeoutMs) throw new Error('observer never saw ' + urlPrefix);
    await delay(50);
  }
}
async function loaded(page) {
  await page.waitForFunction(() => window.__fx8 && window.__fx8.loadAt > 0, { timeout: 10000 });
}
/** Races `p` against `ms`: resolves 'pending' if p has not settled by then (a blocking proof, not a sleep). */
const stillPending = (p, ms) => Promise.race([p.then(() => 'settled', () => 'settled'), delay(ms).then(() => 'pending')]);

// ─────────────────────────────────────────────────────────────────────────────────────────
// MCP-driven cases (also reused for the npm bundle with a subset)
// ─────────────────────────────────────────────────────────────────────────────────────────
const BUNDLE_IDS = new Set(['L1', 'L3', 'L5', 'L6', 'L8', 'N1', 'N2', 'N4', 'N10', 'N12', 'S:click_by_text', 'S:navigate', 'S:handle_dialog', 'M:', 'H']);

async function runMcpCases(surface, serverPath, ctx) {
  const { server, srv7, chromePath } = ctx;
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-08-obs-'));
  tempDirs.push(scratchProfile);
  const downloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-08-dlroot-'));
  tempDirs.push(downloadRoot);
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-08-up-'));
  tempDirs.push(uploadDir);
  const uploadFile = path.join(uploadDir, 'fr2-08-upload.txt');
  await fs.writeFile(uploadFile, 'fr2-08 upload');
  const observer = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: scratchProfile,
    args: ['--no-sandbox'],
    defaultViewport: { width: 1100, height: 900 },
  });
  spawned.push(observer.process()?.pid);
  const mcp = makeMcpClient(serverPath, { ...process.env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: downloadRoot });
  await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-08-verify', version: '1.0' } });
  mcp.notify('notifications/initialized');
  const att = jsonOf(await mcp.callTool('browser.attach', { endpoint: observer.wsEndpoint() }));
  const sessionId = att.sessionId;
  const tool = async (name, a = {}, timeoutMs) => {
    const sentAt = Date.now();
    const r = await mcp.callTool(name, { sessionId, ...a }, timeoutMs);
    const recvAt = Date.now();
    return { raw: r, json: (() => { try { return jsonOf(r); } catch { return undefined; } })(), isError: !!r.isError, text: textOf(r), sentAt, recvAt };
  };
  const cases = [];
  const isBundle = surface === 'bundle';
  const C = (id, fn) => {
    if (isBundle && ![...BUNDLE_IDS].some((b) => id.startsWith(b))) return;
    cases.push(async () => {
      if (!wanted(id)) return;
      try { await fn(id); } catch (e) { record(surface, id, false, { observed: `case threw: ${e.message}` }); }
    });
  };
  const open = async (params, path_ = '/conditions.html') => {
    const url = server.url(path_, params);
    await tool('browser.navigate', { url });
    const page = await pageFor(observer, url.split('&n=')[0].split('?n=')[0]);
    return { url, page };
  };
  const openLoaded = async (params, path_) => {
    const r = await open(params, path_);
    await loaded(r.page);
    return r;
  };
  const waitFor = (a) => tool('browser.wait_for', a);

  // ── L1: the Done-when case ─────────────────────────────────────────────────────────────────
  C('L1', async (id) => {
    const { page } = await open({ case: 'toast', delay: 2000 });
    const r = await waitFor({ text: 'Saved successfully', timeoutMs: 8000 });
    const st = await fxState(page); // re-read AFTER the call
    const toast = evAt(st.events, 'toastShown');
    const domNow = await page.$eval('#toast', (e) => e.innerText).catch(() => null);
    const preToastMutations = st.mutations.filter((m) => m.at > st.loadAt && m.at < toast);
    const preToastRequests = server.requests.filter((q) => q.at > st.loadAt && q.at < toast && !NON_PAGE_REQUESTS.test(q.path));
    const j = r.json;
    const latency = r.recvAt - toast;
    record(surface, id, j.success === true && r.sentAt <= toast && toast <= r.recvAt && latency <= 700 && domNow === 'Saved successfully' &&
      j.output.polls >= 10 && preToastMutations.length === 0 && preToastRequests.length === 0 &&
      j.verification?.verified === true && !!checkOf(j, 'wait_for.text'), {
      expected: 'success; sentAt <= toastShown <= recvAt; recvAt-toast <= 700ms; the observer sees #toast; polls >= 10; the page did NOTHING (0 mutations, 0 requests) between load and the toast; verified',
      observed: { success: j.success, polls: j.output?.polls, latencyMs: latency, satisfiedAfterMs: j.output?.satisfiedAfterMs, tier: tierOf(j), sentBeforeToast: r.sentAt <= toast },
      observerTruth: { toastAt: toast, sentAt: r.sentAt, recvAt: r.recvAt, dom: domNow, preToastMutations, preToastRequests, loadAt: st.loadAt }, verification: j.verification,
      gating: true,
    });
  });
  C('L1b', async (id) => {
    const { page } = await openLoaded({ case: 'toast-click', delay: 2000 });
    const c = await tool('browser.click', { target: '#start-toast', settle: true });
    const st1 = await fxState(page);
    const toast1 = evAt(st1.events, 'toastShown');
    const settledBeforeToast = toast1 === undefined || c.recvAt < toast1;
    const r = await waitFor({ text: 'Saved successfully', timeoutMs: 8000 });
    const st2 = await fxState(page);
    const toast = evAt(st2.events, 'toastShown');
    record(surface, id, c.json.success === true && settledBeforeToast && r.json.success === true && toast <= r.recvAt && r.recvAt - toast <= 700, {
      expected: 'settle:true on the click returned BEFORE the pending-timer toast (T6: settle cannot see a timer); wait_for then catches it',
      observed: { clickReturnedBeforeToast: settledBeforeToast, waitOk: r.json.success, latencyMs: r.recvAt - toast },
      observerTruth: { clickRecvAt: c.recvAt, toastAt: toast, toastAtWhenClickReturned: toast1 }, gating: true,
    });
  });
  C('L1c', async (id) => {
    const { page } = await openLoaded({ case: 'toast-click', delay: 1500 });
    const c = await tool('browser.click', { target: '#start-toast', expect: { text: 'Saved successfully' } });
    const r = await waitFor({ text: 'Saved successfully', timeoutMs: 8000 });
    const dom = await page.$eval('#toast', (e) => e.innerText).catch(() => null);
    record(surface, id, c.json.success === true && c.json.verification?.verified === false && tierOf(c.json) === 'contradicted' &&
      checkOf(c.json, 'expect.text')?.outcome === 'fail' && r.json.success === true && dom === 'Saved successfully', {
      expected: 'expect checks ONCE and does not wait (success:true, verified:false, failing expect.text); wait_for then succeeds (the D10 boundary made executable)',
      observed: { expectTier: tierOf(c.json), expectCheck: checkOf(c.json, 'expect.text')?.outcome, waitOk: r.json.success }, observerTruth: { dom }, gating: true,
    });
  });

  // ── L2: background tab (D2's claim of immunity to GAP-008) ──────────────────────────────────
  for (const [caseName, cond, expectEvent, isUrl] of [
    ['toast', { text: 'Saved successfully' }, 'toastShown'],
    ['js', { js: 'window.__appState.ready === true' }, 'jsReady'],
    ['push', { url: 'stage=done' }, 'pushed'],
  ]) {
    C(`L2-${caseName}`, async (id) => {
      const { url, page } = await openLoaded({ case: caseName, delay: 4000 });
      const pageB = await observer.newPage();
      try {
        await pageB.bringToFront();
        const vis = await page.evaluate(() => document.visibilityState);
        const raf = await page.evaluate(() => new Promise((res) => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(() => res(n), 500); }));
        const tabs = (await tool('browser.list_tabs')).json.tabs;
        const tab = tabs.find((t) => t.url.startsWith(url.split('&n=')[0]));
        const r = await waitFor({ ...cond, timeoutMs: 15000, tabId: tab?.id });
        const st = await fxState(page);
        const at = evAt(st.events, expectEvent);
        const latency = r.recvAt - at;
        record(surface, id, vis === 'hidden' && !!tab && r.json.success === true && at <= r.recvAt && latency <= 700, {
          expected: 'the fixture tab is really hidden (visibilityState==="hidden"; else INCONCLUSIVE = fail); wait_for still succeeds within 700ms of the page event',
          observed: { visibilityState: vis, rafCallsIn500ms: raf, success: r.json.success, latencyMs: latency, polls: r.json.output?.polls },
          observerTruth: { eventAt: at, recvAt: r.recvAt }, gating: true,
        });
        info(surface, `${id}-raf`, { visibilityState: vis, rafCallsIn500ms: raf });
      } finally {
        await pageB.close().catch(() => {});
      }
    });
  }
  C('B-RAF', async (id) => {
    for (const [name, polling] of [['B-RAF', 'raf'], ['B-INT', 100]]) {
      const { page } = await openLoaded({ case: 'toast', delay: 2000 });
      const pageB = await observer.newPage();
      try {
        await pageB.bringToFront();
        const vis = await page.evaluate(() => document.visibilityState);
        const t0 = Date.now();
        let outcome;
        try {
          await page.waitForFunction(() => document.body.innerText.includes('Saved successfully'), { polling, timeout: 10000 });
          outcome = 'resolved';
        } catch (e) { outcome = `rejected: ${e.message.slice(0, 80)}`; }
        const t1 = Date.now();
        const toast = evAt((await fxState(page)).events, 'toastShown');
        info(surface, name, { visibilityState: vis, polling, outcome, latencyAfterToastMs: outcome === 'resolved' ? t1 - toast : null, waitedMs: t1 - t0, note: 'Puppeteer waitForFunction in a hidden tab; documents why wait_for polls from Node (D2). Not gating.' });
      } finally { await pageB.close().catch(() => {}); }
    }
    record(surface, id, true, { expected: 'informational baseline recorded (see live-summary informational[])', observed: 'recorded' });
  });

  // ── L3..L7 ──────────────────────────────────────────────────────────────────────────────────
  C('L3', async (id) => {
    const { page } = await openLoaded({ case: 'spinner', delay: 2000 });
    const r = await waitFor({ textGone: 'Loading data…', timeoutMs: 8000 });
    const st = await fxState(page);
    const at = evAt(st.events, 'spinnerGone');
    const still = await page.evaluate(() => document.body.innerText.includes('Loading data'));
    record(surface, id, r.json.success === true && r.sentAt <= at && at <= r.recvAt && r.json.output.presentAtStart === true && still === false && r.json.verification?.verified === true, {
      expected: 'textGone: sentAt <= spinnerGone <= recvAt, presentAtStart true, verified',
      observed: { success: r.json.success, presentAtStart: r.json.output?.presentAtStart, tier: tierOf(r.json) }, observerTruth: { spinnerGoneAt: at, sentAt: r.sentAt, recvAt: r.recvAt, spinnerStillVisible: still }, gating: true,
    });
  });
  for (const [caseName, ev, needle, sel] of [['hidden-toast', 'htShown', 'Order confirmed', '#ht'], ['vis-toast', 'vtShown', 'Visibility toast', '#vt']]) {
    C(`L4-${caseName}`, async (id) => {
      const { page } = await openLoaded({ case: caseName, delay: 2000 });
      const before = await page.evaluate((s) => ({ textContent: document.querySelector(s).textContent, innerText: document.body.innerText }), sel);
      const r = await waitFor({ text: needle, timeoutMs: 8000 });
      const at = evAt((await fxState(page)).events, ev);
      record(surface, id, r.json.success === true && r.sentAt <= at && at <= r.recvAt && before.textContent === needle && !before.innerText.includes(needle), {
        expected: 'the text was in textContent at sentAt but NOT rendered: wait_for waited for it to become visible (visible-text semantics, not textContent)',
        observed: { success: r.json.success }, observerTruth: { revealedAt: at, sentAt: r.sentAt, recvAt: r.recvAt, before }, gating: true,
      });
    });
  }
  C('L5', async (id) => {
    const { page } = await openLoaded({ case: 'push', delay: 2000 });
    const r = await waitFor({ url: 'stage=done', timeoutMs: 8000 });
    const st = await fxState(page);
    const at = evAt(st.events, 'pushed');
    const href = await page.evaluate(() => location.href);
    record(surface, id, r.json.success === true && r.sentAt <= at && at <= r.recvAt && href.includes('stage=done'), {
      expected: 'url (same-document pushState): sentAt <= pushed <= recvAt', observed: { success: r.json.success }, observerTruth: { pushedAt: at, sentAt: r.sentAt, recvAt: r.recvAt, href }, gating: true,
    });
  });
  C('L5b', async (id) => {
    const { url, page } = await openLoaded({ case: 'nav', delay: 2000 });
    const r = await waitFor({ url: 'stage=arrived', text: 'Arrived', timeoutMs: 10000 });
    const now = await page.evaluate(() => ({ href: location.href, h: document.body.innerText }));
    record(surface, id, r.json.success === true && now.href.includes('stage=arrived') && now.h.includes('Arrived') && r.json.output.polls >= 2, {
      expected: 'url AND text across a cross-document navigation (transient context errors survived); the observer sees the new document',
      observed: { success: r.json.success, polls: r.json.output?.polls }, observerTruth: now, gating: true,
    });
    void url;
  });
  C('L6', async (id) => {
    const { page } = await openLoaded({ case: 'js', delay: 2000 });
    const r = await waitFor({ js: 'window.__appState.ready === true', timeoutMs: 8000 });
    const st = await fxState(page);
    const at = evAt(st.events, 'jsReady');
    const idle = st.mutations.filter((m) => m.at > st.loadAt && m.at < at);
    record(surface, id, r.json.success === true && r.sentAt <= at && at <= r.recvAt && idle.length === 0, {
      expected: 'a pure JS-variable condition (no DOM change at all): window rule against jsReady; zero mutations', observed: { success: r.json.success }, observerTruth: { jsReadyAt: at, sentAt: r.sentAt, recvAt: r.recvAt, mutationsBefore: idle }, gating: true,
    });
  });
  for (const [caseName, needle, ev] of [['shadow', 'Shadow saved', 'shadowShown'], ['frame', 'Frame saved', 'frameShown']]) {
    C(`L7-${caseName}`, async (id) => {
      const { page } = await openLoaded({ case: caseName, delay: 2000 });
      const r = await waitFor({ text: needle, timeoutMs: 10000 });
      const at = evAt((await fxState(page)).events, ev);
      record(surface, id, r.json.success === true && r.sentAt <= at && at <= r.recvAt, {
        expected: `${caseName}: text inside ${caseName === 'shadow' ? 'an open shadow root' : 'a child frame'} is found`, observed: { success: r.json.success }, observerTruth: { eventAt: at, sentAt: r.sentAt, recvAt: r.recvAt }, gating: true,
      });
    });
  }
  C('L8', async (id) => {
    for (const [name, cond] of [['js', { js: 'window.__flag === true' }], ['text', { text: 'CSP ready' }]]) {
      const url = server.url('/csp.html', {});
      await tool('browser.navigate', { url });
      const page = await pageFor(observer, `${server.origin}/csp.html`);
      const r = await waitFor({ ...cond, timeoutMs: 8000 });
      const at = evAt((await page.evaluate(() => window.__fx8.events)), 'cspReady');
      record(surface, `${id}-${name}`, r.json.success === true && at <= r.recvAt && r.recvAt - at <= 900, {
        expected: `strict-CSP page (script-src nonce, no unsafe-eval): ${name} condition still works (CDP-compiled, not new Function)`, observed: { success: r.json.success, error: r.json.error }, observerTruth: { cspReadyAt: at, recvAt: r.recvAt }, gating: true,
      });
    }
  });
  C('B-CSP', async (id) => {
    const url = server.url('/csp.html', {});
    await tool('browser.navigate', { url });
    const page = await pageFor(observer, `${server.origin}/csp.html`);
    let outcome;
    try { await page.waitForFunction('window.__flag === true', { polling: 100, timeout: 5000 }); outcome = 'resolved'; } catch (e) { outcome = `rejected: ${e.message.slice(0, 160)}`; }
    info(surface, 'B-CSP', { outcome, note: "Puppeteer's own waitForFunction(string) on the strict-CSP page (the T17 expectation: blocked)." });
    record(surface, id, true, { expected: 'informational baseline recorded', observed: outcome });
  });

  // ── L9..L12, R-perf ──────────────────────────────────────────────────────────────────────────
  C('L9', async (id) => {
    await open({ case: 'toast', delay: 1500 });
    const r = await waitFor({ text: 'Saved successfully', url: 'stage=never', timeoutMs: 4000 });
    const e = r.json.error ?? '';
    record(surface, id, r.json.success === false && e.includes('text "Saved successfully" is visible') && e.includes('url does not contain "stage=never"'), {
      expected: 'AND: the text is visible but the url never matches -> failure listing the met and the unmet part', observed: { success: r.json.success, error: e }, gating: true,
    });
  });
  C('L10', async (id) => {
    await openLoaded({ case: 'static' });
    const hit = await waitFor({ text: 'Price: $5', timeoutMs: 0 });
    const miss = await waitFor({ text: 'Nope', timeoutMs: 0 });
    record(surface, id, hit.json.success === true && hit.json.output.polls === 1 && miss.json.success === false && /timed out after 0ms/.test(miss.json.error) && miss.json.output.polls === 1, {
      expected: 'timeoutMs 0 = check once: met -> success polls 1; unmet -> "timed out after 0ms" polls 1', observed: { hit: hit.json.success, hitPolls: hit.json.output?.polls, miss: miss.json.error }, gating: true,
    });
  });
  C('L11', async (id) => {
    await open({ case: 'toast', delay: 1500 });
    const r = await waitFor({ text: 'Saved successfully', timeoutMs: 8000 });
    const v = await waitFor({ textGone: 'Never was here', timeoutMs: 1000 });
    record(surface, id, r.json.verification?.verified === true && checkOf(r.json, 'wait_for.text')?.outcome === 'pass' && v.json.verification?.verified === false && tierOf(v.json) === 'unverifiable' && checkOf(v.json, 'wait_for.textGone')?.outcome === 'not-run', {
      expected: 'FR2-07 contract: a met text is verified with a wait_for.text pass; a vacuous textGone is unverifiable with a not-run check',
      observed: { textTier: tierOf(r.json), vacuousTier: tierOf(v.json) }, verification: { met: r.json.verification, vacuous: v.json.verification }, gating: true,
    });
  });
  C('L12', async (id) => {
    await open({ case: 'toast', delay: 1000 });
    await waitFor({ text: 'Saved successfully', timeoutMs: 8000 });
    const h = (await tool('browser.get_action_history')).json;
    const entry = h.entries?.find((e) => e.actionType === 'wait_for');
    record(surface, id, !!entry && entry.selector === 'text="Saved successfully"' && entry.success === true, { expected: 'get_action_history has a wait_for entry with selector text="Saved successfully"', observed: entry, gating: true });
  });
  C('R-perf', async (id) => {
    const { page } = await open({ case: 'big', delay: 2000 });
    const r = await waitFor({ text: 'Saved successfully', timeoutMs: 15000 });
    const at = evAt((await fxState(page)).events, 'toastShown');
    const polls = r.json.output?.polls ?? 1;
    info(surface, 'R-perf', { nodes: 20000, polls, medianPerPassMs: Math.round((r.recvAt - r.sentAt) / polls), latencyAfterToastMs: r.recvAt - at });
    record(surface, id, r.json.success === true && r.recvAt - at <= 1500, { expected: '20k-node page: success and latency after the toast <= 1500ms (per-pass cost recorded as informational)', observed: { success: r.json.success, polls, latencyMs: r.recvAt - at }, gating: true });
  });

  // ── Negatives ───────────────────────────────────────────────────────────────────────────────
  C('N1', async (id) => {
    await openLoaded({ case: 'static' });
    const r = await waitFor({ text: 'Never appears', timeoutMs: 1500 });
    const j = r.json;
    const ms = r.recvAt - r.sentAt;
    record(surface, id, j.success === false && j.error.startsWith('wait_for timed out after 1500ms waiting for text="Never appears"') && ms >= 1500 && ms <= 1500 + 1500 + 1500 &&
      !('failureScreenshot' in j) && !('retriesUsed' in j) && j.error.includes('browser.snapshot') && j.verification?.evidence?.tier === 'action-failed', {
      expected: 'NEG: never true -> success:false, the exact message, elapsed within [1500, +1.5s pass bound + slack] (no retries), no failureScreenshot, hint names browser.snapshot, action-failed',
      observed: { success: j.success, error: j.error, elapsedMs: ms, retriesUsed: j.retriesUsed, hasShot: 'failureScreenshot' in j }, gating: true,
    });
  });
  C('N2', async (id) => {
    await openLoaded({ case: 'static' });
    const r = await waitFor({ js: 'window.__nope.ready', timeoutMs: 8000 });
    const j = r.json;
    record(surface, id, j.success === false && r.recvAt - r.sentAt < 2500 && j.output.polls === 1 && /js condition threw/.test(j.error) && /Cannot read properties of undefined/.test(j.error) && j.error.includes('?.'), {
      expected: 'NEG: a js throw fails at once (not after 8s), polls 1, page message + a "?." hint', observed: { elapsedMs: r.recvAt - r.sentAt, polls: j.output?.polls, error: j.error }, gating: true,
    });
  });
  C('N3', async (id) => {
    await openLoaded({ case: 'static' });
    const r = await waitFor({ js: 'window.__x ===', timeoutMs: 8000 });
    record(surface, id, r.json.success === false && r.recvAt - r.sentAt < 2500 && /js condition threw/.test(r.json.error) && /Unexpected|SyntaxError/.test(r.json.error), { expected: 'NEG: a js syntax error fails fast as a fatal js-threw (Chrome words it "Unexpected token", without the SyntaxError name)', observed: { elapsedMs: r.recvAt - r.sentAt, error: r.json.error }, gating: true });
  });
  C('N4', async (id) => {
    const r = await tool('browser.wait_for', {});
    record(surface, id, r.isError === true && /give at least one/.test(r.text), { expected: 'NEG: no condition keys -> isError with "give at least one"', observed: { isError: r.isError, text: r.text.slice(0, 200) }, gating: true });
  });
  C('N5-N8', async (id) => {
    const rej = async (a) => { try { const r = await tool('browser.wait_for', a); return { rejected: r.isError, text: r.text.slice(0, 160) }; } catch (e) { return { rejected: true, text: e.message.slice(0, 160) }; } };
    const empty = await rej({ text: '' });
    const both = await rej({ text: 'X', textGone: 'X' });
    const neg = await rej({ text: 'x', timeoutMs: -1 });
    const big = await rej({ text: 'x', timeoutMs: 300001 });
    const frac = await rej({ text: 'x', timeoutMs: 1.5 });
    const sel = await rej({ selector: '#t' });
    record(surface, id, empty.rejected && both.rejected && /never be satisfied/.test(both.text) && neg.rejected && big.rejected && frac.rejected && sel.rejected, {
      expected: 'NEG: empty text, text===textGone, timeoutMs -1 / 300001 / 1.5, and a bare {selector} are all rejected', observed: { empty, both, neg, big, frac, sel }, gating: true,
    });
  });
  C('N10', async (id) => {
    const { page } = await open({ case: 'alert', delay: 500 });
    const r = await waitFor({ text: 'Never appears', timeoutMs: 15000 });
    const at = evAt((await fxState(page)).events, 'alertOpened');
    const j = r.json;
    const viaUrl = await waitFor({ url: 'case=alert', timeoutMs: 3000 });
    await tool('browser.handle_dialog', { action: 'accept' }).catch(() => {});
    record(surface, id, j.success === false && /blocked by an open alert dialog/.test(j.error) && r.recvAt - at <= 4500 && r.recvAt - r.sentAt < 8000 && j.dialogPending?.type === 'alert' && viaUrl.json.success === true, {
      expected: 'NEG: an open alert fails the wait within ~2.5s of alertOpened (NOT 15s, NOT the 30s auto-dismiss); a url-only wait on the same page succeeds while it is open',
      observed: { error: j.error, msAfterAlert: r.recvAt - at, dialogPending: j.dialogPending, urlOnlyWhileOpen: viaUrl.json.success }, gating: true,
    });
  });
  C('N11', async (id) => {
    const url = server.url('/conditions.html', { case: 'static' });
    const nt = (await tool('browser.new_tab', { url })).json;
    const tabId = nt.id ?? nt.tabId;
    const p = await pageFor(observer, url); // the EXACT url (an earlier case's page shares the prefix)
    await loaded(p);
    const t0 = Date.now();
    const waiting = tool('browser.wait_for', { text: 'Never', timeoutMs: 10000, tabId });
    await delay(500);
    const closedAt = Date.now();
    await p.close();
    const r = await waiting;
    const health = await tool('browser.list_tabs');
    record(surface, id, r.json.success === false && /the tab was closed while waiting/.test(r.json.error) && r.recvAt - closedAt < 2500 && !health.isError, {
      expected: 'NEG: the tab closing mid-wait fails within ~1.5s of the close with "the tab was closed while waiting"; the server stays healthy',
      observed: { error: r.json.error, msAfterClose: r.recvAt - closedAt, listTabsOk: !health.isError }, gating: true,
    });
    void t0;
  });
  C('N12', async (id) => {
    await openLoaded({ case: 'static' });
    const r = await waitFor({ textGone: 'Never was here', timeoutMs: 5000 });
    const j = r.json;
    record(surface, id, j.success === true && j.output.polls === 1 && j.output.presentAtStart === false && j.verification?.verified === false && tierOf(j) === 'unverifiable', {
      expected: 'vacuous textGone: success at once, polls 1, presentAtStart false, verification unverifiable', observed: { polls: j.output?.polls, presentAtStart: j.output?.presentAtStart, tier: tierOf(j) }, gating: true,
    });
  });
  C('N13', async (id) => {
    const { page } = await openLoaded({ case: 'static' });
    const inContent = await page.evaluate(() => document.body.textContent.includes('Hidden forever') && !document.body.innerText.includes('Hidden forever'));
    const r = await waitFor({ text: 'Hidden forever', timeoutMs: 1000 });
    record(surface, id, inContent && r.json.success === false && /timed out after 1000ms/.test(r.json.error), { expected: 'NEG: display:none text never counts although textContent has it (observer-confirmed)', observed: { success: r.json.success, error: r.json.error }, observerTruth: { inTextContentNotInnerText: inContent }, gating: true });
  });
  C('N14', async (id) => {
    await openLoaded({ case: 'static' });
    const a = await waitFor({ text: 'Typed value', timeoutMs: 1000 });
    const b = await waitFor({ js: "document.querySelector('#inp').value === 'Typed value'", timeoutMs: 3000 });
    record(surface, id, a.json.success === false && b.json.success === true, { expected: 'input values are not text (times out); a js condition reads the value', observed: { text: a.json.success, js: b.json.success }, gating: true });
  });
  C('N15', async (id) => {
    await openLoaded({ case: 'static' });
    const r = await waitFor({ text: 'text=Submit >> nth=0', timeoutMs: 1000 });
    record(surface, id, r.json.success === false && /timed out after 1000ms/.test(r.json.error) && !/InvalidSelector|Playwright|selector/i.test(r.json.error), { expected: 'selector-looking text is literal: a plain timeout, no InvalidSelectorError / FR2-06 hint', observed: { error: r.json.error }, gating: true });
  });
  C('N17', async (id) => {
    const { page } = await openLoaded({ case: 'static' });
    const w = await waitFor({ text: 'Zero box text', timeoutMs: 2000 });
    const tagged = await page.evaluate(() => { const d = [...document.querySelectorAll('div')].find((x) => x.textContent === 'Zero box text'); d.id = 'zerobox'; return true; });
    const s = await tool('browser.wait_for_selector', { target: '#zerobox', state: 'visible', timeoutMs: 500 });
    record(surface, id, w.json.success === true && tagged && s.json.success === false, { expected: 'documented divergence: the text in a 0x0 overflow:hidden box is rendered text (wait_for succeeds) while wait_for_selector says the element is not visible', observed: { waitFor: w.json.success, waitForSelector: s.json.success, selectorError: s.json.error }, gating: true });
  });
  C('N19', async (id) => {
    await openLoaded({ case: 'static' });
    const r = await waitFor({ text: 'Ghost text', timeoutMs: 2000 });
    record(surface, id, r.json.success === true && r.json.output.polls === 1, { expected: 'opacity:0 text counts (rendered) - the same rule as expect.text', observed: { success: r.json.success }, gating: true });
  });

  // ── N18 / T5: settle + a dialog opened by the action ─────────────────────────────────────────
  C('N18', async (id) => {
    // control: the SAME click with NO settle, to learn how long the click itself takes when it opens a dialog
    const c0 = await openLoaded({ case: 'settle' });
    const ctl = await tool('browser.click', { target: '#s-alert' }, 60000);
    await tool('browser.handle_dialog', { action: 'accept' }).catch(() => {});
    const ctlMs = ctl.recvAt - ctl.sentAt;
    // the case: settle:{timeoutMs:2000}
    const { page } = await openLoaded({ case: 'settle' });
    const r = await tool('browser.click', { target: '#s-alert', settle: { timeoutMs: 2000 } }, 60000);
    const at = evLastAt((await fxState(page)).events, 'alertOpened');
    await tool('browser.handle_dialog', { action: 'accept' }).catch(() => {});
    const ms = r.recvAt - r.sentAt;
    void c0;
    record(surface, id, r.json?.success === true && ms - ctlMs <= 2000 + 500 + 1500 && ms < 15000, {
      expected: 'T5/D14: click #s-alert settle:{timeoutMs:2000} returns within (the no-settle click time) + 2000 + 500 + 1500 ms, and far below the 30s auto-dismiss',
      observed: { elapsedMs: ms, noSettleControlMs: ctlMs, settleOverheadMs: ms - ctlMs, success: r.json?.success, dialogPending: r.json?.dialogPending?.type }, observerTruth: { alertOpenedAt: at }, gating: true,
    });
  });

  // ── the GENERATED live matrix: wait_for text/textGone vs the independent observer ────────────────
  {
    const all = matrixCases();
    const list = isBundle ? all.filter((c, i) => i % 3 === 0) : all;
    let seq = 0;
    const tokFor = () => `WQ${String(++seq).padStart(3, '0')}K${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const pageForUrl = async (url) => {
      const t0 = performance.now();
      for (;;) {
        const p = (await observer.pages()).find((x) => x.url() === url);
        if (p) return p;
        if (performance.now() - t0 > 8000) throw new Error('observer never saw ' + url);
        await delay(50);
      }
    };
    const settleMx = async (p, framesExpected, allowHung) => {
      // a deliberately HUNG child frame can keep the parent's load event from ever firing, so those cases wait only for the
      // page's own script marker (an event, not a sleep); every other case also waits for readyState complete
      if (allowHung) await p.waitForFunction(() => window.__mx === 1, { timeout: 10000 });
      else await p.waitForFunction(() => window.__mx === 1 && document.readyState === 'complete', { timeout: 10000 });
      const t0 = performance.now();
      while (p.frames().length < 1 + framesExpected && performance.now() - t0 < 8000) await delay(50);
    };
    const truthOf = async (p, tok, expectText, mode, allowHung) => {
      for (let attempt = 0; ; attempt++) {
        let t;
        if (mode === 'innerText') t = { found: await p.evaluate((s) => document.body.innerText.includes(s), expectText), frames: [], hung: 0 };
        else t = await oracleTruth(p, tok);
        if (allowHung || t.hung === 0 || attempt >= 3) return t;
        await delay(400);
      }
    };
    const runOne = async (id, { url, tok, expectText, label, framesExpected, mode, allowHung, expectHung, relaxedFound, extra }) => {
      try {
        await tool('browser.navigate', { url });
        const p = await pageForUrl(url);
        await settleMx(p, framesExpected, allowHung);
        if (allowHung) {
          // PRECONDITION of the hung-frame cases: a frame really IS hung, by the OBSERVER's own evidence (its evaluate never answers).
          // Found by the fresh re-run: as the FIRST such case in a process the out-of-process frame had not started looping yet, so
          // observer and product both (correctly) got an answer from it and the case's premise did not hold. Event-based wait, bounded.
          let hungNow = 0;
          for (let n = 0; n < 8 && hungNow === 0; n++) {
            hungNow = (await oracleTruth(p, tok, { frameBudgetMs: 1500 })).hung;
            if (hungNow === 0) await delay(500);
          }
          if (hungNow === 0) throw new Error('precondition not established: no frame is hung after 8 observer checks');
        }
        const t1 = await truthOf(p, tok, expectText, mode, allowHung);
        const rt = (await tool('browser.wait_for', { text: expectText, timeoutMs: 0 })).json;
        const rg = (await tool('browser.wait_for', { textGone: expectText, timeoutMs: 0 })).json;
        const t2 = await truthOf(p, tok, expectText, mode, allowHung); // re-read AFTER the calls: no stale ground truth
        const stable = t1.found === t2.found;
        const labelOk = label === undefined || label === t2.found;
        const inconclusive = !allowHung && t2.hung > 0;
        const lastText = rt.output?.last?.text;
        const lastGone = rg.output?.last?.textGone;
        let ok;
        if (expectHung) {
          // text nowhere but an unrelated frame never answers: NEITHER may be met; textGone in particular must not read "unavailable" as gone
          ok = rt.success === false && rg.success === false && lastText === 'unavailable' && lastGone === 'unavailable';
        } else if (t2.found && relaxedFound) {
          ok = (rt.success === true && rg.success === false && lastGone === 'unmet') || (rt.success === false && lastText === 'unavailable' && rg.success === false);
        } else if (t2.found) {
          ok = rt.success === true && rg.success === false && lastGone === 'unmet';
        } else {
          ok = rt.success === false && lastText === 'unmet' && rg.success === true && rg.output?.presentAtStart === false;
        }
        let tolerated = false;
        if (!ok && !expectHung && !relaxedFound && !t2.found) {
          // GAP-325: the product reported `unavailable` for a silent cross-origin frame. Fail-closed is correct; never `met`.
          const unavailOnly = rt.success === false && rg.success === false && lastText === 'unavailable' && lastGone === 'unavailable';
          if (unavailOnly && isGap325Detail(rt.error) ) { ok = true; tolerated = true; gap325.tolerated.push(`${surface}:${id}`); }
        }
        if (!ok && !expectHung && !relaxedFound && t2.found) {
          const unavailText = rt.success === false && lastText === 'unavailable' && rg.success === false && lastGone !== 'met';
          if (unavailText && isGap325Detail(rt.error)) { ok = true; tolerated = true; gap325.tolerated.push(`${surface}:${id}`); }
        }
        record(surface, id, ok && stable && labelOk && !inconclusive, {
          expected: `${expectHung ? 'text: UNAVAILABLE and textGone: UNAVAILABLE (a frame hung; both fail closed)' : t2.found ? 'text met, textGone unmet (rendered)' : 'text unmet, textGone met (not rendered)'}; the label ${label === undefined ? 'n/a' : label ? 'counted' : 'excluded'}; the observer agrees`,
          observed: { text: { success: rt.success, last: lastText, error: rt.error?.slice(0, 200) }, textGone: { success: rg.success, last: lastGone, presentAtStart: rg.output?.presentAtStart } },
          observerTruth: { before: t1, after: t2, stable, labelMatchesObserver: labelOk, inconclusive }, tolerated, gating: true, ...extra,
        });
      } finally {
        server7.releaseHeld();
        await delay(100);
      }
    };
    const server7 = srv7;
    for (const c of list) {
      C(`M:${c.id}`, async (cid) => {
        const tok = tokFor();
        const expectText = c.expectText ? c.expectText(tok) : tok;
        const url = `${srv7.origin}/matrix?case=${encodeURIComponent(c.id)}&tok=${tok}`;
        await runOne(cid, { url, tok, expectText, label: c.counted, framesExpected: c.frames, mode: c.expectText || /split-over|whitespace/.test(c.id) ? 'innerText' : 'oracle', allowHung: false });
      });
    }
    const hungUrl = (tok, q) => `${srv7.origin}/matrix-hung?tok=${tok}&n=8&hung=3&${q}`;
    C('H1', (cid) => { const tok = tokFor(); return runOne(cid, { url: hungUrl(tok, 'tokIn=main'), tok, expectText: tok, label: true, framesExpected: 8, allowHung: true, extra: { note: 'text in the main frame, 1 of 8 cross-origin frames hung: text must still be met' } }); });
    C('H2', (cid) => { const tok = tokFor(); return runOne(cid, { url: hungUrl(tok, 'tokIn=5'), tok, expectText: tok, label: true, framesExpected: 8, allowHung: true, relaxedFound: true, extra: { note: 'text only in cross-origin frame 5, frame 3 hung: met, or unavailable if frame 5 itself never answered; textGone never met' } }); });
    C('H3', (cid) => { const tok = tokFor(); return runOne(cid, { url: hungUrl(tok, 'tokIn=none'), tok, expectText: tok, label: false, framesExpected: 8, allowHung: true, expectHung: true, extra: { note: 'text nowhere, frame 3 hung: text AND textGone both unavailable, textGone must NOT read "unavailable" as gone' } }); });
  }

  // ── the settle sweep ────────────────────────────────────────────────────────────────────────
  const settleCases = [
    // [tool, tag, prep(page), call() -> tool result, gating?]
    ['click_by_text', 'click_by_text', null, () => tool('browser.click_by_text', { text: 'Settle by text', settle: true })],
    ['click_by_role', 'click_by_role', null, () => tool('browser.click_by_role', { role: 'button', name: 'Settle role', settle: true })],
    ['right_click', 'right_click', null, () => tool('browser.right_click', { target: '#s-ctx', settle: true })],
    ['press_key', 'press_key', async () => { await tool('browser.focus', { target: '#s-key' }); }, () => tool('browser.press_key', { key: 'x', settle: true })],
    ['focus', 'focus', null, () => tool('browser.focus', { target: '#s-focus', settle: true })],
    ['hover', 'hover', null, () => tool('browser.hover', { target: '#s-hover', settle: true })],
    ['select_option', 'select_option', null, () => tool('browser.select_option', { target: '#s-sel', value: 'v2', settle: true })],
    ['select_options', 'select_options', null, () => tool('browser.select_options', { target: '#s-multi', values: ['m1', 'm2'], settle: true })],
    ['type_by_label', 'type_by_label', null, () => tool('browser.type_by_label', { label: 'Settle label', value: 'abc', settle: true })],
    ['upload_file', 'upload_file', null, () => tool('browser.upload_file', { target: '#s-file', filePath: uploadFile, settle: true })],
    ['upload_file_via_trigger', 'upload_file_via_trigger', null, () => tool('browser.upload_file_via_trigger', { target: '#s-trigger', filePath: uploadFile, settle: true })],
    ['drag_and_drop', 'drag_and_drop', null, () => tool('browser.drag_and_drop', { sourceTarget: '#s-src', destTarget: '#s-dst', settle: true })],
    ['touch_tap', 'touch_tap', null, () => tool('browser.touch_tap', { target: '#s-tap', settle: true }), 'maybe-not-provable'],
    ['click_at_point', 'click_at_point', null, async (page) => { const c = await centerOf(page, '#s-point'); return tool('browser.click_at_point', { x: c.x, y: c.y, settle: true }); }],
    ['drag_at_points', 'drag_at_points', null, async (page) => { const c = await centerOf(page, '#s-pad'); return tool('browser.drag_at_points', { fromX: c.x - 60, fromY: c.y, toX: c.x + 60, toY: c.y, settle: true }); }],
    ['download_file', 'download_file', null, () => tool('browser.download_file', { target: '#s-dl', settle: true })],
    ['scroll', 'scroll_window', null, () => tool('browser.scroll', { direction: 'down', amount: 300, settle: true })],
    ['fill_form', 'fill_form', null, () => tool('browser.fill_form', { fields: { '#f1': 'a', '#f2': 'b' }, settle: true })],
  ];
  const centerOf = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
  for (const [name, tag, prep, call, mode] of settleCases) {
    C(`S:${name}`, async (id) => {
      const { page } = await openLoaded({ case: 'settle' });
      if (prep) await prep(page);
      const r = await call(page);
      const st = await fxState(page); // re-read AFTER the call
      const trigger = evLastAt(st.events, `${tag}-trigger`);
      const two = evLastAt(st.events, `${tag}:2`);
      const logCount = await page.evaluate(() => (document.getElementById('burst-log')?.children.length ?? 0));
      const notProvable = mode === 'maybe-not-provable' && trigger === undefined;
      if (notProvable) {
        info(surface, id, { result: 'not-provable: trigger not delivered', note: 'FR2-07 D15: no trusted touch delivered without touch emulation', toolSuccess: r.json?.success });
        record(surface, id, true, { expected: 'touch_tap: non-gating when the page never saw the touch', observed: 'not-provable: trigger not delivered', gating: false });
        return;
      }
      const toolOk = name === 'fill_form' ? Object.values(r.json ?? {}).length > 0 && Object.values(r.json).every((x) => x?.success === true) : r.json?.success === true; // fill_form answers one result PER FIELD
      record(surface, id, toolOk && trigger !== undefined && two !== undefined && two <= r.recvAt && trigger >= r.sentAt - 5 && logCount >= 2, {
        expected: `with settle:true the call returns only after the page's burst finished (${tag}:2 <= recvAt) and #burst-log holds both entries`,
        observed: { success: toolOk, elapsedMs: r.recvAt - r.sentAt }, observerTruth: { triggerAt: trigger, burst2At: two, recvAt: r.recvAt, sentAt: r.sentAt, burstLogEntries: logCount }, gating: true,
      });
    });
  }
  C('S:handle_dialog', async (id) => {
    const { page } = await openLoaded({ case: 'settle' });
    await tool('browser.click', { target: '#s-confirm' });
    const r = await tool('browser.handle_dialog', { action: 'accept', settle: true });
    const st = await fxState(page);
    const two = evLastAt(st.events, 'dialog:2');
    record(surface, id, r.json?.success === true && two !== undefined && two <= r.recvAt, { expected: 'handle_dialog accept settle:true: returns after the page re-rendered in response (dialog:2 <= recvAt)', observed: { success: r.json?.success }, observerTruth: { burst2At: two, recvAt: r.recvAt, sentAt: r.sentAt }, gating: true });
  });
  C('S:network', async (id) => {
    const { page } = await openLoaded({ case: 'settle' });
    const r = await tool('browser.click', { target: '#s-fetch', settle: true });
    const st = await fxState(page);
    const done = evLastAt(st.events, 'fetchDone');
    const slow = server.requests.filter((q) => q.path.startsWith('/slow')).at(-1);
    record(surface, id, r.json?.success === true && done !== undefined && done <= r.recvAt && slow?.doneAt !== undefined && slow.doneAt <= r.recvAt, {
      expected: 'the network-idle half: click settle:true returns only after the 800ms /slow fetch completed and its DOM update landed', observed: { success: r.json?.success }, observerTruth: { fetchDoneAt: done, slowServedAt: slow?.doneAt, recvAt: r.recvAt }, gating: true,
    });
  });
  C('S:navigate', async (id) => {
    const url = server.url('/conditions.html', { case: 'settle-load' });
    const r = await tool('browser.navigate', { url, settle: true });
    const page = await pageFor(observer, url.split('&n=')[0].split('?n=')[0]);
    const st = await fxState(page);
    const two = evLastAt(st.events, 'load:2');
    const rl = await tool('browser.reload', { settle: true });
    const st2 = await fxState(page);
    const two2 = evLastAt(st2.events, 'load:2');
    record(surface, id, r.json?.tabId !== undefined && two !== undefined && two <= r.recvAt && rl.json?.url !== undefined && two2 !== undefined && two2 <= rl.recvAt && two2 >= rl.sentAt, {
      expected: 'navigate and reload with settle:true return only after the load-time burst (load:2 <= recvAt)', observed: { navigate: !!r.json?.tabId, reload: !!rl.json?.url }, observerTruth: { navLoad2: two, navRecvAt: r.recvAt, reloadLoad2: two2, reloadRecvAt: rl.recvAt, reloadSentAt: rl.sentAt }, gating: true,
    });
  });
  C('S:go_back_forward', async (id) => {
    const urlA = server.url('/conditions.html', { case: 'settle-load' });
    const urlB = server.url('/conditions.html', { case: 'settle-load', x: 'b' });
    await tool('browser.navigate', { url: urlA });
    const page = await pageFor(observer, `${server.origin}/conditions.html`);
    await loaded(page);
    await tool('browser.navigate', { url: urlB });
    await page.waitForFunction((u) => location.href === u, { timeout: 5000 }, urlB);
    await loaded(page);
    const back = await tool('browser.go_back', { settle: true });
    const st1 = await fxState(page);
    const ps1 = st1.events.filter((e) => e.what === 'pageshow:2' && e.at >= back.sentAt);
    const fwd = await tool('browser.go_forward', { settle: true });
    const st2 = await fxState(page);
    const ps2 = st2.events.filter((e) => e.what === 'pageshow:2' && e.at >= fwd.sentAt);
    record(surface, id, ps1.length > 0 && ps1.at(-1).at <= back.recvAt && ps2.length > 0 && ps2.at(-1).at <= fwd.recvAt, {
      expected: 'go_back / go_forward with settle:true return only after the pageshow burst of the history navigation (pageshow:2 in [sentAt, recvAt])',
      observed: { back: !!back.json?.url, forward: !!fwd.json?.url }, observerTruth: { backPageshow2: ps1.at(-1)?.at, backRecvAt: back.recvAt, fwdPageshow2: ps2.at(-1)?.at, fwdRecvAt: fwd.recvAt }, gating: true,
    });
  });
  // controls: WITHOUT settle the very same fast tools return before the page's burst ends (proves the sweep can distinguish)
  for (const [name, tag, call] of [
    ['click_at_point', 'click_at_point', async (page) => { const c = await centerOf(page, '#s-point'); return tool('browser.click_at_point', { x: c.x, y: c.y }); }],
    ['press_key', 'press_key', async () => { await tool('browser.focus', { target: '#s-key' }); return tool('browser.press_key', { key: 'x' }); }],
  ]) {
    C(`S-control:${name}`, async (id) => {
      const { page } = await openLoaded({ case: 'settle' });
      const r = await call(page);
      // event-based wait for the page's own burst to finish (NOT a sleep), THEN read the stamps it left
      await page.waitForFunction((t) => window.__fx8.events.some((e) => e.what === t), { timeout: 5000 }, `${tag}:2`).catch(() => {});
      const st = await fxState(page);
      const two = evLastAt(st.events, `${tag}:2`);
      record(surface, id, r.json?.success === true && two !== undefined && r.recvAt < two, {
        expected: `CONTROL (no settle): ${name} returns BEFORE ${tag}:2, so the sweep above genuinely distinguishes settle from no-settle`, observed: { success: r.json?.success }, observerTruth: { burst2At: two, recvAt: r.recvAt }, gating: true,
      });
    });
  }

  C('Z-gap325-budget', async (id) => {
    const mine = gap325.tolerated.filter((x) => x.startsWith(surface + ':'));
    record(surface, id, mine.length <= 3, { expected: 'the GAP-325 tolerance (a silent cross-origin frame => fail-closed unavailable) fires at most 3 times per surface run', observed: { tolerated: mine } });
  });

  for (const c of cases) await c();
  await tool('browser.shutdown', {}).catch(() => {});
  mcp.child.stdin.end();
  await observer.close().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// CLI cases
// ─────────────────────────────────────────────────────────────────────────────────────────
async function runCliCases(ctx) {
  const surface = 'cli';
  const { server } = ctx;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-08-cli-state-'));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-08-cli-work-'));
  tempDirs.push(stateDir, work);
  const uploadFile = path.join(work, 'fr2-08-upload.txt');
  await fs.writeFile(uploadFile, 'fr2-08 upload');
  const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir, __CWD: work };
  delete env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS;
  const cli = (a, t) => runCli(a, env, t);
  let observer;
  const page = async () => {
    if (!observer) {
      const state = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf-8'));
      observer = await puppeteer.connect({ browserWSEndpoint: state.wsEndpoint, defaultViewport: null });
    }
    const ps = await observer.pages();
    return ps.find((p) => p.url().startsWith(server.origin)) ?? ps.at(-1);
  };
  const cases = [];
  const C = (id, fn) => cases.push(async () => {
    if (!wanted(id)) return;
    try { await fn(id); } catch (e) { record(surface, id, false, { observed: `case threw: ${e.message}` }); }
  });
  const nav = async (params, extraArgs = []) => {
    const r = await cli(['nav', server.url('/conditions.html', params), ...extraArgs]);
    const p = await page();
    return { r, p };
  };
  const centerOf = (p, sel) => p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });

  // C-L1 / C-L2: causality with mode=manual (each CLI command re-attaches: 0.5-1.5s)
  for (const [id, caseName, flags, ev, okPattern] of [
    ['C-L1', 'toast', ['--text', 'Saved successfully'], 'toastShown', /^Condition met after \d+ms: text="Saved successfully"/],
    ['C-L2-url', 'push', ['--url', 'stage=done'], 'pushed', /^Condition met after \d+ms: url~"stage=done"/],
    ['C-L2-js', 'js', ['--js', 'window.__appState.ready === true'], 'jsReady', /^Condition met after \d+ms: js\(window\.__appState\.ready === true\)/],
    ['C-L2-textGone', 'spinner', ['--text-gone', 'Loading data…'], 'spinnerGone', /^Condition met after \d+ms: textGone="Loading data…"/],
  ]) {
    C(id, async (cid) => {
      const { p } = await nav({ case: caseName, mode: 'manual', delay: 2000 });
      await loaded(p);
      const { done } = spawnCli(['waitfor', '15000', ...flags], env);
      const early = await stillPending(done, 2500); // the delay MUST win: the child is still waiting (blocking proof)
      const armAt = Date.now();
      await p.evaluate(() => window.__fx8.arm(2000)); // a pure 2s setTimeout, nothing else
      const r = await done;
      const st = await fxState(p);
      const at = evAt(st.events, ev);
      const idleMutations = st.mutations.filter((m) => m.at > st.loadAt && m.at < at);
      const idleRequests = server.requests.filter((q) => q.at > armAt && q.at < at && !NON_PAGE_REQUESTS.test(q.path));
      record(surface, cid, early === 'pending' && r.code === 0 && r.exitAt >= at && r.exitAt - at <= 2500 && okPattern.test(r.stdout) && idleMutations.length === 0 && idleRequests.length === 0, {
        expected: 'the child is STILL waiting 2.5s in (blocking proof); after the page arms a pure 2s timer it exits 0 with exitAt >= the page event; the status line matches; the page did nothing else',
        observed: { early, code: r.code, stdout: r.stdout, stderr: r.stderr.slice(0, 200), msAfterEvent: r.exitAt - at }, observerTruth: { eventAt: at, exitAt: r.exitAt, idleMutations, idleRequests }, gating: true,
      });
    });
  }
  C('C-L3', async (id) => {
    await nav({ case: 'static' });
    const r = await cli(['waitfor', '3000', '--text', 'Never appears']);
    record(surface, id, r.code === 1 && /Wait failed: wait_for timed out after 3000ms/.test(r.stdout), { expected: 'exit 1; "Wait failed: wait_for timed out after 3000ms"', observed: { code: r.code, stdout: r.stdout }, gating: true });
  });
  C('C-L4', async (id) => {
    await nav({ case: 'static' });
    const r = await cli(['waitfor', '3000', '--text-gone', 'Never was here']);
    record(surface, id, r.code === 0 && /Note: "Never was here" was not present/.test(r.stderr) && /Verification: NOT verified — unverifiable/.test(r.stdout), { expected: 'exit 0 with a stderr Note (vacuous) and an unverifiable Verification line', observed: { code: r.code, stdout: r.stdout, stderr: r.stderr }, gating: true });
  });
  C('C-L4b-json', async (id) => {
    await nav({ case: 'static' });
    const r = await cli(['waitfor', '3000', '--text', 'Price: $5', '--json']);
    let j; try { j = JSON.parse(r.stdout); } catch { /* not json */ }
    record(surface, id, r.code === 0 && j?.success === true && j?.actionType === 'wait_for' && j?.verification?.verified === true, { expected: '--json prints the full result JSON (actionType wait_for, verification verified)', observed: { code: r.code, stdout: r.stdout.slice(0, 200) }, gating: true });
  });
  // C-L5 settle on the newly wired verbs
  const settleVerbs = [
    ['nav', 'load', 'settle-load', (p) => ['nav', server.url('/conditions.html', { case: 'settle-load' }), '--settle']],
    ['clicktext', 'click_by_text', 'settle', () => ['clicktext', 'Settle by text', '--settle']],
    ['clickrole', 'click_by_role', 'settle', () => ['clickrole', 'button', 'Settle role', '--settle']],
    ['press', 'press_key', 'settle', () => ['press', '#s-key', 'x', '--settle']],
    ['hover', 'hover', 'settle', () => ['hover', '#s-hover', '--settle']],
    ['select', 'select_option', 'settle', () => ['select', '#s-sel', 'v2', '--settle']],
    ['clickpoint', 'click_at_point', 'settle', async (p) => { const c = await centerOf(p, '#s-point'); return ['clickpoint', String(c.x), String(c.y), '--settle']; }],
    ['dragpoints', 'drag_at_points', 'settle', async (p) => { const c = await centerOf(p, '#s-pad'); return ['dragpoints', String(c.x - 60), String(c.y), String(c.x + 60), String(c.y), '--settle']; }],
    ['upload', 'upload_file', 'settle', () => ['upload', '#s-file', uploadFile, '--settle']],
    ['drag', 'drag_and_drop', 'settle', () => ['drag', '#s-src', '#s-dst', '--settle']],
    ['download', 'download_file', 'settle', () => ['download', '#s-dl', './dl', '--settle']],
  ];
  for (const [verb, tag, caseName, argvOf] of settleVerbs) {
    C(`C-L5:${verb}`, async (id) => {
      let p;
      if (verb === 'nav') { await cli(['nav', 'about:blank']); p = await page(); } else ({ p } = await nav({ case: caseName }));
      const argv = await argvOf(p);
      const r = await cli(argv);
      p = await page();
      if (verb === 'nav') await loaded(p);
      const st = await fxState(p);
      const two = evLastAt(st.events, `${tag}:2`);
      record(surface, id, r.code === 0 && two !== undefined && r.firstStdoutAt >= two && r.firstStdoutAt >= r.startedAt, {
        expected: `--settle: the child's first stdout line arrives only after the page's burst finished (${tag}:2 <= firstStdoutAt)`,
        observed: { code: r.code, stdout: r.stdout.slice(0, 200), stderr: r.stderr.slice(0, 200) }, observerTruth: { burst2At: two, firstStdoutAt: r.firstStdoutAt }, gating: true,
      });
    });
  }
  // negatives
  C('N-C1', async (id) => {
    const r = await cli(['waitfor']);
    record(surface, id, r.code === 1 && /usage: sutradhar waitfor/.test(r.stderr + r.stdout), { expected: 'NEG: no condition -> exit 1 + usage', observed: { code: r.code, out: (r.stderr + r.stdout).slice(0, 200) }, gating: true });
  });
  C('N-C2', async (id) => {
    const r = await cli(['waitfor', 'abc', '--text', 'x']);
    const r2 = await cli(['waitfor', '5000', 'successfully', '--text', 'Saved']);
    record(surface, id, r.code === 1 && /whole number of milliseconds/.test(r.stderr) && r2.code === 1 && /unexpected argument "successfully"/.test(r2.stderr), { expected: 'NEG: a non-numeric timeout, and an UNQUOTED multi-word value, exit 1 with a quoting hint', observed: { a: { code: r.code, err: r.stderr }, b: { code: r2.code, err: r2.stderr } }, gating: true });
  });
  C('N-C3', async (id) => {
    const { p } = await nav({ case: 'settle' });
    const r = await cli(['click', '#s-click', '--text', 'Saved']);
    const st = await fxState(p);
    const clicked = st.events.some((e) => e.what === 'click-trigger');
    record(surface, id, r.code === 1 && /--text is only valid with "waitfor"/.test(r.stderr) && clicked === false, { expected: 'NEG (D16): a condition flag on another verb exits 1 AND the click never happened (observer-confirmed)', observed: { code: r.code, stderr: r.stderr }, observerTruth: { clicked }, gating: true });
  });
  C('N-C4', async (id) => {
    const { p } = await nav({ case: 'alert', delay: 500 });
    const t0 = Date.now();
    const r = await cli(['waitfor', '10000', '--text', 'Never appears']);
    await cli(['dialog', 'dismiss']); // an evaluate on the page would block behind the open alert: dismiss FIRST, then read the recorder
    const at = evAt(await p.evaluate(() => window.__fx8.events).catch(() => []), 'alertOpened');
    record(surface, id, r.code === 3 && /dialog/i.test(r.stdout + r.stderr) && Date.now() - t0 < 12000, { expected: 'NEG: an open alert fails the wait well before the 10s timeout, exit 3 (FR2-04 dialog exit code)', observed: { code: r.code, ms: r.ms, out: (r.stdout + r.stderr).slice(0, 300) }, observerTruth: { alertOpenedAt: at }, gating: true });
  });
  C('N-C5', async (id) => {
    const a = await cli(['waitfor', '--text', 'a', '--text-gone', 'a']);
    const b = await cli(['waitfor', '--text', 'a', '--expect-text', 'b']);
    const c = await cli(['waitfor', '--text']);
    record(surface, id, a.code === 1 && /can never be satisfied/.test(a.stderr + a.stdout) && b.code === 1 && /not valid with "waitfor"/.test(b.stderr) && c.code === 1 && /--text needs a value/.test(c.stderr), { expected: 'NEG: text===textGone, --expect-* together with waitfor, and a valueless --text are all rejected', observed: { a: a.stderr || a.stdout, b: b.stderr, c: c.stderr }, gating: true });
  });

  for (const c of cases) await c();
  await cli(['close']);
  await observer?.disconnect().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// SDK cases
// ─────────────────────────────────────────────────────────────────────────────────────────
async function runSdkCases(ctx) {
  const surface = 'sdk';
  const { server } = ctx;
  const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')).href);
  const downloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-08-sdk-dl-'));
  tempDirs.push(downloadRoot);
  const browser = await sdk.launch({ headless: true, allowedDownloadRoots: [downloadRoot] });
  const observer = await puppeteer.connect({ browserWSEndpoint: browser.getWsEndpoint(), defaultViewport: null });
  const page = (await browser.pages())[0];
  const cases = [];
  const C = (id, fn) => cases.push(async () => {
    if (!wanted(id)) return;
    try { await fn(id); } catch (e) { record(surface, id, false, { observed: `case threw: ${e.message}` }); }
  });
  const obsFor = async (urlPrefix) => pageFor(observer, urlPrefix);

  for (const bg of [false, true]) {
    C(`SDK-L1${bg ? '-background' : ''}`, async (id) => {
      const url = server.url('/conditions.html', { case: 'toast', delay: bg ? 4000 : 2000 });
      await page.goto(url);
      const p = await obsFor(url.split('&n=')[0].split('?n=')[0]);
      let other;
      let vis = 'visible';
      if (bg) {
        other = await browser.newPage();
        await other.bringToFront();
        vis = await p.evaluate(() => document.visibilityState);
      }
      try {
        const sentAt = Date.now();
        const r = await page.waitFor({ text: 'Saved successfully', timeout: 12000 });
        const recvAt = Date.now();
        const st = await fxState(p);
        const at = evAt(st.events, 'toastShown');
        const dom = await p.$eval('#toast', (e) => e.innerText).catch(() => null);
        const idle = st.mutations.filter((m) => m.at > st.loadAt && m.at < at);
        record(surface, id, r.success === true && sentAt <= at && at <= recvAt && recvAt - at <= 700 && dom === 'Saved successfully' && (!bg || vis === 'hidden') && (bg || idle.length === 0), {
          expected: `SDK waitFor resolves the result within 700ms of the toast${bg ? ' with the tab really hidden' : ' and the page did nothing else'}`,
          observed: { success: r.success, latencyMs: recvAt - at, visibilityState: vis }, observerTruth: { toastAt: at, sentAt, recvAt, dom, idle }, gating: true,
        });
      } finally { await other?.close().catch(() => {}); }
    });
  }
  C('SDK-L2', async (id) => {
    for (const [name, url, cond, ev] of [
      ['js', server.url('/conditions.html', { case: 'js', delay: 2000 }), { js: 'window.__appState.ready === true' }, 'jsReady'],
      ['url', server.url('/conditions.html', { case: 'push', delay: 2000 }), { url: 'stage=done' }, 'pushed'],
      ['textGone', server.url('/conditions.html', { case: 'spinner', delay: 2000 }), { textGone: 'Loading data…' }, 'spinnerGone'],
    ]) {
      await page.goto(url);
      const p = await obsFor(url.split('&n=')[0].split('?n=')[0]);
      const sentAt = Date.now();
      const r = await page.waitFor({ ...cond, timeout: 8000 });
      const recvAt = Date.now();
      const at = evAt((await fxState(p)).events, ev);
      record(surface, `${id}-${name}`, r.success === true && sentAt <= at && at <= recvAt, { expected: `SDK ${name} condition: sentAt <= event <= recvAt`, observed: { success: r.success }, observerTruth: { eventAt: at, sentAt, recvAt }, gating: true });
    }
  });
  C('SDK-L3', async (id) => {
    const urlA = server.url('/conditions.html', { case: 'settle-load' });
    await page.goto(urlA, { settle: true });
    const p = await obsFor(urlA.split('&n=')[0].split('?n=')[0]);
    await loaded(p);
    const two = evLastAt((await fxState(p)).events, 'load:2');
    const ok1 = two !== undefined;
    // press
    const urlS = server.url('/conditions.html', { case: 'settle' });
    await page.goto(urlS);
    const p2 = await obsFor(urlS.split('&n=')[0].split('?n=')[0]);
    await loaded(p2);
    await page.click('#s-key');
    const s0 = Date.now();
    await page.press('x', { settle: true });
    const e0 = Date.now();
    const pk = evLastAt((await fxState(p2)).events, 'press_key:2');
    // scroll
    await page.goto(urlS);
    const p3 = await obsFor(urlS.split('&n=')[0].split('?n=')[0]);
    await loaded(p3);
    const before = Date.now();
    await page.scroll('down', 300, { settle: true }); // scrolls the WINDOW; its scroll event starts the fixture's burst
    const after = Date.now();
    const sc = evLastAt((await fxState(p3)).events, 'scroll_window:2');
    record(surface, id, ok1 && pk !== undefined && pk <= e0 && s0 <= pk && sc !== undefined && sc <= after && sc >= before, {
      expected: 'SDK: goto settle:true resolves after load:2; press settle:true resolves after press_key:2; scroll settle:true resolves after the window-scroll burst (scroll_window:2)',
      observed: { gotoLoad2Seen: ok1, pressBurst2: pk, pressRecvAt: e0 }, observerTruth: { scrollBurst2At: sc, scrollSentAt: before, scrollRecvAt: after }, gating: true,
    });
  });
  C('SDK-N1', async (id) => {
    await page.goto(server.url('/conditions.html', { case: 'static' }));
    const t0 = Date.now();
    const e1 = await page.waitFor({ text: 'Never appears', timeout: 1500 }).catch((e) => e);
    const ms = Date.now() - t0;
    const e2 = await page.waitFor({}).catch((e) => e);
    const t1 = Date.now();
    const e3 = await page.waitFor({ js: 'window.__nope.ready' }).catch((e) => e);
    const ms3 = Date.now() - t1;
    const e4 = await page.waitFor({ selector: '#t' }).catch((e) => e);
    const e5 = await page.waitFor({ text: 'x', timeout: 'abc' }).catch((e) => e);
    record(surface, id,
      e1 instanceof sdk.ActionFailedError && /wait_for timed out after 1500ms/.test(e1.message) && ms >= 1500 &&
      e2 instanceof TypeError && /at least one/.test(e2.message) &&
      e3 instanceof sdk.ActionFailedError && /js condition threw/.test(e3.message) && ms3 < 2500 &&
      e4 instanceof TypeError && /wait_for_selector/.test(e4.message) && e5 instanceof TypeError, {
      expected: 'NEG: the SDK REJECTS: a timeout (ActionFailedError), no keys (TypeError), a js throw fast (ActionFailedError), {selector} (TypeError naming wait_for_selector), timeout "abc" (TypeError)',
      observed: { e1: e1?.message, e2: e2?.message, e3: e3?.message, ms3, e4: e4?.message, e5: e5?.message }, gating: true,
    });
  });
  C('SDK-N10', async (id) => {
    const url = server.url('/conditions.html', { case: 'alert', delay: 500 });
    await page.goto(url);
    const p = await obsFor(url.split('&n=')[0].split('?n=')[0]);
    const t0 = Date.now();
    const e = await page.waitFor({ text: 'Never appears', timeout: 15000 }).catch((x) => x);
    record(surface, id, e instanceof sdk.ActionFailedError && /blocked by an open alert dialog/.test(e.message) && Date.now() - t0 < 8000, { expected: 'NEG: an open alert rejects the SDK wait within seconds (not 15s / 30s)', observed: { msg: e?.message, ms: Date.now() - t0 }, gating: true });
    // the alert is still open: dismiss it through the observer's own CDP connection (page.evaluate would block behind it)
    const cdp = await p.createCDPSession();
    await cdp.send('Page.enable').catch(() => {});
    await cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    await cdp.detach().catch(() => {});
  });
  C('SDK-N12', async (id) => {
    await page.goto(server.url('/conditions.html', { case: 'static' }));
    const r = await page.waitFor({ textGone: 'Never was here', timeout: 3000 });
    record(surface, id, r.success === true && r.output.presentAtStart === false && page.lastResult?.verification?.evidence?.tier === 'unverifiable', { expected: 'vacuous textGone resolves, presentAtStart false, lastResult tier unverifiable', observed: { presentAtStart: r.output?.presentAtStart, tier: page.lastResult?.verification?.evidence?.tier }, gating: true });
  });
  C('Z-gap325-budget', async (id) => {
    const mine = gap325.tolerated.filter((x) => x.startsWith(surface + ':'));
    record(surface, id, mine.length <= 3, { expected: 'GAP-325 tolerance budget', observed: { tolerated: mine } });
  });

  for (const c of cases) await c();
  await observer.disconnect().catch(() => {});
  await browser.close().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Baseline: N18 (T5) on the PRE-change build, capped at 35 s
// ─────────────────────────────────────────────────────────────────────────────────────────
async function runBaseline(ctx) {
  const { server, chromePath } = ctx;
  const serverPath = path.join(ROOT, 'packages', 'mcp-server', 'dist', 'cli.js');
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-08-base-'));
  tempDirs.push(scratch);
  const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: scratch, args: ['--no-sandbox'], defaultViewport: { width: 1100, height: 900 } });
  spawned.push(observer.process()?.pid);
  const mcp = makeMcpClient(serverPath);
  await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-08-baseline', version: '1.0' } });
  mcp.notify('notifications/initialized');
  const sessionId = jsonOf(await mcp.callTool('browser.attach', { endpoint: observer.wsEndpoint() })).sessionId;
  // control: the same click with NO settle on this build, to learn how long the click itself takes when it opens a dialog
  const urlC = server.url('/conditions.html', { case: 'settle' });
  await mcp.callTool('browser.navigate', { sessionId, url: urlC });
  const pageC = await pageFor(observer, urlC);
  await loaded(pageC);
  const c0 = Date.now();
  await mcp.callTool('browser.click', { sessionId, target: '#s-alert' }, 60000).catch(() => {});
  const controlMs = Date.now() - c0;
  await mcp.callTool('browser.handle_dialog', { sessionId, action: 'accept' }).catch(() => {});
  baselineRows.push({ case: 'N18-baseline-control-no-settle', root: ROOT, elapsedMs: controlMs });
  console.log(`[baseline] control (no settle): ${controlMs}ms`);
  const url = server.url('/conditions.html', { case: 'settle' });
  await mcp.callTool('browser.navigate', { sessionId, url });
  const page = await pageFor(observer, url);
  await loaded(page);
  const sentAt = Date.now();
  let outcome;
  try {
    const r = await mcp.callTool('browser.click', { sessionId, target: '#s-alert', settle: { timeoutMs: 2000 } }, 35000);
    outcome = { returned: true, success: jsonOf(r).success };
  } catch (e) {
    outcome = { returned: false, error: e.message };
  }
  const recvAt = Date.now();
  const opened = evLastAt(await page.evaluate(() => window.__fx8.events).catch(() => []), 'alertOpened');
  baselineRows.push({ case: 'N18-baseline', root: ROOT, elapsedMs: recvAt - sentAt, alertOpenedAt: opened, outcome, note: 'PRE-change build: click #s-alert with settle:{timeoutMs:2000} (a dialog opened by the click). Capped at 35s by this script.' });
  console.log(`[baseline] N18 pre-change: ${JSON.stringify(baselineRows.at(-1))}`);
  mcp.child.stdin.end();
  await observer.close().catch(() => {});
}
const baselineRows = [];

// ─────────────────────────────────────────────────────────────────────────────────────────
function countChromeWithNeedles(needles) {
  if (process.platform !== 'win32' || needles.length === 0) return { count: 0, matches: [] };
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  const matches = (r.stdout || '').split(String.fromCharCode(10)).filter((l) => needles.some((n) => n && l.includes(n)));
  return { count: matches.length, matches: matches.map((m) => m.slice(0, 160)) };
}
async function listCliTempDirs() {
  return new Set((await fs.readdir(os.tmpdir()).catch(() => [])).filter((n) => n.startsWith('sutradhar-cli-')));
}

async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const cliDirsBefore = await listCliTempDirs();
  const chromePath = resolveChrome();
  const server = await startFr208Server();
  const srv7 = await startFr207Server();
  const ctx = { server, srv7, chromePath };
  const startedAt = new Date().toISOString();
  console.log(`[fr2-08] evidence dir: ${EVIDENCE_DIR}; fixture server ${server.origin}; matrix server ${srv7.origin}; mode ${BASELINE ? 'BASELINE' : 'verify'}`);
  let lingering;
  try {
    if (BASELINE) {
      await runBaseline(ctx);
      await fs.writeFile(path.join(EVIDENCE_DIR, 'baselines.jsonl'), baselineRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } else {
      if (SURFACES.includes('mcp')) await runMcpCases('mcp', path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js'), ctx);
      if (SURFACES.includes('cli')) await runCliCases(ctx);
      if (SURFACES.includes('sdk')) await runSdkCases(ctx);
      if (SURFACES.includes('bundle')) await runMcpCases('bundle', path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js'), ctx);
    }
  } finally {
    await server.close().catch(() => {});
    await srv7.close?.().catch(() => {});
    await delay(1500);
    lingering = countChromeWithNeedles(tempDirs);
    for (const d of tempDirs) await rmWithRetry(d);
  }
  const cliDirsAfter = await listCliTempDirs();
  const newCliDirs = [...cliDirsAfter].filter((n) => !cliDirsBefore.has(n));
  for (const d of newCliDirs) await rmWithRetry(path.join(os.tmpdir(), d)); // only the dirs THIS run created
  const cliDirsLeft = [...(await listCliTempDirs())].filter((n) => !cliDirsBefore.has(n));
  if (!BASELINE) {
    for (const s of ['mcp', 'cli', 'sdk', 'bundle']) {
      await fs.writeFile(path.join(EVIDENCE_DIR, `live-${s}.jsonl`), results.filter((r) => r.surface === s).map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
    const perSurface = Object.fromEntries(['mcp', 'cli', 'sdk', 'bundle'].map((s) => [s, { total: results.filter((r) => r.surface === s).length, passed: results.filter((r) => r.surface === s && r.pass).length }]));
    const summary = {
      startedAt, finishedAt: new Date().toISOString(),
      total: results.length, passed: results.filter((r) => r.pass).length, perSurface, failed: results.filter((r) => !r.pass).map((r) => `${r.surface}:${r.case}`),
      gap325Tolerated: gap325.tolerated,
      informational,
      hygiene: { lingeringChromeWithScratchProfile: lingering?.count ?? null, lingeringMatches: lingering?.matches ?? [], newSutradharCliTempDirsCreated: newCliDirs, newSutradharCliTempDirsLeftAfterCleanup: cliDirsLeft, childPidsStarted: spawned.filter(Boolean) },
      cases: results.map((r) => ({ surface: r.surface, case: r.case, expected: r.expected, observed: r.observed, observerTruth: r.observerTruth, verification: r.verification, tolerated: r.tolerated, pass: r.pass })),
    };
    await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2));
    console.log(`\n[fr2-08] ${summary.passed}/${summary.total} passed ${JSON.stringify(perSurface)}${summary.failed.length ? `; FAILED: ${summary.failed.join(', ')}` : ''}`);
    if ((lingering?.count ?? 0) > 0 || cliDirsLeft.length > 0) console.log(`[fr2-08] HYGIENE: ${lingering?.count} lingering chrome, sutradhar-cli-* dirs left: ${cliDirsLeft.join(',')}`);
    process.exitCode = overallOk ? 0 : 1;
  }
}

main().catch((e) => {
  console.error('[fr2-08] fatal:', e);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref());
