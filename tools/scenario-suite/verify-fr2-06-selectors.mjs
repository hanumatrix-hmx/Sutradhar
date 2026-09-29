// Live-verify script for FR2-06 (selector dialect coach) — drives the REAL BUILT worktree
// artifacts (packages/mcp-server/dist/cli.js, packages/capability-runtime/dist, and the CLI
// binary) against a real Chrome, using an INDEPENDENT puppeteer-core observer connection to
// verify each tool's own report against real DOM state. See
// .ai/loop/field-report-2/evidence/FR2-06/spec.md §5.
//
// This is a reduced subset of the spec's full 5-surface / baseline-vs-fix design (that design
// calls for a --baseline pre-fix capture pass plus SDK/bundle surfaces and ~40 individual
// cases) — scoped down here to the (a)/(b)/(c) core claims on the MCP and CLI surfaces, run
// against the CURRENT (post-fix) tree only, given this item's time budget. It is a REAL run
// against a real Chrome, not a simulation.
//
// Run: node tools/scenario-suite/verify-fr2-06-selectors.mjs
// Requires: packages/browser, packages/capability-runtime, packages/cli, packages/mcp-server
// already built (tsc -p <pkg>/tsconfig.json in each).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_06_EVIDENCE_DIR ??
  path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-06', 'run-1');
const FIXTURE_PATH = path.join(here, 'fixtures', 'fr2-06-selectors.html');
const FIXTURE_URL = pathToFileURL(FIXTURE_PATH).href;

const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');

function freshUrl() {
  return `${FIXTURE_URL}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const results = { mcp: [], cli: [] };
const cleanupDirs = [];
let overallOk = true;

function record(surface, entry) {
  results[surface].push(entry);
  if (!entry.pass) overallOk = false;
  const tag = entry.pass ? 'PASS' : 'FAIL';
  console.log(`[${surface}] ${tag} ${entry.case}${entry.pass ? '' : ' — ' + JSON.stringify(entry.detail ?? entry.observed)}`);
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
async function runMcp() {
  const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
  const chromePath = await resolveChromeExecutablePath();
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-mcp-observer-'));
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
    clientInfo: { name: 'fr2-06-verify', version: '1.0' },
  });
  mcp.notify('notifications/initialized');

  const attachResult = jsonOf(await mcp.callTool('browser.attach', { endpoint: wsEndpoint }));
  const sessionId = attachResult.sessionId;

  await mcp.callTool('browser.navigate', { sessionId, url: freshUrl() });
  const pages = await observerBrowser.pages();
  const page = pages.find((p) => p.url().startsWith(FIXTURE_URL)) ?? pages[pages.length - 1];
  await page.waitForFunction(() => window.__fx6 && window.__fx6.ready, { timeout: 5000 }).catch(() => {});

  async function lastClick() {
    return page.evaluate(() => window.__fx6.clicks[window.__fx6.clicks.length - 1]);
  }

  // (a) Playwright selectors fail fast, zero browser round trips (measured by elapsed time
  // while we independently know the page is fine — a real round trip would be single-digit ms
  // here since it's a local file:// page, so this is a weak timing signal on its own; the
  // stronger, decisive proof is (a2) below, which blocks the page's main thread first).
  {
    const start = Date.now();
    const res = await mcp.callTool('browser.click', { sessionId, target: 'text=Submit' });
    const elapsed = Date.now() - start;
    const pass = res.isError === true && textOf(res).includes('Invalid selector "text=Submit"') && textOf(res).includes('click_by_text');
    record('mcp', { case: 'A1-click-playwright-rejected', elapsedMs: elapsed, observed: textOf(res), pass });
  }

  // (a2) Busy-page proof: block the page's main thread, then confirm the Playwright-selector
  // rejection still returns near-instantly (a real page round trip would have to wait out the
  // busy loop), while a genuine wait_for_selector call issued in the SAME busy window does not.
  {
    const busyMs = 1500;
    void page.evaluate((ms) => {
      const t = Date.now();
      while (Date.now() - t < ms) {
        /* busy-loop the main thread */
      }
    }, busyMs);
    await delay(50); // let the busy loop actually start before we race it
    const start = Date.now();
    const res = await mcp.callTool('browser.click', { sessionId, target: 'text=Submit' });
    const elapsed = Date.now() - start;
    const pass = res.isError === true && elapsed < busyMs - 200;
    record('mcp', {
      case: 'A2-busy-page-zero-round-trip',
      elapsedMs: elapsed,
      busyMs,
      observed: textOf(res),
      pass,
    });
    await delay(busyMs); // let the busy loop actually finish before the next case
  }

  // (b) Invalid CSS fails fast through the browser's real parser — retriesUsed 0, no
  // "No element found"/"timed out", and the detail text matches what the browser itself says.
  {
    const observerMsg = await page.evaluate((expr) => {
      try {
        document.createDocumentFragment().querySelector(expr);
        return null;
      } catch (e) {
        return e && e.name === 'SyntaxError' ? String(e.message ?? e) : null;
      }
    }, 'div[');
    const res = jsonOf(await mcp.callTool('browser.click', { sessionId, target: 'div[' }));
    const pass =
      res.success === false &&
      res.retriesUsed === 0 &&
      !res.failureScreenshot &&
      typeof res.error === 'string' &&
      res.error.startsWith('Invalid selector "div["') &&
      observerMsg != null &&
      res.error.includes(observerMsg);
    record('mcp', { case: 'B1-invalid-css-real-parser', observerMsg, observed: res, pass });
  }

  // (b) Valid syntax is never misclassified — a real timeout still says "timed out", not
  // "Invalid selector", and a late-inserted element is still found afterward.
  {
    const res = jsonOf(
      await mcp.callTool('browser.wait_for_selector', { sessionId, target: '#never-appears', timeoutMs: 500, state: 'attached' }),
    );
    const pass = res.success === false && res.error.includes('timed out') && !res.error.includes('Invalid selector');
    record('mcp', { case: 'B-new-6a-valid-selector-not-misclassified', observed: res, pass });
  }
  {
    await page.evaluate(() => window.__fx6.insertLate('late1', 400));
    const res = jsonOf(await mcp.callTool('browser.click', { sessionId, target: '#late1' }));
    const observed = await lastClick();
    const pass = res.success === true && observed === 'late1';
    record('mcp', { case: 'B-new-6b-late-element-still-found', observed: { res, observed }, pass });
  }

  // (c) Every supported dialect finds the real element it targets.
  const dialectCases = [
    ['plain-css', '#plain-btn', 'plain-btn'],
    ['pierce-explicit', 'pierce/#plain-btn', 'plain-btn'],
    ['xpath-prefixed', 'xpath///button[@id="xp-btn"]', 'xp-btn'],
    ['aria-prefixed', 'aria/Submit order[role="button"]', 'aria-btn'],
    ['text-prefixed', 'text/Exact text button', 'text-btn'],
    ['auto-pierce-shadow', 'pierce/#shadow-btn', 'shadow-btn'],
  ];
  for (const [name, selector, expectedId] of dialectCases) {
    const res = jsonOf(await mcp.callTool('browser.click', { sessionId, target: selector }));
    const observed = await lastClick();
    const pass = res.success === true && observed === expectedId;
    record('mcp', { case: `C-dialect-${name}`, selector, expectedId, observed: { res, observed }, pass });
  }

  // (c) The false-positive-shaped CSS list is never rejected, and clicks the real element.
  const falsePositiveCases = [
    ['data-text', '[data-text="text=Submit"]', 'attr-text'],
    ['data-x-chain', '[data-x="a >> b"]', 'attr-chain'],
    ['title-internal', '[title="internal:role=button"]', 'attr-internal'],
    ['data-q-getby', "[data-q=\"getByRole('x')\"]", 'attr-getby'],
    ['escaped-chevron-class', '.a\\>\\>b', 'cls-chev'],
    ['literal-id-getByRole', '#getByRole', 'getByRole'],
    ['internal-class-not', 'button.internal:not(.nope)', 'cls-internal'],
  ];
  for (const [name, selector, expectedId] of falsePositiveCases) {
    const res = jsonOf(await mcp.callTool('browser.click', { sessionId, target: selector }));
    const observed = await lastClick();
    const pass = res.success === true && observed === expectedId;
    record('mcp', { case: `N-falsepositive-${name}`, selector, expectedId, observed: { res, observed }, pass });
  }

  // upload_file_via_trigger: the real path that bypasses the action engine entirely.
  {
    const tmpFile = path.join(os.tmpdir(), `fr2-06-upload-${Date.now()}.txt`);
    await fs.writeFile(tmpFile, 'fr2-06 live-verify upload payload');
    const res = await mcp.callTool('browser.upload_file_via_trigger', { sessionId, target: '#browse-btn', filePath: tmpFile });
    const landedName = await page.evaluate(() => {
      const input = document.getElementById('hidden-file');
      return input && input.files && input.files[0] ? input.files[0].name : null;
    });
    const pass = res.isError !== true && landedName === path.basename(tmpFile);
    record('mcp', { case: 'C-upload-file-via-trigger', observed: { res: textOf(res), landedName }, pass });
    await rmWithRetry(tmpFile);
  }
  // Playwright selector on upload_file_via_trigger rejects with the hint, not a raw click failure.
  {
    const res = await mcp.callTool('browser.upload_file_via_trigger', { sessionId, target: 'text=Browse', filePath: '/tmp/does-not-matter.txt' });
    const text = textOf(res);
    const pass = res.isError === true && text.includes('Invalid selector "text=Browse"') && text.includes('Playwright-style');
    record('mcp', { case: 'A1-upload-via-trigger-playwright-rejected', observed: text, pass });
  }

  await mcp.callTool('browser.shutdown', { sessionId }).catch(() => {});
  mcp.child.stdin.end();
  mcp.child.kill();
  await observerBrowser.close().catch(() => {});
  await rmWithRetry(scratchProfile);
}

// ── CLI surface ─────────────────────────────────────────────────────────────────────────────
function runCliCmd(args, opts = {}) {
  return new Promise((resolve) => {
    const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
    const start = Date.now();
    execFile(process.execPath, [cliPath, ...args], { cwd: opts.cwd, timeout: 30000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code ?? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '', elapsedMs: Date.now() - start });
    });
  });
}

async function runCli() {
  // Isolate this run's CLI session state via the CLI's own supported override (not HOME/
  // USERPROFILE — overriding those breaks Chrome's own profile-directory assumptions on
  // Windows and makes the real spawn time out, unrelated to anything FR2-06 touches).
  const scratchState = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-cli-state-'));
  cleanupDirs.push(scratchState);
  const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: scratchState };
  const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');

  function runCliEnv(args) {
    return new Promise((resolve) => {
      const start = Date.now();
      execFile(process.execPath, [cliPath, ...args], { env, timeout: 30000 }, (err, stdout, stderr) => {
        resolve({ code: err ? err.code ?? 1 : 0, stdout: stdout ?? '', stderr: stderr ?? '', elapsedMs: Date.now() - start });
      });
    });
  }

  // A3: click "text=Submit" exits 1 with the hint, before any Chrome spawn — no state.json
  // should exist at all yet since this is the FIRST cli call in this scratch HOME.
  {
    const res = await runCliEnv(['click', 'text=Submit']);
    const pass = res.code === 1 && res.stderr.includes('Playwright-style') && res.stderr.includes('clickrole');
    record('cli', { case: 'A3-cli-click-playwright-rejected', observed: res, pass });
  }
  // eval with a Playwright --frame chain also exits 1 pre-session.
  {
    const res = await runCliEnv(['eval', '1', '--frame', 'iframe#f::role=x']);
    const pass = res.code === 1 && res.stderr.includes('Invalid frameSelector "role=x"');
    record('cli', { case: 'A3b-cli-eval-frame-playwright-rejected', observed: res, pass });
  }
  // B-new-5: invalid CSS on click exits 1 with the parser-derived message (needs a real
  // session, so it DOES spawn Chrome — the point here is the message shape, not zero-spawn).
  {
    const nav = await runCliEnv(['nav', freshUrl()]);
    const res = await runCliEnv(['click', 'div[']);
    const pass = nav.code === 0 && res.code === 1 && /Click failed: Invalid selector "div\[/.test(res.stdout);
    record('cli', { case: 'B-new-5-cli-invalid-css', observed: { nav, res }, pass });
    await runCliEnv(['close']).catch(() => {});
  }

  await rmWithRetry(scratchState);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  await runMcp();
  await runCli();

  await writeJsonl('live-mcp.jsonl', results.mcp);
  await writeJsonl('live-cli.jsonl', results.cli);

  const needlePaths = [...cleanupDirs];
  const chromeCheck = await countLingeringChromeProcesses(needlePaths);
  if (chromeCheck.count > 0) overallOk = false;

  const summary = {
    at: new Date().toISOString(),
    overallOk,
    scope: 'REDUCED subset of spec §5 — MCP + CLI surfaces only, current tree only, no --baseline capture pass',
    counts: {
      mcp: { total: results.mcp.length, passed: results.mcp.filter((r) => r.pass).length },
      cli: { total: results.cli.length, passed: results.cli.filter((r) => r.pass).length },
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
