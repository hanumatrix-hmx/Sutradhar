// AUDIT-3 viewport bounds live: MCP browser.launch argument, CLI --viewport, leak check by PID.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
const [REPO, S0, WHICH] = process.argv.slice(2);
const MCP = WHICH === 'bundle' ? path.join(REPO, 'packages/sutradhar/dist/mcp-cli.js') : path.join(REPO, 'packages/mcp-server/dist/cli.js');
const CLI = WHICH === 'bundle' ? path.join(REPO, 'packages/sutradhar/dist/cli-bin.js') : path.join(REPO, 'packages/cli/dist/cli.js');
const S = path.join(S0, 'vp-' + WHICH); fs.rmSync(S, { recursive: true, force: true }); fs.mkdirSync(path.join(S, '.git'), { recursive: true });
const LF = String.fromCharCode(10);
const chromePids = () => { try { const o = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*fr214a3*' } | ForEach-Object { $_.ProcessId }"], { encoding: 'utf8' }); return o.split(/\s+/).filter(Boolean).map(Number); } catch { return []; } };
const env = { ...process.env, SUTRADHAR_CONFIG: 'none', SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state'), SUTRADHAR_IDLE_TIMEOUT_MS: '0' };
const rows = [];
const p = spawn(process.execPath, [MCP], { cwd: S, env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; const waiters = new Map();
p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf(LF)) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch {} } });
p.stderr.on('data', () => {});
let id = 0;
const call = (method, params) => new Promise((ok, no) => { const my = ++id; const t = setTimeout(() => no(new Error('timeout')), 120000); waiters.set(my, (m) => { clearTimeout(t); ok(m); }); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: my, method, params }) + LF); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a3', version: '1' } });
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + LF);
const vps = { zero: { width: 0, height: 100 }, neg: { width: -1, height: 100 }, nanAsNull: { width: null, height: 100 }, float: { width: 100.5, height: 100 }, e9: { width: 1e9, height: 1e9 }, over: { width: 10000001, height: 100 }, str: { width: '100', height: 100 } };
for (const [n, vp] of Object.entries(vps)) {
  const pre = chromePids();
  const m = await call('tools/call', { name: 'browser.launch', arguments: { sessionId: 'v' + n, viewport: vp } });
  const txt = JSON.stringify(m.result ?? m.error).slice(0, 200);
  const post = chromePids();
  rows.push({ surface: 'mcp-' + WHICH, case: n, rejected: !!(m.error || m.result?.isError), newChrome: post.filter((x) => !pre.includes(x)).length, txt });
}
const pre2 = chromePids();
const okm = await call('tools/call', { name: 'browser.launch', arguments: { sessionId: 'vok', viewport: { width: 800, height: 600 }, headless: true } });
const during = chromePids().filter((x) => !pre2.includes(x)).length;
rows.push({ surface: 'mcp-' + WHICH, case: 'positive control 800x600', rejected: !!okm.result?.isError, newChromeDuring: during });
await call('tools/call', { name: 'browser.shutdown_all', arguments: {} });
p.stdin.end(); await new Promise((ok) => { p.on('exit', ok); setTimeout(ok, 15000); });
rows.push({ surface: 'mcp-' + WHICH, case: 'after shutdown_all', chromeLeft: chromePids().filter((x) => !pre2.includes(x)) });
for (const v of ['0x5', '5x0', '10000001x5', '-5x5', '1.5x5', 'abcxdef', '10000000x10000000']) {
  const pre = chromePids();
  const r = spawnSync(process.execPath, [CLI, 'nav', 'about:blank', '--viewport', v], { cwd: S, env, encoding: 'utf8', timeout: 180000 });
  spawnSync(process.execPath, [CLI, 'close'], { cwd: S, env, encoding: 'utf8', timeout: 60000 });
  const left = chromePids().filter((x) => !pre.includes(x));
  rows.push({ surface: 'cli-' + WHICH, case: '--viewport ' + v, status: r.status, err: (r.stderr || '').trim().slice(0, 160), chromeLeftAfterClose: left });
}
console.log(JSON.stringify(rows, null, 1));
process.exit(0);
