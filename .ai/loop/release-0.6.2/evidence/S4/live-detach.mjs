// S4 step 5: deterministic live repro of I-047 (detached-frame failures under iframe churn) through the real CLI and SDK
// bundles against the local /churn fixture. Run under the isolation preamble (Git Bash); the ISO dir is process.env.TEMP.
// Env (4b): CLI (abs cli-bin.js; default HEAD build), BUNDLE (abs index.js; default sibling of CLI), RUNS (L1/L2 repetitions, 10),
//   SNAPS (SDK snapshots, 20), CLISNAPS (CLI snaps, 10), TYPES (CLI type runs, 5), NO_MUTANTS=1 (skip the same-build mutants),
//   MODE = head | neg | mutant (head: the HEAD build must be clean; neg: NEG061 control, records failures; mutant: the two
//   same-build mutants must fail), LEVELS (default L1,L2,L3,L4), CHURN (default "k=8&ms=25"), SP, WT, OUT, LOGDIR.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT) { console.error('needs SP and WT'); process.exit(2); }
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir().split(path.sep).join('/');
if (ISO.length + 1 + 35 > 200) { console.error('ISO too long for the Chrome profile path'); process.exit(2); }
if (!existsSync(`${ISO}/.r062`)) { console.error('ISO has no .r062 marker'); process.exit(2); }
const MODE = process.env.MODE ?? 'head';
const CLI = process.env.CLI ?? `${WT}/packages/sutradhar/dist/cli-bin.js`;
const BUNDLE = process.env.BUNDLE ?? path.join(path.dirname(CLI), 'index.js');
const RUNS = Number(process.env.RUNS ?? 10), SNAPS = Number(process.env.SNAPS ?? 20), CLISNAPS = Number(process.env.CLISNAPS ?? 10), TYPES = Number(process.env.TYPES ?? 5);
const LEVELS = (process.env.LEVELS ?? 'L1,L2,L3,L4').split(',');
const CHURN = process.env.CHURN ?? 'k=8&ms=25';
const NO_MUTANTS = process.env.NO_MUTANTS === '1' || MODE === 'neg';
const OUT = process.env.OUT;
const LOGDIR = process.env.LOGDIR ?? `${WT}/.ai/loop/release-0.6.2/evidence/S4/logs-${MODE}`;
mkdirSync(LOGDIR, { recursive: true });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[harness] MODE=${MODE} LEVELS=${LEVELS} CHURN=${CHURN} RUNS=${RUNS} SNAPS=${SNAPS} CLISNAPS=${CLISNAPS} TYPES=${TYPES} NO_MUTANTS=${NO_MUTANTS ? 1 : 0}`);
console.error(`[harness] CLI=${CLI} sha256=${sha(CLI)}`);
console.error(`[harness] BUNDLE=${BUNDLE} sha256=${sha(BUNDLE)} ISO=${ISO} tmpdir=${norm(os.tmpdir())}`);

// The fixture server runs in its own process (spawnSync blocks this process's event loop).
const fixtureChild = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S4/fixture-main.mjs`], { env: { ...process.env, SP, WT }, stdio: ['pipe', 'pipe', 'inherit'] });
const fixtureLines = []; let fixtureWaiters = [];
{
  let buf = '';
  fixtureChild.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { fixtureLines.push(buf.slice(0, i)); buf = buf.slice(i + 1); const w = fixtureWaiters; fixtureWaiters = []; w.forEach((fn) => fn()); }
  });
}
const nextFixtureLine = (ms = 20000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('fixture timeout')), ms);
  const tryNow = () => { if (fixtureLines.length) { clearTimeout(t); resolve(fixtureLines.shift()); } else fixtureWaiters.push(tryNow); };
  tryNow();
});
const fx = JSON.parse(await nextFixtureLine());
const f = { url: fx.url, async close() { fixtureChild.stdin.write('quit\n'); await new Promise((r) => { const t = setTimeout(() => { fixtureChild.kill(); r(); }, 10000); fixtureChild.on('exit', () => { clearTimeout(t); r(); }); }); } };
console.error(`[harness] fixture pid=${fixtureChild.pid} url=${f.url}`);
const REAL_TEMP = 'E:/AI-Cache/tmp';
const cliEnv = { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), NODE_OPTIONS: process.env.NODE_OPTIONS, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CLI_STATE_DIR: `${ISO}/state`, SUTRADHAR_CONFIG: 'none' };
let callNo = 0; const logs = []; let timedOut = false;
function cli(args, bin = CLI) {
  callNo++;
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: ISO, env: cliEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const base = `${LOGDIR}/${String(callNo).padStart(3, '0')}-${args[0]}`;
  writeFileSync(`${base}.stderr.log`, r.stderr ?? ''); writeFileSync(`${base}.stdout.log`, r.stdout ?? ''); logs.push(`${base}.stderr.log`);
  if (r.error) { console.error(`[harness] call ${callNo} ${JSON.stringify(args)} error=${r.error.code}`); timedOut = timedOut || r.error.code === 'ETIMEDOUT'; }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', args };
}
const out = { mode: MODE, churn: CHURN, cli: CLI, cliSha256: sha(CLI), bundle: BUNDLE, bundleSha256: sha(BUNDLE), checks: {} };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 400) : ''}`); };
const stateFile = `${ISO}/state/state.json`;
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return undefined; } };
const realTempNames = () => { try { return readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort(); } catch { return []; } };
const realTempBefore = realTempNames();
const DET = /Attempted to use detached Frame/;
const combined = (r) => `${r.stdout}\n${r.stderr.split('\n').filter((l) => !l.startsWith('[iso-guard]') && !l.startsWith('[cleanup]')).join('\n')}`;
const evalNum = (code, bin) => { const r = cli(['eval', code], bin); return Number(r.stdout.trim()); };
let udChecked = false;
const checkUdd = () => {
  if (udChecked) return; const st = readState(); const udd = st?.userDataDir;
  if (!udd) return;
  udChecked = true;
  check('state.userDataDir <= 200 chars and dirname == ISO', udd.length <= 200 && norm(path.dirname(udd)) === norm(ISO), { udd, len: udd.length });
};

// ---------------- the four levels for one pair of binaries
async function runLevels(label, cliBin, bundle, levels, churn) {
  const res = { label, churn, cliBin, bundle };
  out.current = res; // partial results survive a harness error
  const url = `${f.url}/churn?${churn}`;
  if (levels.includes('L1')) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      let nav, click, rec, close;
      try {
        nav = cli(['nav', url], cliBin); checkUdd();
        click = cli(['click', '#absent'], cliBin);
        rec = evalNum('window.__recreated', cliBin);
      } finally { close = cli(['close'], cliBin); }
      const text = combined(click);
      runs.push({ run: i + 1, navCode: nav.code, clickCode: click.code, detached: DET.test(text), noVisible: /No visible element found/.test(text), recreated: rec, closeCode: close.code, msg: text.trim().split('\n').find((l) => /Click failed|No visible|detached|Error/.test(l))?.slice(0, 200) });
    }
    res.L1 = { runs, detachedRuns: runs.filter((r) => r.detached).length, cleanRuns: runs.filter((r) => r.clickCode === 1 && r.noVisible && !r.detached).length, churnOk: runs.every((r) => r.recreated > 100) };
  }
  if (levels.includes('L2')) {
    const { launch } = await import(pathToFileURL(bundle).href);
    const browser = await launch({ headless: true });
    const runs = [];
    try {
      for (let i = 0; i < RUNS; i++) {
        // a FRESH tab per run: on both 0.6.1 and HEAD a second goto() to the churn page after a click hangs 30 s (pre-existing,
        // unrelated to frame-detach: recorded in the README), so a run never reuses a tab that has been clicked
        const page = await browser.newPage();
        try {
          await page.goto(url);
          await page.evaluate('window.__arm(2500)');
          const t0 = performance.now(); let err; try { await page.click('#late'); } catch (e) { err = String(e?.message ?? e); }
          const t1 = performance.now();
          const late = await page.evaluate('window.__clicks.late'); const rec = await page.evaluate('window.__recreated');
          runs.push({ run: i + 1, ok: !err, err: err?.slice(0, 200), detached: !!err && DET.test(err), late, ms: Math.round(t1 - t0), over1000: t1 - t0 > 1000, recreated: rec });
        } finally { await page.close().catch(() => {}); }
      }
    } finally { await browser.close().catch((e) => console.error('browser.close error', e)); }
    res.L2 = { runs, successRuns: runs.filter((r) => r.ok && r.late === 1 && r.over1000).length, failedRuns: runs.filter((r) => !r.ok).length, detachedRuns: runs.filter((r) => r.detached).length, churnOk: runs.every((r) => r.recreated > 100) };
  }
  if (levels.includes('L3')) {
    const { launch } = await import(pathToFileURL(bundle).href);
    const browser = await launch({ headless: true });
    const sdk = [];
    try {
      const page = await browser.newPage();
      await page.goto(url);
      for (let i = 0; i < SNAPS; i++) {
        let snap, err; try { snap = await page.snapshot(); } catch (e) { err = String(e?.message ?? e); }
        const list = snap?.interactiveElements ?? '';
        const complete = !err && [1, 2, 3, 4, 5].every((n) => new RegExp(`Button ${n}\\b`).test(list));
        sdk.push({ i: i + 1, complete, elementCount: snap?.elementCount, err: err?.slice(0, 160) });
      }
      res.L3sdkRecreated = Number(await page.evaluate('window.__recreated'));
    } finally { await browser.close().catch((e) => console.error('browser.close error', e)); }
    const cliSnaps = []; let typeRuns = []; let rec;
    try {
      cli(['nav', url], cliBin); checkUdd();
      for (let i = 0; i < CLISNAPS; i++) {
        const r = cli(['snap'], cliBin); const text = r.stdout;
        const complete = r.code === 0 && [1, 2, 3, 4, 5].every((n) => new RegExp(`Button ${n}\\b`).test(text));
        cliSnaps.push({ i: i + 1, code: r.code, complete, zero: /Interactive elements \(0\)/.test(text), head: text.split('\n').find((l) => /Interactive elements/.test(l)) });
      }
      if (levels.includes('L4')) {
        for (let i = 0; i < TYPES; i++) {
          const r = cli(['type', '#absent-input', 'x'], cliBin); const text = combined(r);
          typeRuns.push({ run: i + 1, code: r.code, detached: DET.test(text), noVisible: /No visible element found|not found|No element/i.test(text), msg: text.trim().split('\n').find((l) => /failed|No visible|detached|Error/i.test(l))?.slice(0, 200) });
        }
      }
      rec = evalNum('window.__recreated', cliBin);
    } finally { cli(['close'], cliBin); }
    res.L3 = { sdk, cliSnaps, degradedSdk: sdk.filter((s) => !s.complete).length, degradedCli: cliSnaps.filter((s) => !s.complete).length, completeAll: sdk.filter((s) => s.complete).length + cliSnaps.filter((s) => s.complete).length, total: sdk.length + cliSnaps.length, churnOk: res.L3sdkRecreated > 100 && rec > 100, cliRecreated: rec };
    if (levels.includes('L4')) res.L4 = { runs: typeRuns, detachedRuns: typeRuns.filter((r) => r.detached).length, churnOk: rec > 100 };
  } else if (levels.includes('L4')) {
    const typeRuns = []; let rec;
    try {
      cli(['nav', url], cliBin); checkUdd();
      for (let i = 0; i < TYPES; i++) {
        const r = cli(['type', '#absent-input', 'x'], cliBin); const text = combined(r);
        typeRuns.push({ run: i + 1, code: r.code, detached: DET.test(text), msg: text.trim().split('\n').find((l) => /failed|No visible|detached|Error/i.test(l))?.slice(0, 200) });
      }
      rec = evalNum('window.__recreated', cliBin);
    } finally { cli(['close'], cliBin); }
    res.L4 = { runs: typeRuns, detachedRuns: typeRuns.filter((r) => r.detached).length, churnOk: rec > 100 };
  }
  return res;
}

let fatal;
try {
  if (MODE === 'head' || MODE === 'neg') {
    const r = await runLevels(MODE, CLI, BUNDLE, LEVELS, CHURN);
    out.result = r;
    if (r.L1) console.error(`[L1] detachedRuns=${r.L1.detachedRuns}/${RUNS} cleanRuns=${r.L1.cleanRuns}/${RUNS} recreated=${r.L1.runs.map((x) => x.recreated).join(',')}`);
    if (r.L2) console.error(`[L2] success=${r.L2.successRuns}/${RUNS} failed=${r.L2.failedRuns} detached=${r.L2.detachedRuns} ms=${r.L2.runs.map((x) => x.ms).join(',')}`);
    if (r.L3) console.error(`[L3] degraded sdk=${r.L3.degradedSdk}/${SNAPS} cli=${r.L3.degradedCli}/${CLISNAPS}`);
    if (r.L4) console.error(`[L4] detachedRuns=${r.L4.detachedRuns}/${TYPES}`);
    for (const lv of ['L1', 'L2', 'L3', 'L4']) if (r[lv]) check(`${lv} churn really happened (window.__recreated > 100 after every run)`, r[lv].churnOk);
    if (MODE === 'head') {
      if (r.L1) check('S4-3 L1 HEAD: 10/10 runs exit 1 with "No visible element found" and no "detached Frame"', r.L1.cleanRuns === RUNS && r.L1.detachedRuns === 0, { clean: r.L1.cleanRuns, detached: r.L1.detachedRuns });
      if (r.L2) check('S4-4 L2 HEAD: 10/10 succeed, __clicks.late === 1, t1-t0 > 1000 ms (loop path past the head start)', r.L2.successRuns === RUNS, { success: r.L2.successRuns, ms: r.L2.runs.map((x) => x.ms), late: r.L2.runs.map((x) => x.late), errs: r.L2.runs.filter((x) => x.err).map((x) => x.err) });
      if (r.L3) check('S4-5 L3 HEAD: 30/30 snapshots (20 SDK + 10 CLI) list Button 1..5', r.L3.completeAll === r.L3.total && r.L3.total === SNAPS + CLISNAPS, { complete: r.L3.completeAll, total: r.L3.total });
      if (r.L4) check('S4-6 L4 HEAD: type on an absent input never reports "detached Frame" (5/5)', r.L4.detachedRuns === 0 && r.L4.runs.length === TYPES, r.L4.runs.map((x) => x.msg));
    } else {
      if (r.L1) check('NEG061 L1 recorded (validity needs >= 1 detached failure)', true, { detachedRuns: r.L1.detachedRuns, cleanRuns: r.L1.cleanRuns, sample: r.L1.runs.filter((x) => x.detached).slice(0, 2).map((x) => x.msg) });
      if (r.L2) check('NEG061 L2 recorded', true, { success: r.L2.successRuns, failed: r.L2.failedRuns, detached: r.L2.detachedRuns, errs: r.L2.runs.filter((x) => x.err).slice(0, 2).map((x) => x.err) });
      if (r.L3) check('NEG061 L3 recorded (validity needs >= 1 degraded result)', true, { degradedSdk: r.L3.degradedSdk, degradedCli: r.L3.degradedCli, sample: [...r.L3.sdk.filter((x) => !x.complete).slice(0, 2), ...r.L3.cliSnaps.filter((x) => !x.complete).slice(0, 2)] });
      if (r.L4) check('NEG061 L4 recorded', true, { detachedRuns: r.L4.detachedRuns });
    }
  } else if (MODE === 'mutant') {
    // same-build mutants (same Puppeteer as HEAD): sibling files in dist, exactly 1 replacement, deleted afterwards
    const SYNC = '((fr, op) => op(fr))(';
    const mk = (srcFile, mutFile, find) => {
      const src = readFileSync(srcFile, 'utf8'); const cnt = src.split(find).length - 1;
      if (cnt !== 1) throw new Error(`mutant find count ${cnt} (expected 1) for ${find}`);
      writeFileSync(mutFile, src.replace(find, () => find.replace('frameCall(', SYNC)));
      return cnt;
    };
    const cliMut = path.join(path.dirname(CLI), 'cli-bin.mutant.js'); const idxMut = path.join(path.dirname(BUNDLE), 'index.mutant.js');
    const realShas = { cli: sha(CLI), idx: sha(BUNDLE) };
    try {
      if (LEVELS.includes('L1')) {
        out.mutantA_replacements = mk(CLI, cliMut, 'const match = await frameCall(frame, (f) =>');
        const r = await runLevels('mutant-M-047a', cliMut, BUNDLE, ['L1'], CHURN);
        out.mutantA = r;
        console.error(`[M-047a L1] detachedRuns=${r.L1.detachedRuns}/${RUNS} recreated=${r.L1.runs.map((x) => x.recreated).join(',')}`);
        check('M-047a (loop wrapper reverted) on L1: >= 1 of 10 runs shows "detached Frame"', r.L1.detachedRuns >= 1, { detachedRuns: r.L1.detachedRuns, sample: r.L1.runs.filter((x) => x.detached).slice(0, 2).map((x) => x.msg) });
        check('M-047a churn really happened', r.L1.churnOk);
      }
      if (LEVELS.includes('L3')) {
        out.mutantB_replacements = mk(BUNDLE, idxMut, 'const scrape = frameCall(frame, (f) =>');
        // SDK part only: the mutant is index.js (the SDK bundle); the CLI runs the real build for the control snaps
        const saveSnaps = CLISNAPS;
        const r = await runLevelsSdkOnly(idxMut);
        out.mutantB = r;
        console.error(`[M-047b L3 sdk] degraded=${r.degraded}/${SNAPS}`);
        check('M-047b (buildGraph fix reverted) on L3 (SDK): >= 1 degraded snapshot in 20', r.degraded >= 1, { degraded: r.degraded, sample: r.sdk.filter((x) => !x.complete).slice(0, 2) });
        check('M-047b churn really happened', r.recreated > 100, r.recreated);
        void saveSnaps;
      }
    } finally {
      rmSync(cliMut, { force: true }); rmSync(idxMut, { force: true });
    }
    check('mutant files deleted; real dist sha256 unchanged', !existsSync(cliMut) && !existsSync(idxMut) && sha(CLI) === realShas.cli && sha(BUNDLE) === realShas.idx, realShas);
  }
} catch (e) {
  fatal = String(e?.stack ?? e); console.error('FATAL', fatal);
} finally {
  // belt and braces: a session that survived a harness error is closed here
  if (readState()) { const c = cli(['close']); out.finalClose = { code: c.code }; }
  await f.close();
}

async function runLevelsSdkOnly(bundle) {
  const { launch } = await import(pathToFileURL(bundle).href);
  const browser = await launch({ headless: true });
  const sdk = []; let recreated;
  try {
    const page = await browser.newPage();
    await page.goto(`${f.url}/churn?${CHURN}`);
    for (let i = 0; i < SNAPS; i++) {
      let snap, err; try { snap = await page.snapshot(); } catch (e) { err = String(e?.message ?? e); }
      const list = snap?.interactiveElements ?? '';
      sdk.push({ i: i + 1, complete: !err && [1, 2, 3, 4, 5].every((n) => new RegExp(`Button ${n}\\b`).test(list)), elementCount: snap?.elementCount, err: err?.slice(0, 160) });
    }
    recreated = Number(await page.evaluate('window.__recreated'));
  } finally { await browser.close().catch(() => {}); }
  return { sdk, degraded: sdk.filter((s) => !s.complete).length, recreated };
}

// ---- epilogue: leftover checks
if (timedOut && readState()?.chromePid) {
  const pid = readState().chromePid;
  const q = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', timeout: 30000 });
  const owned = (q.stdout ?? '').toLowerCase().includes(path.basename(ISO).toLowerCase());
  out.timeoutKill = { pid, owned };
  if (owned) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 30000 });
}
check('close: state.json removed', readState() === undefined);
const realTempAfter = realTempNames();
out.realTemp = { before: realTempBefore.length, after: realTempAfter.length, vanished: realTempBefore.filter((x) => !realTempAfter.includes(x)) };
const pc = spawnSync(process.execPath, [`${SP}/iso/check-cleanup-paths.mjs`, ISO, ...logs], { encoding: 'utf8' });
out.pathCheck = { exit: pc.status, out: (pc.stdout ?? '').trim().split('\n').slice(-3) };
check('path-log check exit 0 (>= 1 [cleanup] line, none outside ISO)', pc.status === 0, out.pathCheck);
check('no timed-out CLI call', !timedOut);
out.fatal = fatal;
// MODE=neg is a control: its "pass" is that it ran cleanly; the validity verdict is read from the recorded numbers
out.allPass = !fatal && Object.values(out.checks).every((c) => c.ok);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-DETACH OK' : 'LIVE-DETACH FAILED');
process.exitCode = out.allPass ? 0 : 1;
