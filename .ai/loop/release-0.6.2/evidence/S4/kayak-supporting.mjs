// S4 step 6: SUPPORTING live check (never a gate; may block) against kayak.com/stays through the HEAD CLI. ONE attempt, no retries,
// no stealth, no bot-wall bypass: a block/429/CAPTCHA is recorded as EXTERNAL-BLOCK. Run under the isolation preamble (ISO S4t).
// Env: CLI (abs cli-bin.js; default HEAD build), SP, WT, OUT, LOGDIR.
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir().split(path.sep).join('/');
if (ISO.length + 1 + 35 > 200 || !existsSync(`${ISO}/.r062`)) { console.error('bad ISO'); process.exit(2); }
const CLI = process.env.CLI ?? `${WT}/packages/sutradhar/dist/cli-bin.js`;
const LOGDIR = process.env.LOGDIR ?? `${WT}/.ai/loop/release-0.6.2/evidence/S4/logs-kayak`;
mkdirSync(LOGDIR, { recursive: true });
const env = { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), NODE_OPTIONS: process.env.NODE_OPTIONS, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CLI_STATE_DIR: `${ISO}/state`, SUTRADHAR_CONFIG: 'none' };
let n = 0; const logs = []; const calls = []; let timedOut = false;
function cli(args) {
  n++;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ISO, env, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const base = `${LOGDIR}/${String(n).padStart(2, '0')}-${args[0]}`;
  writeFileSync(`${base}.stdout.log`, r.stdout ?? ''); writeFileSync(`${base}.stderr.log`, r.stderr ?? ''); logs.push(`${base}.stderr.log`);
  if (r.error) timedOut = timedOut || r.error.code === 'ETIMEDOUT';
  const clean = (r.stderr ?? '').split('\n').filter((l) => !l.startsWith('[iso-guard]') && !l.startsWith('[cleanup]')).join('\n').trim();
  calls.push({ n, args: args.map((a) => (a.length > 60 ? a.slice(0, 60) + '…' : a)), code: r.status, stdoutHead: (r.stdout ?? '').slice(0, 160).replace(/\n/g, ' | '), stderr: clean.slice(0, 200) });
  console.error(`[kayak] ${JSON.stringify(calls[calls.length - 1])}`);
  return { code: r.status, stdout: r.stdout ?? '', stderr: clean };
}
const out = { calls: [], verdict: undefined };
let blocked = false; let detachedAnywhere = false; let zeroWithText = false;
const all = () => calls.map((c) => c.stdoutHead + ' ' + c.stderr).join('\n');
try {
  const nav1 = cli(['nav', 'https://www.kayak.com', '--settle']);
  const nav2 = cli(['nav', 'https://www.kayak.com/stays', '--settle']);
  const snap1 = cli(['snap']);
  out.snap1Head = snap1.stdout.slice(0, 600);
  const wall = /captcha|are you a (human|robot)|unusual traffic|access denied|verify you are|429|blocked|px-captcha/i;
  if (wall.test(nav1.stdout + nav1.stderr + nav2.stdout + nav2.stderr + snap1.stdout.slice(0, 1500))) blocked = true;
  const idm = /\[#(\d+)\][^\n]*(Enter a city|Where to|Destination|Search for a city|city)/i.exec(snap1.stdout);
  out.cityId = idm ? idm[1] : null;
  out.cityLine = idm ? idm[0] : null;
  let snap2, typeRes, textRes;
  if (idm) {
    const click = cli(['click', idm[1]]);
    snap2 = cli(['snap']);
    const idm2 = /\[#(\d+)\][^\n]*(Enter a city|Where to|Destination|city|Search)/i.exec(snap2.stdout) ?? idm;
    out.destId = idm2[1]; out.destLine = idm2[0];
    typeRes = cli(['type', idm2[1], 'Rome']);
    textRes = cli(['text']);
    out.textHead = textRes.stdout.slice(0, 400);
    out.snap2Head = snap2.stdout.slice(0, 600);
    for (const s of [snap1, snap2]) if (/Interactive elements \(0\)/.test(s.stdout) && textRes.stdout.trim().length > 200) zeroWithText = true;
    out.clickCode = click.code;
  } else {
    textRes = cli(['text']);
    out.textHead = textRes.stdout.slice(0, 400);
    if (/Interactive elements \(0\)/.test(snap1.stdout) && textRes.stdout.trim().length > 200) zeroWithText = true;
  }
  detachedAnywhere = /detached Frame/i.test(all()) || calls.some((c) => /detached Frame/i.test(c.stderr));
  if (!blocked && wall.test(textRes?.stdout.slice(0, 1500) ?? '')) blocked = true;
} finally {
  cli(['close']);
}
out.calls = calls; out.detachedAnywhere = detachedAnywhere; out.zeroWithText = zeroWithText; out.blocked = blocked;
out.verdict = blocked ? 'EXTERNAL-BLOCK' : (!detachedAnywhere && !zeroWithText ? 'SUPPORTING-PASS' : 'SUPPORTING-FAIL');
const pc = spawnSync(process.execPath, [`${SP}/iso/check-cleanup-paths.mjs`, ISO, ...logs], { encoding: 'utf8' });
out.pathCheck = { exit: pc.status, out: (pc.stdout ?? '').trim().split('\n').slice(-2) };
out.timedOut = timedOut;
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.error(`[kayak] verdict=${out.verdict} detachedAnywhere=${detachedAnywhere} zeroWithText=${zeroWithText} blocked=${blocked} pathCheck=${pc.status} timedOut=${timedOut}`);
