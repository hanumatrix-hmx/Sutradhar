#!/usr/bin/env node
// drive.mjs (revision 3): the ONLY way drivers, canary runs and verifier replays may call the Sutradhar CLI.
//
//   node drive.mjs <slot> <taskId> <a1|a2|r1..r9> <verb> [args...]
//   node drive.mjs <slot> <taskId> <attempt> --check-clean
//
// slot: B1..B6 (drivers), K (canaries/setup), V1/V2 (verifier replays), M (self-test only).
// taskId: an id from selection.json (primary/reserve/retest) or a pseudo task (setup, selftest1, selftest2).
//
// Per call it:
//   * verifies the pinned CLI sha256 (exit 99);
//   * takes an exclusive per-slot lock (exit 95 if another call in this slot is running);
//   * enforces session ownership: one live session per slot, owned by <taskId>:<attempt> from its first nav
//     until close (exit 96 on mismatch; exit 97 for a non-nav verb with no session);
//   * enforces the domain fence: nav/newtab only to the task's allowed domains, plus the domain the starting
//     URL itself auto-redirected to in this attempt (exit 93); the attempt's first nav must be the task's
//     startingUrl (exit 93);
//   * refuses forbidden verbs/flags (exit 98);
//   * runs the CLI (120 s hard timeout on its own child PID only), then, while a session exists, an automatic
//     read of href/title/fingerprint (kind auto-href) so every call is tied to the page URL it ran on;
//   * tracks taint: a raw `eval` taints the attempt until the next driver `nav`; reads while tainted are flagged
//     (the checker recomputes this from the log and never accepts tainted reads as evidence);
//   * detects unlogged state changes: state.json mtime is recorded before/after every call; a mismatch with the
//     previous call's "after" is logged as kind gap;
//   * appends hash-chained JSONL to <LOOP>/runs/<slot>/raw/<taskId>.jsonl, echoes output, exits with the CLI code.
// Pseudo-verbs (wrapper-authored read-only JS; driver supplies only data): href, back, status, count <css>,
// read <css> (innerText of matches; evidence-eligible), links <css> (text + href of anchors; evidence-eligible),
// attrs <css> <name[,name...]> (innerText + named attributes via getAttribute; evidence-eligible).
// Verbs outside the driver brief's table are refused (allow-list, exit 98). `eval` and `waitfor --js <expr>` (unless
// <expr> is byte-equal to lib.INTERSTITIAL_JS) run driver JavaScript and taint the attempt until the next nav.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LOOP, genesis, hashRecord, regDomain, taskInfo, sameUrl, pseudoVerb, runsDriverJs, FORBIDDEN_VERBS, FORBIDDEN_FLAGS, URL_VERBS, ALLOWED_VERBS } from './lib.mjs';

const SCR = 'E:/AI-Cache/tmp/claude/E--HMX-Projects-Internal-Projects-PinchTab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const CLI = `${SCR}/v061/inst/node_modules/sutradhar/dist/cli-bin.js`;
const CLI_SHA256 = '9858726a291e844e1f84089b18310e90379140e2dfabf7b2fda80eb550b5c59b';
const SLOTS = /^(B[1-6]|V[12]|K|M)$/;
const TIMEOUT_MS = 120000;
const AUTO = "JSON.stringify({href:location.href,title:document.title,webdriver:navigator.webdriver,ua:navigator.userAgent,inner:[innerWidth,innerHeight]})";

const [slot, taskId, attempt, ...cmd] = process.argv.slice(2);
const task = taskId ? taskInfo(taskId) : null;
if (!slot || !SLOTS.test(slot) || !task || !/^(a[12]|r[1-9])$/.test(attempt ?? '') || cmd.length === 0) {
  console.error('usage: node drive.mjs <B1..B6|K|V1|V2|M> <taskId from selection.json|setup|selftestN> <a1|a2|r1..r9> <verb> [args...] | --check-clean');
  process.exit(2);
}
if (slot !== 'M' && taskId.startsWith('selftest')) { console.error('selftest tasks only in slot M'); process.exit(2); }

const dirs = { base: `${SCR}/w/${slot}`, s: `${SCR}/w/${slot}/s`, c: `${SCR}/w/${slot}/c`, shots: `${SCR}/w/${slot}/shots`, t: `${SCR}/${slot}t` };
for (const d of [dirs.s, dirs.c, dirs.shots, dirs.t]) mkdirSync(d, { recursive: true });
if (dirs.t.length + 35 > 200) { console.error(`TEMP too long for --user-data-dir <=200: ${dirs.t.length}+35`); process.exit(2); }
const logDir = path.join(LOOP, 'runs', slot, 'raw');
mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `${taskId}.jsonl`);
const stateFile = path.join(dirs.s, 'state.json');
const ownerFile = path.join(dirs.base, 'owner');
const taintFile = path.join(dirs.base, 'taint');
const lockFile = path.join(dirs.base, 'lock');
const me = `${taskId}:${attempt}`;

const readLog = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const stateMtime = () => (existsSync(stateFile) ? statSync(stateFile).mtimeMs : null);
function log(rec) {
  const L = readLog();
  const base = { seq: L.length + 1, ts: new Date().toISOString(), slot, taskId: String(taskId), attempt, ...rec, prevHash: L.length ? L[L.length - 1].hash : genesis(slot, taskId) };
  appendFileSync(logFile, JSON.stringify({ ...base, hash: hashRecord(base) }) + '\n');
  return base.seq;
}
function done(code, msg) { if (msg) console.error(msg); try { closeSync(lockFd); rmSync(lockFile, { force: true }); } catch { /* lock already gone */ } process.exit(code); }

// ---- lock (exclusive per slot)
let lockFd;
try { lockFd = openSync(lockFile, 'wx'); } catch {
  const age = existsSync(lockFile) ? Math.round((Date.now() - statSync(lockFile).mtimeMs) / 1000) : -1;
  console.error(`refused: another drive.mjs call is running in slot ${slot} (lock age ${age}s). Run calls one at a time.`);
  process.exit(95);
}

// ---- artifact integrity
const sha = createHash('sha256').update(readFileSync(CLI)).digest('hex');
if (sha !== CLI_SHA256) { log({ kind: 'refused', verb: cmd[0], argv: cmd, exit: 99, stdout: '', stderr: `cli-bin.js sha256 ${sha} != pinned` }); done(99, 'CLI hash mismatch; refusing'); }

// ---- unlogged-change detection
const prev = readLog().filter((r) => 'stateAfter' in r).pop();
const before = stateMtime();
if (prev && prev.stateAfter !== before) log({ kind: 'gap', verb: '-', argv: [], exit: 0, stdout: '', stderr: `state.json mtime changed between logged calls: ${prev.stateAfter} -> ${before}` });

function runCli(argv) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [CLI, ...argv], { cwd: dirs.c, env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: dirs.s, TEMP: dirs.t, TMP: dirs.t, SUTRADHAR_CONFIG: 'none', SUTRADHAR_CLI_DEADLINE_MS: '110000' }, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const timedOut = r.error?.code === 'ETIMEDOUT';
  return { stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error && !timedOut ? `\n[drive.mjs spawn error] ${r.error.message}` : ''), exit: timedOut ? 124 : (r.status ?? 1), timedOut, durationMs: Math.round(performance.now() - t0) };
}

// ---- check-clean (read-only)
if (cmd[0] === '--check-clean') {
  const profiles = readdirSync(dirs.t).filter((x) => x.startsWith('sutradhar-cli-'));
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `$t1='${dirs.t.replace(/\//g, '\\')}'; $t2='${dirs.t}'; @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains($t1) -or $_.CommandLine.Contains($t2)) } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }) -join ';'`],
    { encoding: 'utf8', timeout: 60000 });
  const procs = (ps.stdout ?? '').trim();
  const clean = !existsSync(stateFile) && profiles.length === 0 && procs === '';
  const out = JSON.stringify({ clean, stateJson: existsSync(stateFile), owner: existsSync(ownerFile) ? readFileSync(ownerFile, 'utf8') : null, profiles, processes: procs || null });
  log({ kind: 'check-clean', verb: '--check-clean', argv: cmd, exit: clean ? 0 : 1, durationMs: 0, stdout: out, stderr: ps.stderr ?? '', stateBefore: before, stateAfter: stateMtime() });
  console.log(out);
  done(clean ? 0 : 1);
}

// ---- guards
const verb = cmd[0];
const args = cmd.slice(1);
const refuse = (code, why) => { log({ kind: 'refused', verb, argv: cmd, exit: code, durationMs: 0, stdout: '', stderr: why, stateBefore: before, stateAfter: before }); done(code, why); };
const flagHit = cmd.find((a) => FORBIDDEN_FLAGS.includes(a));
if (FORBIDDEN_VERBS.has(verb) || flagHit) refuse(98, `refused: forbidden ${flagHit ? 'flag ' + flagHit : 'verb ' + verb} (protocol section 3)`);
if (!ALLOWED_VERBS.has(verb)) refuse(98, `refused: verb ${verb} is not in the driver brief's verb table (allow-list)`);
// review-4 B: attrs names must be plain attribute names (no spaces/prose), so nothing can be laundered through them
if (verb === 'attrs') {
  const names = String(args[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!args[0] || !names.length || names.some((n) => !/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(n) || n.length > 40)) refuse(98, 'refused: attrs needs <css> <name[,name...]> with plain attribute names (letters, digits, - _ : .; max 40 chars)');
}
const hasSession = existsSync(stateFile);
const owner = existsSync(ownerFile) ? readFileSync(ownerFile, 'utf8') : null;
if (hasSession && owner !== me) refuse(96, `refused: the live session in slot ${slot} belongs to ${owner ?? 'unknown'}, not ${me}. Close it under its own task first.`);
if (!hasSession && !['nav', 'doctor'].includes(verb)) refuse(97, `refused: no live session in slot ${slot} (run nav first; never run verbs after close)`);
const attemptLog = readLog().filter((r) => r.attempt === attempt);
if (URL_VERBS.has(verb)) {
  const url = args.find((a) => !a.startsWith('--'));
  const firstNav = attemptLog.find((r) => r.kind === 'cli' && r.verb === 'nav');
  if (verb === 'nav' && !firstNav && !sameUrl(url, task.startingUrl)) refuse(93, `refused: the first nav of ${me} must be the task's startingUrl ${task.startingUrl}`);
  const redirect = firstNav ? attemptLog.find((r) => r.kind === 'auto-href' && r.forSeq === firstNav.seq) : null;
  const allowed = new Set(task.allowed);
  if (redirect) { try { allowed.add(regDomain(JSON.parse(redirect.stdout.trim()).href)); } catch { /* no auto-href parsed */ } }
  if (!url || !/^https?:\/\//.test(url) || !allowed.has(regDomain(url))) refuse(93, `refused: ${verb} to ${url} is outside the task's allowed domains [${[...allowed].join(', ')}]`);
}

// ---- run
const pv = pseudoVerb(verb, args);
let argv = pv ? pv.cli : cmd;
if (verb === 'screenshot') argv = ['screenshot', `${dirs.shots}/${taskId}-${attempt}-${readLog().length + 1}.png`];
const r = runCli(argv);
const stateAfterCli = stateMtime();
if (verb === 'nav' && !hasSession && existsSync(stateFile)) writeFileSync(ownerFile, me);
const wasTainted = existsSync(taintFile) && readFileSync(taintFile, 'utf8') === me;
if (verb === 'nav' && r.exit === 0) rmSync(taintFile, { force: true });
const js = !pv && runsDriverJs(verb, cmd);
if (js) writeFileSync(taintFile, me);
const seq = log({ kind: 'cli', verb, dargs: args, argv, exit: r.exit, timedOut: r.timedOut, durationMs: r.durationMs, tainted: verb === 'nav' ? false : (wasTainted || js), runsDriverJs: js, stdout: r.stdout, stderr: r.stderr, stateBefore: before, stateAfter: stateAfterCli });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
if (r.timedOut) console.error(`[drive.mjs] timed out after ${TIMEOUT_MS} ms (logged seq ${seq})`);

if (verb === 'close' && r.exit === 0 && !existsSync(stateFile)) { rmSync(ownerFile, { force: true }); rmSync(taintFile, { force: true }); }
if (existsSync(stateFile)) {
  const a = runCli(['eval', AUTO]);
  log({ kind: 'auto-href', verb: 'auto-href', forSeq: seq, argv: ['eval', AUTO], exit: a.exit, durationMs: a.durationMs, stdout: a.stdout, stderr: a.stderr, stateBefore: stateAfterCli, stateAfter: stateMtime() });
  try {
    const d = regDomain(JSON.parse(a.stdout.trim()).href);
    if (!task.allowed.includes(d)) console.error(`[drive.mjs] WARNING: the page is now on ${d}, outside the task's site. Reads here are evidence only as a flagged linked-org page reached by a click; otherwise nav back.`);
  } catch { /* auto-href unreadable */ }
}
console.error(`[drive.mjs] logged ${slot}/${taskId} ${attempt} seq ${seq} exit ${r.exit}`);
done(r.exit);
