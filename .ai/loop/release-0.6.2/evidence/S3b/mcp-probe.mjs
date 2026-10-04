// Live MCP probe (S3a; S11 reuses it UNMODIFIED). Run under the ISOLATION PREAMBLE (Git Bash form).
// Env in:  SP (scratchpad root, forward slashes), WT (worktree root), EXPECT_VERSION (default 0.6.0), EXPECT_TOOLS (default 73)
// What it does: asserts os.tmpdir() is under the scratchpad, spawns process.execPath with the ABSOLUTE path to
// <WT>/packages/sutradhar/dist/mcp-cli.js (SUTRADHAR_CONFIG=none, cwd = tmpdir), then over stdio:
//   initialize (2025-06-18) -> notifications/initialized -> tools/list -> browser.launch {headless:true}
//   -> browser.navigate to its OWN 127.0.0.1 server -> browser.shutdown_all. 120 s hard limit (performance.now()).
// Kills only the child PID it started, and confirms the exit. Prints one JSON summary; exit 0 only if every check passed.
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP; const WT = process.env.WT;
if (!SP || !WT) { console.error('probe needs SP and WT env'); process.exit(2); }
const tmp = norm(os.tmpdir());
if (!tmp.startsWith(norm(SP) + '/')) { console.error(`ISOLATION GUARD (probe): os.tmpdir()=${tmp} not under ${norm(SP)}`); process.exit(97); }
console.error(`[probe-guard] tmpdir=${tmp} pid=${process.pid}`);

const EXPECT_VERSION = process.env.EXPECT_VERSION ?? '0.6.0';
const EXPECT_TOOLS = Number(process.env.EXPECT_TOOLS ?? 73);
const MCP = path.join(WT, 'packages', 'sutradhar', 'dist', 'mcp-cli.js');
console.error(`[probe] mcp-cli=${MCP}`);

let hits = 0; const hitPaths = [];
const server = http.createServer((req, res) => { hits++; hitPaths.push(req.url); res.setHeader('content-type', 'text/html'); res.end('<html><head><title>S3a-probe-title</title></head><body><h1 id="x">probe-ok</h1></body></html>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const t0 = performance.now();
const child = spawn(process.execPath, [MCP], {
  cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, SUTRADHAR_CONFIG: 'none', TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir() },
});
const childPid = child.pid; let exited = false; let exitInfo = null;
child.on('exit', (code, sig) => { exited = true; exitInfo = { code, sig }; });
let buf = ''; const pending = new Map(); let nextId = 1; let stderr = '';
child.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* non-json */ } } });
child.stderr.on('data', (d) => { stderr += d.toString(); });
const remaining = () => 120000 - (performance.now() - t0);
const call = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++; const to = setTimeout(() => { pending.delete(id); reject(new Error(`timeout waiting for ${method}`)); }, Math.max(1000, remaining()));
  pending.set(id, (m) => { clearTimeout(to); resolve(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const tool = async (name, args) => { const m = await call('tools/call', { name, arguments: args }); const t = m.result?.content?.[0]?.text ?? JSON.stringify(m); let j; try { j = JSON.parse(t); } catch { j = { raw: t }; } return { j, isError: m.result?.isError === true, text: t }; };

const out = { checks: {}, mcpCli: MCP, port, childPid };
let ok = true; const check = (k, v, detail) => { out.checks[k] = v ? 'PASS' : 'FAIL'; if (detail !== undefined) out[k] = detail; if (!v) ok = false; };
let sessionId;
try {
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 's3a-probe', version: '1' } });
  out.serverInfo = init.result?.serverInfo; out.protocolVersion = init.result?.protocolVersion;
  check('version', init.result?.serverInfo?.version === EXPECT_VERSION, init.result?.serverInfo?.version);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tl = await call('tools/list', {}); const names = (tl.result?.tools ?? []).map((t) => t.name);
  check('toolCount', names.length === EXPECT_TOOLS, names.length);
  check('hasWaitFor', names.includes('browser.wait_for'));
  const launch = await tool('browser.launch', { headless: true });
  sessionId = launch.j.sessionId; out.launch = launch.j;
  check('launch', !launch.isError && typeof sessionId === 'string' && sessionId.length > 0);
  const nav = await tool('browser.navigate', { sessionId, url: `http://127.0.0.1:${port}/s3a-probe` });
  out.navigate = nav.j;
  check('navigateNoError', !nav.isError);
  check('serverSawRequest', hits >= 1 && hitPaths.includes('/s3a-probe'), { hits, hitPaths });
  check('navigateResultMentionsPage', /s3a-probe/.test(nav.text) || /S3a-probe-title/.test(nav.text) || /127\.0\.0\.1/.test(nav.text));
  const sd = await tool('browser.shutdown_all', {}); out.shutdown_all = sd.j;
  check('shutdownAll', !sd.isError);
} catch (e) {
  check('noException', false, String(e && e.message || e));
}
// end: close stdin so the server exits on its own, wait up to 15 s, then kill ONLY our child PID tree.
try { child.stdin.end(); } catch { /* ignore */ }
const tw = performance.now();
while (!exited && performance.now() - tw < 15000) await new Promise((r) => setTimeout(r, 100));
if (!exited) {
  out.killedChild = true;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(childPid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(childPid, 'SIGKILL'); } catch { /* gone */ } }
  const tk = performance.now(); while (!exited && performance.now() - tk < 15000) await new Promise((r) => setTimeout(r, 100));
}
check('childExited', exited, exitInfo);
// attribution query: any process whose command line contains the probe's tmp basename (our Chrome profile dirs live under it)
if (process.platform === 'win32') {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like ('*' + $env:PROBE_BASE + '*') } | Select-Object ProcessId,Name | ConvertTo-Json -Compress"], { env: { ...process.env, PROBE_BASE: path.basename(os.tmpdir()) }, encoding: 'utf-8' });
  const s = (r.stdout || '').trim(); out.leftoverProcesses = s === '' ? [] : JSON.parse(s);
  const left = Array.isArray(out.leftoverProcesses) ? out.leftoverProcesses : [out.leftoverProcesses];
  check('noLeftoverChromeUnderTmp', left.length === 0, left);
}
server.close();
out.elapsedMs = Math.round(performance.now() - t0);
out.stderrTail = stderr.split(/\r?\n/).filter(Boolean).slice(-8);
console.log(JSON.stringify(out, null, 2));
process.exit(ok ? 0 : 1);
