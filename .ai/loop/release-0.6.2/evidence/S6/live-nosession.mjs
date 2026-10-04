// S6 live check (I-051): a read/act CLI verb with NO session fails with a hint and launches nothing; launch-capable verbs still launch.
// Run under the isolation preamble (Git Bash); the ISO dir is os.tmpdir(). The fixture server runs in its OWN process.
// Env: MODE=head|neg (neg = NEG061, which auto-launches), CLI (absolute cli-bin.js; default HEAD build), BUNDLE/MCP (unused here),
//      RUNS / NO_MUTANTS (unused: nothing repeats; mutants are source-level in the unit suite), SP, WT, OUT, LOGDIR.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT) { console.error('needs SP and WT'); process.exit(2); }
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir().split(path.sep).join('/');
if (ISO.length + 1 + 35 > 200) { console.error('ISO too long for the Chrome profile path'); process.exit(2); }
if (!existsSync(`${ISO}/.r062`)) { console.error('ISO has no .r062 marker'); process.exit(2); }
const MODE = process.env.MODE ?? 'head';
const CLI = process.env.CLI ?? `${WT}/packages/sutradhar/dist/cli-bin.js`;
const OUT = process.env.OUT;
const LOGDIR = process.env.LOGDIR ?? `${WT}/.ai/loop/release-0.6.2/evidence/S6/logs-${MODE}`;
mkdirSync(LOGDIR, { recursive: true });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[harness] MODE=${MODE} CLI=${CLI} sha256=${sha(CLI)}`);
console.error(`[harness] ISO=${ISO} tmpdir=${norm(os.tmpdir())}`);

const fixtureChild = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S6/fixture-main.mjs`], { env: { ...process.env, SP, WT }, stdio: ['pipe', 'pipe', 'inherit'] });
const fx = JSON.parse(await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('fixture timeout')), 20000);
  fixtureChild.stdout.once('data', (d) => { clearTimeout(t); resolve(d.toString().split('\n')[0]); });
}));
const url = fx.url; const origin = new URL(url).origin;
console.error(`[harness] fixture pid=${fixtureChild.pid} url=${url}`);
const REAL_TEMP = 'E:/AI-Cache/tmp';
const baseEnv = { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), NODE_OPTIONS: process.env.NODE_OPTIONS, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CONFIG: 'none' };
let callNo = 0; const logs = []; let timedOut = false; const stateDirsUsed = [];
// Every sub-case owns a FRESH state dir (asserted not to exist before its first call).
let stateSeq = 0;
function newStateDir() {
  const d = `${ISO}/st${++stateSeq}`;
  if (existsSync(d)) throw new Error(`state dir pre-exists: ${d}`);
  stateDirsUsed.push(d);
  return d;
}
function cli(stateDir, args) {
  callNo++;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ISO, env: { ...baseEnv, SUTRADHAR_CLI_STATE_DIR: stateDir }, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const log = `${LOGDIR}/${String(callNo).padStart(2, '0')}-${args[0]}.stderr.log`;
  writeFileSync(log, r.stderr ?? ''); logs.push(log);
  if (r.error) { timedOut = timedOut || r.error.code === 'ETIMEDOUT'; console.error(`[harness] call ${callNo} error=${r.error.code}`); }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', args };
}
const out = { mode: MODE, cliSha256: sha(CLI), checks: {}, negatives: [] };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 360) : ''}`); };
const realTempNames = () => { try { return readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort(); } catch { return []; } };
const realTempBefore = realTempNames();
const isoCliDirs = () => readdirSync(ISO).filter((n) => n.startsWith('sutradhar-cli-')).sort();
const productLines = (stderr) => stderr.split(/\r?\n/).filter((l) => l.length > 0 && !l.startsWith('[iso-guard]'));
const chromeLeft = () => {
  const q = spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like ('*' + $env:ISO_BASE + '*') } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', env: { ...process.env, ISO_BASE: path.basename(ISO) } });
  return (q.stdout ?? '').split(/\r?\n/).filter(Boolean);
};
const hintLine = (verb) => `Error: no active browser session \u2014 "${verb}" needs an open page and does not start one. Start a session with: sutradhar nav <url>`;
const existsAny = (dir, names) => names.filter((n) => existsSync(`${dir}/${n}`));

let fatal;
try {
  if (MODE === 'head') {
    const cases = [
      ['text'], ['snap'], ['axsnap'], ['click', '1'], ['type', '1', 'x'], ['press', '1', 'Enter'], ['screenshot'], ['eval', '1'], ['tabs'],
      ['waitfor', '1000', '--text', 'x'], ['scroll'], ['grant', origin, 'clipboard-read'], ['getclipboard'], ['newtab'], ['audit'], ['snap', '--json'],
    ];
    const cliDirsBefore = isoCliDirs().join(',');
    for (const args of cases) {
      const sd = newStateDir();
      const verb = args[0];
      const r = cli(sd, args);
      const lines = productLines(r.stderr);
      const exact = lines.length === 1 && lines[0] === hintLine(verb);
      const noFatal = !r.stderr.includes('Fatal:');
      const stateFiles = existsAny(sd, ['state.json', 'warden.json']);
      const rec = { args: args.join(' '), code: r.code, stderrLines: lines, stdoutEmpty: r.stdout === '', exact, noFatal, stateFiles };
      out.negatives.push(rec);
      check(`S6-3 no session: "${args.join(' ')}" -> exit 1, stderr is exactly the hint line, no Fatal:, stdout empty, no state.json/warden.json`,
        r.code === 1 && exact && noFatal && r.stdout === '' && stateFiles.length === 0, rec);
    }
    check('S6-3 afterwards: no sutradhar-cli-* under ISO', isoCliDirs().join(',') === cliDirsBefore, isoCliDirs());
    const left1 = chromeLeft();
    check('S6-3 afterwards: the CIM attribution query for the ISO basename returns 0 Chrome processes', left1.length === 0, left1);

    // ---- positives (launch-capable verbs still launch)
    {
      const sd = newStateDir();
      const n = cli(sd, ['nav', `${url}/short`]);
      check('S6-4 nav <url> from no state launches (exit 0, state.json appears)', n.code === 0 && existsSync(`${sd}/state.json`), { code: n.code, out: n.stdout.slice(0, 70) });
      const st = JSON.parse(readFileSync(`${sd}/state.json`, 'utf8'));
      check('state.userDataDir <= 200 chars and dirname == ISO', st.userDataDir.length <= 200 && norm(path.dirname(st.userDataDir)) === norm(ISO), { len: st.userDataDir.length });
      const t = cli(sd, ['text']);
      check('S6-3 state present: `text` right after `nav` is unchanged (exit 0, > 200 chars, no hint)', t.code === 0 && t.stdout.length > 200 && !t.stderr.includes('no active browser session'), { code: t.code, len: t.stdout.length });
      const c = cli(sd, ['close']);
      check('close after nav: exit 0 and state.json gone', c.code === 0 && !existsSync(`${sd}/state.json`), { code: c.code });
      // smoke scenario: nav, close, text -> exit 1 with the hint (same state dir)
      const t2 = cli(sd, ['text']);
      const l2 = productLines(t2.stderr);
      check('S6-3 smoke: nav, close, then `text` -> exit 1 with the hint, nothing launched', t2.code === 1 && l2.length === 1 && l2[0] === hintLine('text') && t2.stdout === '' && !existsSync(`${sd}/state.json`), { code: t2.code, lines: l2 });
    }
    {
      const sd = newStateDir();
      const n = cli(sd, ['newtab', `${url}/short`]);
      check('S6-4 newtab <url> from no state launches (exit 0, state.json appears)', n.code === 0 && existsSync(`${sd}/state.json`), { code: n.code, out: n.stdout.slice(0, 90) });
      const tabs = cli(sd, ['tabs']);
      check('S6-4 tabs then lists the new tab URL', tabs.code === 0 && tabs.stdout.includes(`${url}/short`), tabs.stdout.slice(0, 200));
      check('close after newtab', cli(sd, ['close']).code === 0 && !existsSync(`${sd}/state.json`));
    }
    {
      const sd = newStateDir();
      mkdirSync(`${ISO}/audit-out`, { recursive: true });
      const a = cli(sd, ['audit', `${url}/short`, `${ISO}/audit-out`]);
      check('S6-4 audit <url> from no state launches and runs (exit 0)', a.code === 0 && !a.stderr.includes('no active browser session'), { code: a.code, out: a.stdout.slice(0, 120) });
      cli(sd, ['close']);
      check('close after audit: state.json gone', !existsSync(`${sd}/state.json`));
    }
    {
      const sd = newStateDir();
      const cmp = cli(sd, ['compare', `${url}/short`, `${url}/hist/a`, `${ISO}/diff-out.png`]);
      check('S6-4 compare <a> <b> from no state launches and runs (exit 0)', cmp.code === 0 && !cmp.stderr.includes('no active browser session'), { code: cmp.code, out: cmp.stdout.slice(0, 160) });
      cli(sd, ['close']);
      check('close after compare: state.json gone', !existsSync(`${sd}/state.json`));
    }
  } else {
    // NEG061: the published 0.6.1 auto-launches on a read verb from no state (validity of the harness)
    const sd = newStateDir();
    const t = cli(sd, ['text']);
    check('S6-5 NEG061 `text` from no state: exit 0 and a state.json appears (it launched a blank browser)', t.code === 0 && existsSync(`${sd}/state.json`), { code: t.code, stdout: t.stdout.slice(0, 40), stderr: productLines(t.stderr).slice(0, 2) });
    const c = cli(sd, ['close']);
    check('NEG061 close: state.json gone', c.code === 0 && !existsSync(`${sd}/state.json`), { code: c.code });
    const sd2 = newStateDir();
    const s = cli(sd2, ['snap']);
    check('S6-5 NEG061 `snap` from no state also launches (exit 0, state.json)', s.code === 0 && existsSync(`${sd2}/state.json`), { code: s.code, stdout: s.stdout.slice(0, 60) });
    cli(sd2, ['close']);
  }
} catch (e) { fatal = String(e?.stack ?? e); console.error('FATAL', fatal); }

if (timedOut) {
  for (const d of stateDirsUsed) {
    let st; try { st = JSON.parse(readFileSync(`${d}/state.json`, 'utf8')); } catch { continue; }
    const pid = st.chromePid; if (!pid) continue;
    const q = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', timeout: 30000 });
    const owned = (q.stdout ?? '').toLowerCase().includes(path.basename(ISO).toLowerCase());
    out.timeoutKill = { pid, owned };
    if (owned) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 30000 });
  }
}
fixtureChild.stdin.write('quit\n');
await new Promise((r) => { const t = setTimeout(() => { fixtureChild.kill(); r(); }, 10000); fixtureChild.on('exit', () => { clearTimeout(t); r(); }); });
const leftoverStates = stateDirsUsed.filter((d) => existsSync(`${d}/state.json`));
check('no state.json left in any state dir at the end', leftoverStates.length === 0, leftoverStates);
const left = isoCliDirs(); out.isoCliDirsLeft = left;
const realTempAfter = realTempNames();
out.realTemp = { before: realTempBefore.length, after: realTempAfter.length, vanished: realTempBefore.filter((x) => !realTempAfter.includes(x)) };
const pc = spawnSync(process.execPath, [`${SP}/iso/check-cleanup-paths.mjs`, ISO, ...logs], { encoding: 'utf8' });
out.pathCheck = { exit: pc.status, out: (pc.stdout ?? '').trim().split('\n').slice(-3) };
check('path-log check exit 0 (>= 1 [cleanup] line, none outside ISO)', pc.status === 0, out.pathCheck);
const cl = chromeLeft();
check('attribution query: no Chrome with the ISO basename left at the end', cl.length === 0, cl);
check('no timed-out CLI call', !timedOut);
out.fatal = fatal; out.allPass = !fatal && Object.values(out.checks).every((c) => c.ok);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-NOSESSION OK' : 'LIVE-NOSESSION FAILED');
process.exitCode = out.allPass ? 0 : 1;
