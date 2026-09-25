// Live-verify script for FR2-10 (MCP optional sessionId) — drives the REAL BUILT worktree
// artifacts (packages/mcp-server/dist/cli.js, packages/sutradhar/dist/mcp-cli.js) over real
// stdio JSON-RPC, using an INDEPENDENT puppeteer-core observer connection (for the attach/
// disconnect cases) — never trusting a result's own claim alone. Every "the call acted on
// session X" claim is proved by writing a unique marker through the omitted-id call, then
// reading it back through an EXPLICIT-id browser.eval on every live session. See
// .ai/loop/field-report-2/evidence/FR2-10/spec.md §5.
//
// Run: node tools/scenario-suite/verify-fr2-10-optional-session.mjs
// Requires: the worktree already built (packages/mcp-server, packages/sutradhar).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const EVIDENCE_DIR = path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-10', 'audit-1', 'live-rerun');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');

const resultsMcp = [];
const resultsBundle = [];
let overallOk = true;
const cleanupDirs = [];

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── helpers copied verbatim in spirit from verify-fr2-01-wait-states.mjs (GAP-005: don't
// refactor a shared module out of two independent live-verify scripts) ─────────────────────────
function record(arr, entry) {
  arr.push(entry);
  if (!entry.pass) overallOk = false;
  const tag = entry.pass ? 'PASS' : 'FAIL';
  console.log(`[live] ${tag} ${entry.case}${entry.pass ? '' : ' — ' + JSON.stringify(entry.detail ?? entry.observed ?? {})}`);
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
function note(result) {
  return result.content?.at(-1)?.text ?? '';
}

async function initMcp(serverPath) {
  const mcp = makeMcpClient(serverPath);
  await mcp.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fr2-10-verify', version: '1.0' },
  });
  mcp.notify('notifications/initialized');
  return mcp;
}

async function markerOf(mcp, sessionId, key) {
  const r = await mcp.callTool('browser.eval', { sessionId, code: `window.${key} ?? null` });
  if (r.isError) return undefined;
  return jsonOf(r).result;
}

async function endMcp(mcp) {
  mcp.child.stdin.end();
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 3000);
    mcp.child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// ── in-script fixture server ────────────────────────────────────────────────────────────────
function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/a')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>FR2-10 A</title><button id="a">A</button>');
    } else if (req.url?.startsWith('/b')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>FR2-10 B</title><button id="b">B</button>');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function freshUrl(base, path_) {
  return `${base}${path_}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const scriptStart = Date.now();
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const fixtureServer = await startFixtureServer();
  const port = fixtureServer.address().port;
  const base = `http://127.0.0.1:${port}`;

  const chromePath = await resolveChromeExecutablePath();
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-10-observer-'));
  cleanupDirs.push(scratchProfile);
  const observerBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: scratchProfile,
    args: ['--no-sandbox', '--remote-debugging-port=0'],
  });
  const observerWsEndpoint = observerBrowser.wsEndpoint();

  const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
  const mcp = await initMcp(serverPath);

  // ── Step 0: baseline tools/list byte size (informational) ──────────────────────────────────
  const toolsListBefore = await mcp.call('tools/list', {});
  const beforeBytes = Buffer.byteLength(JSON.stringify(toolsListBefore), 'utf-8');
  await fs.writeFile(path.join(EVIDENCE_DIR, 'tools-list-after.json'), JSON.stringify(toolsListBefore, null, 2));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'step0-baseline.json'),
    JSON.stringify({ toolsListByteSize: beforeBytes, note: 'post-change build; no separate pre-change dist retained in this worktree' }, null, 2),
  );

  // ── L1: schema shape ─────────────────────────────────────────────────────────────────────────
  {
    const byName = new Map(toolsListBefore.tools.map((t) => [t.name, t]));
    const EXEMPT = new Set(['browser.launch', 'browser.attach', 'agent.runGoal']);
    let allOk = true;
    const problems = [];
    for (const t of toolsListBefore.tools) {
      const required = t.inputSchema?.required ?? [];
      if (required.includes('sessionId')) {
        allOk = false;
        problems.push(`${t.name}: sessionId still required`);
      }
      const sidProp = t.inputSchema?.properties?.sessionId;
      if (sidProp && !EXEMPT.has(t.name) && t.name !== 'browser.health' && t.name !== 'browser.shutdown_all') {
        if (sidProp.description !== 'From browser.launch/attach. Optional only when exactly one session is live.') {
          allOk = false;
          problems.push(`${t.name}: unexpected sessionId description: ${sidProp.description}`);
        }
      }
    }
    const health = byName.get('browser.health');
    const shutdownAll = byName.get('browser.shutdown_all');
    if (health?.inputSchema?.properties?.sessionId) {
      allOk = false;
      problems.push('browser.health has a sessionId property');
    }
    if (shutdownAll?.inputSchema?.properties?.sessionId) {
      allOk = false;
      problems.push('browser.shutdown_all has a sessionId property');
    }
    record(resultsMcp, {
      case: 'L1-schema',
      pass: allOk,
      detail: { problems, byteSizeAfter: beforeBytes },
    });
  }

  // ── L2: 0 sessions ────────────────────────────────────────────────────────────────────────────
  {
    const snap = await mcp.callTool('browser.snapshot', {});
    const listTabs = await mcp.callTool('browser.list_tabs', {});
    const pass =
      snap.isError === true &&
      textOf(snap).startsWith('snapshot failed: No sessionId given, and there is no live browser session') &&
      textOf(snap).includes('browser.launch') &&
      listTabs.isError === true &&
      textOf(listTabs).startsWith('list_tabs failed: No sessionId given, and there is no live browser session');
    record(resultsMcp, { case: 'L2-zero-sessions', pass, detail: { snap: textOf(snap), listTabs: textOf(listTabs) } });
  }

  // ── L3: 1 session ────────────────────────────────────────────────────────────────────────────
  let A;
  {
    const launchRes = jsonOf(await mcp.callTool('browser.launch', { headless: true, initialUrl: freshUrl(base, '/a') }));
    A = launchRes.sessionId;

    const snap = await mcp.callTool('browser.snapshot', {});
    const snapText = textOf(snap);
    const snapNote = note(snap);
    const navRes = jsonOf(await mcp.callTool('browser.navigate', { url: freshUrl(base, '/a') }));
    await mcp.callTool('browser.eval', { code: 'window.__fr210_one = 1' });
    const markerA = await markerOf(mcp, A, '__fr210_one');
    const clickRes = jsonOf(await mcp.callTool('browser.click', { target: '#a' }));
    const explicitSnap = await mcp.callTool('browser.snapshot', { sessionId: A });

    const pass =
      snap.isError !== true &&
      (snapText.includes('FR2-10 A') || snapText.includes('button "A"')) &&
      snapNote === `sessionId omitted: used "${A}", the only live browser session.` &&
      navRes.title !== undefined &&
      markerA === 1 &&
      clickRes.success === true &&
      explicitSnap.content.length === 1;
    record(resultsMcp, {
      case: 'L3-one-session',
      pass,
      detail: { A, snapNote, markerA, navRes, clickRes, explicitContentLength: explicitSnap.content.length },
    });
  }

  // ── L4: 2+ sessions ──────────────────────────────────────────────────────────────────────────
  let B;
  {
    const launchRes = jsonOf(await mcp.callTool('browser.launch', { headless: true, initialUrl: freshUrl(base, '/b') }));
    B = launchRes.sessionId;

    const evalRes = await mcp.callTool('browser.eval', { code: 'window.__fr210_many = 1' });
    const txt = textOf(evalRes);
    const markerA = await markerOf(mcp, A, '__fr210_many');
    const markerB = await markerOf(mcp, B, '__fr210_many');

    const shutdownRes = await mcp.callTool('browser.shutdown', {});
    const stillA = !(await mcp.callTool('browser.list_tabs', { sessionId: A })).isError;
    const stillB = !(await mcp.callTool('browser.list_tabs', { sessionId: B })).isError;

    const explicitBText = textOf(await mcp.callTool('browser.snapshot', { sessionId: B }));

    const pass =
      evalRes.isError === true &&
      txt.includes('2 browser sessions are live') &&
      txt.includes(`  - ${A} (`) &&
      txt.includes(`  - ${B} (`) &&
      txt.includes('/a') &&
      txt.includes('/b') &&
      txt.includes('{"sessionId": "<id>", ...}') &&
      markerA === null &&
      markerB === null &&
      shutdownRes.isError === true &&
      stillA &&
      stillB &&
      explicitBText.includes('FR2-10 B');
    record(resultsMcp, {
      case: 'L4-two-sessions',
      pass,
      detail: { A, B, evalText: txt, markerA, markerB, shutdownText: textOf(shutdownRes), stillA, stillB },
    });
  }

  // ── L5: back to 1 ────────────────────────────────────────────────────────────────────────────
  {
    await mcp.callTool('browser.shutdown', { sessionId: B });
    await mcp.callTool('browser.eval', { code: 'window.__fr210_back = 1' });
    const markerA = await markerOf(mcp, A, '__fr210_back');
    const snap = await mcp.callTool('browser.snapshot', {});
    const pass = markerA === 1 && note(snap) === `sessionId omitted: used "${A}", the only live browser session.`;
    record(resultsMcp, { case: 'L5-back-to-one', pass, detail: { markerA, noteText: note(snap) } });
  }

  // ── L6: launch/attach keep their own meaning ────────────────────────────────────────────────
  let C, D;
  {
    const launchRawRes = await mcp.callTool('browser.launch', { headless: true });
    const launchRes = jsonOf(launchRawRes);
    C = launchRes.sessionId;
    const launchHadNote = launchRawRes.content.length;

    const attachRes = jsonOf(await mcp.callTool('browser.attach', { endpoint: observerWsEndpoint }));
    D = attachRes.sessionId;

    const ambiguous = await mcp.callTool('browser.snapshot', {});
    const txt = textOf(ambiguous);

    const pass =
      C !== A &&
      D !== A &&
      D !== C &&
      launchHadNote === 1 &&
      ambiguous.isError === true &&
      txt.includes(A) &&
      txt.includes(C) &&
      txt.includes(D) &&
      new RegExp(`- ${D} \\(attached`).test(txt);
    record(resultsMcp, { case: 'L6-launch-attach-own-meaning', pass, detail: { A, C, D, txt } });

    // clean up C — leave A and D live for L7
    await mcp.callTool('browser.shutdown', { sessionId: C });
  }

  // ── L7: races ────────────────────────────────────────────────────────────────────────────────
  {
    await mcp.callTool('browser.shutdown', { sessionId: D });
    // Only A is live now.
    const raceResults = [];
    for (let i = 0; i < 5; i++) {
      const key = `__fr210_race_${i}`;
      const launchPromise = mcp.callTool('browser.launch', { headless: true, initialUrl: freshUrl(base, '/b') });
      const evalPromise = mcp.callTool('browser.eval', { code: `window.${key} = 1` });
      const [launchRes, evalRes] = await Promise.all([launchPromise, evalPromise]);
      const E = jsonOf(launchRes).sessionId;
      const markerE = await markerOf(mcp, E, key);
      let branch;
      let branchOk;
      if (evalRes.isError) {
        const txt = textOf(evalRes);
        branch = 'errored';
        const markerA = await markerOf(mcp, A, key);
        branchOk = (txt.includes('in progress') || txt.includes('browser sessions are live')) && markerA !== 1;
      } else {
        branch = 'succeeded';
        const noteText = note(evalRes);
        branchOk = noteText === `sessionId omitted: used "${A}", the only live browser session.` && (await markerOf(mcp, A, key)) === 1;
      }
      raceResults.push({ i, branch, markerE, branchOk });
      // never on E, whichever branch:
      const invariantOk = markerE === null;
      raceResults[raceResults.length - 1].invariantOk = invariantOk;
      await mcp.callTool('browser.shutdown', { sessionId: E }).catch(() => {});
    }
    const pass = raceResults.every((r) => r.invariantOk && r.branchOk);
    record(resultsMcp, { case: 'L7a-launch-race', pass, detail: raceResults });
  }
  {
    // Shutdown race: launch E, then race shutdown(E) against an omitted eval.
    const launchRes = jsonOf(await mcp.callTool('browser.launch', { headless: true, initialUrl: freshUrl(base, '/b') }));
    const E = launchRes.sessionId;
    const shutdownPromise = mcp.callTool('browser.shutdown', { sessionId: E });
    const evalPromise = mcp.callTool('browser.eval', { code: 'window.__fr210_race2 = 1' });
    const [, evalRes] = await Promise.all([shutdownPromise, evalPromise]);
    let pass;
    if (evalRes.isError) {
      const txt = textOf(evalRes);
      pass = txt.includes('in progress') || txt.includes('browser sessions are live');
    } else {
      pass = note(evalRes) === `sessionId omitted: used "${A}", the only live browser session.` && (await markerOf(mcp, A, '__fr210_race2')) === 1;
    }
    // after both settle, an omitted eval resolves to A
    const after = await mcp.callTool('browser.eval', { code: '1' });
    const afterOk = note(after) === `sessionId omitted: used "${A}", the only live browser session.`;
    record(resultsMcp, { case: 'L7b-shutdown-race', pass: pass && afterOk, detail: { evalIsError: evalRes.isError, afterOk } });
  }

  // ── L8: disconnect equals gone ───────────────────────────────────────────────────────────────
  {
    await mcp.callTool('browser.shutdown', { sessionId: A });
    // A FRESH observer browser, not the one used for D/L6/L7 — closeSession() closes the real
    // underlying browser process even for an attached session (a pre-existing gap, not FR2-10's
    // concern here; see BrowserSession.close()), so the earlier observerBrowser is already dead
    // once D was shut down in L7.
    const scratchProfile2 = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-10-observer2-'));
    cleanupDirs.push(scratchProfile2);
    const observerBrowser2 = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      userDataDir: scratchProfile2,
      args: ['--no-sandbox'],
    });
    const observerWsEndpoint2 = observerBrowser2.wsEndpoint();

    const attachRaw = await mcp.callTool('browser.attach', { endpoint: observerWsEndpoint2 });
    if (attachRaw.isError) {
      record(resultsMcp, { case: 'L8-disconnect-equals-gone', pass: false, detail: { attachError: textOf(attachRaw) } });
      throw new Error(`L8 attach failed: ${textOf(attachRaw)}`);
    }
    const attachRes = jsonOf(attachRaw);
    const F = attachRes.sessionId;
    const snap = await mcp.callTool('browser.snapshot', {});
    const resolvedToF = note(snap) === `sessionId omitted: used "${F}", the only live browser session.`;

    await observerBrowser2.close();

    const start = Date.now();
    let sawGone = false;
    let lastText = '';
    while (Date.now() - start < 5000) {
      const r = await mcp.callTool('browser.snapshot', {});
      lastText = textOf(r);
      if (r.isError && lastText.includes('no live browser session')) {
        sawGone = true;
        break;
      }
      await delay(150);
    }
    const elapsedMs = Date.now() - start;
    record(resultsMcp, { case: 'L8-disconnect-equals-gone', pass: resolvedToF && sawGone, detail: { F, resolvedToF, sawGone, elapsedMs, lastText } });
  }

  // ── L9: zero again via shutdown_all ─────────────────────────────────────────────────────────
  {
    await mcp.callTool('browser.launch', { headless: true });
    await mcp.callTool('browser.launch', { headless: true });
    const shutdownAllRes = await mcp.callTool('browser.shutdown_all', {});
    const snap = await mcp.callTool('browser.snapshot', {});
    const pass = !shutdownAllRes.isError && snap.isError === true && textOf(snap).includes('no live browser session');
    record(resultsMcp, { case: 'L9-zero-again', pass, detail: { snapText: textOf(snap) } });
  }

  await mcp.callTool('browser.shutdown_all', {}).catch(() => {});
  await endMcp(mcp);
  await writeJsonl('live-mcp.jsonl', resultsMcp);

  // ── L10: bundle (mcp-cli.js) — subset ────────────────────────────────────────────────────────
  {
    const bundlePath = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js');
    const bundleExists = await fs
      .access(bundlePath)
      .then(() => true)
      .catch(() => false);
    if (!bundleExists) {
      record(resultsBundle, { case: 'L10-bundle-skipped-missing-file', pass: false, detail: { bundlePath } });
    } else {
      const bmcp = await initMcp(bundlePath);
      const zero = await bmcp.callTool('browser.snapshot', {});
      const zeroOk = zero.isError === true && textOf(zero).includes('no live browser session');

      const launchRes = jsonOf(await bmcp.callTool('browser.launch', { headless: true, initialUrl: freshUrl(base, '/a') }));
      const bA = launchRes.sessionId;
      const snap1 = await bmcp.callTool('browser.snapshot', {});
      const oneOk = !snap1.isError && note(snap1) === `sessionId omitted: used "${bA}", the only live browser session.`;

      const launchRes2 = jsonOf(await bmcp.callTool('browser.launch', { headless: true, initialUrl: freshUrl(base, '/b') }));
      const bB = launchRes2.sessionId;
      const ambiguous = await bmcp.callTool('browser.snapshot', {});
      const ambiguousOk = ambiguous.isError === true && textOf(ambiguous).includes('browser sessions are live');

      await bmcp.callTool('browser.shutdown_all', {}).catch(() => {});
      await endMcp(bmcp);

      record(resultsBundle, { case: 'L10-bundle-zero', pass: zeroOk, detail: { text: textOf(zero) } });
      record(resultsBundle, { case: 'L10-bundle-one', pass: oneOk, detail: { noteText: note(snap1) } });
      record(resultsBundle, { case: 'L10-bundle-ambiguous', pass: ambiguousOk, detail: { text: textOf(ambiguous) } });
    }
  }
  await writeJsonl('live-bundle.jsonl', resultsBundle);

  // ── Teardown ─────────────────────────────────────────────────────────────────────────────────
  await new Promise((resolve) => fixtureServer.close(resolve));
  for (const d of cleanupDirs) await rmWithRetry(d);

  const { spawnSync } = await import('node:child_process');
  let leftoverChrome = 0;
  if (process.platform === 'win32') {
    const script =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' } | " +
      "Where-Object { $_.CommandLine -match 'fr2-10-observer' } | Measure-Object | Select-Object -ExpandProperty Count";
    const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8' });
    leftoverChrome = parseInt((r.stdout || '0').trim(), 10) || 0;
  }
  // Only dirs CREATED AFTER this script started — the OS temp dir accumulates
  // puppeteer_dev_chrome_profile-* entries from completely unrelated activity on a real dev
  // machine over days/weeks, so an unfiltered count is not a signal of THIS run's own cleanup.
  let leftoverProfiles = 0;
  const leftoverProfileNames = [];
  try {
    const tmp = os.tmpdir();
    const entries = await fs.readdir(tmp);
    const candidates = entries.filter(
      (e) => e.startsWith('puppeteer_dev_chrome_profile-') || e.startsWith('fr2-10-observer'),
    );
    for (const e of candidates) {
      try {
        const st = await fs.stat(path.join(tmp, e));
        if (st.mtimeMs >= scriptStart) leftoverProfileNames.push(e);
      } catch {
        // Removed between readdir and stat — not a leftover.
      }
    }
    leftoverProfiles = leftoverProfileNames.length;
  } catch {
    leftoverProfiles = 0;
  }

  const summary = {
    overallOk,
    mcpCases: resultsMcp.length,
    mcpPassed: resultsMcp.filter((r) => r.pass).length,
    bundleCases: resultsBundle.length,
    bundlePassed: resultsBundle.filter((r) => r.pass).length,
    leftoverChromeProcesses: leftoverChrome,
    leftoverProfileDirs: leftoverProfiles,
    leftoverProfileNames,
  };
  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2));
  console.log('SUMMARY', JSON.stringify(summary, null, 2));

  if (leftoverChrome !== 0 || leftoverProfiles !== 0) overallOk = false;
  if (!overallOk) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await fs.mkdir(EVIDENCE_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-verify-error.txt'), String(e.stack ?? e), 'utf-8').catch(() => {});
  process.exitCode = 1;
});
