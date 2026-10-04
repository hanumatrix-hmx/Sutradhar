// S7 live check (I-NAV): the CLI `back` / `forward` / `reload` verbs against the fixture server (H1, H1-SPA, H2, H3, H4).
// Run under the isolation preamble (Git Bash); the ISO dir is os.tmpdir(). The fixture server runs in its OWN process.
// Env: CLI (absolute cli-bin.js; default HEAD build), BUNDLE/MCP (unused), RUNS (unused: nothing repeats),
//      NO_MUTANTS (unused: same-build mutants are driven by run-live-mutants.sh, which sets CLI to a sibling .mutant.js),
//      HIST_GROUPS (comma list of H1,H2,H3; default all - a mutant run only needs the groups that must kill it), SP, WT, OUT, LOGDIR.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT) { console.error('needs SP and WT'); process.exit(2); }
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir().split(path.sep).join('/');
if (ISO.length + 1 + 35 > 200) { console.error('ISO too long for the Chrome profile path'); process.exit(2); }
if (!existsSync(`${ISO}/.r062`)) { console.error('ISO has no .r062 marker'); process.exit(2); }
const CLI = process.env.CLI ?? `${WT}/packages/sutradhar/dist/cli-bin.js`;
const GROUPS = new Set((process.env.HIST_GROUPS ?? 'H1,H2,H3').split(',').map((s) => s.trim()).filter(Boolean));
const OUT = process.env.OUT;
const LOGDIR = process.env.LOGDIR ?? `${WT}/.ai/loop/release-0.6.2/evidence/S7/logs-head`;
mkdirSync(LOGDIR, { recursive: true });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[harness] CLI=${CLI} sha256=${sha(CLI)} GROUPS=${[...GROUPS].join(',')}`);
console.error(`[harness] ISO=${ISO} tmpdir=${norm(os.tmpdir())}`);

const fixtureChild = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S7/fixture-main.mjs`], { env: { ...process.env, SP, WT }, stdio: ['pipe', 'pipe', 'inherit'] });
const lines = []; let waiters = [];
{ let buf = ''; fixtureChild.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); const w = waiters; waiters = []; w.forEach((fn) => fn()); } }); }
const nextLine = (ms = 20000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('fixture timeout')), ms);
  const tryNow = () => { if (lines.length) { clearTimeout(t); resolve(lines.shift()); } else waiters.push(tryNow); };
  tryNow();
});
const fx = JSON.parse(await nextLine());
const url = fx.url;
const fixtureHits = async () => { fixtureChild.stdin.write('hits\n'); const l = await nextLine(); return JSON.parse(l.replace(/^hits /, '')); };
console.error(`[harness] fixture pid=${fixtureChild.pid} url=${url}`);
const REAL_TEMP = 'E:/AI-Cache/tmp';
const baseEnv = { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), NODE_OPTIONS: process.env.NODE_OPTIONS, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CONFIG: 'none' };
let callNo = 0; const logs = []; let timedOut = false; const stateDirs = [];
const newStateDir = (name) => { const d = `${ISO}/${name}`; if (existsSync(d)) throw new Error(`state dir pre-exists: ${d}`); stateDirs.push(d); return d; };
let STATE = newStateDir('state');
const stateFile = () => `${STATE}/state.json`;
function cli(args) {
  callNo++;
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ISO, env: { ...baseEnv, SUTRADHAR_CLI_STATE_DIR: STATE }, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  const log = `${LOGDIR}/${String(callNo).padStart(2, '0')}-${args[0]}.stderr.log`;
  writeFileSync(log, r.stderr ?? ''); logs.push(log);
  if (r.error) { timedOut = timedOut || r.error.code === 'ETIMEDOUT'; console.error(`[harness] call ${callNo} error=${r.error.code}`); }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', args, ms };
}
const out = { cliSha256: sha(CLI), groups: [...GROUPS], checks: {}, notes: {} };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 380) : ''}`); };
const readState = () => { try { return JSON.parse(readFileSync(stateFile(), 'utf8')); } catch { return undefined; } };
const ev = (code) => { const r = cli(['eval', code]); return { ...r, value: r.stdout.replace(/\r?\n$/, '') }; };
const href = () => ev('location.href').value;
const stdoutLines = (r) => r.stdout.split(/\r?\n/).filter(Boolean);
const productErr = (r) => r.stderr.split(/\r?\n/).filter((l) => l && !l.startsWith('[iso-guard]') && !l.startsWith('[cleanup]'));
const realTempNames = () => { try { return readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort(); } catch { return []; } };
const realTempBefore = realTempNames();
const chromeLeft = () => {
  const q = spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like ('*' + $env:ISO_BASE + '*') } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', env: { ...process.env, ISO_BASE: path.basename(ISO) } });
  return (q.stdout ?? '').split(/\r?\n/).filter(Boolean);
};
const count = (arr, p) => arr.filter((h) => h === p || h.startsWith(p + '?')).length;
const BU_CANCEL = "the page's beforeunload dialog was dismissed (--dialog dismiss is in effect)";

let fatal;
try {
  if (GROUPS.has('H1')) {
    // ================= H1: full documents
    let r = cli(['nav', `${url}/hist/a`]); check('H1 nav /hist/a exit 0', r.code === 0, r.stdout.slice(0, 50));
    const st = readState(); const udd = st?.userDataDir;
    check('state.userDataDir <= 200 chars and dirname == ISO', !!udd && udd.length <= 200 && norm(path.dirname(udd)) === norm(ISO), { len: udd?.length });
    r = cli(['nav', `${url}/hist/b`]); check('H1 nav /hist/b exit 0', r.code === 0);
    const back = cli(['back']);
    check('S7-1 H1 back: exit 0, first line "Navigated back to <a>", then Title and Verification', back.code === 0 && stdoutLines(back)[0] === `Navigated back to ${url}/hist/a` && stdoutLines(back)[1] === 'Title: Hist A' && /^Verification: /.test(stdoutLines(back)[2] ?? ''), { code: back.code, out: stdoutLines(back) });
    check('S7-1 H1 independent read: eval location.href == <a>', href() === `${url}/hist/a`);
    out.notes.navTypeAfterBack = ev('JSON.stringify(window.__nav)').value;
    const fwd = cli(['forward']);
    check('S7-1 H1 forward: exit 0, "Navigated forward to <b>"', fwd.code === 0 && stdoutLines(fwd)[0] === `Navigated forward to ${url}/hist/b`, { code: fwd.code, out: stdoutLines(fwd) });
    check('S7-1 H1 independent read: eval location.href == <b>', href() === `${url}/hist/b`);
    r = cli(['nav', `${url}/reload-count`]);
    const before = count(await fixtureHits(), '/reload-count');
    const textBefore = ev("document.getElementById('n').textContent").value;
    const rl = cli(['reload']);
    const after = count(await fixtureHits(), '/reload-count');
    const textAfter = ev("document.getElementById('n').textContent").value;
    check('S7-1 H1 reload: exit 0, "Reloaded <url>", Title, Verification', rl.code === 0 && stdoutLines(rl)[0] === `Reloaded ${url}/reload-count` && /^Title: /.test(stdoutLines(rl)[1] ?? '') && /^Verification: verified/.test(stdoutLines(rl)[2] ?? ''), { code: rl.code, out: stdoutLines(rl) });
    check('S7-1 H1 reload: the server hit counter went up by exactly 1 (fixture side) and the page shows the new count', after === before + 1 && textBefore === `Reload count: ${before}` && textAfter === `Reload count: ${after}`, { before, after, textBefore, textAfter });

    // ================= H1-SPA: same-document entries
    r = cli(['nav', `${url}/hist/spa`]); check('H1-SPA nav /hist/spa exit 0', r.code === 0);
    const hash = ev('location.hash').value;
    out.notes.spaHistoryLength = ev('history.length').value;
    check('S7-2 H1-SPA precondition: location.hash == #x (the inline script ran)', hash === '#x', { hash, historyLength: out.notes.spaHistoryLength });
    const b1 = cli(['back']);
    check('S7-2 H1-SPA back: exit 0 and "Navigated back to <spa>#2"', b1.code === 0 && stdoutLines(b1)[0] === `Navigated back to ${url}/hist/spa#2`, { code: b1.code, out: stdoutLines(b1), err: productErr(b1) });
    check('S7-2 H1-SPA independent read: location.href ends with #2', href().endsWith('#2'));
    const b2 = cli(['back']);
    check('S7-2 H1-SPA second back: exit 0 and "Navigated back to <spa>" (no hash)', b2.code === 0 && stdoutLines(b2)[0] === `Navigated back to ${url}/hist/spa`, { code: b2.code, out: stdoutLines(b2) });
    check('S7-2 H1-SPA independent read: location.href == <spa> (no hash)', href() === `${url}/hist/spa`);
    const f1 = cli(['forward']);
    check('S7-2 H1-SPA forward: exit 0 and "Navigated forward to <spa>#2"', f1.code === 0 && stdoutLines(f1)[0] === `Navigated forward to ${url}/hist/spa#2`, { code: f1.code, out: stdoutLines(f1) });
    check('S7-2 H1-SPA independent read after forward: href ends with #2', href().endsWith('#2'));

    // ================= H4: --json after a successful move
    r = cli(['nav', `${url}/hist/a`]); r = cli(['nav', `${url}/hist/b`]);
    const bj = cli(['back', '--json']);
    let bjDoc; try { bjDoc = JSON.parse(bj.stdout); } catch { bjDoc = undefined; }
    check('S7-5 H4 back --json after a successful move: exit 0, one parseable document with the go_back.history-index pass check', bj.code === 0 && !!bjDoc && bjDoc.success === true && bjDoc.url === `${url}/hist/a` && (bjDoc.verification?.evidence?.checks ?? []).some((c) => c.check === 'go_back.history-index' && c.outcome === 'pass'), { code: bj.code, keys: bjDoc && Object.keys(bjDoc) });
    const c1 = cli(['close']); check('H1 close: exit 0, state.json gone', c1.code === 0 && !existsSync(stateFile()));
  }

  if (GROUPS.has('H2')) {
    // ================= H2: edges, on a FRESH session (no assumption about the initial history length)
    STATE = newStateDir('state-h2');
    let r = cli(['nav', `${url}/hist/a`]); check('H2 nav /hist/a (fresh session) exit 0', r.code === 0);
    const fe = cli(['forward']);
    check('S7-3 H2 forward at the newest entry: exit 1, stdout exactly the forward-edge line', fe.code === 1 && stdoutLines(fe).length === 1 && stdoutLines(fe)[0] === `Forward: no forward history entry (still on ${url}/hist/a)`, { code: fe.code, out: stdoutLines(fe), err: productErr(fe) });
    const feExp = cli(['forward', '--expect-url-changed']);
    check('S7-3 H2 forward --expect-url-changed at the newest entry: exit 1 (edge outranks the failed expectation, NOT 4)', feExp.code === 1, { code: feExp.code, out: stdoutLines(feExp), err: productErr(feExp) });
    const feExp2 = cli(['forward', '--expect-url', '/zzz-never']);
    check('S7-3 H2 forward --expect-url /zzz-never at the edge: exit 1', feExp2.code === 1, { code: feExp2.code });
    let sawEdge = false; const walked = [];
    for (let i = 0; i < 5 && !sawEdge; i++) {
      const b = cli(['back']);
      const first = stdoutLines(b)[0] ?? '';
      if (b.code === 1) {
        sawEdge = /^Back: no history entry to go back to \(still on /.test(first) && stdoutLines(b).length === 1;
        walked.push({ i, code: b.code, first });
        check('S7-3 H2 the edge back: exit 1 with "Back: no history entry to go back to (still on <url>)"', sawEdge, { code: b.code, out: stdoutLines(b), err: productErr(b) });
        const atEdgeUrl = href();
        check('S7-3 H2 the edge line names the real current URL', first.endsWith(`(still on ${atEdgeUrl})`), { first, atEdgeUrl });
      } else {
        const m = /^Navigated back to (.+)$/.exec(first);
        const now = href();
        walked.push({ i, code: b.code, first, href: now });
        check(`S7-3 H2 earlier back #${i + 1}: exit 0, "Navigated back to <url>", and eval location.href confirms it`, b.code === 0 && !!m && m[1] === now, { first, now });
      }
    }
    out.notes.h2Walk = walked;
    check('S7-3 H2 the back-edge was reached within 5 backs', sawEdge, walked);
    const beExp = cli(['back', '--expect-url-changed']);
    check('S7-3 H2 back --expect-url-changed at the edge: exit 1 (not 4)', beExp.code === 1, { code: beExp.code, out: stdoutLines(beExp) });
    const bj = cli(['back', '--json']);
    let doc; try { doc = JSON.parse(bj.stdout); } catch { doc = undefined; }
    check('S7-3 H2 back --json at the edge: parseable JSON on stdout containing the go_back.history-edge check, the edge line on stderr, exit 1',
      bj.code === 1 && !!doc && (doc.verification?.evidence?.checks ?? []).some((c) => c.check === 'go_back.history-edge') && productErr(bj).some((l) => l.startsWith('Back: no history entry to go back to (still on ')) && !bj.stdout.includes('Back: no history'),
      { code: bj.code, hasDoc: !!doc, err: productErr(bj) });
  }

  if (GROUPS.has('H3')) {
    // ================= H3: beforeunload
    if (!GROUPS.has('H2')) STATE = newStateDir('state-h3');
    let r = cli(['nav', `${url}/hist/a`]); r = cli(['nav', `${url}/beforeunload`]);
    check('H3 nav /beforeunload exit 0', r.code === 0);
    const arm = () => { const c = cli(['click', '#arm-bu']); return c.code === 0 && ev('String(window.__armed === true && typeof window.onbeforeunload)').value === 'function'; };
    check('H3 armed by a real CLI click (typeof window.onbeforeunload == function)', arm());
    // validity: --dialog accept shows the dialog really is raised on this armed page
    const acc = cli(['reload', '--dialog', 'accept']);
    const accSeen = /dialogHandled: \{"type":"beforeunload"/.test(acc.stdout);
    check('S7-4 H3 validity: reload --dialog accept on the armed page raised and handled a beforeunload dialog (the handled-dialog line)', accSeen, { code: acc.code, out: stdoutLines(acc).slice(0, 4) });
    check('H3 re-armed after the accepted reload', arm());
    const hitsBefore = count(await fixtureHits(), '/beforeunload');
    const rd = cli(['reload', '--dialog', 'dismiss']);
    const hitsAfterReload = count(await fixtureHits(), '/beforeunload');
    check('S7-4 H3 reload --dialog dismiss: exit 1, the cancel message on stdout, the /beforeunload hit counter unchanged', rd.code === 1 && rd.stdout.includes(BU_CANCEL) && !rd.stdout.includes('Reloaded') && hitsAfterReload === hitsBefore, { code: rd.code, ms: rd.ms, out: stdoutLines(rd), err: productErr(rd).slice(0, 3), hitsBefore, hitsAfterReload });
    check('H3 URL unchanged after the cancelled reload', href() === `${url}/beforeunload`);
    out.notes.h3ReloadMs = rd.ms;
    check('H3 re-armed (the handler is still there after the cancelled reload)', arm());
    const bd = cli(['back', '--dialog', 'dismiss']);
    check('S7-4 H3 back --dialog dismiss: exit 1, the cancel message on stdout, never "Navigated"', bd.code === 1 && bd.stdout.includes(BU_CANCEL) && !bd.stdout.includes('Navigated'), { code: bd.code, ms: bd.ms, out: stdoutLines(bd), err: productErr(bd).slice(0, 3) });
    check('S7-4 H3 URL unchanged after the cancelled back', href() === `${url}/beforeunload`);
    out.notes.h3BackMs = bd.ms;
  }

  // ================= H4: no session (always run): the exact S6 line for `back`
  {
    const c = cli(['close']); check('close before the no-session check: exit 0', c.code === 0 || !existsSync(stateFile()), { code: c.code });
    STATE = newStateDir('state-nosession');
    for (const verb of ['back', 'forward', 'reload']) {
      const nb = cli([verb]);
      const l = nb.stderr.split(/\r?\n/).filter((x) => x && !x.startsWith('[iso-guard]'));
      check(`S7-5 H4 no-session ${verb}: exit 1, the exact S6 hint line, stdout empty, nothing launched`,
        nb.code === 1 && l.length === 1 && l[0] === `Error: no active browser session \u2014 "${verb}" needs an open page and does not start one. Start a session with: sutradhar nav <url>` && nb.stdout === '' && !existsSync(`${STATE}/state.json`), { code: nb.code, l });
    }
  }
} catch (e) { fatal = String(e?.stack ?? e); console.error('FATAL', fatal); }

// close any session still open (every state dir that has a state.json)
for (const d of stateDirs) {
  if (!existsSync(`${d}/state.json`)) continue;
  STATE = d;
  const c = cli(['close']); console.error(`[harness] cleanup close ${path.basename(d)} -> ${c.code}`);
}
if (timedOut) {
  for (const d of stateDirs) {
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
const leftoverStates = stateDirs.filter((d) => existsSync(`${d}/state.json`));
check('no state.json left in any state dir at the end', leftoverStates.length === 0, leftoverStates);
const realTempAfter = realTempNames();
out.realTemp = { before: realTempBefore.length, after: realTempAfter.length, vanished: realTempBefore.filter((x) => !realTempAfter.includes(x)) };
const pc = spawnSync(process.execPath, [`${SP}/iso/check-cleanup-paths.mjs`, ISO, ...logs], { encoding: 'utf8' });
out.pathCheck = { exit: pc.status, out: (pc.stdout ?? '').trim().split('\n').slice(-3) };
check('path-log check exit 0 (>= 1 [cleanup] line, none outside ISO)', pc.status === 0, out.pathCheck);
const cl = chromeLeft();
check('attribution query: no Chrome with the ISO basename left at the end', cl.length === 0, cl);
check('no timed-out CLI call', !timedOut);
out.fatal = fatal; out.allPass = !fatal && Object.values(out.checks).every((c2) => c2.ok);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-HISTORY OK' : 'LIVE-HISTORY FAILED');
process.exitCode = out.allPass ? 0 : 1;
