// S8 auditor probe (additive; A.5 item 3). Replaces the two sanctioned PATH='' checks of S4 win-a7:
// an UNRESOLVABLE scanner (absolute path under a non-existent SystemRoot) must fail CLOSED.
import os from 'node:os'; import path from 'node:path'; import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url';
const SPR = 'e:/ai-cache/tmp/claude/e--hmx-projects-internal-projects-pinchtab--claude-worktrees-project-understanding-696041/37c49594-f3f4-44c7-b8d5-a5f569bf406f/scratchpad';
const nrmG = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (process.platform !== 'win32' || !nrmG(os.tmpdir()).startsWith(SPR + '/')) { console.error(`PROBE GUARD: tmpdir=${os.tmpdir()} not under scratchpad`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${nrmG(os.tmpdir())} pid=${process.pid}`);
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(pathToFileURL(process.env.S4_COMMON).href);
const { P, check, done, exists, setOld, profileDir, header, sleep } = C;
header('win-a7b unresolvable scanner (SystemRoot -> non-existent dir) fails closed');
const T = await fsp.mkdtemp(path.join(os.tmpdir(), 'a7b-'));
const saved = process.env.SystemRoot; const bogus = path.join(T, 'no-such-windows');
console.log(`INFO SystemRoot before=${saved}`);
// 1. unresolvable scanner
const d = await profileDir(path.join(T, 'sutradhar-cli-1790000000400-AbC123'), { lockfile: false }); await setOld(d); P('dir', d);
process.env.SystemRoot = bogus;
const t0 = performance.now(); const s = await TP.scanCommandLines(); const ms = performance.now() - t0;
const rc = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: T });
const sw = await TP.sweepStaleTempProfiles({ tmpRoot: T, minAgeMs: 0 });
process.env.SystemRoot = saved;
check('A7b scanCommandLines() with unresolvable scanner -> null', s === null, `got=${Array.isArray(s) ? 'array(' + s.length + ')' : s} ms=${ms.toFixed(0)}`);
check('A7b close keeps dir with scan-unavailable', rc.removed === false && rc.reason === 'scan-unavailable' && (await exists(d)), JSON.stringify(rc));
check('A7b sweep keeps dir with scan-unavailable', sw.removed.length === 0 && sw.kept.some((k) => k.dir === d && k.reason === 'scan-unavailable') && (await exists(d)), JSON.stringify(sw.kept.map((k) => k.reason)));
check('A7b SystemRoot restored', process.env.SystemRoot === saved);
// 2. negative controls: the same probe CAN fail (scanner available -> not-in-use dir removed; in-use dir kept)
const s2 = await TP.scanCommandLines();
check('A7b control: restored scanner returns an array', Array.isArray(s2), `len=${s2?.length}`);
const { spawn } = await import('node:child_process');
const d2 = await profileDir(path.join(T, 'sutradhar-cli-1790000000401-AbC123'), { lockfile: false }); await setOld(d2); P('dir', d2);
// the dir path reaches the stand-in only via its own argv (it is the process under test, P7)
const sb2 = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)', '--', '--user-data-dir=' + d2], { stdio: 'ignore', windowsHide: true, env: { ...process.env, NODE_OPTIONS: '' } });
await sleep(1500);
const rIn = await TP.removeSessionTempProfile(d2, undefined, { tmpRoot: T, removeTimeoutMs: 500 });
check('A7b control: in-use stand-in dir kept (in-use)', rIn.removed === false && rIn.reason === 'in-use' && (await exists(d2)), JSON.stringify(rIn));
sb2.kill('SIGKILL'); let w = performance.now(); while (performance.now() - w < 15000 && sb2.exitCode === null && sb2.signalCode === null) await sleep(100);
console.log(`INFO stand-in pid=${sb2.pid} exited=${sb2.exitCode !== null || sb2.signalCode !== null}`);
const rOut = await TP.removeSessionTempProfile(d2, undefined, { tmpRoot: T });
check('A7b control: same dir removed once the stand-in is gone', rOut.removed === true && !(await exists(d2)), JSON.stringify(rOut));
const rd = await TP.removeSessionTempProfile(d, undefined, { tmpRoot: T });
check('A7b control: first dir removed with the scanner restored', rd.removed === true && !(await exists(d)), JSON.stringify(rd));
done();
