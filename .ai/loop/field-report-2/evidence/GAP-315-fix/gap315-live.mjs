// GAP-315 live check. Only kills PIDs it started itself; every wait has a hard timeout.
import { spawnSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/peaceful-boyd-a324b8';
const CLI = path.join(REPO, 'packages/cli/dist/cli.js');
const TP = await import('file:///' + path.join(REPO, 'packages/cli/dist/temp-profile.js').replace(/\\/g, '/'));
const { BrowserLauncher } = await import('file:///' + path.join(REPO, 'packages/browser/dist/index.js').replace(/\\/g, '/'));
const STATE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'gap315-state');
const TMP = os.tmpdir();
const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: STATE_DIR };
const list = () => readdirSync(TMP).filter((n) => n.startsWith('sutradhar-cli-')).sort();
const log = (...a) => console.log(`[${new Date().toISOString()}]`, ...a);
let failures = 0;
const check = (ok, msg) => { log(ok ? 'PASS' : 'FAIL', msg); if (!ok) failures++; };

function cli(...args) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf-8', timeout: 120_000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), ms: Math.round(performance.now() - t0) };
}

const before = list();
const scan0 = await TP.scanCommandLines();
const inUseBefore = before.filter((n) => TP.commandLinesReference(path.join(TMP, n), scan0 ?? []));
log('tmpdir', TMP, 'before:', before.length, before.join(' '));
log('in use by a running process before:', inUseBefore.join(' ') || '(none)');

// ---- Negative case: a Chrome WE start, on an old-named, backdated, dead-owner-marker temp dir.
const negName = 'sutradhar-cli-1700000000000-NEG315';
const negDir = path.join(TMP, negName);
mkdirSync(negDir, { recursive: true });
writeFileSync(path.join(negDir, TP.OWNER_MARKER), JSON.stringify({ chromePid: 999999, cliPid: 1, createdAt: '2020-01-01T00:00:00Z' }));
const chromePath = new BrowserLauncher().findExecutablePath();
const neg = spawn(chromePath, ['--headless=new', `--user-data-dir=${negDir}`, '--no-first-run', '--remote-debugging-port=0', 'about:blank'], { detached: true, stdio: 'ignore' });
neg.unref();
log('negative-case Chrome pid', neg.pid, 'dir', negDir);
{ const t = performance.now(); while (!existsSync(path.join(negDir, 'Default')) && performance.now() - t < 15_000) await new Promise((r) => setTimeout(r, 200)); }
const past = new Date(Date.now() - 3600_000); utimesSync(negDir, past, past);

// ---- 10 x nav + close
const sessions = [];
for (let i = 1; i <= 10; i++) {
  const nav = cli('nav', 'https://example.com');
  const st = JSON.parse(readFileSync(path.join(STATE_DIR, 'state.json'), 'utf-8'));
  const close = cli('close');
  const gone = !existsSync(st.userDataDir);
  const pidAlive = TP.isPidAlive(st.chromePid);
  sessions.push(path.basename(st.userDataDir));
  log(`iter ${i}: nav exit=${nav.code} ${nav.ms}ms | dir=${path.basename(st.userDataDir)} tempProfile=${st.tempProfile} pid=${st.chromePid} | close exit=${close.code} ${close.ms}ms out="${close.out}" err="${close.err}" | dirRemoved=${gone} chromeAlive=${pidAlive}`);
  check(nav.code === 0 && close.code === 0 && gone && !pidAlive && st.tempProfile === true, `iter ${i} session dir removed after close`);
}

const after = list();
const newDirs = after.filter((n) => !before.includes(n) && n !== negName);
log('after:', after.length, after.join(' '));
check(newDirs.length === 0, `no new sutradhar-cli-* dirs remain (new: ${newDirs.join(' ') || 'none'})`);
for (const n of inUseBefore) check(after.includes(n), `pre-existing in-use dir survived: ${n}`);
check(existsSync(negDir), `negative case: dir used by running Chrome pid ${neg.pid} survived 10 sweeps`);
const direct = await TP.removeSessionTempProfile(negDir, undefined);
check(!direct.removed && direct.reason === 'in-use' && existsSync(negDir), `negative case: close-path removal refused (${JSON.stringify(direct)})`);
const swept = before.filter((n) => !after.includes(n));
log('stale dirs removed by session-start sweep:', swept.join(' ') || '(none)');

// ---- Tear down OUR Chrome by PID, then show the same dir becomes removable.
spawnSync('taskkill', ['/PID', String(neg.pid), '/T', '/F'], { timeout: 30_000 });
const exited = await TP.waitForPidExit(neg.pid, 15_000);
const afterKill = await TP.removeSessionTempProfile(negDir, neg.pid);
check(exited && afterKill.removed && !existsSync(negDir), `negative-case dir removed once its Chrome (pid ${neg.pid}) exited: ${JSON.stringify(afterKill)}`);

log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
process.exit(failures ? 1 : 0);
