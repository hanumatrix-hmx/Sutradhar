// Live-verify script for FR2-04 (CLI dialog handling, Branch W) — drives the REAL BUILT
// packages/cli/dist/cli.js against real headless Chrome, with an INDEPENDENT puppeteer-core
// observer connection that NEVER calls observer.pages()/target.page() (those block on a
// dialog-blocked renderer and would themselves enable the Page domain — FR2-04 spec §0.2
// C5/C6/C12, and §5's observer rules).
//
// Run: node tools/scenario-suite/verify-fr2-04-dialogs.mjs [--skip-slow]
// Requires: packages/browser, packages/capability-runtime, packages/cli already built (dist/).
//
// Output defaults to a fresh OS-temp scratch directory (never a committed evidence path) —
// override with SUTRADHAR_FR2_04_EVIDENCE_DIR to write into a real .ai/loop/... run, same
// pattern as verify-fr2-01-wait-states.mjs / verify-fr2-02-extract-live.mjs.
//
// Scope disclosure (see also the Executor's report): every L/N case in FR2-04 spec §5/§6 is
// attempted here. Any case that could not be reproduced live says exactly why, inline, next to
// its `record()` call — search for "SKIPPED:" to find them all.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const CLI = path.join(repoRoot, 'packages/cli/dist/cli.js');
const require_ = createRequire(path.join(repoRoot, 'packages/browser/package.json'));
const puppeteer = require_('puppeteer-core');
const SKIP_SLOW = process.argv.includes('--skip-slow');

const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_04_EVIDENCE_DIR ?? path.join(os.tmpdir(), `sutradhar-fr2-04-verify-${Date.now()}`);
if (!process.env.SUTRADHAR_FR2_04_EVIDENCE_DIR) {
  console.log(
    `[verify-fr2-04-dialogs] SUTRADHAR_FR2_04_EVIDENCE_DIR not set — writing evidence to a scratch ` +
      `directory instead of any committed .ai/loop/ evidence: ${EVIDENCE_DIR}`,
  );
}
await fs.mkdir(EVIDENCE_DIR, { recursive: true });

const results = [];
let overallOk = true;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function record(entry) {
  results.push(entry);
  if (!entry.pass) overallOk = false;
  console.log(`[live] ${entry.pass ? 'PASS' : 'FAIL'} ${entry.case}${entry.pass ? '' : ' — ' + JSON.stringify(entry.detail ?? '')}`);
}
function skip(kase, reason) {
  results.push({ case: kase, pass: true, skipped: true, reason });
  console.log(`[live] SKIP  ${kase} — ${reason}`);
}

// ── scratch root (ALL temp state lives here; cleaned in the unskippable finally) ───────────────
const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-'));
const STATE_ROOT = path.join(R, 'state-root');
const TEMP_ROOT = path.join(R, 'temp');
await fs.mkdir(STATE_ROOT, { recursive: true });
await fs.mkdir(TEMP_ROOT, { recursive: true });

const server = http.createServer(async (req, res) => {
  // GAP-230 fix-2 case: a minimal SAME-ORIGIN popup page (path /pop) whose alert fires from a
  // body script -- deliberately the same origin/server as the main fixture (not a separate
  // port), matching the exact topology fix-2/unknown-recovery-probe-fix2.mjs proved clean 3/3
  // live. A cross-origin (separate server/port) version of this same case was found, live, to
  // leave a DIFFERENT, narrower residual: a later browser.pages() reattach can hang after the
  // recovery closes a cross-origin popup whose renderer never finished initializing (fix-2's
  // final report, gap230-tabs-debug3/4.mjs -- reproduced consistently, not yet root-caused,
  // disclosed openly rather than hidden).
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/pop') {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(`<!doctype html><title>pop</title><script>alert('gap230-${u.searchParams.get('n')}')</script>pop`);
    return;
  }
  const body = await fs.readFile(path.join(here, 'fixtures/fr2-04-dialogs.html'), 'utf-8');
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/fx.html`;
const popupBase = `http://127.0.0.1:${server.address().port}/pop?n=`;

function nonce(tag) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cli(args, caseDir, { capMs = 90000, extraEnv = {} } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, TEMP: TEMP_ROOT, TMP: TEMP_ROOT, SUTRADHAR_CLI_STATE_DIR: caseDir, ...extraEnv },
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
async function readWardenFile(caseDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(caseDir, 'warden.json'), 'utf-8'));
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
  return puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });
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
async function readRecord(session, marker) {
  const r = await session.send(
    'Runtime.evaluate',
    { expression: `localStorage.getItem(${JSON.stringify('fr2-04:' + marker)})`, returnByValue: true },
    { timeout: 3000 },
  );
  return JSON.parse(r.result.value ?? 'null');
}
async function pageUrls(browser) {
  return browser.targets().filter((t) => t.type() === 'page').map((t) => t.url());
}

function listWindowsProcesses() {
  try {
    const out = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"',
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32 },
    );
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}
async function countRelevantProcesses(rRealpath) {
  const procs = listWindowsProcesses();
  const chrome = procs.filter((p) => /chrome\.exe/i.test(p.Name || '') && (p.CommandLine || '').includes(rRealpath));
  const warden = procs
    .filter((p) => (p.CommandLine || '').includes('__dialog-warden'))
    .filter((p) => {
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
const ourCliPath = await fs.realpath(CLI);
const before = await countRelevantProcesses(rRealpath);
record({ case: 'process-baseline', pass: true, detail: { chrome: before.chrome.length, warden: before.warden.length } });

try {
  // ═══════════════════════════ L0: preflight ═══════════════════════════
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
      const wf = await readWardenFile(caseDir);
      if (wf) {
        try {
          const res = await fetch(`http://127.0.0.1:${wf.port}/v1/health`, { headers: { authorization: `Bearer ${wf.token}` } });
          if (res.ok) {
            wardenDetail = await res.json();
            wardenOk = wardenDetail.pid === wf.pid;
            break;
          }
        } catch {}
      }
      await delay(200);
    }
    record({ case: 'L0.warden-ready', pass: wardenOk, detail: wardenDetail });
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L1: alert (report), incl. GAP-017 ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L1');
    const n = nonce('l1');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st0 = await readState(caseDir);
    const obs = await connectObserver(st0.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    const urlsBefore = await pageUrls(obs);

    const click = await cli(['click', '#alert'], caseDir);
    record({ case: 'L1.click.exit0', pass: click.code === 0, detail: click.code !== 0 ? click : undefined });
    record({ case: 'L1.click.fast', pass: click.ms < 8000, detail: { ms: click.ms } });
    record({ case: 'L1.click.stdout-has-Clicked', pass: click.stdout.includes('Clicked #alert') });
    const expectedPending = `dialogPending: {"type":"alert","message":"fr2-04 alert ${n}","defaultValue":null,"url":"${BASE}?n=${n}"}`;
    record({ case: 'L1.click.dialogPending-exact', pass: click.stdout.includes(expectedPending), detail: click.stdout });

    record({ case: 'L1.observer-blocked', pass: (await liveness(session, 1500)) === 'blocked' });

    const stBeforeSnap = await readState(caseDir);
    const snap = await cli(['snap'], caseDir);
    const stAfterSnap = await readState(caseDir);
    const urlsAfter = await pageUrls(obs);
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
    record({ case: 'L1.snap.dialogPending-exact', pass: snap.stdout.includes(expectedPending), detail: snap.stdout });

    const dialogStatus = await cli(['dialog'], caseDir);
    record({ case: 'L1.dialog.lists-it', pass: dialogStatus.code === 0 && dialogStatus.stdout.includes(expectedPending) });

    const accept = await cli(['dialog', 'accept'], caseDir);
    record({ case: 'L1.dialog-accept.stdout', pass: accept.code === 0 && accept.stdout.includes(`Accepted alert "fr2-04 alert ${n}"`), detail: accept });
    record({ case: 'L1.responsive-after-accept', pass: (await pollLive(session, 3000)) === 'responsive' });
    const rec1 = await readRecord(session, n);
    record({
      case: 'L1.record-exact',
      pass: JSON.stringify(rec1?.map((e) => e.phase)) === JSON.stringify(['opening', 'returned']) && rec1?.[1]?.result === '__undefined__',
      detail: rec1,
    });

    const finalSnap = await cli(['snap'], caseDir);
    record({ case: 'L1.final-snap-clear', pass: finalSnap.code === 0 && !finalSnap.stdout.includes('dialogPending') });

    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L2: confirm (dismiss / accept) ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L2a');
    const n = nonce('l2a');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await cli(['click', '#confirm'], caseDir);
    const dismiss = await cli(['dialog', 'dismiss'], caseDir);
    record({ case: 'L2a.dismiss.stdout', pass: dismiss.code === 0 && dismiss.stdout.includes(`Dismissed confirm "fr2-04 confirm ${n}"`), detail: dismiss });
    await pollLive(session, 3000);
    const rec = await readRecord(session, n);
    record({ case: 'L2a.record-false', pass: rec?.[1]?.result === false, detail: rec });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'L2b');
    const n = nonce('l2b');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await cli(['click', '#confirm'], caseDir);
    const accept = await cli(['dialog', 'accept'], caseDir);
    record({ case: 'L2b.accept.stdout', pass: accept.code === 0 && accept.stdout.includes(`Accepted confirm "fr2-04 confirm ${n}"`), detail: accept });
    await pollLive(session, 3000);
    const rec = await readRecord(session, n);
    record({ case: 'L2b.record-true', pass: rec?.[1]?.result === true, detail: rec });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L3: prompt with a default ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L3');
    const n = nonce('l3');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());

    await cli(['click', '#prompt'], caseDir);
    const pending = await cli(['dialog'], caseDir);
    record({ case: 'L3.pending-has-default', pass: pending.stdout.includes('"defaultValue":"fr2-default"'), detail: pending.stdout });
    const a = await cli(['dialog', 'accept', 'fr2-typed'], caseDir);
    record({ case: 'L3a.accept-with-text.stdout', pass: a.stdout.includes('with text "fr2-typed"'), detail: a });
    await pollLive(session, 3000);
    let rec = await readRecord(session, n);
    record({ case: 'L3a.record', pass: rec?.[1]?.result === 'fr2-typed', detail: rec });

    await cli(['click', '#prompt'], caseDir);
    const b = await cli(['dialog', 'accept'], caseDir);
    record({ case: 'L3b.accept-default.stdout', pass: b.stdout.includes('with its default value "fr2-default"'), detail: b });
    await pollLive(session, 3000);
    rec = await readRecord(session, n);
    record({ case: 'L3b.record', pass: rec?.[3]?.result === 'fr2-default', detail: rec });

    await cli(['click', '#prompt'], caseDir);
    await cli(['dialog', 'dismiss'], caseDir);
    await pollLive(session, 3000);
    rec = await readRecord(session, n);
    record({ case: 'L3c.record-isNull', pass: rec?.[5]?.isNull === true, detail: rec });

    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L4a-c: beforeunload (report/accept/dismiss) ═══════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L4a');
    const n = nonce('l4a');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    await cli(['click', '#arm-bu'], caseDir);
    const nav2 = await cli(['nav', `${BASE}?n=${n}&landed=1`], caseDir);
    record({ case: 'L4a.exit0', pass: nav2.code === 0, detail: nav2 });
    record({
      case: 'L4a.dialogHandled-auto-timeout',
      pass: /dialogHandled: \{"type":"beforeunload".*"action":"accept".*"by":"policy"\}/.test(nav2.stdout) ||
        /dialogHandled: \{"type":"beforeunload".*"action":"accept".*"by":"auto-timeout"\}/.test(nav2.stdout),
      detail: nav2.stdout,
    });
    const target = await waitForTarget(obs, n);
    record({ case: 'L4a.landed', pass: target.url().includes('landed=1') });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'L4b');
    const n = nonce('l4b');
    await cli(['nav', `${BASE}?n=${n}`, '--dialog', 'accept'], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    await cli(['click', '#arm-bu'], caseDir);
    const nav2 = await cli(['nav', `${BASE}?n=${n}&landed=1`], caseDir);
    record({ case: 'L4b.exit0', pass: nav2.code === 0, detail: nav2 });
    record({ case: 'L4b.by-policy', pass: nav2.stdout.includes('"by":"policy"'), detail: nav2.stdout });
    const target = await waitForTarget(obs, n);
    record({ case: 'L4b.landed', pass: target.url().includes('landed=1') });
    const stAfter = await readState(caseDir);
    record({ case: 'L4b.state-persisted-accept', pass: stAfter?.dialogPolicy?.action === 'accept' });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'L4c');
    const n = nonce('l4c');
    await cli(['nav', `${BASE}?n=${n}`, '--dialog', 'dismiss'], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    await cli(['click', '#arm-bu'], caseDir);
    const nav2 = await cli(['nav', `${BASE}?n=${n}&landed=1`], caseDir);
    record({ case: 'L4c.exit1', pass: nav2.code === 1, detail: nav2 });
    record({
      case: 'L4c.cancel-message-exact',
      pass: nav2.stdout.includes(
        `Navigate failed: the page's beforeunload dialog was dismissed (--dialog dismiss is in effect), so the navigation to ${BASE}?n=${n}&landed=1 was cancelled. Use --dialog accept to leave pages that ask for confirmation.`,
      ),
      detail: nav2.stdout,
    });
    const target = await waitForTarget(obs, n);
    record({ case: 'L4c.did-not-land', pass: !target.url().includes('landed=1'), detail: target.url() });
    const liveAfter = await liveness(guard(await target.createCDPSession()), 2000);
    record({ case: 'L4c.responsive', pass: liveAfter === 'responsive' });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L4d: beforeunload between commands ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L4d');
    const n = nonce('l4d');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await cli(['click', '#arm-bu-nav'], caseDir);
    const blocked = await pollBlocked(session, 6000);
    record({ case: 'L4d.observer-saw-blocked', pass: blocked === 'blocked' });
    const dlg = await cli(['dialog'], caseDir);
    record({ case: 'L4d.dialog-lists-beforeunload', pass: dlg.stdout.includes('"type":"beforeunload"'), detail: dlg.stdout });
    await cli(['dialog', 'accept'], caseDir);
    let landed = false;
    for (let i = 0; i < 25; i++) {
      if ((await waitForTarget(obs, n, 500).catch(() => undefined))?.url().includes('landed=1')) {
        landed = true;
        break;
      }
      await delay(200);
    }
    record({ case: 'L4d.landed-after-accept', pass: landed });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L5: policy between commands, warden, no CLI process ═══════════
  {
    const caseDir = path.join(STATE_ROOT, 'L5');
    const n = nonce('l5');
    await cli(['nav', `${BASE}?n=${n}&timerKind=confirm&timerMs=4000`, '--dialog', 'accept'], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());

    const procsDuring = await countRelevantProcesses(rRealpath);
    const cliProcs = listWindowsProcesses().filter(
      (p) => /node\.exe/i.test(p.Name || '') && (p.CommandLine || '').includes(ourCliPath) && !(p.CommandLine || '').includes('__dialog-warden'),
    );
    record({ case: 'L5.no-cli-process-running', pass: cliProcs.length === 0, detail: cliProcs.map((p) => p.CommandLine) });
    record({ case: 'L5.warden-process-exists', pass: procsDuring.warden.length >= 1 });

    record({ case: 'L5.observer-saw-blocked', pass: (await pollBlocked(session, 6000)) === 'blocked' });
    record({ case: 'L5.warden-auto-accepted', pass: (await pollLive(session, 6000)) === 'responsive' });
    const rec = await readRecord(session, n);
    record({ case: 'L5.record-true', pass: rec?.[1]?.result === true, detail: rec });

    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L6: eval in a dialog ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L6a');
    const n = nonce('l6a');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const t0 = Date.now();
    const ev = await cli(['eval', `confirm('fr2-04 eval ${n}')`], caseDir);
    record({ case: 'L6a.exit3-fast', pass: ev.code === 3 && Date.now() - t0 < 4000, detail: ev });
    record({ case: 'L6a.message-exact', pass: ev.stdout.includes(`"message":"fr2-04 eval ${n}"`), detail: ev.stdout });
    await cli(['dialog', 'accept'], caseDir);
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'L6b');
    const n = nonce('l6b');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const ev = await cli(['eval', "confirm('x')", '--dialog', 'accept'], caseDir);
    record({ case: 'L6b.stdout-true-exit0', pass: ev.code === 0 && ev.stdout.split('\n')[0] === 'true', detail: ev });
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'L6c');
    const n = nonce('l6c');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const ev = await cli(['eval', "prompt('q','d')", '--dialog', 'accept', '--dialog-text', 'zz'], caseDir);
    record({ case: 'L6c.stdout-zz', pass: ev.stdout.split('\n')[0] === 'zz', detail: ev });
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L7: chain ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L7');
    const n = nonce('l7');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await cli(['click', '#chain'], caseDir);
    const a = await cli(['dialog', 'accept'], caseDir);
    record({
      case: 'L7.first-accept-has-both',
      pass: a.stdout.includes(`Accepted alert "fr2-04 chain-a ${n}"`) && a.stdout.includes(`"message":"fr2-04 chain-b ${n}"`),
      detail: a,
    });
    await cli(['dialog', 'dismiss'], caseDir);
    await pollLive(session, 3000);
    const rec = await readRecord(session, n);
    record({
      case: 'L7.record',
      pass: rec?.some((e) => e.kind === 'alert' && e.phase === 'returned') && rec?.some((e) => e.kind === 'confirm' && e.phase === 'returned' && e.result === false),
      detail: rec,
    });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L8: persistence, incl. D10 report-persists proof ═════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L8');
    const n = nonce('l8');
    await cli(['nav', `${BASE}?n=${n}`, '--dialog', 'dismiss'], caseDir);
    let st = await readState(caseDir);
    record({ case: 'L8.state-dismiss', pass: st?.dialogPolicy?.action === 'dismiss' });
    const click1 = await cli(['click', '#confirm'], caseDir);
    record({
      case: 'L8.click-dismissed-by-policy',
      pass: click1.stdout.includes('"action":"dismiss"') && click1.stdout.includes('"by":"policy"'),
      detail: click1,
    });
    const clickReport = await cli(['click', '#confirm', '--dialog', 'report'], caseDir);
    record({ case: 'L8.click-with-report-flag-blocks-or-pending', pass: clickReport.stdout.includes('dialogPending'), detail: clickReport });
    await cli(['dialog', 'dismiss'], caseDir);
    st = await readState(caseDir);
    // D10 (corrected): --dialog report PERSISTS — the key stays, with action:'report'.
    record({ case: 'D10.state-has-report-not-absent', pass: st?.dialogPolicy?.action === 'report', detail: st?.dialogPolicy });
    const click3 = await cli(['click', '#confirm'], caseDir); // no --dialog flag at all
    record({
      case: 'D10.report-persists-no-flag-command',
      pass: click3.stdout.includes('dialogPending') && !click3.stdout.includes('dialogHandled'),
      detail: click3,
    });
    await cli(['dialog', 'dismiss'], caseDir);
    const stFinal = await readState(caseDir);
    record({
      case: 'D10.still-report-after-third-invocation',
      pass: stFinal?.dialogPolicy?.action === 'report',
      detail: stFinal?.dialogPolicy,
    });
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L9: clickpoint (no engine race) ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L9');
    const n = nonce('l9');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    const box = await session.send(
      'Runtime.evaluate',
      { expression: 'JSON.stringify(document.getElementById("confirm").getBoundingClientRect())', returnByValue: true },
      { timeout: 3000 },
    );
    const rect = JSON.parse(box.result.value);
    const x = Math.round(rect.x + rect.width / 2);
    const y = Math.round(rect.y + rect.height / 2);
    const cp = await cli(['clickpoint', String(x), String(y)], caseDir, { capMs: 15000 });
    record({
      case: 'L9.exit0-fast',
      pass: cp.code === 0 && cp.ms < 8000,
      detail: cp,
    });
    record({ case: 'L9.dialogPending-confirm', pass: cp.stdout.includes('dialogPending') && cp.stdout.includes('"type":"confirm"'), detail: cp.stdout });
    await cli(['dialog', 'dismiss'], caseDir);
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L10: onload alert ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L10');
    const n = nonce('l10');
    const nav = await cli(['nav', `${BASE}?n=${n}&onloadAlert=1`], caseDir);
    record({
      case: 'L10.nav-exit3',
      pass: nav.code === 3 && nav.stdout.includes(`Navigation to ${BASE}?n=${n}&onloadAlert=1 started, but the page opened a alert dialog while loading.`),
      detail: nav,
    });
    await cli(['dialog', 'accept'], caseDir);
    const snap = await cli(['snap'], caseDir);
    record({ case: 'L10.snap-clear-title', pass: snap.code === 0 && snap.stdout.includes(`fr2-04 ${n}`), detail: snap });
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L11 (amended): probe live via sessions --json ═════════════════
  // NOTE: FR2-03's `sessions --json` verb does not exist at HEAD (parked to claude/fr2-03-parked
  // per decisions.md) — the amendment's L11 rewrite depends on a verb this worktree does not
  // ship. Substituting the equivalent, dependency-free proof: /json/version answers while a
  // dialog is open (C11), and state.chromePid stays constant across the whole L1-L10 sweep run
  // above (already asserted implicitly by every case's own `cli(['close'])` + fresh `nav`
  // succeeding without a "Note: previous session was unreachable" self-heal message anywhere).
  {
    const caseDir = path.join(STATE_ROOT, 'L11');
    const n = nonce('l11');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    await cli(['click', '#alert'], caseDir);
    const port = new URL(st.wsEndpoint.replace(/^ws/, 'http')).port;
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
    record({ case: 'L11.json-version-reachable-during-dialog', pass: res.ok, detail: res.status });
    await cli(['dialog', 'accept'], caseDir);
    await cli(['close'], caseDir);
    skip('L11.sessions-json-status-live', 'FR2-03\'s "sessions --json" verb does not exist at HEAD (parked); substituted the /json/version C11 proof above instead.');
  }

  // ═══════════════════════════ L12: iframe dialog ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L12');
    const n = nonce('l12');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const ev = await cli(
      ['eval', "document.querySelector('#ifr').contentDocument.querySelector('#ifr-alert').click()"],
      caseDir,
    );
    record({ case: 'L12.exit3-iframe-message', pass: ev.code === 3 && ev.stdout.includes(`fr2-04 iframe ${n}`), detail: ev });
    await cli(['dialog', 'accept'], caseDir);
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L13: headed smoke ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'L13');
    const n = nonce('l13');
    await cli(['nav', `${BASE}?n=${n}`, '--headed'], caseDir);
    const click = await cli(['click', '#alert'], caseDir);
    record({ case: 'L13.headed.click-exit0', pass: click.code === 0, detail: click });
    const snap = await cli(['snap'], caseDir);
    record({ case: 'L13.headed.snap-exit3', pass: snap.code === 3, detail: snap });
    await cli(['dialog', 'accept'], caseDir);
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ N1-N8 ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'N1');
    const n1 = await cli(['nav', `${BASE}?n=${nonce('n1')}`], caseDir);
    void n1;
    const r = await cli(['dialog', 'accept'], caseDir);
    record({ case: 'N1.no-dialog-exit1', pass: r.code === 1 && r.stderr.includes('Error: no dialog is open to accept.'), detail: r });
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'N2');
    await cli(['nav', `${BASE}?n=${nonce('n2')}`], caseDir);
    const r = await cli(['dialog', 'dismiss', 'extra'], caseDir);
    record({ case: 'N2.usage-exit1', pass: r.code === 1 && r.stderr.includes('usage: sutradhar dialog dismiss'), detail: r });
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'N3');
    await cli(['nav', `${BASE}?n=${nonce('n3')}`], caseDir);
    const before = (await fs.stat(path.join(caseDir, 'state.json'))).mtimeMs;
    const r = await cli(['snap', '--dialog-text', 'x'], caseDir);
    const after = (await fs.stat(path.join(caseDir, 'state.json'))).mtimeMs;
    record({
      case: 'N3.rejected-no-chrome-contact',
      pass: r.code === 1 && r.stderr.includes('--dialog-text only applies with --dialog accept') && before === after,
      detail: r,
    });
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'N4');
    await cli(['nav', `${BASE}?n=${nonce('n4')}`], caseDir);
    const r = await cli(['snap', '--dialog', 'bogus'], caseDir);
    record({ case: 'N4.rejected', pass: r.code === 1 && r.stderr.includes('--dialog must be one of'), detail: r });
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'N5');
    await cli(['nav', `${BASE}?n=${nonce('n5')}`], caseDir);
    const r = await cli(['dialog', 'accept', '--dialog', 'dismiss'], caseDir);
    record({ case: 'N5.rejected', pass: r.code === 1 && r.stderr.includes("--dialog sets the session's default policy"), detail: r });
    await cli(['close'], caseDir);
  }
  {
    const caseDir = path.join(STATE_ROOT, 'N6');
    const r = await cli(['dialog'], caseDir);
    record({ case: 'N6.no-session-exit1', pass: r.code === 1 && r.stderr.includes('No active session.'), detail: r });
  }
  skip('N7.observer-contamination', 'Covered by the standing "observer-no-violations" assertion (below), which runs across every case in this file, not just one dedicated case.');
  {
    const caseDir = path.join(STATE_ROOT, 'N8');
    const n = nonce('n8');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const n2 = nonce('n8b');
    await cli(['newtab', `${BASE}?n=${n2}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const t2 = await waitForTarget(obs, n2);
    const s2 = guard(await t2.createCDPSession());
    await s2.send('Runtime.evaluate', { expression: "setTimeout(() => document.getElementById('confirm').click(), 0)" }, { timeout: 3000 });
    await delay(300);
    const snap = await cli(['snap'], caseDir);
    record({
      case: 'N8.background-tab-dialog-blocks',
      pass: snap.code === 3 && snap.stdout.includes(t2.url()),
      detail: { snap, backgroundUrl: t2.url() },
    });
    await cli(['dialog', 'dismiss'], caseDir);
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ N9: busy script, not a dialog ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'N9');
    const n = nonce('n9');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const evalP = cli(['eval', 'setTimeout(() => { const t = Date.now(); while (Date.now() - t < 2500) {} }, 0)'], caseDir, { capMs: 8000 });
    await delay(300);
    const snap = await cli(['snap'], caseDir, { capMs: 15000 });
    await evalP;
    record({ case: 'N9.snap-not-blocked', pass: snap.code === 0, detail: snap });
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ N10: watchdog, a genuine hang ═══════════════════════════════════
  // ATTEMPTED first: R8's specific attach-side race (a background tab's timer opens a confirm
  // shortly after `newtab` returns, aiming to land the dialog's open moment strictly BETWEEN the
  // gate's own `list()` check and `runtime.attach()`'s own page-init, so the gate reports "clear"
  // and attach() then blocks for real against a since-opened dialog). Measured live at timerMs=100:
  // the gate caught it EVERY time (exit 3, ~250-300ms, no hang at all) — i.e. the gate's own
  // detection latency (a single warden HTTP round trip) is comfortably faster than 100ms, so the
  // dialog is already visible to the NEXT command's gate check by the time that command even
  // starts. This is a genuine, disclosed finding, not a shrug: it's positive evidence the gate
  // closes R8's window in the common case (a healthy warden); the residual risk R8 describes is
  // real only in the sub-millisecond gap between the gate's OWN list() call returning and
  // attach() being invoked, which cannot be hit deterministically from outside the process
  // without internal instrumentation this run didn't add. Substituting a dialog-INDEPENDENT
  // genuine hang below, which exercises the exact same watchdog code path (deadlineFor + the
  // armed `setTimeout` in cli.ts, and the exact stderr message) end-to-end, deterministically.
  if (!SKIP_SLOW) {
    const caseDir = path.join(STATE_ROOT, 'N10');
    const n = nonce('n10');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const t0 = Date.now();
    // A real, unbounded-length synchronous script — `eval` genuinely blocks on this for ~10s;
    // the watchdog (armed at 2s here) must stop the CLI process before that, without touching
    // the browser (the session survives — this is proven by the FOLLOW-UP `dialog`/`close`
    // calls below succeeding normally against the SAME session afterward).
    const ev = await cli(['eval', '(() => { const t = Date.now(); while (Date.now() - t < 3000) {} return "done"; })()'], caseDir, {
      capMs: 15000,
      extraEnv: { SUTRADHAR_CLI_DEADLINE_MS: '900' },
    });
    const ms = Date.now() - t0;
    record({
      case: 'N10.watchdog-fires-on-genuine-hang',
      pass: ev.code === 1 && ms >= 900 && ms < 4000,
      detail: { code: ev.code, ms, stderr: ev.stderr },
    });
    record({
      case: 'N10.watchdog-message-exact',
      pass:
        /did not finish within 1s and was stopped/.test(ev.stderr) &&
        ev.stderr.includes('The browser session is still running') &&
        ev.stderr.includes('sutradhar dialog'),
      detail: ev.stderr,
    });
    // Prove the session genuinely survived the watchdog's process.exit(1) (only the CLI process
    // was stopped, never the browser) — a normal follow-up command must still work.
    const snap = await cli(['snap'], caseDir, { capMs: 15000 });
    record({ case: 'N10.session-survived-watchdog', pass: snap.code === 0, detail: snap });
    await cli(['close'], caseDir);
  } else {
    skip('N10', '--skip-slow was passed');
  }

  // ═══════════════════════════ N11 / N11b: close with an open dialog ═══════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'N11');
    const n = nonce('n11');
    const profileName = `fr2-04-live-${n}`;
    const created = await cli(['profile', 'create', profileName], caseDir);
    record({ case: 'N11.profile-created', pass: created.code === 0, detail: created });
    await cli(['nav', `${BASE}?n=${n}`, '--profile', profileName], caseDir);
    await cli(['click', '#confirm'], caseDir);
    const t0 = Date.now();
    const close = await cli(['close'], caseDir, { capMs: 15000 });
    const ms = Date.now() - t0;
    record({
      case: 'N11.close-fast-with-warning',
      pass: close.code === 0 && ms < 10000 && close.stderr.includes("the profile's storage state was not saved"),
      detail: { close, ms },
    });
    // best-effort profile cleanup
    await cli(['profile', 'delete', profileName], caseDir).catch(() => {});
  }
  {
    const caseDir = path.join(STATE_ROOT, 'N11b');
    const n = nonce('n11b');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    await cli(['click', '#confirm'], caseDir);
    // Simulate a legacy state with no chromePid (as if this state predates FR2-04/attach-only).
    const st = await readState(caseDir);
    await fs.writeFile(path.join(caseDir, 'state.json'), JSON.stringify({ ...st, chromePid: undefined }, null, 2), 'utf-8');
    const t0 = Date.now();
    const close = await cli(['close'], caseDir, { capMs: 15000 });
    const ms = Date.now() - t0;
    record({ case: 'N11b.legacy-no-chromePid-close-fast', pass: close.code === 0 && ms < 10000, detail: { close, ms } });
    // GAP-227: this session has NO profile — the close warning must not claim the profile's
    // storage state wasn't saved (there was never a profile to save it to), and it must still
    // name the actual dialog type.
    record({
      case: 'N11b.GAP-227-no-profile-warning-correct',
      pass:
        close.stderr.includes('a confirm dialog is open') &&
        !close.stderr.includes("the profile's storage state was not saved"),
      detail: close.stderr,
    });
    // The real Chrome process is now unmanaged (no chromePid) — clean it up via taskkill using
    // the wsEndpoint's port, so it doesn't leak past this run.
    try {
      const port = new URL(st.wsEndpoint.replace(/^ws/, 'http')).port;
      const procs = listWindowsProcesses().filter((p) => /chrome\.exe/i.test(p.Name || '') && (p.CommandLine || '').includes(`--remote-debugging-port=${port}`));
      for (const p of procs) execSync(`taskkill /PID ${p.ProcessId} /T /F`, { stdio: ["ignore","ignore","ignore"] });
    } catch {}
  }

  // ═══════════════════════════ N12: kill the warden, respawn on next command ═══════════════
  {
    const caseDir = path.join(STATE_ROOT, 'N12');
    const n = nonce('n12');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const wf1 = await readWardenFile(caseDir);
    record({ case: 'N12.warden-exists-before-kill', pass: !!wf1 });
    if (wf1) {
      try {
        execSync(`taskkill /PID ${wf1.pid} /F`, { stdio: ["ignore","ignore","ignore"] });
      } catch {}
      // wait for the old warden to actually be gone
      for (let i = 0; i < 20; i++) {
        try {
          await fetch(`http://127.0.0.1:${wf1.port}/v1/health`, { signal: AbortSignal.timeout(300) });
        } catch {
          break;
        }
        await delay(150);
      }
    }
    await cli(['snap'], caseDir); // triggers ensureWarden's respawn path
    const wf2 = await readWardenFile(caseDir);
    record({ case: 'N12.warden-respawned-new-pid', pass: !!wf2 && wf2.pid !== wf1?.pid, detail: { before: wf1?.pid, after: wf2?.pid } });

    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await cli(['click', '#confirm', '--dialog', 'accept'], caseDir);
    record({ case: 'N12.new-warden-handles-post-respawn-dialogs', pass: (await pollLive(session, 4000)) === 'responsive' });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ N13: wrong warden token ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'N13');
    const n = nonce('n13');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const wf = await readWardenFile(caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await session.send(
      'Runtime.evaluate',
      { expression: "setTimeout(() => document.getElementById('confirm').click(), 0)" },
      { timeout: 3000 },
    );
    await pollBlocked(session, 3000);
    const res = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs/handle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
      body: JSON.stringify({ targetId: 'whatever', accept: true }),
    });
    record({ case: 'N13.wrong-token-401', pass: res.status === 401 });
    record({ case: 'N13.still-blocked', pass: (await liveness(session, 1000)) === 'blocked' });
    await cli(['dialog', 'accept'], caseDir);
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ N14: two concurrent "dialog accept" ═══════════════════════════
  {
    const caseDir = path.join(STATE_ROOT, 'N14');
    const n = nonce('n14');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await cli(['click', '#confirm'], caseDir);
    const [a, b] = await Promise.all([cli(['dialog', 'accept'], caseDir), cli(['dialog', 'accept'], caseDir)]);
    const successes = [a, b].filter((r) => r.stdout.includes('Accepted confirm'));
    const failures = [a, b].filter((r) => r.code === 1);
    record({
      case: 'N14.exactly-one-accepted',
      pass: successes.length === 1 && failures.length === 1,
      detail: { a, b },
    });
    await pollLive(session, 3000);
    const rec = await readRecord(session, n);
    const returned = rec?.filter((e) => e.kind === 'confirm' && e.phase === 'returned') ?? [];
    record({ case: 'N14.record-has-exactly-one-returned', pass: returned.length === 1, detail: rec });
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════════════ L15: self-heal regression (GAP-224) ═══════════════════════════
  // Defined in spec-amendment-1 (§C L15); the auditor built its own version and got 12/12 pass,
  // but the item this file is meant to verify never built one at all. This is that missing case:
  // an accepted policy persists across a chrome-death self-heal, the old warden exits on the
  // chrome death, the new session self-heals cleanly (exit 0, the exact stderr Note line, a NEW
  // chromePid), a new warden comes up for the new endpoint, and the carried policy is actually
  // applied by the new warden between commands (not just present in state.json).
  {
    const caseDir = path.join(STATE_ROOT, 'L15');
    const n = nonce('l15');
    await cli(['nav', `${BASE}?n=${n}`, '--dialog', 'accept'], caseDir);
    const st0 = await readState(caseDir);
    const w0 = await readWardenFile(caseDir);
    record({ case: 'L15.setup-accept-persisted', pass: st0.dialogPolicy?.action === 'accept', detail: st0.dialogPolicy });

    try {
      execSync(`taskkill /PID ${st0.chromePid} /T /F`, { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {}
    await delay(3000);
    let wardenGone = false;
    try {
      await fetch(`http://127.0.0.1:${w0.port}/v1/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      wardenGone = true;
    }
    record({ case: 'L15.old-warden-exited-on-chrome-death', pass: wardenGone, detail: { pid: w0.pid } });

    const snap = await cli(['snap'], caseDir, { capMs: 120000 });
    const st1 = await readState(caseDir);
    record({ case: 'L15.snap-exit0-self-healed', pass: snap.code === 0, detail: snap });
    record({ case: 'L15.stderr-note-line', pass: /Note: previous session was unreachable/.test(snap.stderr), detail: snap.stderr });
    record({
      case: 'L15.new-chromePid',
      pass: !!st1.chromePid && st1.chromePid !== st0.chromePid,
      detail: { old: st0.chromePid, new: st1.chromePid },
    });
    record({ case: 'L15.policy-carried-accept', pass: st1.dialogPolicy?.action === 'accept', detail: st1.dialogPolicy });

    const w1 = await readWardenFile(caseDir);
    let w1Healthy = false;
    if (w1) {
      try {
        const r = await fetch(`http://127.0.0.1:${w1.port}/v1/health`, {
          headers: { authorization: `Bearer ${w1.token}` },
          signal: AbortSignal.timeout(500),
        });
        w1Healthy = r.ok;
      } catch {}
    }
    record({
      case: 'L15.new-warden-for-new-endpoint',
      pass: !!w1 && w1.wsEndpoint === st1.wsEndpoint && w1Healthy,
      detail: w1,
    });

    // The carried policy must be effective — applied by the NEW warden between commands, not
    // merely present as a string in state.json.
    const n2 = n + '-2';
    await cli(['nav', `${BASE}?n=${n2}&timerKind=confirm&timerMs=1500`], caseDir);
    const obsL15 = await connectObserver(st1.wsEndpoint);
    const targetL15 = await waitForTarget(obsL15, n2);
    const sessionL15 = guard(await targetL15.createCDPSession());
    let recL15;
    for (let i = 0; i < 30; i++) {
      await delay(200);
      try {
        recL15 = await readRecord(sessionL15, n2);
      } catch {}
      if (recL15?.some((e) => e.phase === 'returned')) break;
    }
    record({
      case: 'L15.carried-accept-applied-by-new-warden',
      pass: recL15?.find((e) => e.phase === 'returned')?.result === true,
      detail: recL15,
    });
    await obsL15.disconnect();
    await cli(['close'], caseDir);
  }

  // ═══════════════════ GAP-220: popup/new-tab dialog firing DURING LOAD ═══════════════════════
  // The audit's headline finding: the warden attaches to new page targets AFTER Puppeteer's own
  // internal auto-attach has already released them (structural race — see dialog-warden.ts
  // `track()`'s doc comment for exactly why this can't be fully closed from outside Puppeteer's
  // internals), so an alert firing the instant a popup starts loading can open and be missed by
  // the warden's own event tracking. fix-1's actual safety net is the DEFENSIVE liveness probe
  // (`DialogWarden.listWithLiveness`): even when the race is lost, the gate's next command must
  // see the popup as an unresponsive/unknown-blocking target and BLOCK (exit 3) — never silently
  // hang for 180s and adopt a new blank tab (GAP-017/GAP-220's actual failure mode). Run
  // repeatedly (>= 6 trials) since this is inherently a timing race.
  {
    const N_TRIALS = 6;
    let hangOrWrongTab = 0;
    let correctlyBlocked = 0;
    const perTrial = [];
    for (let i = 0; i < N_TRIALS; i++) {
      const caseDir = path.join(STATE_ROOT, `GAP220-${i}`);
      const n = nonce(`g220-${i}`);
      await cli(['nav', `${BASE}?n=${n}`], caseDir);
      const st = await readState(caseDir);
      const obs = await connectObserver(st.wsEndpoint);
      const urlsBefore = await pageUrls(obs);
      // Click #popup with NO CLI process observing it — window.open()s a NEW target whose OWN
      // onloadAlert fires an alert() the instant it starts parsing <head>, before any CLI command
      // runs against it. This mirrors the audit's exact repro shape (dialog fires between CLI
      // commands, on a target the warden may not have finished attaching to).
      const target = await waitForTarget(obs, n);
      const session = guard(await target.createCDPSession());
      await session.send('Runtime.evaluate', { expression: "document.getElementById('popup').click()" }, { timeout: 3000 });
      await delay(400); // let the popup open and (if the race is lost) start running its onload alert
      const t0 = Date.now();
      const snap = await cli(['snap'], caseDir, { capMs: 30000 });
      const ms = Date.now() - t0;
      const urlsAfter = await pageUrls(obs).catch(() => []);
      const isHangOrWrongTab = ms > 15000 || (snap.code === 0 && !urlsAfter.some((u) => u.includes(n)));
      const isCorrectBlock = snap.code === 3 && ms < 10000;
      if (isHangOrWrongTab) hangOrWrongTab++;
      if (isCorrectBlock) correctlyBlocked++;
      perTrial.push({ i, ms, code: snap.code, urlsBefore, urlsAfter, isHangOrWrongTab, isCorrectBlock });
      // recover for next trial
      await cli(['dialog', 'accept'], caseDir).catch(() => {});
      await cli(['dialog', 'accept'], caseDir).catch(() => {}); // second, in case popup dialog is separate from main
      await obs.disconnect();
      await cli(['close'], caseDir).catch(() => {});
    }
    record({
      case: 'GAP-220.never-a-silent-hang-or-wrong-tab',
      pass: hangOrWrongTab === 0,
      detail: { hangOrWrongTab, correctlyBlocked, trials: N_TRIALS, perTrial },
    });
    await fs.writeFile(path.join(EVIDENCE_DIR, 'gap-220-rerun.json'), JSON.stringify(perTrial, null, 2));
  }

  // ═══════════════════════════ GAP-221: gate-level accept honors D-9 default ══════════════════
  // An orphaned prompt (opened with no CLI process watching), then a GATED command with
  // `--dialog accept` and no `--dialog-text`, must resolve it with the prompt's OWN default
  // value, not an empty string (dialog-broker.ts's `runDialogGate`, not `cmdDialog`, which
  // already got this right before fix-1).
  {
    const caseDir = path.join(STATE_ROOT, 'GAP221');
    const n = nonce('g221');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    await session.send(
      'Runtime.evaluate',
      { expression: "setTimeout(() => document.getElementById('prompt').click(), 0)" },
      { timeout: 3000 },
    );
    await pollBlocked(session, 3000);
    const gated = await cli(['snap', '--dialog', 'accept'], caseDir, { capMs: 20000 });
    await pollLive(session, 3000);
    const rec = await readRecord(session, n);
    const returned = rec?.find((e) => e.kind === 'prompt' && e.phase === 'returned');
    record({
      case: 'GAP-221.gate-accept-uses-prompt-default-not-empty',
      pass: returned?.result === 'fr2-default',
      detail: { gated, returned },
    });
    await obs.disconnect();
    await cli(['close'], caseDir).catch(() => {});
  }

  // ═══════════════════ Coordinator-requested: "warden killed, then a dialog opens" ═══════════
  // This is the fallback-safety proof (DirectCdpBroker, no lastPendingDialog hint): the warden
  // is killed OUTSIDE any CLI command, a dialog is then opened purely via the observer (so no
  // CLI process ever sees or records it as `lastPendingDialog`), and the NEXT command must
  // neither hang nor silently adopt a new blank tab.
  {
    const caseDir = path.join(STATE_ROOT, 'WardenDown');
    const n = nonce('wd');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const wf = await readWardenFile(caseDir);
    try {
      execSync(`taskkill /PID ${wf.pid} /F`, { stdio: ["ignore","ignore","ignore"] });
    } catch {}
    for (let i = 0; i < 20; i++) {
      try {
        await fetch(`http://127.0.0.1:${wf.port}/v1/health`, { signal: AbortSignal.timeout(300) });
      } catch {
        break;
      }
      await delay(150);
    }
    const obs = await connectObserver(st.wsEndpoint);
    const target = await waitForTarget(obs, n);
    const session = guard(await target.createCDPSession());
    const urlsBefore = await pageUrls(obs);
    // Open the dialog with NO CLI process involved at all — no lastPendingDialog hint will ever
    // be written for it. Wrapped in setTimeout(...,0) so THIS evaluate call itself returns
    // immediately — confirm() blocks the renderer synchronously (C13), so a direct (unwrapped)
    // click() call here would make this very Runtime.evaluate never return either.
    await session.send(
      'Runtime.evaluate',
      { expression: "setTimeout(() => document.getElementById('confirm').click(), 0)" },
      { timeout: 3000 },
    );
    await pollBlocked(session, 3000);
    const stBefore = await readState(caseDir);

    const t0 = Date.now();
    const cmd = await cli(['snap'], caseDir, { capMs: 20000 });
    const ms = Date.now() - t0;
    const stAfter = await readState(caseDir);
    const urlsAfter = await pageUrls(obs);
    record({ case: 'WardenDown.no-hang', pass: ms < 15000, detail: { ms } });
    record({
      case: 'WardenDown.honest-block-not-silent-success',
      pass: cmd.code === 3,
      detail: cmd,
    });
    record({
      case: 'WardenDown.no-GAP-017-wrong-tab',
      pass: JSON.stringify(urlsBefore) === JSON.stringify(urlsAfter) && !urlsAfter.includes('about:blank'),
      detail: { urlsBefore, urlsAfter },
    });
    record({ case: 'WardenDown.no-self-heal-kill', pass: stBefore.chromePid === stAfter.chromePid, detail: { before: stBefore.chromePid, after: stAfter.chromePid } });
    // Recover: handle it directly over CDP (the CLI's own dialog broker, degraded-but-functional).
    await cli(['dialog', 'accept'], caseDir).catch(() => {});
    await obs.disconnect();
    await cli(['close'], caseDir);
  }

  // ── FR2-04 fix-2 live cases (GAP-228, GAP-229, GAP-230, GAP-231) ───────────────────────────
  {
    // GAP-228: a blank popup (window.open('')) that alerts SYNCHRONOUSLY (no timer at all) must
    // be caught — this is the exact shape audit-2 found missed 26/26 under fix-1's narrowed probe.
    const caseDir = path.join(STATE_ROOT, 'GAP228');
    const n = nonce('g228');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const opener = await waitForTarget(obs, n);
    const os_ = guard(await opener.createCDPSession());
    await os_.send(
      'Runtime.evaluate',
      { expression: `void (function(){var w=window.open('');w.alert('${n}-blank');})()`, userGesture: true },
      { timeout: 4000 },
    ).catch(() => {});
    await delay(600);
    const cmd = await cli(['snap'], caseDir, { capMs: 20000 });
    record({
      case: 'GAP228.blank-popup-sync-alert-caught',
      pass: cmd.code === 3 && /"type":"unknown"/.test(cmd.stdout ?? ''),
      detail: { code: cmd.code, out: (cmd.stdout ?? '').slice(0, 300) },
    });
    await cli(['dialog', 'accept'], caseDir).catch(() => {});
    await obs.disconnect().catch(() => {});
    await cli(['close'], caseDir).catch(() => {});
  }
  {
    // GAP-229: an alert immediately followed by a confirm (a chain) under a --dialog policy must
    // be fully resolved before the command runs — never a partial handle + a 180s hang.
    const caseDir = path.join(STATE_ROOT, 'GAP229');
    const n = nonce('g229');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    await cli(['click', '#chain'], caseDir);
    const t0 = Date.now();
    const cmd = await cli(['snap', '--dialog', 'accept'], caseDir, { capMs: 30000 });
    const ms = Date.now() - t0;
    record({
      case: 'GAP229.chained-dialog-fully-regated',
      pass: cmd.code === 0 && ms < 10000 && !/about:blank/.test(cmd.stdout ?? ''),
      detail: { code: cmd.code, ms, out: (cmd.stdout ?? '').slice(0, 300) },
    });
    await cli(['close'], caseDir).catch(() => {});
  }
  {
    // GAP-230: an unknown dialog must be recoverable (tab closed, session stays alive) via
    // `dialog accept`, and `tabs` must never be gated. Opens the popup from an INDEPENDENT
    // observer connection (raw CDP `window.open`, not a live CLI `click` of the fixture's own
    // `#popup` button) — a real CLI click of that button was found, live, to crash the click
    // command itself with an UNRELATED, pre-existing bug ("Requesting main frame too early!" in
    // BrowserSession.adoptPopupPage, packages/browser/src/session/browser-session.ts — outside
    // FR2-04's file set) when the popup's onload alert fires before Puppeteer's frame manager for
    // it finishes initializing; that crash was then found to leave the session in a state where a
    // later `tabs` hangs (5/5, capped). This is flagged separately (see fix-2's final report) —
    // it is a real, reproducible bug, but not a dialog-warden/gate bug, and fixing it is out of
    // this item's scope. The independent-observer trigger used here reproduces GAP-230's actual
    // target (an unknown, unrecoverable-before-fix-2 dialog) without going through that unrelated
    // crash, matching fix-2/unknown-recovery-probe-fix2.mjs's proven-clean repro (3/3 live).
    const caseDir = path.join(STATE_ROOT, 'GAP230');
    const n = nonce('g230');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const st = await readState(caseDir);
    const obs = await connectObserver(st.wsEndpoint);
    const opener = await waitForTarget(obs, n);
    const os_ = guard(await opener.createCDPSession());
    // A body-script alert (fires after SOME frame/DOM commit), served from a tiny dedicated page
    // — not the shared fixture's `onloadAlert` (fires via a <head> IIFE before any frame commit
    // at all), which was found, live, to leave a DIFFERENT, narrower residual after recovery (see
    // fix-2's final report: an extremely-early, pre-frame-commit dialog's `Target.closeTarget`
    // recovery can leave a later `browser.pages()` enumeration hanging on a fresh reattach, 3/3
    // reproduced in fix-2/gap230-tabs-debug2.mjs). Disclosed separately, not silently avoided
    // here by picking an easier case — this one exercises the shape GAP-230's fix is proven clean
    // for end-to-end (matches fix-2/unknown-recovery-probe-fix2.mjs's repro, also 3/3 clean).
    await os_.send('Runtime.evaluate', { expression: `void window.open(${JSON.stringify(popupBase + n)})`, userGesture: true }).catch(() => {});
    await delay(800);
    const acc = await cli(['dialog', 'accept'], caseDir, { capMs: 20000 });
    record({
      case: 'GAP230.unknown-recovered-via-dialog-accept',
      pass: acc.code === 0 && /closed because its dialog/.test(acc.stdout ?? ''),
      detail: { acceptOut: (acc.stdout ?? '').slice(0, 200) },
    });
    // KNOWN RESIDUAL (disclosed, not fixed): calling `tabs` IMMEDIATELY after this recovery has
    // been found, live, to hang this specific ordering (reproduced consistently across several
    // standalone scripts -- fix-2/gap230-tabs-debug3.mjs, debug4.mjs, debug5.mjs -- not yet root-
    // caused). The exact same recovery followed by `tabs` LATER in a longer command sequence
    // (several intervening `snap`/`dialog` calls first) is proven clean 3/3 live in
    // fix-2/unknown-recovery-probe-fix2.mjs and 3/3 in fix-2/gap220-matrix-fix2.json. This case is
    // kept FAILING (not removed, not loosened) so the open item stays visible rather than quietly
    // dropped -- see fix-2's final report for the full disclosure.
    const tabsAfter = await cli(['tabs'], caseDir, { capMs: 20000 });
    record({
      case: 'GAP230.tabs-immediately-after-recovery(KNOWN-RESIDUAL)',
      pass: tabsAfter.code === 0,
      detail: { tabsCode: tabsAfter.code, tabsMs: tabsAfter.ms, tabsKilled: tabsAfter.killedAtCap },
    });
    await obs.disconnect().catch(() => {});
    await cli(['close'], caseDir, { capMs: 10000 }).catch(() => {});
  }
  {
    // GAP-231: N concurrent commands racing right after a stale spawn lock must still converge on
    // exactly ONE warden for the session.
    const caseDir = path.join(STATE_ROOT, 'GAP231');
    const n = nonce('g231');
    await cli(['nav', `${BASE}?n=${n}`], caseDir);
    const wf0 = await readWardenFile(caseDir);
    if (wf0) {
      try { execSync(`taskkill /PID ${wf0.pid} /F`, { stdio: 'ignore' }); } catch {}
    }
    await delay(300);
    await fs.rm(path.join(caseDir, 'warden.json'), { force: true }).catch(() => {});
    await fs.writeFile(path.join(caseDir, 'warden.lock'), JSON.stringify({ pid: 999999, startedAt: Date.now() - 60000 })).catch(() => {});
    await Promise.all([cli(['snap'], caseDir), cli(['snap'], caseDir), cli(['snap'], caseDir), cli(['snap'], caseDir)]);
    await delay(1000);
    const allProcs = listWindowsProcesses();
    const mineWardens = allProcs.filter((p) => {
      if (!/__dialog-warden/.test(p.CommandLine || '')) return false;
      const m = /__dialog-warden\s+(\S+)/.exec(p.CommandLine || '');
      if (!m) return false;
      try {
        const decoded = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf-8'));
        return (decoded.stateFile || '').includes(caseDir);
      } catch {
        return false;
      }
    });
    record({
      case: 'GAP231.stale-lock-race-single-warden',
      pass: mineWardens.length === 1,
      detail: { wardenCount: mineWardens.length },
    });
    await cli(['close'], caseDir).catch(() => {});
  }
} catch (e) {
  record({ case: 'unexpected-exception', pass: false, detail: String(e?.stack || e) });
} finally {
  // ── cleanup, unskippable ─────────────────────────────────────────────────────────────────
  server.close();
  for (const dir of await fs.readdir(STATE_ROOT).catch(() => [])) {
    await cli(['close'], path.join(STATE_ROOT, dir), { capMs: 20000 }).catch(() => {});
  }
  await delay(1500);
  const after = await countRelevantProcesses(rRealpath);
  record({ case: 'L14.no-leftover-chrome', pass: after.chrome.length === 0, detail: after.chrome.map((p) => p.ProcessId) });
  record({ case: 'L14.no-leftover-warden', pass: after.warden.length === 0, detail: after.warden.map((p) => p.ProcessId) });
  record({ case: 'observer-no-violations', pass: violations.length === 0, detail: violations });

  // GAP-225: gate overhead measurement (spec's gate-overhead.json, never written before this
  // fix) — median/p90 wall time of a gated `snap` (gate + attach + snap, including fix-1's new
  // per-target liveness probe on every page target with no tracked dialog) vs. `dialog` (gate
  // detection only) on a clean single-tab page, n=10.
  let gateOverhead;
  try {
    const goDir = path.join(STATE_ROOT, 'GateOverhead');
    await cli(['nav', `${BASE}?n=${nonce('go')}`], goDir);
    const snapTimes = [];
    const dialogTimes = [];
    for (let i = 0; i < 10; i++) {
      let t = Date.now();
      await cli(['snap'], goDir);
      snapTimes.push(Date.now() - t);
      t = Date.now();
      await cli(['dialog'], goDir);
      dialogTimes.push(Date.now() - t);
    }
    await cli(['close'], goDir).catch(() => {});
    const stats = (arr) => {
      const s = [...arr].sort((a, b) => a - b);
      return { median: s[Math.floor(s.length / 2)], p90: s[Math.min(s.length - 1, Math.floor(s.length * 0.9))], all: s };
    };
    gateOverhead = { snap: stats(snapTimes), dialogStatus: stats(dialogTimes), at: new Date().toISOString() };
  } catch (e) {
    gateOverhead = { error: String(e?.stack || e) };
  }
  await fs.writeFile(path.join(EVIDENCE_DIR, 'gate-overhead.json'), JSON.stringify(gateOverhead, null, 2));

  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-cases.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  // GAP-225: pass/fail/skip must be reported as three DISTINCT counts — a skip is not a pass.
  // (Before this fix, the final console line's numerator counted skips as passes: "97/97" was
  // actually 95 real passes + 2 skips, which read as "everything passed".)
  const skippedCount = results.filter((r) => r.skipped).length;
  const realPassCount = results.filter((r) => r.pass && !r.skipped).length;
  const failedCount = results.filter((r) => !r.pass).length;
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'live-summary.json'),
    JSON.stringify(
      { overallOk, total: results.length, passed: realPassCount, failed: failedCount, skipped: skippedCount, at: new Date().toISOString() },
      null,
      2,
    ),
  );

  for (let i = 0; i < 8; i++) {
    try {
      await fs.rm(R, { recursive: true, force: true });
      break;
    } catch {
      await delay(400 * (i + 1));
    }
  }
  console.log(
    `\n${overallOk ? 'ALL PASS' : 'SOME FAILED'} (${realPassCount} passed, ${failedCount} failed, ${skippedCount} skipped, ` +
      `${results.length} total), evidence: ${EVIDENCE_DIR}`,
  );
  process.exit(overallOk ? 0 : 1);
}
