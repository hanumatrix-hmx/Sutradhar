// Live-verify script for FR2-01 (wait_for_selector visibility states) — drives the REAL BUILT
// worktree artifacts (packages/mcp-server/dist/cli.js, packages/cli/dist/cli.js,
// packages/sutradhar/dist/index.js) against a real Chrome, using an INDEPENDENT puppeteer-core
// observer connection to verify the tool's own report against real DOM state and real timing —
// never trusting `success` alone. See .ai/loop/field-report-2/evidence/FR2-01/spec.md §5.
//
// Run: node tools/scenario-suite/verify-fr2-01-wait-states.mjs
// Requires: `pnpm build` already run in this worktree.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
// FR2-01 fix-2 standing rule: each fix/audit round's evidence directory is its own to write —
// never a prior round's (`audit-1/`, `fix-1/`, `audit-2/`, or this top-level FR2-01 dir, which
// predates all of those). `SUTRADHAR_FR2_01_EVIDENCE_DIR` lets a later round redirect this
// script's output into its OWN evidence directory instead of overwriting an earlier round's.
//
// GAP-132-fix process finding: the OLD default here — the shared, top-level FR2-01 evidence
// dir — meant simply running this script with no env var set would silently overwrite that
// shared directory's files, including earlier rounds' committed evidence, exactly the kind of
// clobber this comment already warned against for a LATER round but never actually prevented
// for the SIMPLE case of "someone runs this without reading the comment first". The default is
// now a fresh scratch directory under the OS temp dir — never a path under `.ai/loop/` at all —
// so running this script can never overwrite committed evidence by accident. Pass
// `SUTRADHAR_FR2_01_EVIDENCE_DIR` explicitly to write into a real (new, not-yet-existing) round
// directory on purpose.
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_01_EVIDENCE_DIR ??
  path.join(os.tmpdir(), `sutradhar-fr2-01-verify-${Date.now()}`);
if (!process.env.SUTRADHAR_FR2_01_EVIDENCE_DIR) {
  console.warn(
    `[verify-fr2-01-wait-states] SUTRADHAR_FR2_01_EVIDENCE_DIR not set — writing evidence to a ` +
      `scratch directory instead of any committed .ai/loop/ evidence: ${EVIDENCE_DIR}`,
  );
}
const FIXTURE_PATH = path.join(here, 'fixtures', 'fr2-01-wait-states.html');
// GAP-012: `pathToFileURL` (not a hand-rolled 'file://' + path string) — on Windows, Chrome's
// own normalized file:// URL for an absolute drive-letter path has THREE slashes
// ("file:///E:/...", not "file://E:/..."), so the naive version never actually matched a real
// page's `.url()` by prefix. That went unnoticed everywhere it was used because every call site
// silently fell back to "the last open page" — see gotoAndGetObserverPage's new hard check,
// added for GAP-012, which is what actually surfaced this.
const FIXTURE_URL = pathToFileURL(FIXTURE_PATH).href;
// GAP-008: a page with NO iframes at all — the multi-frame fixture above masked the original
// bug (its iframe made resolveElement/waitForHiddenInAllFrames take the multi-frame branch,
// which happened to poll differently). This fixture forces the plain single-frame path.
const SINGLEFRAME_FIXTURE_PATH = path.join(here, 'fixtures', 'fr2-01-singleframe.html');
const SINGLEFRAME_FIXTURE_URL = pathToFileURL(SINGLEFRAME_FIXTURE_PATH).href;

const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');

/** Builds a genuinely-fresh fixture URL for `hash` (e.g. '#auto', '#manual') — the nonce goes
 *  in the QUERY STRING, before the '#', not appended inside the fragment. A fragment-only
 *  change (e.g. '#auto&t=1' -> '#auto&t=2') is a same-document navigation in Chrome: no reload,
 *  no re-run of the fixture's <script>, so window.__fx and every element's state would silently
 *  carry over from whatever a PRIOR case left behind instead of resetting to the load-time
 *  state. A query-string nonce forces a real full navigation every time. */
function freshUrl(hash) {
  return `${FIXTURE_URL}?t=${Date.now()}-${Math.random().toString(36).slice(2)}${hash}`;
}

/** Same nonce-in-query-string discipline, for the single-frame fixture (GAP-008 cases only). */
function freshSingleFrameUrl() {
  return `${SINGLEFRAME_FIXTURE_URL}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const results = { mcp: [], cli: [], sdk: [] };
const cleanupDirs = [];
let overallOk = true;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function record(surface, entry) {
  results[surface].push(entry);
  if (!entry.pass) overallOk = false;
  const tag = entry.pass ? 'PASS' : 'FAIL';
  console.log(`[${surface}] ${tag} ${entry.case}${entry.pass ? '' : ' — ' + (entry.detail ?? '')}`);
}

async function writeJsonl(name, arr) {
  const lines = arr.map((e) => JSON.stringify(e)).join('\n') + (arr.length ? '\n' : '');
  await fs.writeFile(path.join(EVIDENCE_DIR, name), lines, 'utf-8');
}

async function resolveChromeExecutablePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
  const launcher = new mod.BrowserLauncher();
  const p = launcher.findExecutablePath();
  if (!p) throw new Error('No Chrome/Edge executable found — set CHROME_PATH.');
  return p;
}

/**
 * GAP-012: a REAL count of Chrome/Chromium processes still referencing any of this run's
 * scratch profile paths (or the `sutradhar-cli-*` temp dirs the CLI surface leaks pending
 * FR2-03) — not a "we called close() so it must be gone" assumption. Uses PowerShell's
 * `Get-CimInstance Win32_Process` (Windows) so the check reads the process's real command
 * line, the same technique already used in audit-1's `chrome-before.txt`.
 */
async function countLingeringChromeProcesses(needlePaths) {
  if (process.platform !== 'win32' || needlePaths.length === 0) return { count: 0, matches: [] };
  const { spawnSync } = await import('node:child_process');
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' } | " +
    "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  const matches = lines.filter((line) => needlePaths.some((p) => p && line.includes(p)));
  return { count: matches.length, matches };
}

async function rmWithRetry(dir, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts - 1) {
        console.warn(`[cleanup] could not remove ${dir}: ${e.message}`);
        return;
      }
      await delay(300);
    }
  }
}

// ── MCP JSON-RPC stdio transport (copied locally per spec §5.1 — run-mcp.mjs runs main() on
// import, so it can't be imported) ──────────────────────────────────────────────────────────
function makeMcpClient(serverPath) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdoutBuf = '';
  let nextId = 1;
  const pending = new Map();
  const stderrLog = [];
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    }
  });
  child.stderr.on('data', (d) => stderrLog.push(d.toString('utf8')));

  function call(method, params, timeoutMs = 60000) {
    const id = nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify(req) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for response to ${method} (id=${id})`));
        }
      }, timeoutMs);
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async function callTool(name, args) {
    return call('tools/call', { name, arguments: args });
  }
  return { child, call, notify, callTool, stderrLog };
}

function textOf(result) {
  return result.content?.[0]?.text ?? '';
}
function jsonOf(result) {
  return JSON.parse(textOf(result));
}

// ── MCP surface ─────────────────────────────────────────────────────────────────────────────
async function runMcpSurface() {
  const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
  const chromePath = await resolveChromeExecutablePath();
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-01-mcp-observer-'));
  cleanupDirs.push(scratchProfile);

  const observerBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: scratchProfile,
    args: ['--no-sandbox'],
  });
  const wsEndpoint = observerBrowser.wsEndpoint();

  const mcp = makeMcpClient(serverPath);
  await mcp.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fr2-01-verify', version: '1.0' },
  });
  mcp.notify('notifications/initialized');

  const attachResult = jsonOf(await mcp.callTool('browser.attach', { endpoint: wsEndpoint }));
  const sessionId = attachResult.sessionId;

  async function navFresh(hash) {
    // A unique nonce per call: navigating to the exact same URL (incl. hash) as the CURRENT
    // page is a same-document no-op in Chrome — it would silently skip the real reload and
    // reuse whatever DOM state (already revealed/hidden/removed elements) a PRIOR case left
    // behind, instead of genuinely resetting the fixture to its load-time state.
    await mcp.callTool('browser.navigate', { sessionId, url: freshUrl(hash) });
    // Find the freshly-navigated page via the observer's own connection.
    const pages = await observerBrowser.pages();
    const page = pages.find((p) => p.url().startsWith(FIXTURE_URL)) ?? pages[pages.length - 1];
    await page.waitForFunction(() => !!window.__fx, { timeout: 5000 }).catch(() => {});
    return page;
  }

  async function fxEvent(page, id) {
    return page.evaluate((elId) => {
      const ev = (window.__fx?.events ?? []).filter((e) => e.id === elId);
      return ev.length ? ev[ev.length - 1] : null;
    }, id);
  }

  async function isVisible(page, selector) {
    return page
      .evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return !['hidden', 'collapse'].includes(s.visibility) && r.width > 0 && r.height > 0;
      }, selector)
      .catch(() => null);
  }

  // (a) default visible on #toast — auto mode, fresh nav, timer at 1500ms.
  {
    const page = await navFresh('#auto');
    const before = await isVisible(page, '#toast');
    const sentAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#toast', timeoutMs: 5000 }));
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'toast');
    const afterVisible = await isVisible(page, '#toast');
    const pass =
      res.success === true &&
      res.output?.state === 'visible' &&
      before === false &&
      !!ev &&
      sentAt <= ev.at &&
      ev.at <= recvAt + 50 &&
      afterVisible === true;
    record('mcp', {
      case: 'a-default-visible-toast',
      expected: 'success, state=visible, waited past the ~1.5s reveal',
      observed: { res, before, ev, afterVisible, sentAt, recvAt },
      pass,
    });
  }

  // (a2) explicit state:'visible' on #toast — same proof, explicit.
  {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#toast', timeoutMs: 5000, state: 'visible' }),
    );
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'toast');
    const pass = res.success === true && res.output?.state === 'visible' && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50;
    record('mcp', { case: 'a2-explicit-visible-toast', expected: 'same as (a), explicit state', observed: { res, ev }, pass });
  }

  // (b) state:'attached' on #toast — returns before the reveal.
  {
    const page = await navFresh('#auto');
    const recvBefore = Date.now();
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#toast', timeoutMs: 5000, state: 'attached' }),
    );
    const recvAt = Date.now();
    const stillHidden = await isVisible(page, '#toast');
    const pass = res.success === true && res.output?.state === 'attached' && recvAt - recvBefore < 1000 && stillHidden === false;
    record('mcp', {
      case: 'b-attached-toast-returns-before-reveal',
      expected: 'success quickly, before the ~1.5s reveal, element still display:none',
      observed: { res, recvAt, recvBefore, stillHidden },
      pass,
    });
  }

  // (c1) state:'hidden' on #banner — visible->hidden at 1500ms.
  {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#banner', timeoutMs: 5000, state: 'hidden' }),
    );
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'banner');
    const nowHidden = await isVisible(page, '#banner');
    const pass =
      res.success === true &&
      res.output?.state === 'hidden' &&
      !!ev &&
      sentAt <= ev.at &&
      ev.at <= recvAt + 50 &&
      nowHidden === false;
    record('mcp', { case: 'c1-hidden-banner', expected: 'success, waited for the CSS hide', observed: { res, ev, nowHidden }, pass });
  }

  // (c2) state:'hidden' on #spinner — removed from the DOM at 1500ms.
  {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#spinner', timeoutMs: 5000, state: 'hidden' }),
    );
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'spinner');
    const goneNow = await page.evaluate(() => document.querySelector('#spinner') === null);
    const pass = res.success === true && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50 && goneNow === true;
    record('mcp', { case: 'c2-hidden-spinner-removed', expected: 'success, waited for removal', observed: { res, ev, goneNow }, pass });
  }

  // Extra mechanisms: default visible on vis-hidden, zero-size, shadow-toast, frame-toast.
  for (const [id, selector] of [
    ['vis-hidden', '#vis-hidden'],
    ['zero-size', '#zero-size'],
    ['shadow-toast', '#host'], // pierce/ needed to reach the shadow child; select via shadow host + child id below
  ]) {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const target = id === 'shadow-toast' ? '#shadow-toast' : selector;
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target, timeoutMs: 5000 }));
    const recvAt = Date.now();
    const ev = await fxEvent(page, id);
    const pass = res.success === true && res.output?.state === 'visible' && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50;
    record('mcp', { case: `mechanism-visible-${id}`, expected: 'success, waited for the mechanism-specific reveal', observed: { res, ev }, pass });
  }

  // Manual-mode causality proof: default visible on #toast must NOT resolve before reveal(),
  // then resolve promptly once reveal() runs.
  {
    const page = await navFresh('#manual');
    const callPromise = mcp.callTool('browser.wait_for_selector', { sessionId, target: '#toast', timeoutMs: 10000 });
    const notYetWinner = await Promise.race([
      callPromise.then(() => 'call'),
      delay(1500).then(() => 'delay'),
    ]);
    const revealAt = Date.now();
    await page.evaluate(() => window.__fx.reveal('toast'));
    const raceResult = await Promise.race([
      callPromise.then((r) => ({ winner: 'call', r })),
      delay(1000).then(() => ({ winner: 'timeout' })),
    ]);
    const recvAt = Date.now();
    const pass = notYetWinner === 'delay' && raceResult.winner === 'call' && jsonOf(raceResult.r).success === true && recvAt >= revealAt;
    record('mcp', {
      case: 'manual-causality-toast-visible',
      expected: 'blocked for 1.5s, resolves within 1s of reveal()',
      observed: { notYetWinner, raceResult: raceResult.winner === 'call' ? jsonOf(raceResult.r) : raceResult, revealAt, recvAt },
      pass,
    });
  }
  {
    const page = await navFresh('#manual');
    const callPromise = mcp.callTool('browser.wait_for_selector', { sessionId, target: '#banner', timeoutMs: 10000, state: 'hidden' });
    const notYetWinner = await Promise.race([callPromise.then(() => 'call'), delay(1500).then(() => 'delay')]);
    const hideAt = Date.now();
    await page.evaluate(() => window.__fx.hide('banner'));
    const raceResult = await Promise.race([callPromise.then((r) => ({ winner: 'call', r })), delay(1000).then(() => ({ winner: 'timeout' }))]);
    const recvAt = Date.now();
    const pass = notYetWinner === 'delay' && raceResult.winner === 'call' && jsonOf(raceResult.r).success === true && recvAt >= hideAt;
    record('mcp', {
      case: 'manual-causality-banner-hidden',
      expected: 'blocked for 1.5s, resolves within 1s of hide()',
      observed: { notYetWinner, raceResult: raceResult.winner === 'call' ? jsonOf(raceResult.r) : raceResult, hideAt, recvAt },
      pass,
    });
  }

  // ── Negative cases (§6) ──────────────────────────────────────────────────────────────────
  // N1: #never, visible, 1500ms — timeout, names the state, contains "none is visible", carries
  // the state:"attached" hint, elapsed >= 1500ms.
  {
    await navFresh('#auto');
    const startedAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#never', timeoutMs: 1500 }));
    const elapsed = Date.now() - startedAt;
    const pass =
      res.success === false &&
      /timed out after 1500ms waiting for state=visible/.test(res.error) &&
      res.error.includes('none is visible') &&
      res.error.includes('state:"attached"') &&
      elapsed >= 1400;
    record('mcp', { case: 'N1-never-visible-timeout', expected: 'failure, state-naming + hint, elapsed>=1500ms', observed: { res, elapsed }, pass });
  }

  // N2: #does-not-exist, visible — contains state=visible AND "No element found for selector".
  {
    await navFresh('#auto');
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#does-not-exist', timeoutMs: 800 }));
    const pass = res.success === false && res.error.includes('state=visible') && res.error.includes('No element found for selector: #does-not-exist');
    record('mcp', { case: 'N2-nonexistent-selector', expected: 'failure with both diagnostics', observed: res, pass });
  }

  // N3: #stays, hidden, 1500ms — timeout, "waiting for state=hidden", "still visible".
  {
    await navFresh('#auto');
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#stays', timeoutMs: 1500, state: 'hidden' }));
    const pass = res.success === false && /waiting for state=hidden/.test(res.error) && res.error.includes('still visible');
    record('mcp', { case: 'N3-stays-hidden-timeout', expected: 'failure, state-naming', observed: res, pass });
  }

  // N4: typo'd selector, hidden — succeeds quickly, matchedAtStart:false.
  {
    await navFresh('#auto');
    const startedAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#typo-nothing', timeoutMs: 5000, state: 'hidden' }));
    const elapsed = Date.now() - startedAt;
    const pass = res.success === true && res.output?.matchedAtStart === false && elapsed < 2000;
    record('mcp', { case: 'N4-typo-hidden-succeeds-fast', expected: 'success quickly, matchedAtStart:false', observed: { res, elapsed }, pass });
  }

  // N8 (MCP half): invalid state — schema rejection (or, if the SDK forwards it through to the
  // handler anyway, an in-band success:false) — never success:true.
  {
    await navFresh('#auto');
    let sawError = false;
    let detail;
    try {
      const raw = await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#toast', state: 'bogus' });
      detail = raw.isError ? raw : jsonOf(raw);
      sawError = raw.isError === true || detail.success === false;
    } catch (e) {
      sawError = true;
      detail = e.message;
    }
    const pass = sawError;
    record('mcp', { case: 'N8-invalid-state-schema-rejection', expected: 'JSON-RPC/tool error, never success:true', observed: detail, pass });
  }

  // N9: timeoutMs:0 on #never — fails fast, state message, no hang.
  {
    await navFresh('#auto');
    const startedAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#never', timeoutMs: 0 }));
    const elapsed = Date.now() - startedAt;
    const pass = res.success === false && /waiting for state=visible/.test(res.error) && elapsed < 3000;
    record('mcp', { case: 'N9-timeoutMs-zero-no-hang', expected: 'fails fast, no hang', observed: { res, elapsed }, pass });
  }

  // N5: #opacity-zero — opacity:0 still counts as VISIBLE (Puppeteer's own rule). Default state
  // succeeds immediately; state:'hidden' times out because it never actually becomes hidden.
  {
    await navFresh('#auto');
    const startedAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#opacity-zero', timeoutMs: 5000 }));
    const elapsed = Date.now() - startedAt;
    const pass = res.success === true && res.output?.state === 'visible' && elapsed < 800;
    record('mcp', { case: 'N5a-opacity-zero-visible-immediately', expected: 'success immediately (opacity:0 counts as visible)', observed: { res, elapsed }, pass });
  }
  {
    await navFresh('#auto');
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#opacity-zero', timeoutMs: 1500, state: 'hidden' }));
    const pass = res.success === false && /waiting for state=hidden/.test(res.error) && res.error.includes('still visible');
    record('mcp', { case: 'N5b-opacity-zero-hidden-times-out', expected: 'failure — opacity:0 never satisfies hidden', observed: res, pass });
  }

  // N6: #offscreen — off-screen position still counts as visible; default state succeeds
  // immediately.
  {
    await navFresh('#auto');
    const startedAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#offscreen', timeoutMs: 5000 }));
    const elapsed = Date.now() - startedAt;
    const pass = res.success === true && res.output?.state === 'visible' && elapsed < 800;
    record('mcp', { case: 'N6-offscreen-visible-immediately', expected: 'success immediately (off-screen still counts as visible)', observed: { res, elapsed }, pass });
  }

  // N7: .dup — first match hidden forever, second match visible. Visibility is checked on the
  // FIRST match only, so this must time out, with the "later match(es) are" diagnosis (not
  // silently succeed against the wrong, visible element).
  {
    await navFresh('#auto');
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '.dup', timeoutMs: 1500 }));
    const pass = res.success === false && res.error.includes('later match(es) are');
    record('mcp', { case: 'N7-dup-first-hidden-second-visible-diagnosed', expected: 'failure, diagnosed (not a silent wrong-element success)', observed: res, pass });
  }

  // N10: a stale [data-sd-node-id] selector, after a real navigation, keeps the "call
  // browser.snapshot again" staleness guidance AND still names state=visible.
  {
    await navFresh('#auto');
    await mcp.callTool('browser.snapshot', { sessionId }); // stamps a snapshot generation on THIS document
    await navFresh('#auto'); // real navigation away — the new document has no snapshot generation at all
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '[data-sd-node-id="999"]', timeoutMs: 800 }),
    );
    const pass =
      res.success === false &&
      res.error.includes('state=visible') &&
      res.error.includes('navigated since the last snapshot') &&
      res.error.includes('Call browser.snapshot again');
    record('mcp', { case: 'N10-stale-node-id-after-navigation', expected: 'failure, keeps staleness guidance + state=visible', observed: res, pass });
  }

  // Mechanism: #child under #ancestor-hidden — default visible must wait for the ANCESTOR's
  // display:none -> block reveal, not just the child's own (unchanged) inline style.
  {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#child', timeoutMs: 5000 }));
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'child');
    const pass = res.success === true && res.output?.state === 'visible' && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50;
    record('mcp', { case: 'mechanism-visible-ancestor-hidden-child', expected: 'success, waited for the ancestor reveal', observed: { res, ev }, pass });
  }

  // Mechanism: #frame-toast — lives INSIDE the <iframe>, not the main frame. Default visible
  // must cross the frame boundary and wait for its reveal.
  {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#frame-toast', timeoutMs: 5000 }));
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'frame-toast');
    const pass = res.success === true && res.output?.state === 'visible' && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50;
    record('mcp', { case: 'mechanism-visible-frame-toast', expected: 'success, waited for the in-iframe reveal', observed: { res, ev }, pass });
  }

  // Mechanism: #late — not in the DOM at all at load, inserted by the timer. BOTH 'attached'
  // and 'visible' must genuinely wait for the insertion (there's nothing to find before it).
  {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#late', timeoutMs: 5000, state: 'attached' }));
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'late');
    const pass = res.success === true && res.output?.state === 'attached' && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50;
    record('mcp', { case: 'mechanism-attached-late-waits-for-insertion', expected: 'success, waited for insertion (attached)', observed: { res, ev }, pass });
  }
  {
    const page = await navFresh('#auto');
    const sentAt = Date.now();
    const res = jsonOf(await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#late', timeoutMs: 5000 }));
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'late');
    const pass = res.success === true && res.output?.state === 'visible' && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50;
    record('mcp', { case: 'mechanism-visible-late-waits-for-insertion', expected: 'success, waited for insertion (visible)', observed: { res, ev }, pass });
  }

  // Hidden multi-frame probe: #frame-toast made visible INSIDE the iframe (manual mode) must
  // NOT satisfy state:'hidden' while it's still visible there — the main frame has no match at
  // all for this selector, so a buggy "any frame says hidden/absent" (OR) implementation would
  // wrongly succeed instantly on the main frame's absence alone, instead of requiring EVERY
  // live frame (including the iframe, where it's genuinely visible) to agree.
  {
    const page = await navFresh('#manual');
    await page.evaluate(() => window.__fx.reveal('frame-toast'));
    // Give the iframe's own reveal (arms via postMessage-free direct contentWindow call) a
    // moment to actually land before asserting on it.
    await page
      .waitForFunction(
        () => {
          const f = document.getElementById('f');
          const doc = f && f.contentDocument;
          const el = doc && doc.getElementById('frame-toast');
          return !!el && getComputedStyle(el).display !== 'none';
        },
        { timeout: 2000 },
      )
      .catch(() => {});
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#frame-toast', timeoutMs: 800, state: 'hidden' }),
    );
    const pass = res.success === false && /waiting for state=hidden/.test(res.error) && res.error.includes('still visible');
    record('mcp', {
      case: 'hidden-multiframe-visible-in-iframe-does-not-succeed',
      expected: 'failure — the iframe still has a visible match, hidden must require EVERY frame to agree',
      observed: res,
      pass,
    });
  }

  // GAP-008 live proof, MCP surface: wait_for_selector on a tab that is NOT the foreground tab
  // must not stall for whole rAF-polling frames (~500ms) — resolve within ~500ms of the real
  // reveal, on the FIRST attempt (retriesUsed 0). Opens a second tab AFTER navigating the
  // fixture tab (so the fixture tab goes to the background) and targets the fixture tab
  // explicitly via `tabId`, the same technique the audit used.
  {
    // Single-frame fixture (GAP-008): the multi-frame fixture's iframe masked the original bug.
    await mcp.callTool('browser.navigate', { sessionId, url: freshSingleFrameUrl() });
    const pagesNow = await observerBrowser.pages();
    const page = pagesNow.find((p) => p.url().startsWith(SINGLEFRAME_FIXTURE_URL)) ?? pagesNow[pagesNow.length - 1];
    const tabsBefore = jsonOf(await mcp.callTool('browser.list_tabs', { sessionId })).tabs;
    const tabA = tabsBefore.find((t) => t.url.startsWith(SINGLEFRAME_FIXTURE_URL)) ?? tabsBefore[0];
    await mcp.callTool('browser.new_tab', { sessionId, url: 'about:blank' });
    await delay(200);
    const visState = await page.evaluate(() => document.visibilityState);
    setTimeout(() => {
      page.evaluate(() => window.__fx.reveal('toast')).catch(() => {});
    }, 400);
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#toast', timeoutMs: 5000, tabId: tabA.id }),
    );
    const recvAt = Date.now();
    const ev = await fxEvent(page, 'toast');
    const latencyAfterRevealMs = ev ? recvAt - ev.at : null;
    // GAP-035: this case's whole point is that tabA is genuinely BACKGROUNDED — assert that
    // directly (visState === 'hidden'), not just record it, or the case could pass without tabA
    // ever really being backgrounded at all (audit-2 found the CLI case already asserted this,
    // but the MCP and SDK cases didn't).
    const pass =
      res.success === true &&
      res.output?.state === 'visible' &&
      (res.retriesUsed ?? 0) === 0 &&
      visState === 'hidden' &&
      !!ev &&
      latencyAfterRevealMs !== null &&
      latencyAfterRevealMs >= 0 &&
      latencyAfterRevealMs < 500;
    record('mcp', {
      case: 'GAP-008-background-tab-visible-resolves-fast',
      expected: 'success on the first attempt, within ~500ms of the real reveal, even though tabA is backgrounded',
      observed: { res, visState, ev, latencyAfterRevealMs },
      pass,
    });
  }

  // N11: no timeout error ever starts with the generic outer-race message.
  {
    const allErrors = results.mcp.filter((r) => r.observed?.res?.error || r.observed?.error).map((r) => r.observed.res?.error ?? r.observed.error);
    const pass = allErrors.every((e) => typeof e !== 'string' || !e.startsWith('Action wait_for_selector timed out after'));
    record('mcp', { case: 'N11-never-the-generic-outer-message', expected: 'no error starts with the generic message', observed: { count: allErrors.length }, pass });
  }

  await mcp.callTool('browser.shutdown', { sessionId }).catch(() => {});
  mcp.child.stdin.end();
  await new Promise((resolve) => mcp.child.once('exit', resolve));
  await observerBrowser.close();
  await rmWithRetry(scratchProfile);
}

// ── CLI surface ─────────────────────────────────────────────────────────────────────────────
function runCliCommand(cliJs, args, env, opts = {}) {
  const child = spawn(process.execPath, [cliJs, ...args], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let firstStdoutAt = null;
  child.stdout.on('data', (d) => {
    if (firstStdoutAt === null) firstStdoutAt = Date.now();
    stdout += d.toString('utf8');
  });
  child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code) => resolve({ code, get stdout() { return stdout; }, get stderr() { return stderr; } }));
  });
  return {
    child,
    exitPromise,
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    // GAP-008 timing note: the CLI process can take several extra seconds to actually EXIT
    // after it has already printed its result (an unrelated, pre-existing characteristic of
    // this per-command process's teardown — reproduced live even for a plain foreground `wait`
    // with no backgrounding involved at all, so it is NOT something FR2-01 introduced). The
    // real "did it detect the change quickly" signal is when stdout first arrives, not exit.
    get firstStdoutAt() { return firstStdoutAt; },
  };
}

async function runCliSurface() {
  const cliJs = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
  const scratchStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-01-cli-state-'));
  cleanupDirs.push(scratchStateDir);
  const env = { SUTRADHAR_CLI_STATE_DIR: scratchStateDir };

  const beforeTmpDirs = new Set((await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('sutradhar-cli-')));

  async function readCliState() {
    const raw = await fs.readFile(path.join(scratchStateDir, 'state.json'), 'utf-8');
    return JSON.parse(raw);
  }

  // Fresh manual-mode session.
  const nav1 = runCliCommand(cliJs, ['nav', freshUrl('#manual')], env);
  const nav1Result = await nav1.exitPromise;
  record('cli', { case: 'setup-nav-manual', expected: 'exit 0', observed: nav1Result, pass: nav1Result.code === 0 });

  const state = await readCliState();
  const observer = await puppeteer.connect({ browserWSEndpoint: state.wsEndpoint });
  const observerPages = await observer.pages();
  const observerPage = observerPages.find((p) => p.url().startsWith(FIXTURE_URL)) ?? observerPages[observerPages.length - 1];

  // wait "#toast" 10000 (default visible) — must still be running after 2500ms, then resolves
  // once the observer reveals it.
  {
    const waitRun = runCliCommand(cliJs, ['wait', '#toast', '10000'], env);
    const stillRunning = await Promise.race([waitRun.exitPromise.then(() => false), delay(2500).then(() => true)]);
    const revealAt = Date.now();
    await observerPage.evaluate(() => window.__fx.reveal('toast'));
    const exitResult = await waitRun.exitPromise;
    const exitAt = Date.now();
    const nowVisible = await observerPage
      .evaluate(() => {
        const el = document.querySelector('#toast');
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return !['hidden', 'collapse'].includes(s.visibility) && r.width > 0 && r.height > 0;
      })
      .catch(() => null);
    const pass = stillRunning === true && exitResult.code === 0 && /is visible \(state=visible\)/.test(exitResult.stdout) && exitAt >= revealAt && nowVisible === true;
    record('cli', { case: 'wait-default-visible-toast-blocks-then-resolves', expected: 'blocked >2.5s, exit 0 after reveal', observed: { stillRunning, exitResult, nowVisible }, pass });
  }

  // GAP-008 live proof, CLI surface: `newtab` then `focustab` back to the fixture tab (the
  // audit's own technique — `newtab` makes Chrome's real foreground tab tabB, while `focustab`
  // only moves the CLI's OWN "next command targets this tab" bookkeeping back to tabA; it does
  // NOT call bringToFront, so tabA stays genuinely backgrounded in Chrome). `wait` must still
  // resolve within ~500ms of the real reveal, on the first attempt.
  {
    // Single-frame fixture (GAP-008): the multi-frame fixture's iframe masked the original bug.
    const navBg = await runCliCommand(cliJs, ['nav', freshSingleFrameUrl()], env).exitPromise;
    // `nav` never calls persistActiveTab (only `newtab`/`focustab` do), so state.json's
    // activeTabId is still whatever a PRIOR case left it as (or absent on a brand-new session).
    // Read the real current tab id off `tabs`' own output instead (the line marked with `*`).
    const tabsOut = (await runCliCommand(cliJs, ['tabs'], env).exitPromise).stdout;
    const activeLine = tabsOut.split('\n').find((l) => l.startsWith('*'));
    const tabA = activeLine ? activeLine.slice(1).trim().split(/\s+/)[0] : undefined;
    const newTabResult = await runCliCommand(cliJs, ['newtab', 'about:blank'], env).exitPromise;
    const focusResult = await runCliCommand(cliJs, ['focustab', tabA], env).exitPromise;
    const stateBg = await readCliState();
    const observerBg = await puppeteer.connect({ browserWSEndpoint: stateBg.wsEndpoint });
    const pagesBg = await observerBg.pages();
    const pageBg = pagesBg.find((p) => p.url().startsWith(SINGLEFRAME_FIXTURE_URL)) ?? pagesBg[pagesBg.length - 1];
    const visState = await pageBg.evaluate(() => document.visibilityState);
    // Each CLI command is a NEW Node process that must re-attach to the existing Chrome over
    // CDP before its own internal wait even starts — spec §5.2 measured this at ~0.5-1.5s. A
    // fixed short delay before revealing can't prove anything (the reveal might land before the
    // process has even finished attaching). Instead: start `wait` as a background child, first
    // confirm it's STILL RUNNING after a delay comfortably longer than that attach overhead
    // (2500ms, the same bound the pre-existing default-visible case above uses), THEN trigger
    // the real reveal, and measure latency from the reveal event to the child's actual exit.
    const waitRunHandle = runCliCommand(cliJs, ['wait', '#toast', '10000'], env);
    const stillRunning = await Promise.race([
      waitRunHandle.exitPromise.then(() => false),
      delay(2500).then(() => true),
    ]);
    await pageBg.evaluate(() => window.__fx.reveal('toast')).catch(() => {});
    const waitRun = await waitRunHandle.exitPromise;
    const ev = await pageBg
      .evaluate(() => {
        const e = (window.__fx?.events ?? []).filter((x) => x.id === 'toast');
        return e.length ? e[e.length - 1] : null;
      })
      .catch(() => null);
    // GAP-008 timing note (found live debugging this exact case): the CLI's own process EXIT
    // can lag several extra seconds behind the moment it already printed its result — a
    // pre-existing, unrelated CLI process-teardown characteristic (reproduced even for a plain
    // foreground `wait` with no backgrounding at all), not something this fix introduced. The
    // real "detected the change quickly" signal is when stdout first arrives, not process exit.
    const latencyAfterRevealMs = ev && waitRunHandle.firstStdoutAt ? waitRunHandle.firstStdoutAt - ev.at : null;
    observerBg.disconnect();
    const pass =
      !!tabA &&
      navBg.code === 0 &&
      newTabResult.code === 0 &&
      focusResult.code === 0 &&
      visState === 'hidden' &&
      stillRunning === true &&
      waitRun.code === 0 &&
      /is visible \(state=visible\)/.test(waitRun.stdout) &&
      !!ev &&
      latencyAfterRevealMs !== null &&
      latencyAfterRevealMs >= 0 &&
      latencyAfterRevealMs < 500;
    record('cli', {
      case: 'GAP-008-background-tab-visible-resolves-fast',
      expected: 'tabA visibilityState=hidden (real backgrounding); once attached and blocked, the RESULT (stdout) appears within ~500ms of the real reveal',
      observed: { tabA, navBg, newTabResult, focusResult, visState, stillRunning, waitRun, ev, latencyAfterRevealMs, firstStdoutAt: waitRunHandle.firstStdoutAt },
      pass,
    });
    // tabB (about:blank) is left open — harmless; the surface's final `close` command tears
    // down the whole browser, and every later case does its own fresh `nav` on the active tab.
  }

  // Fresh nav, wait "#toast" --state attached — exits promptly, still hidden.
  // The hash carries a unique nonce: navigating to the SAME URL (incl. hash) as the current
  // page is a same-document no-op in Chrome — it would silently reuse the prior test's already-
  // revealed DOM instead of genuinely reloading the fixture back to its hidden initial state.
  {
    const nav2 = await runCliCommand(cliJs, ['nav', freshUrl('#manual')], env).exitPromise;
    const startedAt = Date.now();
    const waitRun = await runCliCommand(cliJs, ['wait', '#toast', '10000', '--state', 'attached'], env).exitPromise;
    const elapsed = Date.now() - startedAt;
    const state2 = await readCliState();
    const observer2 = await puppeteer.connect({ browserWSEndpoint: state2.wsEndpoint });
    const pages2 = await observer2.pages();
    const page2 = pages2.find((p) => p.url().startsWith(FIXTURE_URL)) ?? pages2[pages2.length - 1];
    const stillHidden = await page2
      .evaluate(() => {
        const el = document.querySelector('#toast');
        return getComputedStyle(el).display === 'none';
      })
      .catch(() => null);
    observer2.disconnect();
    const pass = nav2.code === 0 && waitRun.code === 0 && /is attached \(state=attached\)/.test(waitRun.stdout) && elapsed < 4000 && stillHidden === true;
    record('cli', { case: 'wait-attached-toast-returns-promptly', expected: 'exit 0 quickly, still display:none', observed: { waitRun, elapsed, stillHidden }, pass });
  }

  // wait "#banner" 10000 --state hidden — blocks, then resolves once hide() runs.
  {
    const waitRun = runCliCommand(cliJs, ['wait', '#banner', '10000', '--state', 'hidden'], env);
    const stillRunning = await Promise.race([waitRun.exitPromise.then(() => false), delay(2500).then(() => true)]);
    const hideAt = Date.now();
    await observerPage.evaluate(() => window.__fx.hide('banner'));
    const exitResult = await waitRun.exitPromise;
    const exitAt = Date.now();
    const pass = stillRunning === true && exitResult.code === 0 && /hidden or absent/.test(exitResult.stdout) && exitAt >= hideAt;
    record('cli', { case: 'wait-hidden-banner-blocks-then-resolves', expected: 'blocked >2.5s, exit 0 after hide()', observed: { stillRunning, exitResult }, pass });
  }

  // wait "#spinner" 10000 --state hidden — blocks, then resolves once remove() runs.
  {
    const waitRun = runCliCommand(cliJs, ['wait', '#spinner', '10000', '--state', 'hidden'], env);
    const stillRunning = await Promise.race([waitRun.exitPromise.then(() => false), delay(2500).then(() => true)]);
    await observerPage.evaluate(() => window.__fx.remove('spinner'));
    const exitResult = await waitRun.exitPromise;
    const pass = stillRunning === true && exitResult.code === 0 && /hidden or absent/.test(exitResult.stdout);
    record('cli', { case: 'wait-hidden-spinner-blocks-then-resolves-on-removal', expected: 'blocked >2.5s, exit 0 after remove()', observed: { stillRunning, exitResult }, pass });
  }

  // Negatives.
  {
    const r = await runCliCommand(cliJs, ['wait', '#never', '1500'], env).exitPromise;
    const pass = r.code === 1 && r.stdout.includes('Wait failed:') && r.stdout.includes('waiting for state=visible') && r.stdout.includes('none is visible');
    record('cli', { case: 'N-never-visible-exit1', expected: 'exit 1, diagnostic stdout', observed: r, pass });
  }
  {
    const r = await runCliCommand(cliJs, ['wait', '#toast', '1000', '--state', 'bogus'], env).exitPromise;
    const pass = r.code === 1 && (r.stdout + r.stderr).includes('--state must be one of');
    record('cli', { case: 'N8-cli-state-bogus-exit1', expected: 'exit 1, usage message', observed: r, pass });
  }
  {
    const r = await runCliCommand(cliJs, ['wait', '#toast', '--state'], env).exitPromise;
    const pass = r.code === 1;
    record('cli', { case: 'N8-cli-state-missing-value-exit1', expected: 'exit 1', observed: r, pass });
  }
  {
    const r = await runCliCommand(cliJs, ['wait', '#stays', '1500', '--state', 'hidden'], env).exitPromise;
    const pass = r.code === 1 && r.stdout.includes('state=hidden');
    record('cli', { case: 'N-stays-hidden-exit1', expected: 'exit 1, state-naming', observed: r, pass });
  }

  // Teardown.
  const stateBeforeClose = await readCliState();
  observer.disconnect();
  const closeResult = await runCliCommand(cliJs, ['close'], env).exitPromise;
  await delay(500);
  let chromeDead = false;
  try {
    process.kill(stateBeforeClose.chromePid, 0);
    chromeDead = false;
  } catch {
    chromeDead = true;
  }
  record('cli', { case: 'teardown-close-kills-chrome', expected: 'exit 0, chromePid no longer alive', observed: { closeResult, chromeDead }, pass: closeResult.code === 0 && chromeDead });

  const afterTmpDirs = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('sutradhar-cli-'));
  const newDirs = afterTmpDirs.filter((n) => !beforeTmpDirs.has(n));
  for (const d of newDirs) {
    await rmWithRetry(path.join(os.tmpdir(), d));
  }
  // GAP-012: compute the real outcome instead of a hardcoded pass — actually re-list the temp
  // dir and confirm every one of THIS run's new dirs is genuinely gone (rmWithRetry is
  // best-effort and can legitimately fail on a Windows EBUSY lock).
  const stillPresent = (await fs.readdir(os.tmpdir())).filter((n) => newDirs.includes(n));
  record('cli', {
    case: 'cleanup-no-leaked-profile-dirs-left-by-us',
    expected: "this run's temp dirs removed",
    observed: { newDirs, stillPresent },
    pass: stillPresent.length === 0,
  });

  await rmWithRetry(scratchStateDir);
}

// ── SDK surface ─────────────────────────────────────────────────────────────────────────────
async function runSdkSurface() {
  const sdkPath = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js');
  const sdk = await import(pathToFileURL(sdkPath));
  const browser = await sdk.launch({ headless: true });
  const page = (await browser.pages())[0];

  const wsEndpoint = browser.getWsEndpoint();
  if (!wsEndpoint) throw new Error('SDK Browser handle has no wsEndpoint — cannot attach an independent observer.');
  const observer = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  const observerPage = (await observer.pages())[0];

  async function fxEvent(observerPageArg, id) {
    return observerPageArg.evaluate((elId) => {
      const ev = (window.__fx?.events ?? []).filter((e) => e.id === elId);
      return ev.length ? ev[ev.length - 1] : null;
    }, id);
  }

  // GAP-012: verify the observer really IS the fixture page, by URL, before trusting anything
  // it reports for (a)/(c1)/(c2) below.
  async function gotoAndGetObserverPage(hash) {
    const url = freshUrl(hash);
    await page.goto(url);
    // observerPage is a live reference (same Puppeteer Page object across navigations within
    // the same tab), but re-resolve defensively via observer.pages() in case the SDK's own
    // page ever creates a new tab/target instead of navigating the existing one.
    const pages = await observer.pages();
    const op = pages.find((p) => p.url().startsWith(FIXTURE_URL)) ?? observerPage;
    if (!op.url().startsWith(FIXTURE_URL)) {
      throw new Error(`observer page URL "${op.url()}" does not match the fixture — not observing the real tab`);
    }
    return op;
  }

  // (a) default visible on #toast — real observer/fixture-event timestamps, not just "didn't throw".
  {
    const op = await gotoAndGetObserverPage('#auto');
    const before = await isVisibleOn(op, '#toast');
    const sentAt = Date.now();
    let error;
    try {
      await page.waitForSelector('#toast', { timeout: 5000 });
    } catch (e) {
      error = e;
    }
    const recvAt = Date.now();
    const ev = await fxEvent(op, 'toast');
    const afterVisible = await isVisibleOn(op, '#toast');
    const pass =
      !error &&
      before === false &&
      !!ev &&
      sentAt <= ev.at &&
      ev.at <= recvAt + 50 &&
      afterVisible === true &&
      op.url().startsWith(FIXTURE_URL);
    record('sdk', {
      case: 'a-default-visible-toast',
      expected: 'resolves with sentAt<=toastShownAt<=recvAt, observer confirms visible',
      observed: { error: error?.message, before, ev, afterVisible, sentAt, recvAt, observerUrl: op.url() },
      pass,
    });
  }

  // (b) state:'attached' on #toast — returns BEFORE the reveal (GAP-012: was missing entirely).
  {
    const op = await gotoAndGetObserverPage('#auto');
    const recvBefore = Date.now();
    let error;
    try {
      await page.waitForSelector('#toast', { state: 'attached', timeout: 5000 });
    } catch (e) {
      error = e;
    }
    const recvAt = Date.now();
    const stillHidden = (await isVisibleOn(op, '#toast')) === false;
    const pass = !error && recvAt - recvBefore < 1000 && stillHidden;
    record('sdk', {
      case: 'b-attached-toast-returns-before-reveal',
      expected: 'resolves quickly, before the ~1.5s reveal, still display:none',
      observed: { error: error?.message, elapsed: recvAt - recvBefore, stillHidden },
      pass,
    });
  }

  // (c1) state:'hidden' on #banner — visible->hidden at ~1500ms, real timestamps.
  {
    const op = await gotoAndGetObserverPage('#auto');
    const sentAt = Date.now();
    let error;
    try {
      await page.waitForSelector('#banner', { state: 'hidden', timeout: 5000 });
    } catch (e) {
      error = e;
    }
    const recvAt = Date.now();
    const ev = await fxEvent(op, 'banner');
    const nowHidden = (await isVisibleOn(op, '#banner')) === false;
    const pass = !error && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50 && nowHidden;
    record('sdk', {
      case: 'c1-hidden-banner',
      expected: 'resolves with sentAt<=bannerHiddenAt<=recvAt, observer confirms hidden',
      observed: { error: error?.message, ev, sentAt, recvAt, nowHidden },
      pass,
    });
  }

  // (c2) state:'hidden' on #spinner via REMOVAL, not CSS hiding (GAP-012: was missing entirely).
  {
    const op = await gotoAndGetObserverPage('#auto');
    const sentAt = Date.now();
    let error;
    try {
      await page.waitForSelector('#spinner', { state: 'hidden', timeout: 5000 });
    } catch (e) {
      error = e;
    }
    const recvAt = Date.now();
    const ev = await fxEvent(op, 'spinner');
    const nowAbsent = await op.evaluate(() => document.querySelector('#spinner') === null);
    const pass = !error && !!ev && sentAt <= ev.at && ev.at <= recvAt + 50 && nowAbsent === true;
    record('sdk', {
      case: 'c2-hidden-spinner-removed',
      expected: 'resolves with sentAt<=spinnerRemovedAt<=recvAt, observer confirms querySelector===null',
      observed: { error: error?.message, ev, sentAt, recvAt, nowAbsent },
      pass,
    });
  }

  // GAP-008 live proof, SDK surface: wait_for_selector on a tab that is NOT the foreground tab.
  // Single-frame fixture: the multi-frame fixture's iframe masked the original bug.
  {
    await page.goto(freshSingleFrameUrl());
    const opPages = await observer.pages();
    const op = opPages.find((p) => p.url().startsWith(SINGLEFRAME_FIXTURE_URL)) ?? observerPage;
    const bgPage = await browser.newPage('about:blank'); // becomes Chrome's real foreground tab
    await delay(200);
    const visState = await op.evaluate(() => document.visibilityState);
    setTimeout(() => {
      op.evaluate(() => window.__fx.reveal('toast')).catch(() => {});
    }, 400);
    const sentAt = Date.now();
    let error;
    let retriesUsed;
    try {
      await page.waitForSelector('#toast', { timeout: 5000 });
    } catch (e) {
      error = e;
    }
    const recvAt = Date.now();
    const ev = await fxEvent(op, 'toast');
    const latencyAfterRevealMs = ev ? recvAt - ev.at : null;
    // GAP-035: assert the tab was actually backgrounded (visState === 'hidden'), same reasoning
    // as the MCP case above — this is the one thing the case exists to prove.
    const pass =
      !error &&
      visState === 'hidden' &&
      !!ev &&
      latencyAfterRevealMs !== null &&
      latencyAfterRevealMs >= 0 &&
      latencyAfterRevealMs < 500;
    record('sdk', {
      case: 'GAP-008-background-tab-visible-resolves-fast',
      expected: 'resolves within ~500ms of the real reveal even though the tab is backgrounded (visibilityState=hidden)',
      observed: { error: error?.message, visState, ev, latencyAfterRevealMs },
      pass,
    });
    await bgPage.close().catch(() => {});
  }

  // N1: #never times out and REJECTS with a state-naming message, and the diagnosis is
  // strengthened to assert NONE of the matches is visible (not just "some substring present").
  {
    const op = await gotoAndGetObserverPage('#auto');
    let error;
    try {
      await page.waitForSelector('#never', { timeout: 1200 });
    } catch (e) {
      error = e;
    }
    const noneVisible = await op.evaluate(() => {
      const els = Array.from(document.querySelectorAll('#never'));
      return els.every((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return ['hidden', 'collapse'].includes(s.visibility) || r.width === 0 || r.height === 0;
      });
    });
    const pass = !!error && /state=visible/.test(error.message) && noneVisible === true;
    record('sdk', { case: 'N1-never-rejects-none-visible', expected: 'rejects with state=visible message AND observer confirms none is visible', observed: { error: error?.message, noneVisible }, pass });
  }

  // N3: hidden on #stays must REJECT with state=hidden and "still visible" (GAP-012: was missing).
  {
    await gotoAndGetObserverPage('#auto');
    let error;
    try {
      await page.waitForSelector('#stays', { state: 'hidden', timeout: 1200 });
    } catch (e) {
      error = e;
    }
    const pass = !!error && /state=hidden/.test(error.message) && error.message.includes('still visible');
    record('sdk', { case: 'N3-stays-hidden-rejects', expected: 'rejects with state=hidden and "still visible"', observed: { error: error?.message }, pass });
  }

  // N8: invalid state (JS bypassing types) rejects with the Invalid-state message.
  {
    let error;
    try {
      await page.waitForSelector('#toast', { state: 'bogus', timeout: 500 });
    } catch (e) {
      error = e;
    }
    const pass = !!error && error.message.includes('Invalid wait_for_selector state');
    record('sdk', { case: 'N8-sdk-invalid-state-rejects', expected: 'rejects with Invalid wait_for_selector state', observed: { error: error?.message }, pass });
  }

  observer.disconnect();
  await browser.close();
}

async function isVisibleOn(observerPage, selector) {
  return observerPage
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return !['hidden', 'collapse'].includes(s.visibility) && r.width > 0 && r.height > 0;
    }, selector)
    .catch(() => null);
}

// ── Main ─────────────────────────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  try {
    await runMcpSurface();
  } catch (e) {
    overallOk = false;
    record('mcp', { case: 'SURFACE-CRASHED', expected: 'no crash', observed: { message: e.message, stack: e.stack }, pass: false });
  }
  try {
    await runCliSurface();
  } catch (e) {
    overallOk = false;
    record('cli', { case: 'SURFACE-CRASHED', expected: 'no crash', observed: { message: e.message, stack: e.stack }, pass: false });
  }
  try {
    await runSdkSurface();
  } catch (e) {
    overallOk = false;
    record('sdk', { case: 'SURFACE-CRASHED', expected: 'no crash', observed: { message: e.message, stack: e.stack }, pass: false });
  }

  await writeJsonl('live-mcp.jsonl', results.mcp);
  await writeJsonl('live-cli.jsonl', results.cli);
  await writeJsonl('live-sdk.jsonl', results.sdk);

  // GAP-012: final Chrome-process count across ALL surfaces, computed for real.
  // GAP-035: this previously only ever matched the CLI's own `sutradhar-cli-*` temp-profile
  // naming — an SDK-side leak (Puppeteer's own default profile dir, named
  // `puppeteer_dev_chrome_profile-*` when no explicit `userDataDir` is given, which is exactly
  // what the SDK surface in this script uses) would never show up in `chromeCheck.count` at
  // all, silently passing even with real lingering Chrome processes left behind.
  const needlePaths = [
    ...cleanupDirs,
    path.join(os.tmpdir(), 'sutradhar-cli-'),
    path.join(os.tmpdir(), 'puppeteer_dev_chrome_profile-'),
  ];
  const chromeCheck = await countLingeringChromeProcesses(needlePaths);
  if (chromeCheck.count > 0) overallOk = false;

  const summary = {
    at: new Date().toISOString(),
    overallOk,
    counts: {
      mcp: { total: results.mcp.length, passed: results.mcp.filter((r) => r.pass).length },
      cli: { total: results.cli.length, passed: results.cli.filter((r) => r.pass).length },
      sdk: { total: results.sdk.length, passed: results.sdk.filter((r) => r.pass).length },
    },
    cleanupDirsAttempted: cleanupDirs,
    lingeringChromeProcesses: chromeCheck,
  };
  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log(JSON.stringify(summary, null, 2));

  if (!overallOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
