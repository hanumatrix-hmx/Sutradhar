// AUDIT-3 live precedence / F1 / done-when check with independent observers (CLI, MCP, SDK).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const [REPO, S0] = process.argv.slice(2);
const CLI = path.join(REPO, 'packages/cli/dist/cli.js');
const BUNDLE_CLI = path.join(REPO, 'packages/sutradhar/dist/cli-bin.js');
const MCP = path.join(REPO, 'packages/mcp-server/dist/cli.js');
const S = path.join(S0, 'lp');
fs.rmSync(S, { recursive: true, force: true });
const mk = (p, cfg) => { const d = path.join(S, p); fs.mkdirSync(d, { recursive: true }); if (cfg) fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify(cfg)); return d; };
const P = mk('proj', { viewport: { width: 405, height: 305 }, allowedDomains: ['localhost'], dialog: { mode: 'accept', promptText: 'cfgtext' } });
fs.mkdirSync(path.join(P, '.git'));
const CHILD = mk(path.join('proj', 'sub', 'deeper'));
const RF = mk('refused', { downloadDir: '../outside' });
fs.mkdirSync(path.join(RF, '.git'));
const ENVROOT = mk('envroot');
const srvCode = "const s=require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>t</title><input type=file id=f>')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port));setTimeout(()=>process.exit(0),900000)";
const srvP = spawn(process.execPath, ['-e', srvCode], { stdio: ['ignore', 'pipe', 'inherit'] });
const PORT = await new Promise((ok) => srvP.stdout.once('data', (d) => ok(Number(String(d).trim()))));
const U_LOCAL = 'http://localhost:' + PORT + '/';
const U_IP = 'http://127.0.0.1:' + PORT + '/';
const chromePids = () => { try { const o = execFileSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*fr214a3*' } | ForEach-Object { $_.ProcessId }"], { encoding: 'utf8' }); return o.split(/\s+/).filter(Boolean).map(Number); } catch { return []; } };
const rows = [];
const baseEnv = { ...process.env, SUTRADHAR_CONFIG: '' };
for (const k of ['SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS']) delete baseEnv[k];
function cli(bin, cwd, args, env = {}) { const r = spawnSync(process.execPath, [bin, ...args], { cwd, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 120000 }); return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }; }
function row(name, ok, detail) { rows.push({ name, ok, detail: typeof detail === 'string' ? detail.slice(0, 300) : detail }); }
const before = chromePids();
for (const [bn, bin] of [['pkg', CLI], ['bundle', BUNDLE_CLI]]) {
  const st = { SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state-' + bn) };
  let r = cli(bin, CHILD, ['doctor'], st);
  row(bn + ' done-when: doctor in proj/sub/deeper names the PARENT config', r.out.includes(path.join(P, '.sutradhar.json')) && r.out.includes('viewport=config'), r.out.split('\n').filter((l) => l.startsWith('Config')).join(' | '));
  r = cli(bin, CHILD, ['nav', U_LOCAL], st); row(bn + ' nav localhost allowed by config', r.status === 0, r.err || r.out);
  r = cli(bin, CHILD, ['eval', 'innerWidth'], st); row(bn + ' config viewport -> innerWidth 405', /405/.test(r.out), r.out);
  r = cli(bin, CHILD, ['eval', "prompt('q')"], st); row(bn + ' config dialog accept+promptText -> prompt() returns cfgtext', r.out.includes('cfgtext'), r.out + ' ' + r.err);
  r = cli(bin, CHILD, ['nav', U_IP], st); row(bn + ' config allowlist blocks 127.0.0.1', r.status !== 0 && /blocked/i.test(r.err + r.out), r.err);
  r = cli(bin, CHILD, ['nav', U_IP], { ...st, SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.1' }); row(bn + ' env > config: 127.0.0.1 allowed', r.status === 0, r.err || r.out);
  r = cli(bin, CHILD, ['nav', U_IP, '--allowlist-domains', 'localhost'], { ...st, SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.1' }); row(bn + ' flag > env: blocked again', r.status !== 0 && /blocked/i.test(r.err + r.out), r.err);
  r = cli(bin, CHILD, ['close'], st);
  r = cli(bin, CHILD, ['nav', U_LOCAL, '--viewport', '401x301'], st); row(bn + ' flag viewport nav', r.status === 0, r.err);
  r = cli(bin, CHILD, ['eval', 'innerWidth'], st); row(bn + ' flag > config: innerWidth 401', /401/.test(r.out), r.out);
  r = cli(bin, CHILD, ['eval', "prompt('q')", '--dialog', 'dismiss'], st); row(bn + ' --dialog dismiss > config accept: prompt() -> null', /null/.test(r.out) && !r.out.includes('cfgtext'), r.out + ' ' + r.err);
  cli(bin, CHILD, ['close'], st);
  const pre = chromePids().length;
  r = cli(bin, RF, ['nav', U_LOCAL], { SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state-rf-' + bn) });
  row(bn + ' F1: refused discovered root, no higher layer -> exit 1 before Chrome', r.status === 1 && r.err.includes('outside this config') && chromePids().length === pre, r.err.slice(0, 200));
  r = cli(bin, RF, ['nav', U_LOCAL], { SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state-rf-' + bn), SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: ENVROOT });
  row(bn + ' F1: env overrides refused root + N8 warning', r.status === 0 && /were refused.*overridden by SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS/.test(r.err), r.err);
  r = cli(bin, RF, ['doctor'], { SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state-rf-' + bn), SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: ENVROOT });
  row(bn + ' F1: doctor shows downloadRoots=env', r.out.includes('downloadRoots=env'), r.out.split('\n').filter((l) => l.startsWith('Config')).join(' | '));
  r = cli(bin, RF, ['nav', U_LOCAL], { SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state-rf-' + bn), SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: ';;' });
  row(bn + ' F1: env ;; is unset -> still refused', r.status === 1 && r.err.includes('outside this config'), r.err.slice(0, 160));
  cli(bin, RF, ['close'], { SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state-rf-' + bn) });
}
async function mcpStart(cwd, env, ms) {
  const p = spawn(process.execPath, [MCP], { cwd, env: { ...baseEnv, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => (err += d));
  const exited = await new Promise((ok) => { const t = setTimeout(() => ok(null), ms); p.on('exit', (c) => { clearTimeout(t); ok(c); }); });
  if (exited === null) { p.stdin.end(); p.kill(); }
  return { pid: p.pid, exited, err };
}
{
  const pre = chromePids().length;
  let m = await mcpStart(RF, {}, 8000);
  row('mcp F1: refused discovered root, no higher layer -> fatal at startup, no Chrome', m.exited !== null && m.exited !== 0 && m.err.includes('outside this config') && chromePids().length === pre, 'pid ' + m.pid + ' exit ' + m.exited + ' ' + m.err.slice(0, 200));
  m = await mcpStart(RF, { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: ENVROOT }, 8000);
  row('mcp F1: env overrides + startup warning', m.exited === null && /warning: .*were refused.*overridden by SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS/.test(m.err), 'pid ' + m.pid + ' ' + m.err.slice(0, 300));
  m = await mcpStart(CHILD, {}, 8000);
  row('mcp banner names the parent config (searched upward)', m.err.includes(path.join(P, '.sutradhar.json')), m.err.split('\n')[0]);
}
{
  const sdk = await import(pathToFileURL(path.join(REPO, 'packages/sutradhar/dist/index.js')).href);
  const cwd0 = process.cwd();
  process.chdir(RF);
  const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    const pre = chromePids().length;
    let err;
    try { const b = await sdk.launch({ discoverConfig: true, headless: true }); await b.close(); } catch (e) { err = e.message; }
    row('sdk F1: discoverConfig in refused dir -> throws before Chrome', !!err && err.includes('outside this config') && chromePids().length === pre, String(err).slice(0, 200));
    const b = await sdk.launch({ discoverConfig: true, headless: true, allowedDownloadRoots: [ENVROOT] });
    await b.close();
    row('sdk F1: option overrides refused root + console.warn note', warns.some((w) => /were refused.*overridden by the allowedDownloadRoots option/.test(w)), warns.join(' | ').slice(0, 300));
  } finally { console.warn = ow; process.chdir(cwd0); }
}
const after = chromePids();
row('no Chrome left from this probe', after.filter((p) => !before.includes(p)).length === 0, { before, after });
srvP.kill();
console.log(JSON.stringify(rows, null, 1));
console.log('PASS', rows.filter((r) => r.ok).length, 'FAIL', rows.filter((r) => !r.ok).length);
process.exit(0);
