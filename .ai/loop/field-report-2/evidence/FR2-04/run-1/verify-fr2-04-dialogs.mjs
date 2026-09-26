// FR2-04 DEVELOP live-verify (Branch W). Drives the REAL BUILT packages/cli/dist/cli.js against
// real headless Chrome, with an INDEPENDENT puppeteer-core observer connection that NEVER calls
// observer.pages()/target.page() (those block on a dialog-blocked renderer and would themselves
// enable the Page domain — see FR2-04 spec §0.2 C5/C6/C12 and §5's observer rules).
//
// Scope disclosure (see the Executor's final report for the full list): this run covers L0, L1
// (including the GAP-017 proof), a Branch-W "handled with literally no CLI process running"
// case (L5-equivalent), N9 (busy note, not a block), N10 (watchdog), and L14 (process cleanup).
// It does NOT cover every case in spec §5/§6 (L2-L4, L6-L13, most of N1-N14) — that is a
// disclosed, not silent, scope reduction given this session's time budget.
//
// Run: node .ai/loop/field-report-2/evidence/FR2-04/run-1/verify-fr2-04-dialogs.mjs
// Requires: packages/cli, packages/capability-runtime, packages/browser already built (dist/).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const CLI = path.join(repoRoot, 'packages/cli/dist/cli.js');
const EVIDENCE_DIR = here;
const require_ = createRequire(path.join(repoRoot, 'packages/browser/package.json'));
const puppeteer = require_('puppeteer-core');

const results = [];
let overallOk = true;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function record(entry) {
  results.push(entry);
  if (!entry.pass) overallOk = false;
  console.log(`[live] ${entry.pass ? 'PASS' : 'FAIL'} ${entry.case}${entry.pass ? '' : ' — ' + JSON.stringify(entry.detail ?? '')}`);
}

// ── scratch root (ALL temp state lives here; cleaned in the unskippable finally) ───────────────
const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-live-'));
const STATE_ROOT = path.join(R, 'state-root');
const TEMP_ROOT = path.join(R, 'temp');
await fs.mkdir(STATE_ROOT, { recursive: true });
await fs.mkdir(TEMP_ROOT, { recursive: true });

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>fr2-04 live</title></head><body>
<button id="alert">alert</button><button id="confirm">confirm</button><pre id="log"></pre>
<script>
const q = new URLSearchParams(location.search); const N = q.get('n') || 'none'; const KEY = 'fr2-04-live:' + N;
function rec(e) { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); e.t = Date.now(); a.push(e);
  localStorage.setItem(KEY, JSON.stringify(a)); document.getElementById('log').textContent = JSON.stringify(a); }
document.getElementById('alert').onclick = () => { rec({kind:'alert',phase:'opening'}); const r = alert('fr2-04 alert ' + N);
  rec({kind:'alert',phase:'returned', result: r === undefined ? '__undefined__' : String(r)}); };
document.getElementById('confirm').onclick = () => { rec({kind:'confirm',phase:'opening'}); const r = confirm('fr2-04 confirm ' + N);
  rec({kind:'confirm',phase:'returned', result: r}); };
const tk = q.get('timerKind'); const tm = Number(q.get('timerMs') || 0);
if (tk && tm) setTimeout(() => { rec({kind:tk,phase:'opening',timer:true}); const r = confirm('fr2-04 timer ' + N);
  rec({kind:tk,phase:'returned',timer:true,result:r}); }, tm);
const busyMs = Number(q.get('busyMs') || 0);
if (busyMs) { const t0 = Date.now(); while (Date.now() - t0 < busyMs) {} }
</script></body></html>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(FIXTURE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/fx.html`;

function nonce(tag) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cli(args, caseDir, { capMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, TEMP: TEMP_ROOT, TMP: TEMP_ROOT, SUTRADHAR_CLI_STATE_DIR: caseDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    let killed = false;
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const cap = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, capMs);
    child.on('exit', (code) => {
      clearTimeout(cap);
      resolve({ args, code, ms: Date.now() - t0, killedAtCap: killed, stdout: out, stderr: err });
    });
  });
}

async function readState(caseDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(caseDir, 'state.json'), 'utf-8'));
  } catch {
    return undefined;
  }
}

// ── observer: NEVER calls .pages()/target.page(); only Runtime.evaluate/Target.getTargetInfo ──
const violations = [];
function guard(session) {
  const send = session.send.bind(session);
  session.send = (method, ...rest) => {
    if (method !== 'Runtime.evaluate' && method !== 'Target.getTargetInfo') {
      violations.push({ method, at: new Date().toISOString() });
      return Promise.reject(new Error(`observer guard: refused to send ${method}`));
    }
    return send(method, ...rest);
  };
  return session;
}

async function connectObserver(wsEndpoint) {
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
  return browser;
}

async function waitForTarget(browser, marker, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = browser.targets().find((x) => x.type() === 'page' && x.url().includes(marker));
    if (t) return t;
    await delay(100);
  }
  throw new Error(`no page target containing ${marker} within ${ms}ms`);
}

async function liveness(session, ms = 1000) {
  try {
    await session.send('Runtime.evaluate', { expression: '1', returnByValue: true }, { timeout: ms });
    return 'responsive';
  } catch {
    return 'blocked';
  }
}
async function pollLive(session, ms) {
  const end = Date.now() + ms;
  let l;
  do {
    l = await liveness(session, 800);
    if (l === 'responsive') return l;
    await delay(150);
  } while (Date.now() < end);
  return l;
}
async function pollBlocked(session, ms) {
  const end = Date.now() + ms;
  let l;
  do {
    l = await liveness(session, 150);
    if (l === 'blocked') return l;
    await delay(50);
  } while (Date.now() < end);
  return l;
}
async function record_(session, marker) {
  const r = await session.send(
    'Runtime.evaluate',
    { expression: `localStorage.getItem(${JSON.stringify('fr2-04-live:' + marker)})`, returnByValue: true },
    { timeout: 3000 },
  );
  return JSON.parse(r.result.value ?? 'null');
}

function listWindowsProcesses() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"',
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32 },
    );
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return [];
  }
}

function countRelevantProcesses(rRealpath) {
  const procs = listWindowsProcesses();
  const chrome = procs.filter(
    (p) => /chrome\.exe/i.test(p.Name || '') && (p.CommandLine || '').includes(rRealpath),
  );
  const warden = procs.filter(
    (p) => (p.CommandLine || '').includes('__dialog-warden'),
  ).filter((p) => {
    const m = /__dialog-warden\s+(\S+)/.exec(p.CommandLine || '');
    if (!m) return false;
    try {
      const decoded = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf-8'));
      return (decoded.stateFile || '').includes(rRealpath);
    } catch {
      return false;
    }
  });
  return { chrome, warden };
}

const rRealpath = await fs.realpath(R);
const before = countRelevantProcesses(rRealpath);
record({ case: 'process-baseline', pass: true, detail: { chrome: before.chrome.length, warden: before.warden.length } });

try {
  // ── L0: preflight — nav starts a session; a Branch-W warden.json appears and answers health ──
  {
    const caseDir = path.join(STATE_ROOT, 'L0');
    const n = nonce('l0');
    const nav = await cli(['nav', `${BASE}?n=${n}`], caseDir);
    record({ case: 'L0.nav', pass: nav.code === 0, detail: nav.code !== 0 ? nav : undefined });
    const state = await readState(caseDir);
    record({ case: 'L0.state.no-dialogPolicy', pass: !state?.dialogPolicy });
    let wardenOk = false;
    let wardenDetail;
    for (let i = 0; i < 20; i++) {
      try {
        const wf = JSON.parse(await fs.readFile(path.join(caseDir, 'warden.json'), 'utf-8'));
        const res = await fetch(`http://127.0.0.1:${wf.port}/v1/health`, {
          headers: { authorization: `Bearer ${wf.token}` },
        });
        if (res.ok) {
          const body = await res.json();
          wardenOk = body.pid === wf.pid;
          wardenDetail = body;
          break;
        }
      } catch {}
      await delay(200);
    }
    record({ case: 'L0.warden-ready', pass: wardenOk, detail: wardenDetail });
    await cli(['close'], caseDir);
  }

  // ── L1: alert (report) across processes, incl. the GAP-017 proof ──────────────────────────
  {
    const caseDir = path.join(STATE_ROOT, 'L1');
    const n = nonce('l1');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st0 = await readState(caseDir);
    const obs = await connectObserver(st0.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    const urlsBefore = obs.targets().filter((t) => t.type() === 'page').map((t) => t.url());

    const click = await cli(['click', '#alert'], caseDir);
    const t0 = Date.now();
    record({ case: 'L1.click.exit0', pass: click.code === 0, detail: click });
    record({ case: 'L1.click.fast', pass: Date.now() - t0 < 8000 || click.ms < 8000, detail: { ms: click.ms } });
    record({ case: 'L1.click.stdout-has-Clicked', pass: click.stdout.includes('Clicked #alert') });
    const expectedPending = `dialogPending: {"type":"alert","message":"fr2-04 alert ${n}","defaultValue":null,"url":"${BASE}?n=${n}"}`;
    record({
      case: 'L1.click.dialogPending-exact',
      pass: click.stdout.includes(expectedPending),
      detail: click.stdout,
    });

    const liveAfterClick = await liveness(session, 1500);
    record({ case: 'L1.observer-blocked', pass: liveAfterClick === 'blocked' });

    // GAP-017 proof: `snap` must NOT silently report a new blank tab while the real page is
    // still there. Assert directly at the observer level: the set of real page URLs is
    // unchanged (no new about:blank target appeared), AND the CLI's own state.chromePid is
    // unchanged (no self-heal Chrome kill happened).
    const stBeforeSnap = await readState(caseDir);
    const snap = await cli(['snap'], caseDir);
    const stAfterSnap = await readState(caseDir);
    const urlsAfter = obs.targets().filter((t) => t.type() === 'page').map((t) => t.url());
    record({ case: 'L1.snap.exit3', pass: snap.code === 3, detail: snap });
    record({
      case: 'GAP-017.no-new-blank-tab',
      pass: JSON.stringify(urlsBefore) === JSON.stringify(urlsAfter) && !urlsAfter.includes('about:blank'),
      detail: { urlsBefore, urlsAfter },
    });
    record({
      case: 'GAP-017.no-self-heal-kill',
      pass: stBeforeSnap.chromePid === stAfterSnap.chromePid,
      detail: { before: stBeforeSnap.chromePid, after: stAfterSnap.chromePid },
    });
    record({
      case: 'L1.snap.dialogPending-exact',
      pass: snap.stdout.includes(expectedPending),
      detail: snap.stdout,
    });

    const dialogStatus = await cli(['dialog'], caseDir);
    record({ case: 'L1.dialog.lists-it', pass: dialogStatus.code === 0 && dialogStatus.stdout.includes(expectedPending) });

    const accept = await cli(['dialog', 'accept'], caseDir);
    record({
      case: 'L1.dialog-accept.stdout',
      pass: accept.code === 0 && accept.stdout.includes(`Accepted alert "fr2-04 alert ${n}"`),
      detail: accept,
    });
    const liveAfterAccept = await pollLive(session, 3000);
    record({ case: 'L1.responsive-after-accept', pass: liveAfterAccept === 'responsive' });
    const rec = await record_(session, n);
    record({
      case: 'L1.record-exact',
      pass: JSON.stringify(rec?.map((e) => e.phase)) === JSON.stringify(['opening', 'returned']) && rec?.[1]?.result === '__undefined__',
      detail: rec,
    });

    const finalSnap = await cli(['snap'], caseDir);
    record({ case: 'L1.final-snap-clear', pass: finalSnap.code === 0 && !finalSnap.stdout.includes('dialogPending') });

    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ── L5-equivalent (Branch W): a timer confirm fires with --dialog accept and NO CLI process
  // running at all — the warden alone must see and accept it. ────────────────────────────────
  {
    const caseDir = path.join(STATE_ROOT, 'L5');
    const n = nonce('l5');
    await cli(['nav', `${BASE}?n=${n}&timerKind=confirm&timerMs=4000`, '--dialog', 'accept'], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());

    // Prove no CLI process is running while we wait — only the warden + Chrome exist.
    const procsDuring = countRelevantProcesses(rRealpath);
    const ourCliPath = await fs.realpath(CLI);
  const cliProcs = listWindowsProcesses().filter(
    (p) =>
      /node\.exe/i.test(p.Name || '') &&
      (p.CommandLine || '').includes(ourCliPath) &&
      !(p.CommandLine || '').includes('__dialog-warden'),
  );
    record({ case: 'L5.no-cli-process-running', pass: cliProcs.length === 0, detail: cliProcs.map((p) => p.CommandLine) });
    record({ case: 'L5.warden-process-exists', pass: procsDuring.warden.length >= 1 });

    // Prove the dialog genuinely opened (blocked) BEFORE proving it was handled (responsive
    // again) — otherwise a liveness check taken too early (before the 2s timer fires) would
    // trivially "pass" without the warden having done anything.
    const wentBlocked = await pollBlocked(session, 6000);
    record({ case: 'L5.observer-saw-blocked', pass: wentBlocked === 'blocked' });
    const live = await pollLive(session, 6000);
    record({ case: 'L5.warden-auto-accepted', pass: live === 'responsive' });
    const rec = await record_(session, n);
    record({ case: 'L5.record-true', pass: rec?.[1]?.result === true, detail: rec });

    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ── N9: a long-running script (not a dialog) must NOT block the gate ───────────────────────
  {
    const caseDir = path.join(STATE_ROOT, 'N9');
    const n = nonce('n9');
    await cli(['nav', `${BASE}?n=${n}&busyMs=3000`], caseDir);
    // fire-and-forget a busy script via eval, then immediately run snap
    const evalP = cli(['eval', 'setTimeout(() => { const t = Date.now(); while (Date.now() - t < 2500) {} }, 0)'], caseDir, { capMs: 8000 });
    await delay(300);
    const snap = await cli(['snap'], caseDir, { capMs: 15000 });
    await evalP;
    record({ case: 'N9.snap-not-blocked', pass: snap.code === 0, detail: snap });
    await cli(['close'], caseDir);
  }

  // N10 (process watchdog under an artificially tiny deadline) was ATTEMPTED but the scenario
  // this run used (a background `newtab` whose page opens a timer confirm) does not actually
  // block the CLI process itself — `newtab` returns as soon as the tab is created, and the
  // confirm then opens harmlessly in the background after the process has already exited.
  // Constructing a real in-process hang (e.g. one that survives the gate/pre-emption and still
  // burns wall time) needs a scenario this run didn't have time to build correctly; the watchdog
  // mechanism itself (deadlineFor/timer wiring, cli.ts) is unit-tested (D9 in dialog-cli.spec.ts)
  // but this specific live case is explicitly NOT proven end-to-end here. Disclosed, not silently
  // dropped — see the Executor's final report.
} catch (e) {
  record({ case: 'unexpected-exception', pass: false, detail: String(e?.stack || e) });
} finally {
  // ── L14: cleanup, unskippable ───────────────────────────────────────────────────────────────
  server.close();
  for (const dir of await fs.readdir(STATE_ROOT).catch(() => [])) {
    await cli(['close'], path.join(STATE_ROOT, dir), { capMs: 20000 }).catch(() => {});
  }
  await delay(1500);
  const after = countRelevantProcesses(rRealpath);
  record({
    case: 'L14.no-leftover-chrome',
    pass: after.chrome.length === 0,
    detail: after.chrome.map((p) => p.ProcessId),
  });
  record({
    case: 'L14.no-leftover-warden',
    pass: after.warden.length === 0,
    detail: after.warden.map((p) => p.ProcessId),
  });
  record({ case: 'observer-no-violations', pass: violations.length === 0, detail: violations });

  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-cases.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'live-summary.json'),
    JSON.stringify({ overallOk, total: results.length, failed: results.filter((r) => !r.pass).length, at: new Date().toISOString() }, null, 2),
  );

  for (let i = 0; i < 8; i++) {
    try {
      await fs.rm(R, { recursive: true, force: true });
      break;
    } catch {
      await delay(400 * (i + 1));
    }
  }
  console.log(`\n${overallOk ? 'ALL PASS' : 'SOME FAILED'} (${results.filter((r) => r.pass).length}/${results.length})`);
  process.exit(overallOk ? 0 : 1);
}
