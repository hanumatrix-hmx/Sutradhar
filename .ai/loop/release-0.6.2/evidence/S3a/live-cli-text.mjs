// S3a live check: the CLI `text` verb against the fixture server through spawnSync(process.execPath, [cli-bin.js, ...]).
// Run under the isolation preamble (Git Bash); the ISO dir is process.env.TEMP.
// Env: MODE=head|neg (head: the HEAD build; neg: NEG061, the old behaviour), CLI (abs cli-bin.js, default HEAD build),
//      BUNDLE (abs index.js, used only to export a PDF; default sibling of CLI), NO_MUTANTS=1 (skip the same-build mutant),
//      SP, WT, OUT (result json path), LOGDIR (where per-call stderr logs go), RUNS (unused: nothing repeats here).
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const NO_MUTANTS = process.env.NO_MUTANTS === '1' || MODE !== 'head';
const OUT = process.env.OUT;
const LOGDIR = process.env.LOGDIR ?? `${WT}/.ai/loop/release-0.6.2/evidence/S3a/logs-${MODE}`;
mkdirSync(LOGDIR, { recursive: true });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[harness] MODE=${MODE} CLI=${CLI} sha256=${sha(CLI)}`);
console.error(`[harness] BUNDLE=${BUNDLE} sha256=${sha(BUNDLE)} NO_MUTANTS=${NO_MUTANTS ? 1 : 0} ISO=${ISO} tmpdir=${norm(os.tmpdir())}`);

// The fixture server runs in its own process (spawnSync below blocks this process's event loop).
const fixtureChild = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S3a/fixture-main.mjs`], { env: { ...process.env, SP, WT }, stdio: ['pipe', 'pipe', 'inherit'] });
const fixtureLines = []; let fixtureWaiters = [];
{
  let buf = '';
  fixtureChild.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      fixtureLines.push(buf.slice(0, i)); buf = buf.slice(i + 1);
      const w = fixtureWaiters; fixtureWaiters = []; w.forEach((fn) => fn());
    }
  });
}
const nextFixtureLine = (ms = 20000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('fixture timeout')), ms);
  const tryNow = () => { if (fixtureLines.length) { clearTimeout(t); resolve(fixtureLines.shift()); } else fixtureWaiters.push(tryNow); };
  tryNow();
});
const fx = JSON.parse(await nextFixtureLine());
const f = {
  url: fx.url, port: fx.port,
  async setPdfFile(file) {
    fixtureChild.stdin.write('pdf ' + file + '\n');
    const l = await nextFixtureLine();
    if (l !== 'ok pdf') throw new Error('fixture pdf: ' + l);
  },
  async close() {
    fixtureChild.stdin.write('quit\n');
    await new Promise((r) => { const t = setTimeout(() => { fixtureChild.kill(); r(); }, 10000); fixtureChild.on('exit', () => { clearTimeout(t); r(); }); });
  },
};
console.error(`[harness] fixture pid=${fixtureChild.pid} url=${f.url}`);
const REAL_TEMP = 'E:/AI-Cache/tmp';
const cliEnv = {
  ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(),
  NODE_OPTIONS: process.env.NODE_OPTIONS, SUTRADHAR_CLI_DEBUG_CLEANUP: '1',
  SUTRADHAR_CLI_STATE_DIR: `${ISO}/state`, SUTRADHAR_CONFIG: 'none',
};
let callNo = 0; const logs = [];
function cli(args, bin = CLI) {
  callNo++;
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: ISO, env: cliEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const log = `${LOGDIR}/${String(callNo).padStart(2, '0')}-${args[0]}.stderr.log`;
  writeFileSync(log, r.stderr ?? ''); logs.push(log);
  if (r.error) { console.error(`[harness] call ${callNo} ${JSON.stringify(args)} error=${r.error.code}`); timedOut = timedOut || r.error.code === 'ETIMEDOUT'; }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', args };
}
let timedOut = false;

const out = { mode: MODE, cli: CLI, cliSha256: sha(CLI), bundleSha256: sha(BUNDLE), noMutants: NO_MUTANTS, checks: {} };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 300) : ''}`); };
const stateFile = `${ISO}/state/state.json`;
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return undefined; } };
const evalStr = (code) => { const r = cli(['eval', code]); return { ...r, value: r.stdout.replace(/\r?\n$/, '') }; };
const realTempNames = () => { try { return readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort(); } catch { return []; } };
const isoCliDirs = () => readdirSync(ISO).filter((n) => n.startsWith('sutradhar-cli-')).sort();
const realTempBefore = realTempNames();

const MARK = (a, b, total) => `[page text truncated: showing characters ${a}-${b} of ${total}. Continue with: sutradhar text --offset ${b}]`;
const markerRe = /^([\s\S]*)\n(\[page text[^\n]*\])\n$/;
const splitOut = (stdout) => { const m = markerRe.exec(stdout); return m ? { text: m[1], marker: m[2] } : { text: stdout.replace(/\n$/, ''), marker: null }; };

let fatal;
try {
  // ---------------- a. page + independent FULL
  const nav = cli(['nav', `${f.url}/long?n=10000`]);
  check('a nav exit 0', nav.code === 0, { code: nav.code, out: nav.stdout.slice(0, 80) });
  const st = readState();
  const udd = st?.userDataDir;
  check('a state.userDataDir <= 200 chars and dirname == ISO', !!udd && udd.length <= 200 && norm(path.dirname(udd)) === norm(ISO), { udd, len: udd?.length });
  const Lr = evalStr('document.body.innerText.length');
  const L = Number(Lr.value);
  const FULL = evalStr('document.body.innerText').value;
  out.L = L; out.fullLength = FULL.length;
  check('a L >= 10000 and FULL.length == L', L >= 10000 && FULL.length === L, { L, full: FULL.length });

  if (MODE === 'head') {
    // ---------------- b
    const b = cli(['text']);
    const expectedB = `${FULL.slice(0, 4000)}\n${MARK(0, 4000, L)}\n`;
    check('b text = FULL[0:4000] + newline + marker A (stdout), exit 0', b.code === 0 && b.stdout === expectedB, { code: b.code, len: b.stdout.length, tail: b.stdout.slice(-130) });
    check('b marker is on stdout, not stderr', !b.stderr.includes('[page text'), b.stderr.slice(0, 100));
    // ---------------- c
    let acc = ''; const wins = []; let off = 0; let lastMarker = null; let ok = true;
    for (let i = 0; i < 40 && off < L; i++) {
      const r = cli(['text', '--offset', String(off)]);
      const { text, marker } = splitOut(r.stdout);
      if (r.code !== 0) { ok = false; break; }
      wins.push(text); acc += text; off += text.length; lastMarker = marker;
      if (marker && marker.includes('(end)')) break;
    }
    check('c windows concatenate to FULL exactly', ok && acc === FULL, { windows: wins.length, accLen: acc.length });
    check('c L >= 10000, >= 3 windows, windows differ', L >= 10000 && wins.length >= 3 && new Set(wins).size === wins.length, { windows: wins.length });
    check('c last marker is B naming the end', lastMarker === `[page text: showing characters ${off - wins[wins.length - 1].length}-${L} of ${L} (end)]`, lastMarker);
    // ---------------- d
    const d1 = cli(['text', '--max-chars', '100000']);
    check('d --max-chars 100000 = FULL, no marker', d1.code === 0 && d1.stdout === `${FULL}\n`, { len: d1.stdout.length });
    const d2 = cli(['text', '--offset', String(L + 5)]);
    check('d offset past end = empty window + marker C, exit 0', d2.code === 0 && d2.stdout === `\n[page text: offset ${L + 5} is past the end; the page text has ${L} characters]\n`, d2.stdout.slice(0, 160));
    // ---------------- e
    const e = cli(['text', '--json']);
    let ej; try { ej = JSON.parse(e.stdout); } catch { ej = undefined; }
    check('e --json parses; fields equal (b); no marker line', e.code === 0 && !!ej && ej.text === FULL.slice(0, 4000) && ej.offset === 0 && ej.returnedChars === 4000 && ej.totalChars === L && ej.truncated === true && ej.source === 'dom' && !e.stdout.includes('[page text'), { keys: ej && Object.keys(ej) });
    // ---------------- h (mid-session)
    const hcases = [
      [['text', '--offset', '-1'], '--offset must be an integer >= 0'],
      [['text', '--max-chars', '0'], '--max-chars must be an integer from 1 to 100000'],
      [['text', '--max-chars', '100001'], '--max-chars must be an integer from 1 to 100000'],
      [['text', '--offset', 'abc'], '--offset must be an integer >= 0'],
      [['text', '--offset'], '--offset needs a value'],
      [['snap', '--offset', '5'], '--offset is only valid with "text"'],
    ];
    const hres = [];
    for (const [args, msg] of hcases) {
      const before = { sha: sha(stateFile), dirs: isoCliDirs().join(',') };
      const r = cli(args);
      const after = { sha: sha(stateFile), dirs: isoCliDirs().join(',') };
      const good = r.code === 1 && r.stderr.includes(`Error: ${msg}`) && r.stdout === '' && before.sha === after.sha && before.dirs === after.dirs;
      hres.push({ args: args.join(' '), code: r.code, stderr: r.stderr.split('\n')[0], stdoutEmpty: r.stdout === '', stateUnchanged: before.sha === after.sha, noNewCliDir: before.dirs === after.dirs, good });
    }
    out.h = hres;
    check('h invalid flags mid-session: exit 1, message, state.json unchanged, no new sutradhar-cli-* under ISO', hres.every((x) => x.good), hres);
    // ---------------- i (on /nodeid: /long has no interactive elements, so no element would carry data-sd-gen)
    cli(['nav', `${f.url}/nodeid`]);
    const getG = () => evalStr("document.documentElement.getAttribute('data-sd-current-gen')").value;
    const getE = () => evalStr("document.querySelector('[data-sd-node-id]').getAttribute('data-sd-gen')").value;
    const runI = (textBin, label) => {
      cli(['snap']);
      const G1 = getG(), E1 = getE();
      cli(['text'], textBin);
      const G2 = getG(), E2 = getE();
      const real = (v) => /^[0-9]+$/.test(v);
      return { label, G1, G2, E1, E2, ok: real(G1) && real(E1) && G1 === G2 && E1 === E2 };
    };
    const iRes = runI(CLI, 'head');
    out.i = iRes;
    check('i text does not re-stamp ids (G1 non-null, G1 == G2, E1 == E2)', iRes.ok, iRes);
    cli(['snap']); const G3 = getG();
    check('i control: a second snap changes G (the read detects a re-stamp)', /^[0-9]+$/.test(G3) && G3 !== iRes.G1, { G1: iRes.G1, G3 });
    // same-build mutant M-048i
    if (!NO_MUTANTS) {
      const mut = path.join(path.dirname(CLI), 'cli-bin.mutant.js');
      const src = readFileSync(CLI, 'utf8');
      const find = 'const out = await runTextCommand(runtime, sessionId, {';
      const cnt = src.split(find).length - 1;
      out.mutantReplacements = cnt;
      const realShaBefore = sha(CLI);
      if (cnt !== 1) { check('M-048i mutant built with exactly 1 replacement', false, cnt); }
      else {
        writeFileSync(mut, src.replace(find, () => `await runtime.snapshot(sessionId);\n    ${find}`));
        try {
          const mRes = runI(mut, 'mutant');
          out.iMutant = mRes;
          check('S3a-12 M-048i live: the re-stamping mutant FAILS (i) (G2 != G1, both real numbers)', mRes.ok === false && /^[0-9]+$/.test(mRes.G1) && /^[0-9]+$/.test(mRes.G2) && mRes.G2 !== mRes.G1, mRes);
        } finally { rmSync(mut, { force: true }); }
        check('M-048i mutant file deleted, real cli-bin.js sha256 unchanged', !existsSync(mut) && sha(CLI) === realShaBefore);
      }
    }
    // ---------------- f (short page) + g (pdf) + j
    nav2short();
    await pdfAndAlert(true);
  } else {
    // NEG061 control mode
    const b = cli(['text']);
    out.negTextLength = b.stdout.length;
    check('k NEG061 text stdout length 4001 (4000 + newline), no marker', b.code === 0 && b.stdout.length === 4001 && !b.stdout.includes('[page text'), { len: b.stdout.length });
    const ofl = cli(['text', '--offset', '4000']);
    check('NEG061 rejects --offset as an unrecognized flag (exit 1)', ofl.code === 1 && /Unrecognized flag/.test(ofl.stderr), ofl.stderr.slice(0, 100));
    const getG = () => evalStr("document.documentElement.getAttribute('data-sd-current-gen')").value;
    cli(['nav', `${f.url}/nodeid`]);
    cli(['snap']); const G1 = getG(); cli(['text']); const G2 = getG();
    out.i = { G1, G2 };
    check('i NEG061 control: old `text` re-stamps ids (G changes) - the check can detect it', /^[0-9]+$/.test(G1) && /^[0-9]+$/.test(G2) && G1 !== G2, { G1, G2 });
    nav2short();
    await pdfAndAlert(false);
  }

  function nav2short() {
    const n = cli(['nav', `${f.url}/short`]);
    const t = cli(['text']);
    out.shortStdout = t.stdout; out.shortLength = t.stdout.length; out.shortSha256 = createHash('sha256').update(t.stdout).digest('hex');
    check('f short page text: exit 0, length > 200, no marker', n.code === 0 && t.code === 0 && t.stdout.length > 200 && !t.stdout.includes('[page text'), { len: t.stdout.length });
  }
  async function pdfAndAlert(isHead) {
    // g: PDF. Export a real PDF with the same build's SDK bundle (separate Chrome under the same ISO), then serve it.
    const { SutradharRuntime } = await import(pathToFileURL(BUNDLE).href);
    const rt = new SutradharRuntime();
    const res = await rt.launch({ launch: { headless: true } });
    let pdfBuf;
    try {
      await rt.navigate(res.sessionId, `${f.url}/long?n=10000`);
      pdfBuf = Buffer.from((await rt.exportPdf(res.sessionId)).base64, 'base64');
    } finally { await rt.shutdown(res.sessionId).catch(() => {}); }
    const pdfFile = `${ISO}/fixture.pdf`; writeFileSync(pdfFile, pdfBuf); await f.setPdfFile(pdfFile);
    out.pdfBytes = pdfBuf.length;
    const n = cli(['nav', `${f.url}/pdf`]);
    if (isHead) {
      // (g2) Addendum A.1: bundled builds cannot extract PDF text (PROB-052): exit 1 with the documented message, never empty + exit 0.
      const t = cli(['text', '--json']);
      const errLine = t.stderr.split(String.fromCharCode(10)).find((l) => l.startsWith('Error:')) ?? '';
      check('g2 bundled text on /pdf: exit 1, stdout empty, clear PROB-052 message (not the raw DOMMatrix error), no Fatal:',
        t.code === 1 && t.stdout === '' && errLine.startsWith('Error: text read failed: the PDF text could not be extracted: PDF text extraction is not available in this build (PROB-052)') && !/^Error: .*DOMMatrix is not defined/.test(errLine) && !t.stderr.includes('Fatal:'),
        { nav: n.code, code: t.code, stdout: t.stdout.slice(0, 80), errLine: errLine.slice(0, 260) });
      const t2 = cli(['text']);
      check('g2 plain text mode: also exit 1, empty stdout', t2.code === 1 && t2.stdout === '', { code: t2.code, stdout: t2.stdout.slice(0, 40) });
    } else {
      const t = cli(['text']);
      check('g2 NEG061 control: old text on the same PDF = one empty line, exit 0 (silent data loss)', t.code === 0 && t.stdout === String.fromCharCode(10), { len: t.stdout.length, stdout: t.stdout.slice(0, 120), stderrNonGuard: t.stderr.split(String.fromCharCode(10)).filter((l) => !l.startsWith('[iso-guard]')).slice(0, 4) });
    }
    // j: read failure (dialog)
    cli(['nav', `${f.url}/long?n=10000`]);
    const al = cli(['eval', "setTimeout(()=>alert('x'),0)"]);
    await new Promise((r) => setTimeout(r, 500));
    const t = cli(['text']);
    out.j = { evalCode: al.code, code: t.code, stdout: t.stdout.slice(0, 200), stderr: t.stderr.split('\n').slice(0, 3) };
    const neverEmptyOk = !(t.code === 0 && t.stdout.trim() === '');
    if (isHead) {
      const dialogBlocked = t.code === 3;
      const readFailed = t.code === 1 && t.stdout === '' && t.stderr.includes('Error: text read failed:') && !t.stderr.includes('Fatal:');
      check('j read failure: exit 3 (dialog-blocked) or exit 1 "Error: text read failed:", never exit 0 with empty stdout', neverEmptyOk && (dialogBlocked || readFailed), out.j);
    } else {
      out.negJRecorded = true;
      console.error(`[harness] NEG061 j recorded: ${JSON.stringify(out.j)}`);
    }
    const dd = cli(['dialog', 'dismiss']);
    out.dialogDismiss = { code: dd.code, stdout: dd.stdout.slice(0, 120) };
  }
} catch (e) {
  fatal = String(e?.stack ?? e); console.error('FATAL', fatal);
} finally {
  const c = cli(['close']);
  out.close = { code: c.code };
  await f.close();
}
// ---- epilogue: leftover checks
if (timedOut && readState()?.chromePid) {
  // 0.3 indirectly-started-Chrome rule: the PID from state.json, ownership check (CommandLine contains our ISO basename),
  // taskkill /PID <pid> /T /F, never by image name, never twice.
  const pid = readState().chromePid;
  const q = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', timeout: 30000 });
  const owned = (q.stdout ?? '').toLowerCase().includes(path.basename(ISO).toLowerCase());
  out.timeoutKill = { pid, owned };
  if (owned) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 30000 });
}
const finalState = readState();
out.stateGone = finalState === undefined;
check('close: state.json removed', out.stateGone);
const left = isoCliDirs(); out.isoCliDirsLeft = left;
const realTempAfter = realTempNames();
out.realTemp = { before: realTempBefore.length, after: realTempAfter.length, vanished: realTempBefore.filter((x) => !realTempAfter.includes(x)) };
const pc = spawnSync(process.execPath, [`${SP}/iso/check-cleanup-paths.mjs`, ISO, ...logs], { encoding: 'utf8' });
out.pathCheck = { exit: pc.status, out: (pc.stdout ?? '').trim().split('\n').slice(-3) };
check('path-log check exit 0 (>= 1 [cleanup] line, none outside ISO)', pc.status === 0, out.pathCheck);
check('no timed-out CLI call', !timedOut);
out.fatal = fatal; out.allPass = !fatal && Object.values(out.checks).every((c2) => c2.ok);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-CLI-TEXT OK' : 'LIVE-CLI-TEXT FAILED');
process.exitCode = out.allPass ? 0 : 1;
