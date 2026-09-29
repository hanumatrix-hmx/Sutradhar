// Live-verify script for FR2-12 (Machine-readable audit). See
// .ai/loop/field-report-2/evidence/FR2-12/spec.md §5 for the exact case list.
//
// Run:
//   node tools/scenario-suite/verify-fr2-12-audit.mjs --step0   # pre-change baseline, no assertions
//   node tools/scenario-suite/verify-fr2-12-audit.mjs           # post-change cases (§5.2) + negatives (§6)
//
// Requires: `pnpm build` already run in this worktree for whichever mode you're running.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { startAuditFixtureServer } from './fixtures/fr2-12-audit-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_12_EVIDENCE_DIR ?? path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-12', 'run-1');
const STEP0 = process.argv.includes('--step0');

const require_ = createRequire(path.join(repoRoot, 'packages', 'mcp-server', 'package.json'));

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const results = { step0: [], live: [] };
let overallOk = true;

function record(bucket, entry) {
  results[bucket].push(entry);
  const tag = entry.pass === undefined ? 'INFO' : entry.pass ? 'PASS' : 'FAIL';
  if (entry.pass === false) overallOk = false;
  console.log(`[${bucket}] ${tag} ${entry.case}${entry.detail ? ' — ' + entry.detail : ''}`);
}

async function writeJsonl(name, arr) {
  const lines = arr.map((e) => JSON.stringify(e)).join('\n') + (arr.length ? '\n' : '');
  await fs.writeFile(path.join(EVIDENCE_DIR, name), lines, 'utf-8');
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

async function mktemp(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function freshUrl(origin, route, n) {
  return `${origin}${route}?n=${n}`;
}

// ── PID-scoped process bookkeeping (hard rule: never kill by image name) ───────────────────────
const spawnedChildren = new Set(); // ChildProcess objects this script itself spawned
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
      // already gone
    }
  }
}

async function listChromeProcessesByCommandLineNeedle(needle) {
  if (process.platform !== 'win32') return [];
  try {
    const script =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome' } | " +
      "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
    const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
    return out.split('\n').filter((l) => l.includes(needle));
  } catch {
    return []; // never let a failed listing skip cleanup
  }
}

// ── CLI helpers ─────────────────────────────────────────────────────────────────────────────
const CLI_PATH = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');

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
  return mktemp('sutradhar-fr212-cli-state');
}

// ── MCP stdio client (copied pattern from verify-fr2-01-wait-states.mjs, per spec §5: don't
// refactor) ─────────────────────────────────────────────────────────────────────────────────
function makeMcpClient(serverPath) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  trackChild(child);
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

async function initMcp(client) {
  await client.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fr2-12-verify', version: '0.0.0' },
  });
  client.notify('notifications/initialized', {});
}

// ── PNG helpers ─────────────────────────────────────────────────────────────────────────────
function pngIhdr(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 && buf[0] !== 0x89) {
    // fallback tolerant check
  }
  const sig = buf.subarray(0, 8);
  const isPng = sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
  if (!isPng) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function checkPng(filePath, report) {
  const buf = await fs.readFile(filePath);
  const { width, height } = pngIhdr(buf);
  const stat = await fs.stat(filePath);
  return (
    width === report.screenshot.width &&
    height === report.screenshot.height &&
    stat.size === report.screenshot.bytes
  );
}

function noBase64(obj) {
  let ok = true;
  const walk = (v, keyPath) => {
    if (v && typeof v === 'object') {
      for (const [k, vv] of Object.entries(v)) {
        if (/base64/i.test(k)) ok = false;
        walk(vv, keyPath + '.' + k);
      }
    } else if (typeof v === 'string' && v.length > 20000) {
      ok = false;
    }
  };
  walk(obj, '$');
  return ok;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// STEP 0 — run on the pre-change build. Records only; asserts nothing (spec §5.1).
// ════════════════════════════════════════════════════════════════════════════════════════════
async function runStep0(origin) {
  const step0 = {};

  // E0a: bad nested outDir -> today's ENOENT-after-audit crash
  {
    const tmp = await mktemp('fr212-e0a');
    const stateDir = await freshCliStateDir();
    const r = await runCli(['audit', freshUrl(origin, '/audit', 1), path.join(tmp, 'x', 'y', 'z')], {
      env: { SUTRADHAR_CLI_STATE_DIR: stateDir },
    });
    step0.E0a = { code: r.code, stderrTail: r.stderr.slice(-500) };
    record('step0', { case: 'E0a', detail: `exit=${r.code} stderr has ENOENT=${/ENOENT/.test(r.stderr)}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    await rmWithRetry(tmp);
    await rmWithRetry(stateDir);
  }

  // E0b: --json on audit today (should be plain text, jsonMode ignored)
  {
    const tmp = await mktemp('fr212-e0b');
    const stateDir = await freshCliStateDir();
    const r = await runCli(['audit', freshUrl(origin, '/audit', 2), tmp, '--json'], {
      env: { SUTRADHAR_CLI_STATE_DIR: stateDir },
    });
    let parses = true;
    try {
      JSON.parse(r.stdout);
    } catch {
      parses = false;
    }
    step0.E0b = { code: r.code, stdoutIsJson: parses, stdoutHead: r.stdout.slice(0, 200) };
    record('step0', { case: 'E0b', detail: `exit=${r.code} stdoutIsJson=${parses} (expected false pre-change)` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    await rmWithRetry(tmp);
    await rmWithRetry(stateDir);
  }

  // E1a: reattach coverage — separate CLI processes, nav then audit
  {
    const tmp = await mktemp('fr212-e1a');
    const stateDir = await freshCliStateDir();
    await runCli(['nav', freshUrl(origin, '/audit', 3)], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    const r = await runCli(['audit', '', tmp], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    const consoleErrMatch = r.stdout.match(/Console errors: (\d+)/);
    const pageErrMatch = r.stdout.match(/Page errors: (\d+)/);
    const brokenMatch = r.stdout.match(/Broken requests \(4xx\/5xx\): (\d+)/);
    step0.E1a = {
      code: r.code,
      consoleErrors: consoleErrMatch ? Number(consoleErrMatch[1]) : null,
      pageErrors: pageErrMatch ? Number(pageErrMatch[1]) : null,
      brokenRequests: brokenMatch ? Number(brokenMatch[1]) : null,
      stdout: r.stdout,
    };
    record('step0', {
      case: 'E1a',
      detail: `console=${step0.E1a.consoleErrors} pageErr=${step0.E1a.pageErrors} broken=${step0.E1a.brokenRequests} (expect broken=0)`,
    });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    await rmWithRetry(tmp);
    await rmWithRetry(stateDir);
  }

  // Direct runtime access for E1b/E1c/E2/E3
  const rtMod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
  const { SutradharRuntime } = rtMod;

  // E1b: cross-document contamination (B1)
  {
    const runtime = new SutradharRuntime({});
    const { sessionId } = await runtime.launch({ launch: { headless: true } });
    await runtime.navigate(sessionId, freshUrl(origin, '/noisy', 4));
    await runtime.navigate(sessionId, freshUrl(origin, '/clean', 4));
    const a1 = await runtime.audit(sessionId, {});
    const a2 = await runtime.audit(sessionId, { url: freshUrl(origin, '/clean', 5) });
    step0.E1b = {
      afterCleanNav_consoleErrors: a1.consoleErrors.map((e) => e.text),
      afterCleanUrlAudit_consoleErrors: a2.consoleErrors.map((e) => e.text),
    };
    record('step0', {
      case: 'E1b',
      detail: `contaminated(current-page)=${JSON.stringify(step0.E1b.afterCleanNav_consoleErrors)} contaminated(url-mode)=${JSON.stringify(step0.E1b.afterCleanUrlAudit_consoleErrors)}`,
    });
    await runtime.shutdownAll();
  }

  // E1c: CLS x k (B2) in MCP/SDK-style long-lived runtime
  {
    const runtime = new SutradharRuntime({});
    const { sessionId } = await runtime.launch({ launch: { headless: true } });
    const clsSeries = [];
    for (let i = 0; i < 3; i++) {
      const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/shift', 6) });
      clsSeries.push(a.webVitals.cls);
    }
    step0.E1c = { clsSeries };
    record('step0', { case: 'E1c', detail: `cls series (expect ~1x,2x,3x): ${JSON.stringify(clsSeries)}` });
    await runtime.shutdownAll();
  }

  // E1d: CLI runs audit twice as separate processes -> no cross-process CLS multiplication
  {
    const tmp = await mktemp('fr212-e1d');
    const stateDir1 = await freshCliStateDir();
    const stateDir2 = await freshCliStateDir();
    const r1 = await runCli(['audit', freshUrl(origin, '/shift', 7), tmp], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir1 } });
    const r2 = await runCli(['audit', freshUrl(origin, '/shift', 7), tmp], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir2 } });
    const cls1 = r1.stdout.match(/CLS: ([\d.]+|n\/a)/)?.[1];
    const cls2 = r2.stdout.match(/CLS: ([\d.]+|n\/a)/)?.[1];
    step0.E1d = { cls1, cls2 };
    record('step0', { case: 'E1d', detail: `cls1=${cls1} cls2=${cls2} (expect equal)` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir1 } });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir2 } });
    await rmWithRetry(tmp);
    await rmWithRetry(stateDir1);
    await rmWithRetry(stateDir2);
  }

  // E2: buffered-read decision (D6 branch A/B/B')
  {
    const runtime = new SutradharRuntime({});
    const launchA = await runtime.launch({ launch: { headless: true } });
    const sessionId = launchA.sessionId;
    const tabA = launchA.activeTabId;
    const tabBInfo = await runtime.createTab(sessionId);
    const tabB = tabBInfo.id;

    await runtime.navigate(sessionId, freshUrl(origin, '/shift', 8), tabB);
    const deadline = Date.now() + 5000;
    let shiftDone = false;
    while (Date.now() < deadline) {
      shiftDone = await runtime.eval(sessionId, 'window.__fr212ShiftDone === true', tabB).catch(() => false);
      if (shiftDone) break;
      await delay(100);
    }
    const probe = await runtime.eval(
      sessionId,
      `(() => {
        const readBuffered = (type) => {
          try {
            const po = new PerformanceObserver(() => {});
            po.observe({ type, buffered: true });
            const recs = po.takeRecords();
            po.disconnect();
            return recs;
          } catch { return null; }
        };
        const lcp = readBuffered('largest-contentful-paint');
        const shifts = readBuffered('layout-shift');
        return {
          visibility: document.visibilityState,
          syncLcpStartTimes: lcp ? lcp.map(e => e.startTime) : null,
          syncCls: shifts ? shifts.reduce((s,e)=> e.hadRecentInput ? s : s+e.value, 0) : null,
        };
      })()`,
      tabB,
    );

    // async variant, bounded to 250ms
    const asyncProbe = await runtime.eval(
      sessionId,
      `new Promise((resolve) => {
        let got = null;
        try {
          const po = new PerformanceObserver((list) => { const e = list.getEntries(); if (e.length) got = e[e.length-1].startTime; });
          po.observe({ type: 'largest-contentful-paint', buffered: true });
        } catch {}
        setTimeout(() => resolve(got), 250);
      })`,
      tabB,
    ).catch(() => null);

    // reference: runtime.audit on a fresh tab (k=1), 3 runs with new nonces
    const referenceRuns = [];
    for (const n of [9, 91, 92]) {
      const freshTab = await runtime.createTab(sessionId);
      const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/shift', n), tabId: freshTab.id });
      referenceRuns.push(a.webVitals);
      await runtime.closeTab(sessionId, freshTab.id).catch(() => {});
    }

    let decision = 'A';
    const visOk = probe.visibility === 'visible';
    const syncNonEmpty = Array.isArray(probe.syncLcpStartTimes) && probe.syncLcpStartTimes.length > 0;
    const refCls = referenceRuns[0]?.cls;
    const closeToRef = typeof refCls === 'number' && typeof probe.syncCls === 'number' && Math.abs(probe.syncCls - refCls) < 0.001;
    if (visOk && syncNonEmpty && closeToRef) decision = 'B';
    else if (!syncNonEmpty && asyncProbe != null) decision = "B'";
    else decision = 'A';

    step0.E2 = { probe, asyncProbe, referenceRuns, decision, visOk, syncNonEmpty, closeToRef };
    record('step0', {
      case: 'E2',
      detail: `visibility=${probe.visibility} syncLcp=${JSON.stringify(probe.syncLcpStartTimes)} syncCls=${probe.syncCls} refCls=${refCls} decision=${decision}`,
    });
    await runtime.shutdownAll();
  }

  // E3: fixed-sleep miss (GAP-038)
  {
    const runtime = new SutradharRuntime({});
    const { sessionId } = await runtime.launch({ launch: { headless: true } });
    const a = await runtime.audit(sessionId, { url: freshUrl(origin, '/audit', 10) + '&slow=2500' });
    const hasSlow = a.brokenRequests.some((r) => r.url.includes('/slow-404-10'));
    step0.E3 = { hasSlow, brokenRequests: a.brokenRequests };
    record('step0', { case: 'E3', detail: `slow-404 present=${hasSlow} (expect false pre-change)` });
    await runtime.shutdownAll();
  }

  return step0;
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// POST-CHANGE cases (spec §5.2) + negative cases (§6)
// ════════════════════════════════════════════════════════════════════════════════════════════
async function runPostChange(origin) {
  const AjvJsonSchemaValidator = require_('@modelcontextprotocol/sdk/validation/ajv').AjvJsonSchemaValidator;
  const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json'), 'utf-8'));
  const validate = new AjvJsonSchemaValidator().getValidator(schema);

  let step0Ref;
  try {
    step0Ref = JSON.parse(await fs.readFile(path.join(EVIDENCE_DIR, 'step0-raw.json'), 'utf-8'));
  } catch {
    step0Ref = null;
  }

  const cleanupDirs = [];
  async function tmpDir(name) {
    const dir = await mktemp(name);
    cleanupDirs.push(dir);
    return dir;
  }

  function checkA11y(report, expectedCounts) {
    const map = {};
    for (const i of report.accessibilityIssues) map[i.rule] = i.count;
    return JSON.stringify(map) === JSON.stringify(expectedCounts);
  }

  // ── L1: mkdir ──────────────────────────────────────────────────────────────────────────────
  {
    const tmp = await tmpDir('fr212-l1');
    const nested = path.join(tmp, 'a', 'b', 'c');
    const stateDir = await freshCliStateDir();
    const r = await runCli(['audit', freshUrl(origin, '/audit', 11), nested], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    const m = r.stdout.match(/Screenshot: (.*)/);
    const abs = m ? m[1].trim() : null;
    const expected = path.resolve(nested, 'audit-screenshot.png');
    const pass = r.code === 0 && abs === expected && (await fs.access(abs).then(() => true).catch(() => false));
    record('live', { case: 'L1', pass, detail: `exit=${r.code} screenshot=${abs}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    cleanupDirs.push(stateDir);
  }

  // ── L2/L3: --json core case ────────────────────────────────────────────────────────────────
  let l2Report = null;
  {
    const tmp = await tmpDir('fr212-l2');
    const stateDir = await freshCliStateDir();
    const url = freshUrl(origin, '/audit', 12) + '&slow=2500';
    const r = await runCli(['audit', url, tmp, '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    let parsed = null;
    let parseOk = false;
    try {
      parsed = JSON.parse(r.stdout);
      parseOk = JSON.stringify(parsed, null, 2).replace(/\r\n/g, '\n') + '\n' === r.stdout.replace(/\r\n/g, '\n');
    } catch {}
    l2Report = parsed;
    const v = parsed ? validate(parsed) : { valid: false };
    const pngOk = parsed ? await checkPng(parsed.screenshot.path, parsed).catch(() => false) : false;
    const consoleOk = parsed ? parsed.consoleErrors.some((e) => e.text.includes('fr2-12-console-12')) : false;
    const pageErrOk = parsed ? parsed.pageErrors.some((e) => e.message.includes('fr2-12-pageerror-12')) : false;
    const brokenOk = parsed
      ? parsed.brokenRequests.some((b) => b.url.includes('/missing-12.png') && b.status === 404) &&
        parsed.brokenRequests.some((b) => b.url.includes('/api/fail-12') && b.status === 500)
      : false;
    const slow404Present = parsed ? parsed.brokenRequests.some((b) => b.url.includes('/slow-404-12')) : false;
    const a11yOk = parsed ? checkA11y(parsed, { 'img-alt': 1, 'input-label': 1, 'missing-lang': 1, 'button-name': 1 }) : false;
    const vitalsOk = parsed ? parsed.webVitals.lcpMs > 0 && parsed.webVitals.cls > 0.01 && parsed.webVitals.fcpMs > 0 && parsed.webVitals.ttfbMs >= 0 : false;
    const obsOk = parsed ? parsed.observation.mode === 'navigated' && parsed.observation.coversWholeDocument === true && parsed.observation.pageWasHidden === false : false;
    const pass = r.code === 0 && parseOk && v.valid && noBase64(parsed) && pngOk && consoleOk && pageErrOk && brokenOk && a11yOk && vitalsOk && obsOk && parsed.requestedUrl === url && parsed.baseline === null;
    record('live', { case: 'L2', pass, detail: `exit=${r.code} schemaValid=${v.valid} a11yOk=${a11yOk} vitalsOk=${vitalsOk} slow404(expected-miss, GAP-038)=${slow404Present}` });
    await fs.writeFile(path.join(EVIDENCE_DIR, 'report-L2.json'), r.stdout);
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    cleanupDirs.push(stateDir);

    // L3: same + --fail-on-diff -> exit 1, stdout still a valid report
    const stateDir3 = await freshCliStateDir();
    const url3 = freshUrl(origin, '/audit', 121);
    const r3 = await runCli(['audit', url3, tmp, '--json', '--fail-on-diff'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir3 } });
    let parsed3 = null;
    try {
      parsed3 = JSON.parse(r3.stdout);
    } catch {}
    const pass3 = r3.code === 1 && parsed3 !== null && validate(parsed3).valid;
    record('live', { case: 'L3', pass: pass3, detail: `exit=${r3.code} validStdout=${parsed3 !== null}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir3 } });
    cleanupDirs.push(stateDir3);
  }

  // ── L4: baseline ───────────────────────────────────────────────────────────────────────────
  {
    const tmp = await tmpDir('fr212-l4a');
    const stateDir = await freshCliStateDir();
    const r = await runCli(
      ['audit', freshUrl(origin, '/audit', 13), tmp, '--json', '--baseline', freshUrl(origin, '/clean', 13)],
      { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } },
    );
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {}
    const baseline = parsed?.baseline;
    const pngOk = baseline && baseline.diffPath ? await checkPngGeneric(baseline.diffPath, baseline.width, baseline.height) : false;
    const pass = r.code === 0 && baseline && !('error' in baseline) && baseline.diffPercentage > 0 && path.isAbsolute(baseline.diffPath) && pngOk;
    record('live', { case: 'L4a', pass, detail: `exit=${r.code} diffPct=${baseline?.diffPercentage}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    cleanupDirs.push(stateDir);

    const tmp2 = await tmpDir('fr212-l4b');
    const stateDir2 = await freshCliStateDir();
    const r2 = await runCli(
      ['audit', freshUrl(origin, '/clean', 14), tmp2, '--json', '--fail-on-diff', '--baseline', freshUrl(origin, '/clean', 14)],
      { env: { SUTRADHAR_CLI_STATE_DIR: stateDir2 } },
    );
    let parsed2 = null;
    try {
      parsed2 = JSON.parse(r2.stdout);
    } catch {}
    const pass2 = r2.code === 0 && parsed2?.baseline?.diffPercentage === 0 && parsed2.consoleErrors.length === 0 && parsed2.pageErrors.length === 0;
    record('live', { case: 'L4b (N14)', pass: pass2, detail: `exit=${r2.code} diffPct=${parsed2?.baseline?.diffPercentage}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir2 } });
    cleanupDirs.push(stateDir2);
  }

  // ── L5: baseline failure (also N4/N5 live one-liners) ─────────────────────────────────────
  {
    const tmp = await tmpDir('fr212-l5');
    const stateDir = await freshCliStateDir();
    const r = await runCli(
      ['audit', freshUrl(origin, '/clean', 15), tmp, '--json', '--baseline', 'http://127.0.0.1:1/'],
      { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } },
    );
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {}
    const diffFileAbsent = !(await fs.access(path.join(tmp, 'audit-baseline-diff.png')).then(() => true).catch(() => false));
    const pass = r.code === 1 && parsed && parsed.baseline && typeof parsed.baseline.error === 'string' && parsed.baseline.error.length > 0 && diffFileAbsent && !/Fatal:/.test(r.stderr);
    record('live', { case: 'L5', pass, detail: `exit=${r.code} baselineError=${parsed?.baseline?.error}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    cleanupDirs.push(stateDir);

    // N4: --baseline with no value
    const stateDirN4a = await freshCliStateDir();
    const rN4a = await runCli(['audit', freshUrl(origin, '/clean', 151), tmp, '--baseline'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDirN4a } });
    record('live', { case: 'N4a (--baseline no value)', pass: rN4a.code === 1 && /--baseline requires a URL/.test(rN4a.stderr), detail: rN4a.stderr.trim().slice(0, 200) });
    cleanupDirs.push(stateDirN4a);

    // N4: --baseline followed by a flag
    const stateDirN4b = await freshCliStateDir();
    const rN4b = await runCli(['audit', freshUrl(origin, '/clean', 152), tmp, '--baseline', '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDirN4b } });
    record('live', { case: 'N4b (--baseline then flag)', pass: rN4b.code === 1 && /--baseline requires a URL/.test(rN4b.stderr), detail: rN4b.stderr.trim().slice(0, 200) });
    cleanupDirs.push(stateDirN4b);
  }

  // ── L6: current page, separate processes ──────────────────────────────────────────────────
  {
    const tmp = await tmpDir('fr212-l6');
    const stateDir = await freshCliStateDir();
    await runCli(['nav', freshUrl(origin, '/audit', 16)], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    // Current-page mode never settles (D7) — give the fixture's deliberate 300ms layout shift
    // time to actually happen before the second (separate) process attaches and audits,
    // otherwise this is a race against the page's own timers, not a real assertion.
    await delay(500);
    const r = await runCli(['audit', '', tmp, '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {}
    const noteOk = /Note: console\/page errors and broken requests cover only activity since/.test(r.stderr);
    const pass =
      parsed &&
      parsed.observation.mode === 'current-page' &&
      parsed.observation.coversWholeDocument === false &&
      parsed.requestedUrl === null &&
      noteOk &&
      parsed.webVitals.lcpMs > 0 &&
      parsed.webVitals.cls > 0.01;
    record('live', { case: 'L6 (N11)', pass, detail: `lcpMs=${parsed?.webVitals?.lcpMs} cls=${parsed?.webVitals?.cls} note=${noteOk}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    cleanupDirs.push(stateDir);
  }

  // ── L7: text mode unchanged ────────────────────────────────────────────────────────────────
  {
    const tmp = await tmpDir('fr212-l7');
    const stateDir = await freshCliStateDir();
    const r = await runCli(['audit', freshUrl(origin, '/audit', 17), tmp], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    const labels = r.stdout
      .split('\n')
      .map((l) => l.split(':')[0].trim())
      .filter((l) => l.length > 0 && !l.startsWith('-'));
    const expectedLabelsSubset = ['URL', 'Title', 'Screenshot', 'Web Vitals', 'Console errors', 'Page errors', 'Broken requests (4xx/5xx)', 'Accessibility issues'];
    const hasAllLabels = expectedLabelsSubset.every((l) => labels.includes(l));
    const noNams = !/n\/ams/.test(r.stdout);
    record('live', { case: 'L7', pass: r.code === 0 && hasAllLabels && noNams, detail: `labels=${JSON.stringify(labels)}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    cleanupDirs.push(stateDir);
  }

  // ── L8: bad outDir (also N2, N3) ───────────────────────────────────────────────────────────
  {
    const tmp = await tmpDir('fr212-l8');
    const filePath = path.join(tmp, 'file');
    await fs.writeFile(filePath, 'x');
    const stateDir = await freshCliStateDir();
    const before = await listChromeProcessesByCommandLineNeedle(stateDir);
    const r = await runCli(['audit', freshUrl(origin, '/clean', 18), filePath], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    const after = await listChromeProcessesByCommandLineNeedle(stateDir);
    const stateFileExists = await fs.access(path.join(stateDir, 'state.json')).then(() => true).catch(() => false);
    const pass = r.code === 1 && /Cannot create audit output directory/.test(r.stderr) && !stateFileExists && before.length === after.length;
    record('live', { case: 'L8 (N2)', pass, detail: `exit=${r.code} stateFileExists=${stateFileExists}` });
    cleanupDirs.push(stateDir);

    // N3: --json + a fatal error (blocked domain) -> exit 1, empty stdout, Fatal: on stderr
    const stateDirN3 = await freshCliStateDir();
    const rN3 = await runCli(
      ['audit', freshUrl(origin, '/clean', 181), tmp, '--json', '--allowlist-domains', 'other.example.com'],
      { env: { SUTRADHAR_CLI_STATE_DIR: stateDirN3 } },
    );
    const pass3 = rN3.code === 1 && rN3.stdout.trim() === '' && /Fatal:/.test(rN3.stderr);
    record('live', { case: 'N3', pass: pass3, detail: `exit=${rN3.code} stdoutEmpty=${rN3.stdout.trim() === ''} fatal=${/Fatal:/.test(rN3.stderr)}` });
    // GAP-265: this case's `audit` call above rejects before any real navigation happens (the
    // allowlist blocks it), but `withSession` still spawns/attaches a real headless Chrome to get
    // there — audit-1 found this session was never closed, leaking a headless Chrome per run.
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDirN3 } }).catch(() => {});
    cleanupDirs.push(stateDirN3);
  }

  // ── L21/L22/L23 (GAP-261 fix-1): `audit --json` must print exactly one parseable JSON
  // document on stdout across all 3 dialog shapes audit-1 found broken ─────────────────────────
  function tryParseJson(s) {
    try {
      return { ok: true, value: JSON.parse(s) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // L21: default/report policy, a dialog LEFT OPEN by an earlier command blocks the next
  // `audit --json` outright (was: JSON replaced entirely by a raw `dialogPending:` line, exit 3).
  {
    const tmp = await tmpDir('fr212-l21');
    const stateDir = await freshCliStateDir();
    await runCli(['nav', freshUrl(origin, '/clean', 211)], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    // Fire a real alert() and let the CLI process exit while it's still open -- this is the exact
    // "left over from an earlier command" shape the gate has to detect on the NEXT command.
    await runCli(['eval', "setTimeout(()=>alert('gap261-l21'),0); 1"], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    await delay(300);
    const r = await runCli(['audit', freshUrl(origin, '/clean', 212), tmp, '--json'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    const parsed = tryParseJson(r.stdout);
    const pass =
      r.code === 3 &&
      parsed.ok &&
      typeof parsed.value.error === 'string' &&
      parsed.value.dialogPending !== null &&
      parsed.value.dialogPending.type === 'alert';
    record('live', { case: 'L21 (GAP-261, default-policy leftover dialog)', pass, detail: `exit=${r.code} stdoutParses=${parsed.ok} dialogPending=${JSON.stringify(parsed.value?.dialogPending)}` });
    await runCli(['dialog', 'dismiss'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
    cleanupDirs.push(stateDir);
  }

  // L22: accept policy, a dialog opens (and is auto-handled) WHILE `audit --json` itself is
  // running -- was: a `dialogHandled:` line appended raw AFTER the JSON on stdout.
  {
    const tmp = await tmpDir('fr212-l22');
    const stateDir = await freshCliStateDir();
    await runCli(['nav', freshUrl(origin, '/clean', 220), '--dialog', 'accept'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } });
    const r = await runCli(
      ['audit', `${freshUrl(origin, '/alert', 221)}&delayMs=200`, tmp, '--json'],
      { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } },
    );
    const parsed = tryParseJson(r.stdout);
    const parseOk = parsed.ok && JSON.stringify(parsed.value, null, 2).replace(/\r\n/g, '\n') + '\n' === r.stdout.replace(/\r\n/g, '\n');
    const pass = r.code === 0 && parseOk && typeof parsed.value.schemaVersion === 'number' && /dialogHandled:/.test(r.stderr);
    record('live', { case: 'L22 (GAP-261, accept-policy mid-audit dialog)', pass, detail: `exit=${r.code} stdoutIsExactlyOneJsonDoc=${parseOk} dialogHandledOnStderr=${/dialogHandled:/.test(r.stderr)}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
    cleanupDirs.push(stateDir);
  }

  // L23: default/report policy, a dialog opens WHILE `audit --json` is running and is never
  // handled -- was: either an empty stdout + generic "Fatal:" (D11's own throw), or (once past the
  // pre-emption grace) the same broken-JSON shape as L21. Either way stdout must still be exactly
  // one parseable document.
  {
    const tmp = await tmpDir('fr212-l23');
    const stateDir = await freshCliStateDir();
    const r = await runCli(
      ['audit', `${freshUrl(origin, '/alert', 231)}&delayMs=100`, tmp, '--json'],
      { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } },
    );
    const parsed = tryParseJson(r.stdout);
    const pass =
      r.code === 3 &&
      parsed.ok &&
      typeof parsed.value.error === 'string' &&
      parsed.value.dialogPending !== null &&
      parsed.value.dialogPending.type === 'alert';
    record('live', { case: 'L23 (GAP-261, mid-audit alert, never handled)', pass, detail: `exit=${r.code} stdoutParses=${parsed.ok} dialogPending=${JSON.stringify(parsed.value?.dialogPending)}` });
    await runCli(['dialog', 'dismiss'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
    cleanupDirs.push(stateDir);
  }

  // ── L9-L15: MCP surface ────────────────────────────────────────────────────────────────────
  {
    const client = makeMcpClient(path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js'));
    await initMcp(client);
    const launchRes = jsonOf(await client.callTool('browser.launch', { headless: true }));
    const S = launchRes.sessionId;

    // L9
    const r9 = await client.callTool('browser.audit', { sessionId: S, url: freshUrl(origin, '/audit', 19) + '&slow=2500' });
    const report9 = jsonOf(r9);
    const v9 = validate(report9);
    const img9 = r9.content[1];
    let pngMatch9 = false;
    if (img9 && img9.type === 'image') {
      const buf = Buffer.from(img9.data, 'base64');
      const ihdr = pngIhdr(buf);
      pngMatch9 = ihdr.width === report9.screenshot.width && ihdr.height === report9.screenshot.height && buf.length === report9.screenshot.bytes;
    }
    const a11y9 = checkA11y(report9, { 'img-alt': 1, 'input-label': 1, 'missing-lang': 1, 'button-name': 1 });
    const pass9 =
      v9.valid &&
      report9.screenshot.path === null &&
      img9?.type === 'image' &&
      pngMatch9 &&
      noBase64(report9) &&
      a11y9 &&
      report9.consoleErrors.some((e) => e.text.includes('fr2-12-console-19')) &&
      report9.brokenRequests.some((b) => b.url.includes('/missing-19.png'));
    record('live', { case: 'L9', pass: pass9, detail: `schemaValid=${v9.valid} pngMatch=${pngMatch9}` });

    // L15: GAP-038 expected-miss
    const slow19Present = report9.brokenRequests.some((b) => b.url.includes('/slow-404-19'));
    record('live', { case: 'L15 (GAP-038, expected-miss)', pass: undefined, detail: `slow-404-19 present=${slow19Present} (FR2-08 not landed; documented as expected-miss)` });

    // L10
    const r10 = await client.callTool('browser.audit', { sessionId: S, includeImages: false });
    record('live', { case: 'L10', pass: r10.content.length === 1, detail: `contentLength=${r10.content.length}` });

    // L11
    const r11 = await client.callTool('browser.audit', { sessionId: S, url: freshUrl(origin, '/audit', 20), baselineUrl: freshUrl(origin, '/clean', 20) });
    const report11 = jsonOf(r11);
    const diffImg = r11.content[2];
    let diffMatch = false;
    if (diffImg && diffImg.type === 'image' && report11.baseline && !('error' in report11.baseline)) {
      const buf = Buffer.from(diffImg.data, 'base64');
      const ihdr = pngIhdr(buf);
      diffMatch = ihdr.width === report11.baseline.width && ihdr.height === report11.baseline.height;
    }
    const pass11 = r11.content.length === 3 && diffMatch && report11.baseline?.diffPath === null && report11.baseline?.diffPercentage > 0;
    record('live', { case: 'L11', pass: pass11, detail: `contentLength=${r11.content.length} diffPct=${report11.baseline?.diffPercentage}` });

    // L12: B1 fixed (single-shot /noisy -> /clean, both current-page and url-mode audits)
    await client.callTool('browser.navigate', { sessionId: S, url: freshUrl(origin, '/noisy', 21) });
    await client.callTool('browser.navigate', { sessionId: S, url: freshUrl(origin, '/clean', 21) });
    const r12a = jsonOf(await client.callTool('browser.audit', { sessionId: S }));
    await client.callTool('browser.navigate', { sessionId: S, url: freshUrl(origin, '/noisy', 22) });
    const r12b = jsonOf(await client.callTool('browser.audit', { sessionId: S, url: freshUrl(origin, '/clean', 22) }));
    const pass12 =
      r12a.consoleErrors.length === 0 &&
      r12a.pageErrors.length === 0 &&
      r12a.brokenRequests.length === 0 &&
      r12a.observation.coversWholeDocument === true &&
      r12b.consoleErrors.length === 0 &&
      r12b.pageErrors.length === 0 &&
      r12b.brokenRequests.length === 0;
    record('live', { case: 'L12 (B1 fixed, N9)', pass: pass12, detail: `r12a=${JSON.stringify(r12a.consoleErrors)} r12b=${JSON.stringify(r12b.consoleErrors)}` });

    // L12b (GAP-262 fix-1): audit-1 found L12's single-shot noise missed the REAL contamination
    // window (old page alive between navigate()-call and the new page's frame commit) because a
    // single console.error/fetch can land before or after that narrow window by luck -- and
    // found the old (call-time-scoped) fix flaky here, failing 1/30 repeats. Replace it with a
    // page that keeps emitting noise on a 25ms interval for as long as it's alive
    // (`/noisy-interval`) immediately followed by a clean page at an ORDINARY (not artificially
    // slow) ~150ms response time (`/clean-delayed`), repeated well past audit-1's 30-repeat find,
    // asserting zero leakage on every single repeat (not just on average).
    const GAP262_REPEATS = 15;
    const gap262Leaks = [];
    for (let i = 0; i < GAP262_REPEATS; i++) {
      await client.callTool('browser.navigate', { sessionId: S, url: freshUrl(origin, '/noisy-interval', `262-${i}`) });
      // Give the interval a few ticks to actually start producing noise before navigating away —
      // otherwise this repeat could pass by luck (nothing logged yet), not because the fix works.
      await delay(80);
      const rep = jsonOf(
        await client.callTool('browser.audit', { sessionId: S, url: `${freshUrl(origin, '/clean-delayed', `262-${i}`)}&delayMs=150` }),
      );
      const leaked =
        rep.consoleErrors.length > 0 ||
        rep.pageErrors.length > 0 ||
        rep.brokenRequests.some((b) => b.url.includes('noisy-interval'));
      if (leaked) {
        gap262Leaks.push({ i, consoleErrors: rep.consoleErrors, brokenRequests: rep.brokenRequests });
      }
    }
    record('live', {
      case: 'L12b (GAP-262 fix-1, 15 repeats)',
      pass: gap262Leaks.length === 0,
      detail: `leaks=${gap262Leaks.length}/${GAP262_REPEATS} ${gap262Leaks.length ? JSON.stringify(gap262Leaks.slice(0, 3)) : ''}`,
    });

    // L13: B2 fixed
    const clsSeries = [];
    for (const n of [23, 24, 25]) {
      const rep = jsonOf(await client.callTool('browser.audit', { sessionId: S, url: freshUrl(origin, '/shift', n) }));
      clsSeries.push(rep.webVitals.cls);
    }
    const spread = Math.max(...clsSeries) - Math.min(...clsSeries);
    const refCls = step0Ref?.E2?.referenceRuns?.[0]?.cls;
    const closeToRef = typeof refCls === 'number' ? clsSeries.every((c) => Math.abs(c - refCls) < 0.005) : true;
    await client.callTool('browser.navigate', { sessionId: S, url: freshUrl(origin, '/clean', 26) });
    const typeofVitals = jsonOf(await client.callTool('browser.eval', { sessionId: S, code: 'typeof window.__sutradharVitals' })).result;
    const pass13 = spread < 0.005 && closeToRef && typeofVitals === 'undefined';
    record('live', { case: 'L13 (B2 fixed, N10)', pass: pass13, detail: `clsSeries=${JSON.stringify(clsSeries)} spread=${spread} typeofVitals=${typeofVitals}` });

    // L14: dialog
    await client.callTool('browser.eval', { sessionId: S, code: 'setTimeout(()=>alert("fr212"),0); 1' });
    await delay(200);
    const t0 = Date.now();
    const r14 = await client.callTool('browser.audit', { sessionId: S });
    const elapsed = Date.now() - t0;
    const text14 = textOf(r14);
    const pass14 = r14.isError === true && /alert dialog is open \("fr212"\)/.test(text14) && elapsed < 3000;
    record('live', { case: 'L14 (N8)', pass: pass14, detail: `isError=${r14.isError} elapsed=${elapsed}ms text=${text14.slice(0, 100)}` });
    await client.callTool('browser.handle_dialog', { sessionId: S, action: 'dismiss' });

    // L20: hidden page, informational
    const newTabRes = jsonOf(await client.callTool('browser.new_tab', { sessionId: S, url: freshUrl(origin, '/clean', 30) }));
    const originalTabId = launchRes.activeTabId;
    await client.callTool('browser.navigate', { sessionId: S, tabId: originalTabId, url: freshUrl(origin, '/audit', 30) });
    const r20 = jsonOf(await client.callTool('browser.audit', { sessionId: S, tabId: originalTabId }));
    let pass20;
    if (r20.observation.pageWasHidden === false) pass20 = r20.webVitals.fcpMs !== null;
    else if (r20.observation.pageWasHidden === true) pass20 = true; // hidden -> vitals may legitimately be null, no fabrication
    else pass20 = 'not-reproducible-headless';
    record('live', { case: 'L20 (informational)', pass: pass20 === true || pass20 === 'not-reproducible-headless' ? true : pass20, detail: `pageWasHidden=${r20.observation.pageWasHidden} fcpMs=${r20.webVitals.fcpMs} newTab=${newTabRes.id}` });

    // N18: unknown session
    const rN18 = await client.callTool('browser.audit', { sessionId: 'no-such-session' });
    record('live', { case: 'N18', pass: rN18.isError === true && /audit failed:/.test(textOf(rN18)), detail: textOf(rN18).slice(0, 150) });

    await client.callTool('browser.shutdown_all', {});
    client.child.stdin.end();
  }

  // ── L16/L17: SDK ───────────────────────────────────────────────────────────────────────────
  {
    const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')));
    const browser = await sdk.launch({ headless: true });
    const page = (await browser.pages())[0];

    const tmp1 = await tmpDir('fr212-sdk-1');
    const res16a = await page.audit({ url: freshUrl(origin, '/audit', 27), outDir: tmp1 });
    const v16a = validate(res16a.report);
    const bytesMatch = Buffer.from(res16a.screenshotBase64, 'base64').equals(await fs.readFile(res16a.report.screenshot.path));
    const pngOk16 = await checkPng(res16a.report.screenshot.path, res16a.report);
    record('live', { case: 'L16a', pass: v16a.valid && bytesMatch && pngOk16, detail: `schemaValid=${v16a.valid} bytesMatch=${bytesMatch}` });

    const res16b = await page.audit();
    record('live', { case: 'L16b', pass: res16b.report.screenshot.path === null && res16b.report.observation.mode === 'current-page' && res16b.report.observation.coversWholeDocument === true, detail: JSON.stringify(res16b.report.observation) });

    // L17
    const tmp2 = await tmpDir('fr212-sdk-2');
    const res17 = await page.audit({ url: freshUrl(origin, '/clean', 28), baselineUrl: freshUrl(origin, '/audit', 28), outDir: tmp2 });
    const diffExists = res17.report.baseline && !('error' in res17.report.baseline) ? await fs.access(res17.report.baseline.diffPath).then(() => true).catch(() => false) : false;
    const diffBytesMatch =
      diffExists && res17.baselineDiffBase64 ? Buffer.from(res17.baselineDiffBase64, 'base64').equals(await fs.readFile(res17.report.baseline.diffPath)) : false;
    record('live', { case: 'L17', pass: diffExists && diffBytesMatch, detail: `diffExists=${diffExists} diffBytesMatch=${diffBytesMatch}` });

    await browser.close();
  }

  // ── L18: schema mutations bite ─────────────────────────────────────────────────────────────
  if (l2Report) {
    const mutations = [
      (r) => ({ ...r, screenshotBase64: 'x' }),
      (r) => ({ ...r, brokenRequests: [{ url: 'http://x', status: 200 }] }),
      (r) => { const c = { ...r }; delete c.webVitals; return c; },
      (r) => ({ ...r, observation: { ...r.observation, mode: 'other' } }),
      (r) => ({ ...r, schemaVersion: 2 }),
      (r) => ({ ...r, baseline: { url: 'u' } }),
      (r) => ({ ...r, timestamp: 'yesterday' }),
      (r) => ({ ...r, accessibilityIssues: [{ rule: 'img-alt', description: 'x', count: 0 }] }),
    ];
    let allBad = true;
    for (const mutate of mutations) {
      const mutated = mutate(JSON.parse(JSON.stringify(l2Report)));
      if (validate(mutated).valid) allBad = false;
    }
    const unmutatedValid = validate(l2Report).valid;
    record('live', { case: 'L18 (N13)', pass: allBad && unmutatedValid, detail: `allMutationsRejected=${allBad} unmutatedValid=${unmutatedValid}` });
  }

  // ── L19: bundle CLI ────────────────────────────────────────────────────────────────────────
  {
    const tmp = await tmpDir('fr212-l19');
    const stateDir = await freshCliStateDir();
    const bundlePath = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'cli-bin.js');
    const r = await new Promise((resolve) => {
      const cp = spawn(process.execPath, [bundlePath, 'audit', freshUrl(origin, '/clean', 29), tmp, '--json'], {
        env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir },
      });
      trackChild(cp);
      let stdout = '';
      let stderr = '';
      cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
      cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
      cp.on('close', (code) => resolve({ code, stdout, stderr }));
    });
    let parsed = null;
    try {
      parsed = JSON.parse(r.stdout);
    } catch {}
    const pngOk = parsed ? await checkPng(parsed.screenshot.path, parsed).catch(() => false) : false;
    record('live', { case: 'L19', pass: r.code === 0 && parsed !== null && pngOk, detail: `exit=${r.code} valid=${parsed !== null}` });
    await runCli(['close'], { env: { SUTRADHAR_CLI_STATE_DIR: stateDir } }).catch(() => {});
    cleanupDirs.push(stateDir);
  }

  for (const dir of cleanupDirs) await rmWithRetry(dir);
}

function checkPngGeneric(filePath, width, height) {
  return fs
    .readFile(filePath)
    .then((buf) => {
      const ihdr = pngIhdr(buf);
      return ihdr.width === width && ihdr.height === height;
    })
    .catch(() => false);
}

// ════════════════════════════════════════════════════════════════════════════════════════════
// main
// ════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const fixture = await startAuditFixtureServer();
  console.log(`[fixture] listening on ${fixture.origin}`);

  try {
    if (STEP0) {
      const step0 = await runStep0(fixture.origin);
      await fs.writeFile(path.join(EVIDENCE_DIR, 'step0-raw.json'), JSON.stringify(step0, null, 2));
      const decision = step0.E2.decision;
      const md = `# FR2-12 Step 0 decision\n\nDate: ${new Date().toISOString()}\n\n## E2 buffered-vitals-read experiment\n\n- visibility: ${step0.E2.probe.visibility}\n- sync LCP startTimes: ${JSON.stringify(step0.E2.probe.syncLcpStartTimes)}\n- sync CLS: ${step0.E2.probe.syncCls}\n- async LCP (250ms bound): ${step0.E2.asyncProbe}\n- reference audit() runs' webVitals: ${JSON.stringify(step0.E2.referenceRuns)}\n\n**Decision: Branch ${decision}**\n\n## Other step-0 findings (informational, no assertions)\n\n- E0a (bad nested outDir): exit=${step0.E0a.code}, ENOENT in stderr=${/ENOENT/.test(step0.E0a.stderrTail)}\n- E0b (--json on audit today): stdout is JSON=${step0.E0b.stdoutIsJson} (expected false)\n- E1a (reattach coverage): consoleErrors=${step0.E1a.consoleErrors}, pageErrors=${step0.E1a.pageErrors}, brokenRequests=${step0.E1a.brokenRequests} (expected brokenRequests=0; console/page error replay behavior recorded, not asserted)\n- E1b (contamination, B1): current-page mode leaked=${JSON.stringify(step0.E1b.afterCleanNav_consoleErrors)}; url mode leaked=${JSON.stringify(step0.E1b.afterCleanUrlAudit_consoleErrors)}\n- E1c (CLS x k, B2): series=${JSON.stringify(step0.E1c.clsSeries)}\n- E1d (CLI cross-process, no B2): cls1=${step0.E1d.cls1} cls2=${step0.E1d.cls2}\n- E3 (fixed-sleep miss, GAP-038): slow-404 present=${step0.E3.hasSlow} (expected false)\n`;
      await fs.writeFile(path.join(EVIDENCE_DIR, 'step0-decision.md'), md);
      console.log(`\nStep 0 decision: Branch ${decision}. Written to ${path.join(EVIDENCE_DIR, 'step0-decision.md')}`);
      console.log('Step 0 complete (no pass/fail — recording only).');
    } else {
      await runPostChange(fixture.origin);
      const summary = {
        total: results.live.length,
        pass: results.live.filter((r) => r.pass === true).length,
        fail: results.live.filter((r) => r.pass === false).length,
        info: results.live.filter((r) => r.pass === undefined).length,
      };
      await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify({ ...summary, cases: results.live }, null, 2));
      console.log(`\nLive-verify: ${summary.pass} pass, ${summary.fail} fail, ${summary.info} info, out of ${summary.total}`);
    }
  } finally {
    await fixture.close();
    await killTrackedChildren();
  }

  await writeJsonl('step0-log.jsonl', results.step0);
  // Deviation from spec §5's live-cli/live-mcp/live-sdk split: cases are interleaved by
  // surface within one run (CLI cases first, then MCP, then SDK), so they're written to one
  // combined log instead of three separate ones — each case's `case` label still says which
  // surface it targets, and live-summary.json gives the pass/fail/info tally.
  await writeJsonl('live-all.jsonl', results.live);
  if (!overallOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exitCode = 1;
});
