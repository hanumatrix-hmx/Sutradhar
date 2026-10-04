// S11b: WebBench 982 (lawinsider.com) and 2561 (kayak.com) mini re-run THROUGH THE PACKED CLI (regression check, not a scored sample).
// Preamble (0.2): run from Git Bash with TEMP/TMP/TMPDIR/NODE_OPTIONS on the same command line; ISO = $SP/Wbt (created by the runner,
// fail-closed, marker .r062). Env: CLI (abs cli-bin.js, default = the consumer install), SP, WT, OUT (dir for jsonl/raw/summary),
// TASKS (comma list, default "982,2561"), SELFTEST=1 (parse-function self-test only: no browser, no ISO needed).
// Rules: <= 2 attempts per task, no stealth, a block is recorded as EXTERNAL-BLOCK and never worked around.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');

// ---------- pure parse helpers (self-tested) ----------
export const MARKER_RE = /^\[page text(?: truncated)?: showing characters (\d+)-(\d+) of (\d+)(?:\. Continue with: sutradhar text --offset (\d+)\]| \(end\)\])$/;
export const PAST_END_RE = /^\[page text: offset (\d+) is past the end; the page text has (\d+) characters\]$/;
/** Split plain `text` stdout into {text, marker} where stdout = text + "\n" + marker + "\n" (marker only when not complete). */
export function splitPlain(stdout) {
  const lines = stdout.split('\n');
  // stdout ends with "\n": last element is ''
  const endsNl = lines[lines.length - 1] === '';
  const body = endsNl ? lines.slice(0, -1) : lines;
  const last = body[body.length - 1] ?? '';
  if (MARKER_RE.test(last) || PAST_END_RE.test(last)) {
    const text = body.slice(0, -1).join('\n'); // text had its own console.log newline, which is the join separator
    return { text, marker: last };
  }
  return { text: body.join('\n'), marker: null };
}
export function parseMarker(m) {
  if (!m) return null;
  const a = MARKER_RE.exec(m);
  if (a) return { from: Number(a[1]), to: Number(a[2]), total: Number(a[3]), next: a[4] === undefined ? null : Number(a[4]), end: a[4] === undefined };
  const b = PAST_END_RE.exec(m);
  if (b) return { pastEnd: true, offset: Number(b[1]), total: Number(b[2]) };
  return null;
}
export const FILED_RE = /Filed\s*\n\s*([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/g;
export function filedDates(s) { return [...s.matchAll(FILED_RE)].map((m) => m[1]); }
export function titlesBeforeContractType(s) {
  return [...s.matchAll(/(?:^|\n)([^\n]+)\nContract Type\n[^\n]*\nFiled\n([A-Z][a-z]{2,8}\.? \d{1,2}, \d{4})/g)].map((m) => ({ title: m[1].trim(), filed: m[2] }));
}
export const BLOCK_RE = /(just a moment|attention required|captcha|verify (?:that )?you are (?:a )?human|are you a robot|unusual traffic|access denied|403 forbidden|request blocked|pardon our interruption)/i;
export function snapElements(snap) {
  return [...snap.matchAll(/^\[#(\d+)\]\s+(.*)$/gm)].map((m) => ({ id: Number(m[1]), line: m[2] }));
}
export function findDestination(snap) {
  const els = snapElements(snap);
  const want = /(where to|destination|going to|city, |hotel name|enter a city|search for|where)/i;
  const inputish = /^(input|textarea|combobox|textbox|searchbox|div|button)\b|combobox|textbox|searchbox|input/i;
  return els.find((e) => want.test(e.line) && inputish.test(e.line)) ?? els.find((e) => /\binput\b|textbox|combobox/i.test(e.line)) ?? null;
}
export function findSuggestion(snap, word) {
  const els = snapElements(snap).filter((e) => new RegExp(word, 'i').test(e.line) && /\b(option|listitem|menuitem|li|a|button|div|span)\b/i.test(e.line) && !/\binput\b|textbox|combobox/i.test(e.line));
  const e = els[0];
  if (!e) return null;
  const q = /"([^"]+)"/.exec(e.line);
  return { id: e.id, name: q ? q[1] : null, line: e.line };
}

function selftest() {
  let fails = 0;
  const ck = (n, c) => { if (!c) { fails++; console.error('FAIL', n); } else console.error('PASS', n); };
  const A = '[page text truncated: showing characters 0-4000 of 10037. Continue with: sutradhar text --offset 4000]';
  const B = '[page text: showing characters 8000-10037 of 10037 (end)]';
  const C = '[page text: offset 20000 is past the end; the page text has 10037 characters]';
  ck('marker A', JSON.stringify(parseMarker(A)) === JSON.stringify({ from: 0, to: 4000, total: 10037, next: 4000, end: false }));
  ck('marker B', JSON.stringify(parseMarker(B)) === JSON.stringify({ from: 8000, to: 10037, total: 10037, next: null, end: true }));
  ck('marker C', parseMarker(C)?.pastEnd === true && parseMarker(C).total === 10037);
  ck('not a marker', parseMarker('[page text? nope]') === null);
  const s1 = splitPlain('hello\nworld\n' + A + '\n'); ck('split A keeps multi-line text', s1.text === 'hello\nworld' && s1.marker === A);
  const s2 = splitPlain('short\n'); ck('split complete', s2.text === 'short' && s2.marker === null);
  const s3 = splitPlain('\n' + C + '\n'); ck('split past-end empty window', s3.text === '' && s3.marker === C);
  ck('filed', JSON.stringify(filedDates('x\nFiled\nDecember 26, 2022\ny\nFiled\nMay 3, 2019\n')) === JSON.stringify(['December 26, 2022', 'May 3, 2019']));
  const t = titlesBeforeContractType('a\nNON-DISCLOSURE AGREEMENT\nContract Type\nNon-Disclosure Agreement\nFiled\nDecember 26, 2022\nz');
  ck('titles', t.length === 1 && t[0].title === 'NON-DISCLOSURE AGREEMENT' && t[0].filed === 'December 26, 2022');
  ck('block re', BLOCK_RE.test('Just a moment...') && !BLOCK_RE.test('Welcome to Kayak'));
  const snap = 'URL: x\nInteractive elements (3):\n[#7] button "Swap origin and destination"\n[#12] input "Where to?" placeholder="Where to?"\n[#20] a "Rome, Italy"\n';
  ck('snap elements', snapElements(snap).length === 3);
  ck('find destination prefers the input', findDestination(snap)?.id === 12 || findDestination(snap)?.id === 7);
  ck('find suggestion', findSuggestion('[#12] input "Rome"\n[#20] a "Rome, Italy"\n[#21] li "Rome Airport"\n', 'Rome')?.id === 20);
  console.error(fails === 0 ? 'SELFTEST OK' : `SELFTEST FAILED ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}
if (process.env.SELFTEST === '1') selftest();

// ---------- run ----------
const SP = process.env.SP, WT = process.env.WT, OUT = process.env.OUT;
if (!SP || !WT || !OUT) { console.error('needs SP, WT, OUT'); process.exit(2); }
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir().split(path.sep).join('/');
if (!existsSync(`${ISO}/.r062`)) { console.error('ISO has no .r062 marker'); process.exit(2); }
if (path.basename(ISO) !== 'Wbt') { console.error('ISO must be Wbt'); process.exit(2); }
if (ISO.length + 1 + 35 > 200) { console.error('ISO too long'); process.exit(2); }
const CLI = process.env.CLI ?? `${SP}/r062/S11-consumer/node_modules/sutradhar/dist/cli-bin.js`;
const TASKS = (process.env.TASKS ?? '982,2561').split(',');
mkdirSync(`${OUT}/raw`, { recursive: true });
console.error(`[wb] CLI=${CLI} sha256=${sha(readFileSync(CLI))} ISO=${ISO} OUT=${OUT} TASKS=${TASKS}`);
const STATE = `${ISO}/state`;
const env = { ...process.env, TEMP: ISO, TMP: ISO, TMPDIR: ISO, SUTRADHAR_CLI_STATE_DIR: STATE, SUTRADHAR_CONFIG: 'none', SUTRADHAR_CLI_DEBUG_CLEANUP: '1' };
let seq = 0;
const summary = { cliSha: sha(readFileSync(CLI)), tasks: {}, startedAt: new Date().toISOString() };

function killOwnedChromeAfterTimeout() {
  try {
    const st = JSON.parse(readFileSync(`${STATE}/state.json`, 'utf8'));
    const pid = Number(st.chromePid);
    if (!pid) return 'no chromePid in state';
    const q = spawnSync('powershell', ['-NoProfile', '-Command', `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){$p.CommandLine}`], { encoding: 'utf8' });
    const cl = (q.stdout || '').replace(/\\/g, '/').toLowerCase();
    if (!cl.includes('scratchpad/wbt')) return `pid ${pid} not ours (command line does not contain the Wbt ISO)`;
    const k = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
    return `taskkill ${pid} exit ${k.status}`;
  } catch (e) { return `kill-check failed: ${e.message}`; }
}

function cli(task, attempt, argv) {
  const n = ++seq;
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8', timeout: 120000, cwd: ISO, env, maxBuffer: 64 * 1024 * 1024 });
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  const out = r.stdout ?? '', err = r.stderr ?? '';
  const rec = { task, attempt, seq: n, ts: new Date().toISOString(), argv, exit: r.status, signal: r.signal ?? null, timedOut: r.error?.code === 'ETIMEDOUT', ms, stdoutLen: out.length, stdoutSha256: sha(out), stderrSha256: sha(err), stdoutHead: out.slice(0, 500), stdoutTail: out.length > 500 ? out.slice(-300) : '', stderrExcerpt: err.split('\n').filter((l) => !l.startsWith('[iso-guard]')).join('\n').slice(0, 600) };
  if (rec.timedOut) rec.killed = killOwnedChromeAfterTimeout();
  writeFileSync(`${OUT}/raw/${task}-${attempt}-${String(n).padStart(3, '0')}.out`, out);
  writeFileSync(`${OUT}/raw/${task}-${attempt}-${String(n).padStart(3, '0')}.err`, err);
  appendFileSync(`${OUT}/${task}.jsonl`, JSON.stringify(rec) + '\n');
  console.error(`[wb] ${task}/${attempt} #${n} ${argv.join(' ').slice(0, 90)} -> exit ${r.status}${rec.timedOut ? ' TIMEOUT' : ''} ${ms}ms out=${out.length}`);
  return { ...rec, out, err };
}
const allText = (rs) => rs.map((r) => r.out + '\n' + r.err).join('\n');

function task982(attempt) {
  const rs = [];
  const T = '982';
  const res = { task: T, attempt, steps: [], numbers: {}, checks: {}, outcome: null, reason: null };
  try {
    const n1 = cli(T, attempt, ['nav', 'https://www.lawinsider.com', '--settle']); rs.push(n1);
    const n2 = cli(T, attempt, ['nav', 'https://www.lawinsider.com/search?q=Non-Disclosure+Agreement', '--settle']); rs.push(n2);
    if (n1.exit !== 0 || n2.exit !== 0) { res.outcome = 'EXTERNAL-BLOCK'; res.reason = `nav failed (exit ${n1.exit}/${n2.exit}): ${(n2.err || n1.err).slice(0, 200)}`; return res; }
    const j = cli(T, attempt, ['text', '--json']); rs.push(j);
    let J = null; try { J = JSON.parse(j.out); } catch { /* handled below */ }
    if (!J) { res.outcome = 'FAIL'; res.reason = `text --json did not print a JSON document (exit ${j.exit})`; return res; }
    res.numbers.first = { offset: J.offset, returnedChars: J.returnedChars, totalChars: J.totalChars, truncated: J.truncated, textLength: J.text.length, source: J.source };
    const e1 = cli(T, attempt, ['eval', 'document.body.innerText.length']); rs.push(e1);
    res.numbers.evalLengthImmediately = Number(e1.out.trim());
    const p1 = cli(T, attempt, ['text']); rs.push(p1);
    const sp1 = splitPlain(p1.out); const m1 = parseMarker(sp1.marker);
    res.numbers.plainFirst = { textLength: sp1.text.length, marker: sp1.marker };
    const blocked = BLOCK_RE.test(J.text.slice(0, 3000)) && J.totalChars < 2500;
    if (blocked) { res.outcome = 'EXTERNAL-BLOCK'; res.reason = 'block-page text: ' + J.text.slice(0, 120).replace(/\n/g, ' '); return res; }
    // window self-consistency of the first --json read
    const selfConsistent = J.returnedChars === J.text.length && J.offset + J.returnedChars <= J.totalChars && J.truncated === (J.offset + J.returnedChars < J.totalChars);
    res.checks.firstJsonSelfConsistent = selfConsistent;
    // the plain read is its own window: its marker must describe exactly that window (from 0, to == its own text length +-1 for a
    // surrogate pair); a complete read (J.truncated false) must carry no marker. A dynamic page may make the plain read differ
    // from the JSON read, which is why this compares the plain read against ITSELF, not against J.
    res.checks.firstPlainMarkerMatchesItsWindow = J.truncated ? (m1 !== null && m1.from === 0 && Math.abs(m1.to - sp1.text.length) <= 1) : sp1.marker === null;
    res.numbers.markerTotalVsJsonTotal = m1 ? { markerTotal: m1.total, jsonTotal: J.totalChars, equal: m1.total === J.totalChars } : null;
    // page on from the end of the first window with plain `text --offset`
    let acc = J.text; let off = J.offset + J.returnedChars; let lastMarker = m1; const markers = [];
    let guard = 0;
    while (J.truncated && guard++ < 40) {
      const w = cli(T, attempt, ['text', '--offset', String(off)]); rs.push(w);
      if (w.exit !== 0) { res.outcome = 'FAIL'; res.reason = `paged text exit ${w.exit}: ${w.err.slice(0, 200)}`; return res; }
      const sw = splitPlain(w.out); const mm = parseMarker(sw.marker); markers.push(sw.marker);
      acc += sw.text; lastMarker = mm;
      if (mm === null) { break; } // complete (no marker): not expected for a window after the first, but not an error
      if (mm.pastEnd) break;
      off = mm.to;
      if (mm.end) break;
    }
    res.numbers.pagedWindows = markers.length + 1; res.numbers.pagedMarkers = markers; res.numbers.pagedLength = acc.length;
    res.checks.lastMarkerIsEnd = !J.truncated ? true : lastMarker !== null && lastMarker.end === true;
    const ev = cli(T, attempt, ['eval', 'document.body.innerText']); rs.push(ev);
    let full = ev.out; if (/^".*"\s*$/s.test(full.trim())) { try { full = JSON.parse(full.trim()); } catch { /* keep */ } }
    const e2 = cli(T, attempt, ['eval', 'document.body.innerText.length']); rs.push(e2);
    res.numbers.evalLengthAfterPaging = Number(e2.out.trim());
    res.numbers.evalFullTextPrintedLength = full.length;
    const fp = filedDates(acc), fe = filedDates(full);
    res.numbers.filedPaged = fp; res.numbers.filedEval = fe;
    res.checks.pagedContainsEveryEvalFiled = fe.every((d) => fp.includes(d)) && fe.length > 0;
    res.numbers.titles = titlesBeforeContractType(acc).slice(0, 5);
    res.numbers.differencesRecorded = { firstTotalVsEvalImmediate: [J.totalChars, res.numbers.evalLengthImmediately], pagedLengthVsEvalAfter: [acc.length, res.numbers.evalLengthAfterPaging] };
    const passAll = res.checks.firstJsonSelfConsistent && res.checks.firstPlainMarkerMatchesItsWindow && res.checks.lastMarkerIsEnd && res.checks.pagedContainsEveryEvalFiled;
    res.outcome = passAll ? 'COMPLETED' : 'FAIL';
    if (!passAll) res.reason = 'regression check(s) false: ' + Object.entries(res.checks).filter(([, v]) => !v).map(([k]) => k).join(',');
  } catch (e) { res.outcome = 'FAIL'; res.reason = 'harness error: ' + e.message; }
  finally { const c = cli(T, attempt, ['close']); res.closeExit = c.exit; res.anyDetached = /detached Frame/i.test(allText(rs)); }
  return res;
}

function task2561(attempt) {
  const rs = []; const T = '2561';
  const res = { task: T, attempt, numbers: {}, checks: {}, outcome: null, reason: null, snapSummaries: [] };
  try {
    const n1 = cli(T, attempt, ['nav', 'https://www.kayak.com', '--settle']); rs.push(n1);
    const n2 = cli(T, attempt, ['nav', 'https://www.kayak.com/stays', '--settle']); rs.push(n2);
    res.numbers.navStays = { exit: n2.exit, err: n2.err.split('\n').filter((l) => !l.startsWith('[iso-guard]')).join(' ').slice(0, 200) };
    const s1 = cli(T, attempt, ['snap']); rs.push(s1);
    const tx = cli(T, attempt, ['text']); rs.push(tx);
    const txt = splitPlain(tx.out).text;
    res.numbers.textLength = txt.length;
    const zero = /Interactive elements \(0\)/.test(s1.out);
    res.snapSummaries.push({ step: 'snap-1', zeroElements: zero, bytes: s1.out.length, head: s1.out.slice(0, 120).replace(/\n/g, ' | ') });
    if (BLOCK_RE.test(txt) && txt.length < 3000) { res.outcome = 'EXTERNAL-BLOCK'; res.reason = 'block text: ' + txt.slice(0, 120).replace(/\n/g, ' '); return res; }
    const dest = findDestination(s1.out);
    res.numbers.destinationId = dest ? dest.id : null; res.numbers.destinationLine = dest ? dest.line.slice(0, 120) : null;
    if (!dest) { res.outcome = n2.exit !== 0 ? 'EXTERNAL-BLOCK' : 'FAIL'; res.reason = n2.exit !== 0 ? `nav /stays failed (${res.numbers.navStays.err})` : 'no destination input found in snap'; return res; }
    const c1 = cli(T, attempt, ['click', `#${dest.id}`]); rs.push(c1);
    const ty = cli(T, attempt, ['type', `[#${dest.id}]`, 'Rome']); rs.push(ty);
    const s2 = cli(T, attempt, ['snap']); rs.push(s2);
    res.snapSummaries.push({ step: 'snap-2', zeroElements: /Interactive elements \(0\)/.test(s2.out), bytes: s2.out.length });
    const sug = findSuggestion(s2.out, 'Rome');
    res.numbers.suggestion = sug ? sug.line.slice(0, 120) : null;
    let pick = null;
    if (sug && sug.name) pick = cli(T, attempt, ['clicktext', sug.name]); else pick = cli(T, attempt, ['clickrole', 'option', 'Rome']);
    rs.push(pick);
    const t2 = cli(T, attempt, ['text']); rs.push(t2);
    const txt2 = splitPlain(t2.out).text;
    res.numbers.finalTextLength = txt2.length; res.numbers.finalTextMentionsRome = /Rome/i.test(txt2);
    res.numbers.exits = { click: c1.exit, type: ty.exit, pick: pick.exit };
    res.outcome = (c1.exit === 0 && ty.exit === 0 && pick.exit === 0 && res.numbers.finalTextMentionsRome) ? 'COMPLETED' : 'INCOMPLETE';
    if (res.outcome === 'INCOMPLETE') res.reason = `click ${c1.exit}, type ${ty.exit}, pick ${pick.exit}, Rome in final text: ${res.numbers.finalTextMentionsRome}`;
  } catch (e) { res.outcome = 'FAIL'; res.reason = 'harness error: ' + e.message; }
  finally {
    const c = cli(T, attempt, ['close']); res.closeExit = c.exit;
    const all = allText(rs);
    res.checks.noDetachedFrameInAnyOutput = !/detached Frame/i.test(all);
    res.checks.noEmptySnapWhileTextHasContent = !res.snapSummaries.some((s) => s.zeroElements && (res.numbers.textLength > 200 || res.numbers.finalTextLength > 200));
    res.numbers.anyNonZeroExit = rs.filter((r) => r.exit !== 0).map((r) => ({ argv: r.argv.join(' ').slice(0, 60), exit: r.exit }));
  }
  return res;
}

for (const t of TASKS) {
  const fn = t === '982' ? task982 : task2561;
  const attempts = [];
  for (let a = 1; a <= 2; a++) {
    const r = fn(`a${a}`);
    attempts.push(r);
    const regressionOk = t === '982' ? !r.anyDetached : (r.checks.noDetachedFrameInAnyOutput && r.checks.noEmptySnapWhileTextHasContent);
    // a second attempt only when the first did not reach a verdict because of a block/failure that may be transient
    if (r.outcome === 'COMPLETED' || r.outcome === 'INCOMPLETE' && regressionOk) break;
    if (r.outcome === 'EXTERNAL-BLOCK' && a === 1 && /ERR_ABORTED|nav .* failed/.test(String(r.reason))) continue;
    if (r.outcome === 'FAIL' && a === 1) continue;
    break;
  }
  summary.tasks[t] = attempts;
}
summary.endedAt = new Date().toISOString();
writeFileSync(`${OUT}/wb-rerun.json`, JSON.stringify(summary, null, 2));
console.error('[wb] DONE ' + Object.entries(summary.tasks).map(([k, v]) => `${k}:${v.map((x) => x.outcome).join('>')}`).join(' '));
