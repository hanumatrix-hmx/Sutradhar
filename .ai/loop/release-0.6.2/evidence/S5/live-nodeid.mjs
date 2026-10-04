// S5 live check (I-049): "#N" / "[#N]" accepted as snapshot node ids on the CLI, the MCP server and the SDK, incl. --frame.
// Run under the isolation preamble (Git Bash); the ISO dir is os.tmpdir(). The fixture server runs in its OWN process.
// Env: MODE=head|neg (neg = NEG061: the old behaviour must reject), CLI / BUNDLE / MCP (absolute dist paths; default HEAD build,
//      or the siblings of CLI), RUNS / NO_MUTANTS (unused: nothing repeats, no same-build mutants here), SP, WT, OUT, LOGDIR.
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
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
const MCP = process.env.MCP ?? path.join(path.dirname(CLI), 'mcp-cli.js');
const OUT = process.env.OUT;
const LOGDIR = process.env.LOGDIR ?? `${WT}/.ai/loop/release-0.6.2/evidence/S5/logs-${MODE}`;
mkdirSync(LOGDIR, { recursive: true });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
for (const [k, v] of [['CLI', CLI], ['BUNDLE', BUNDLE], ['MCP', MCP]]) console.error(`[harness] ${k}=${v} sha256=${sha(v)}`);
console.error(`[harness] MODE=${MODE} ISO=${ISO} tmpdir=${norm(os.tmpdir())}`);

const fixtureChild = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S5/fixture-main.mjs`], { env: { ...process.env, SP, WT }, stdio: ['pipe', 'pipe', 'inherit'] });
const fx = JSON.parse(await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('fixture timeout')), 20000);
  fixtureChild.stdout.once('data', (d) => { clearTimeout(t); resolve(d.toString().split('\n')[0]); });
}));
const fixtureUrl = fx.url;
console.error(`[harness] fixture pid=${fixtureChild.pid} url=${fixtureUrl}`);
const REAL_TEMP = 'E:/AI-Cache/tmp';
const baseEnv = { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), NODE_OPTIONS: process.env.NODE_OPTIONS, SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CLI_STATE_DIR: `${ISO}/state`, SUTRADHAR_CONFIG: 'none' };
let callNo = 0; const logs = []; let timedOut = false;
function cli(args) {
  callNo++;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ISO, env: baseEnv, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const log = `${LOGDIR}/${String(callNo).padStart(2, '0')}-${args[0]}.stderr.log`;
  writeFileSync(log, r.stderr ?? ''); logs.push(log);
  if (r.error) { timedOut = timedOut || r.error.code === 'ETIMEDOUT'; console.error(`[harness] call ${callNo} error=${r.error.code}`); }
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', args };
}
const out = { mode: MODE, cliSha256: sha(CLI), bundleSha256: sha(BUNDLE), mcpSha256: sha(MCP), checks: {} };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 400) : ''}`); };
const stateFile = `${ISO}/state/state.json`;
const readState = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return undefined; } };
const ev = (code, ...extra) => { const r = cli(['eval', code, ...extra]); return { ...r, value: r.stdout.replace(/\r?\n$/, '') }; };
const realTempNames = () => { try { return readdirSync(REAL_TEMP).filter((n) => n.startsWith('sutradhar-cli-')).sort(); } catch { return []; } };
const realTempBefore = realTempNames();
// `snap` prints `[#N] button "Go"`, `[#N] input "Name"`, `[#N] iframe role=clickable`, `[#N in iframe "fr" (...)] button "Frame Go"`.
const idOf = (snapText, re) => { const m = re.exec(snapText); return m ? m[1] : null; };
const parseIds = (snapText) => ({
  go: idOf(snapText, /^\[#(\d+)\] button "Go"/m),
  inp: idOf(snapText, /^\[#(\d+)\] input "Name"/m),
  ifr: idOf(snapText, /^\[#(\d+)\] iframe/m),
  fgo: idOf(snapText, /^\[#(\d+) in iframe "fr"[^\]]*\] button "Frame Go"/m),
});
const HINT = /node id/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); // the runtime rejects a duplicate click on the same target within 1000 ms

let fatal; let ids;
try {
  // ======================= CLI
  const nav = cli(['nav', `${fixtureUrl}/nodeid`]);
  check('cli nav exit 0', nav.code === 0, nav.stdout.slice(0, 60));
  const st = readState(); const udd = st?.userDataDir;
  check('state.userDataDir <= 200 chars and dirname == ISO', !!udd && udd.length <= 200 && norm(path.dirname(udd)) === norm(ISO), { len: udd?.length });
  // the <iframe> element is not an interactive element; tabindex makes it a real snapshot node with a real id (no manual id stamping)
  ev("document.getElementById('fr').setAttribute('tabindex','0')");
  const snap = cli(['snap']);
  ids = parseIds(snap.stdout); out.ids = ids;
  check('cli snap lists Go, Name input, the iframe and the in-frame button with ids', Object.values(ids).every((v) => v !== null), { ids, snap: snap.stdout.split('\n').slice(2, 9) });
  const goClicks = () => Number(ev('window.__goClicks').value);
  const frameClicks = () => Number(ev('window.__frameClicks || 0', '--frame', ids.ifr).value);
  const c0 = goClicks();
  check('cli counter starts at 0 (independent read via eval)', c0 === 0, c0);
  if (MODE === 'head') {
    const c1 = cli(['click', `#${ids.go}`]);
    check('S5-2 cli click "#<go>" exit 0 and __goClicks == 1', c1.code === 0 && goClicks() === 1, { code: c1.code, out: c1.stdout.slice(0, 80) });
    const c2 = cli(['click', `[#${ids.go}]`]);
    check('S5-2 cli click "[#<go>]" exit 0 and __goClicks == 2', c2.code === 0 && goClicks() === 2, { code: c2.code, out: c2.stdout.slice(0, 80) });
    const c3 = cli(['click', ids.go]);
    check('S5-2 control: cli click <bare number> still works (== 3)', c3.code === 0 && goClicks() === 3, { code: c3.code });
    const t1 = cli(['type', `#${ids.inp}`, 'hello']);
    const v1 = ev("document.getElementById('inp').value").value;
    check('S5-2 cli type "#<input>" hello -> value hello', t1.code === 0 && v1 === 'hello', { code: t1.code, v1 });
    const t2 = cli(['type', `[#${ids.inp}]`, 'world']);
    const v2 = ev("document.getElementById('inp').value").value;
    check('S5-2 cli type "[#<input>]" world -> value world', t2.code === 0 && v2 === 'world', { code: t2.code, v2 });
    const f1 = ev('document.title', '--frame', `#${ids.ifr}`);
    const f2 = ev('document.title', '--frame', `[#${ids.ifr}]`);
    const f0 = ev('document.title', '--frame', ids.ifr);
    check('S5-2 cli eval --frame "#<iframe>" -> iframe title (non-empty, differs from the top title)', f1.code === 0 && f1.value === f0.value && f1.value.length > 0 && f1.value !== 'Nodeid page', { f1: f1.value, f0: f0.value });
    check('S5-2 cli eval --frame "[#<iframe>]" -> same iframe title', f2.code === 0 && f2.value === f0.value, { f2: f2.value });
    // frame hop in a chain where a hop is a #N ref is exercised by the pure validateFrameChain unit test; here a single hop live.
    // an id for an element INSIDE the frame, as a click target, is resolved across frames
    const fc = cli(['click', `#${ids.fgo}`]);
    check('S5-2 cli click "#<in-frame button>" exit 0 and the frame counter == 1', fc.code === 0 && frameClicks() === 1, { code: fc.code, out: fc.stdout.slice(0, 80) });
    // negative cases that must STILL fail
    const n1 = cli(['click', `#${ids.go}]`]);
    check('S5 negative: "#N]" still rejected with the node-id hint (exit 1), counter unchanged', n1.code === 1 && HINT.test(n1.stderr) && goClicks() === 3, { code: n1.code, stderr: n1.stderr.split('\n').filter((l) => !l.startsWith('[')).slice(0, 2) });
    const n2 = cli(['click', `[#${ids.go}`]);
    check('S5 negative: "[#N" still rejected with the node-id hint (exit 1)', n2.code === 1 && HINT.test(n2.stderr), { code: n2.code });
  } else {
    const n1 = cli(['click', `#${ids.go}`]);
    check('S5-3 NEG061 cli click "#<go>" exit 1 with the node-id hint, counter unchanged', n1.code === 1 && HINT.test(n1.stderr) && goClicks() === 0, { code: n1.code, stderr: n1.stderr.split('\n').filter((l) => !l.startsWith('[iso-guard]')).slice(0, 2) });
    const n2 = cli(['click', `[#${ids.go}]`]);
    check('S5-3 NEG061 cli click "[#<go>]" exit 1 with the hint', n2.code === 1 && HINT.test(n2.stderr) && goClicks() === 0, { code: n2.code });
    const n3 = cli(['click', ids.go]);
    check('S5-3 NEG061 control: the bare number works (the counter is live)', n3.code === 0 && goClicks() === 1, { code: n3.code });
    const f1 = ev('document.title', '--frame', `#${ids.ifr}`);
    check('S5-3 NEG061 eval --frame "#<iframe>" fails', f1.code !== 0, { code: f1.code, stderr: f1.stderr.split('\n').filter((l) => !l.startsWith('[iso-guard]')).slice(0, 2) });
  }
} catch (e) { fatal = String(e?.stack ?? e); console.error('FATAL', fatal); }
finally { const c = cli(['close']); out.close = { code: c.code }; }

// ======================= MCP (stdio JSON-RPC)
async function mcpPart() {
  const t0 = performance.now();
  const child = spawn(process.execPath, [MCP], { cwd: ISO, stdio: ['pipe', 'pipe', 'pipe'], env: { ...baseEnv } });
  let exited = false; child.on('exit', () => { exited = true; });
  let buf = ''; const pending = new Map(); let nextId = 1; let stderr = '';
  child.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* log line */ } } });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++; const to = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, Math.max(1000, 240000 - (performance.now() - t0)));
    pending.set(id, (m) => { clearTimeout(to); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = async (name, args) => { const m = await call('tools/call', { name, arguments: args }); return { isError: m.result?.isError === true || !!m.error, text: m.result?.content?.[0]?.text ?? JSON.stringify(m.error ?? m) }; };
  try {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 's5-live', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const sessionId = JSON.parse((await tool('browser.launch', { headless: true })).text).sessionId;
    await tool('browser.navigate', { sessionId, url: `${fixtureUrl}/nodeid` });
    await tool('browser.eval', { sessionId, code: "document.getElementById('fr').setAttribute('tabindex','0')" });
    const sn = await tool('browser.snapshot', { sessionId });
    const mids = parseIds(sn.text); out.mcpIds = mids;
    check('mcp snapshot lists the ids', Object.values(mids).every((v) => v !== null), mids);
    const goN = async () => JSON.parse((await tool('browser.eval', { sessionId, code: 'window.__goClicks' })).text).result;
    if (MODE === 'head') {
      const r1 = await tool('browser.click', { sessionId, target: `#${mids.go}` });
      check('S5-2 mcp browser.click {target:"#<go>"} succeeds and __goClicks == 1', !r1.isError && (await goN()) === 1, { isError: r1.isError, text: r1.text.slice(0, 80) });
      await sleep(1200);
      const r2 = await tool('browser.click', { sessionId, target: `[#${mids.go}]` });
      check('S5-2 mcp browser.click {target:"[#<go>]"} succeeds and __goClicks == 2', !r2.isError && (await goN()) === 2, { isError: r2.isError });
      const r3 = await tool('browser.eval', { sessionId, code: 'document.title', frameSelector: `#${mids.ifr}` });
      const r3b = await tool('browser.eval', { sessionId, code: 'document.title', frameSelector: mids.ifr });
      check('S5-2 mcp browser.eval frameSelector "#<iframe>" -> iframe title', !r3.isError && r3.text === r3b.text && !r3.text.includes('Nodeid page'), { r3: r3.text.slice(0, 80), r3b: r3b.text.slice(0, 80) });
      const r4 = await tool('browser.click', { sessionId, target: `#${mids.go}]` });
      check('S5 negative mcp: "#N]" rejected (isError, node-id hint), counter unchanged', r4.isError && HINT.test(r4.text) && (await goN()) === 2, { text: r4.text.slice(0, 160) });
    } else {
      const r1 = await tool('browser.click', { sessionId, target: `#${mids.go}` });
      check('S5-3 NEG061 mcp browser.click {target:"#<go>"} isError with the hint, counter 0', r1.isError && HINT.test(r1.text) && (await goN()) === 0, { text: r1.text.slice(0, 160) });
    }
    check('mcp shutdown_all', !(await tool('browser.shutdown_all', {})).isError);
  } catch (e) { check('mcp noException', false, String(e?.stack ?? e)); }
  try { child.stdin.end(); } catch { /* ignore */ }
  const tw = performance.now(); while (!exited && performance.now() - tw < 15000) await new Promise((r) => setTimeout(r, 100));
  if (!exited) { out.mcpKilled = true; spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); }
  check('mcp child exited', exited);
}
await mcpPart();

// ======================= SDK (in-process)
async function sdkPart() {
  const sdk = await import(pathToFileURL(BUNDLE).href);
  const browser = await sdk.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${fixtureUrl}/nodeid`);
    await page.evaluate("document.getElementById('fr').setAttribute('tabindex','0')");
    const sn = await page.snapshot();
    const sids = parseIds(sn.interactiveElements); out.sdkIds = sids;
    check('sdk snapshot lists the ids', Object.values(sids).every((v) => v !== null), sids);
    const goN = () => page.evaluate('window.__goClicks');
    if (MODE === 'head') {
      await page.click(`#${sids.go}`);
      check('S5-2 sdk page.click("#<go>") -> __goClicks == 1', (await goN()) === 1);
      await sleep(1200);
      await page.click(`[#${sids.go}]`);
      check('S5-2 sdk page.click("[#<go>]") -> __goClicks == 2', (await goN()) === 2);
      const t = await page.evaluate('document.title', `#${sids.ifr}`);
      check('S5-2 sdk page.evaluate(expr, "#<iframe>") -> iframe title', typeof t === 'string' && t.length > 0 && t !== 'Nodeid page', t);
      let err; try { await page.click(`#${sids.go}]`); } catch (e) { err = e; }
      check('S5 negative sdk: "#N]" rejects with the node-id hint, counter unchanged', !!err && HINT.test(String(err.message)) && (await goN()) === 2, String(err?.message).slice(0, 160));
    } else {
      let err; try { await page.click(`#${sids.go}`); } catch (e) { err = e; }
      check('S5-3 NEG061 sdk page.click("#<go>") rejects with the hint, counter 0', !!err && HINT.test(String(err.message)) && (await goN()) === 0, String(err?.message).slice(0, 160));
    }
  } catch (e) { check('sdk noException', false, String(e?.stack ?? e)); }
  finally { await browser.close().catch((e) => { out.sdkCloseErr = String(e); }); }
}
await sdkPart();

// ======================= epilogue
if (timedOut && readState()?.chromePid) {
  const pid = readState().chromePid;
  const q = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8', timeout: 30000 });
  const owned = (q.stdout ?? '').toLowerCase().includes(path.basename(ISO).toLowerCase());
  out.timeoutKill = { pid, owned };
  if (owned) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', timeout: 30000 });
}
fixtureChild.stdin.write('quit\n');
await new Promise((r) => { const t = setTimeout(() => { fixtureChild.kill(); r(); }, 10000); fixtureChild.on('exit', () => { clearTimeout(t); r(); }); });
check('cli close: state.json removed', readState() === undefined);
const left = readdirSync(ISO).filter((n) => n.startsWith('sutradhar-cli-')); out.isoCliDirsLeft = left;
const realTempAfter = realTempNames();
out.realTemp = { before: realTempBefore.length, after: realTempAfter.length, vanished: realTempBefore.filter((x) => !realTempAfter.includes(x)) };
const pc = spawnSync(process.execPath, [`${SP}/iso/check-cleanup-paths.mjs`, ISO, ...logs], { encoding: 'utf8' });
out.pathCheck = { exit: pc.status, out: (pc.stdout ?? '').trim().split('\n').slice(-3) };
check('path-log check exit 0 (>= 1 [cleanup] line, none outside ISO)', pc.status === 0, out.pathCheck);
const q = spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like ('*' + $env:ISO_BASE + '*') } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', env: { ...process.env, ISO_BASE: path.basename(ISO) } });
const chromeLeft = (q.stdout ?? '').split(/\r?\n/).filter(Boolean);
check('attribution query: no Chrome with the ISO basename left', chromeLeft.length === 0, chromeLeft);
check('no timed-out CLI call', !timedOut);
out.fatal = fatal; out.allPass = !fatal && Object.values(out.checks).every((c) => c.ok);
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-NODEID OK' : 'LIVE-NODEID FAILED');
process.exitCode = out.allPass ? 0 : 1;
