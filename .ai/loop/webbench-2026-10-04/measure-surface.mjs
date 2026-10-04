// Measures the browser fingerprint each 0.6.1 surface produces on this machine (review-1 finding 2).
// Read-only. Navigates to https://example.com only. Uses an isolated TEMP and state dir, shuts down
// its own sessions, kills nothing by name.
// Usage: node measure-surface.mjs <installDir> <workDir>
//   installDir = dir containing node_modules/sutradhar (published 0.6.1)
//   workDir    = scratch dir (short path); creates <workDir>/{s,t,c}
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const [installDir, workDir] = process.argv.slice(2);
const pkg = path.join(installDir, 'node_modules', 'sutradhar', 'dist');
const dirs = { s: path.join(workDir, 's'), t: path.join(workDir, 't'), c: path.join(workDir, 'c') };
for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
const env = { ...process.env, TEMP: dirs.t, TMP: dirs.t, SUTRADHAR_CLI_STATE_DIR: dirs.s, SUTRADHAR_CONFIG: 'none' };
const FP = "JSON.stringify({webdriver:navigator.webdriver,ua:navigator.userAgent,uaBrands:(navigator.userAgentData&&navigator.userAgentData.brands.map(b=>b.brand+' '+b.version).join('; '))||null,inner:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],screen:[screen.width,screen.height],dpr:devicePixelRatio,languages:navigator.languages,plugins:navigator.plugins.length,hardwareConcurrency:navigator.hardwareConcurrency})";

// --- CLI surface
const cli = (...a) => spawnSync(process.execPath, [path.join(pkg, 'cli-bin.js'), ...a], { cwd: dirs.c, env, encoding: 'utf8', timeout: 120000 });
const n = cli('nav', 'https://example.com');
const e = cli('eval', FP);
const c = cli('close');
console.log('CLI nav exit', n.status, '| eval exit', e.status, '| close exit', c.status);
console.log('CLI fingerprint', e.stdout.trim());

// --- MCP surface (published mcp-cli.js over stdio JSON-RPC)
const p = spawn(process.execPath, [path.join(pkg, 'mcp-cli.js')], { cwd: dirs.c, env, stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
p.stdout.on('data', (d) => { buf += d; });
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
const waitId = (id, ms = 90000) => new Promise((res, rej) => {
  const t0 = performance.now();
  const iv = setInterval(() => {
    const m = buf.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o && o.id === id);
    if (m) { clearInterval(iv); res(m); } else if (performance.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout id ' + id)); }
  }, 100);
});
const call = async (id, name, args) => { send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }); return waitId(id); };
const text = (r) => (r.result?.content ?? []).filter((x) => x.type === 'text').map((x) => x.text).join('\n');
try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'measure', version: '0' } } });
  const init = await waitId(1);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  console.log('MCP serverInfo', JSON.stringify(init.result?.serverInfo));
  const l = await call(2, 'browser.launch', { sessionId: 'wb1004-measure', initialUrl: 'https://example.com' });
  console.log('MCP launch', text(l).slice(0, 200).replace(/\s+/g, ' '));
  const ev = await call(3, 'browser.eval', { sessionId: 'wb1004-measure', code: FP });
  console.log('MCP fingerprint', text(ev).trim());
  const sd = await call(4, 'browser.shutdown', { sessionId: 'wb1004-measure' });
  console.log('MCP shutdown', text(sd).slice(0, 120).replace(/\s+/g, ' '));
} finally {
  p.stdin.end();
  await new Promise((r) => setTimeout(r, 1500));
  if (p.exitCode === null) p.kill(); // our own child PID only
}
console.log('leftover state.json:', existsSync(path.join(dirs.s, 'state.json')), '| TEMP entries:', readdirSync(dirs.t).filter((x) => x.startsWith('sutradhar-cli-')).length);
