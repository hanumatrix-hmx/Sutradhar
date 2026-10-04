import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
import { spawn, spawnSync, execFileSync } from 'node:child_process'; import net from 'node:net';
const kind = process.env.BROWSER_KIND; header(`win-browser harness kind=${kind}`);
const EXE = kind.startsWith('edge') ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BINS = JSON.parse(process.env.NODE_BINS);
const ISO = os.tmpdir();
const T = await fsp.mkdtemp(path.join(ISO, 'r-'));
const dir = path.join(T, `sutradhar-cli-${Date.now()}-A${Math.random().toString(36).slice(2, 5)}`); await fsp.mkdir(dir);
P('tmpRoot', T); P('dir', dir);
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'];
if (kind.endsWith('headless')) args.push('--headless=new'); else args.push('--window-position=-32000,-32000', '--window-size=800,600');
const child = spawn(EXE, args, { detached: true, stdio: 'ignore' }); const bpid = child.pid; child.on("exit", (c, sg) => console.log(`INFO browser process exit code=${c} signal=${sg}`)); child.unref();
console.log(`STARTED browser pid=${bpid} exe=${EXE}`);
const t0 = performance.now(); let up = false;
while (performance.now() - t0 < 30000) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) { up = true; console.log(`INFO version=${(await r.json()).Browser}`); break; } } catch {} await sleep(250); }
check('browser up', up);
const t1 = performance.now(); while (performance.now() - t1 < 10000 && !(await exists(path.join(dir, 'lockfile')))) await sleep(200);
const childEnvBase = { ...process.env, PROBE_DIR: dir, PROBE_ROOT: T, PROBE_PORT: String(port), PROBE_BPID: String(bpid) };
for (const [rt, nb] of Object.entries(BINS)) {
  if (!up) break;
  console.log(`---- child ${rt}`);
  const r = spawnSync(nb, [path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'win-a4child.mjs')], { env: childEnvBase, encoding: 'utf-8', timeout: 240000 });
  for (const l of (r.stdout + r.stderr).split(/\r?\n/)) if (l) console.log(`[${rt}] ${l}`);
  check(`child ${rt} exit 0`, r.status === 0, `status=${r.status} signal=${r.signal}`);
}
// teardown: kill only our PID tree, confirm exit within 15 s
const TK = 'C:/Windows/System32/taskkill.exe';
try { execFileSync(TK, ['/PID', String(bpid), '/T', '/F'], { stdio: 'pipe' }); } catch (e) { console.log(`INFO taskkill: ${String(e.stderr ?? e.message).trim()}`); }
const t2 = performance.now(); let dead = false;
while (performance.now() - t2 < 15000) { try { process.kill(bpid, 0); } catch { dead = true; break; } await sleep(200); }
check('browser pid exited within 15 s', dead);
// post-kill: no remaining process may reference our dir (ownership by basename); then close path must remove it
let rest = await TP.scanCommandLines();
const ours = (rest ?? []).filter((l) => l.toLowerCase().includes(path.basename(dir).toLowerCase()));
console.log(`INFO post-kill references=${ours.length}`);
const t3 = performance.now();
let rr; do { rr = await TP.removeSessionTempProfile(dir, bpid, { tmpRoot: T }); if (rr.removed) break; await sleep(1000); } while (performance.now() - t3 < 20000);
P('postkill-close-result', dir, `removed=${rr.removed} reason=${JSON.stringify(rr.reason)}`);
check('post-kill close removes the now-dead profile (positive control)', rr.removed && !(await exists(dir)), JSON.stringify(rr));
done();
