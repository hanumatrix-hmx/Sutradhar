// FR2-14 fix-1 own repro script for the audit-1 findings F1/F2/F3/F4/F8, against the BUILT artifacts (package dist + bundle).
// Every run uses its own scratch root (argv[2]) with TEMP/TMP pointed into it, so every Chrome profile and process is
// identifiable by that path. Chrome processes are only ever counted/killed by PID found via the scratch path (never by image name).
// Usage: node fix1-repros.mjs <scratch-root>      Prints one JSON line per check and a summary.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const S = path.resolve(process.argv[2]);
fs.mkdirSync(S, { recursive: true });
const BIN = {
  cliPkg: path.join(WT, 'packages/cli/dist/cli.js'),
  cliBundle: path.join(WT, 'packages/sutradhar/dist/cli-bin.js'),
  mcpPkg: path.join(WT, 'packages/mcp-server/dist/cli.js'),
  mcpBundle: path.join(WT, 'packages/sutradhar/dist/mcp-cli.js'),
};
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const rec = (id, pass, obs) => {
  rows.push({ id, pass: !!pass });
  console.log(JSON.stringify({ id, pass: !!pass, obs: String(obs).slice(0, 300) }));
};
function pidsReferencing(needle) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\n').filter((l) => l.toLowerCase().includes(needle.toLowerCase()) && !l.includes('Get-CimInstance')).map((l) => Number(l.split('\t')[0])).filter((n) => Number.isInteger(n) && n !== process.pid);
  } catch { return []; }
}
function killPids(pids) {
  for (const pid of pids) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
}
function envFor(root, extra = {}) {
  const e = { ...process.env, TEMP: path.join(root, 'temp'), TMP: path.join(root, 'temp'), TMPDIR: path.join(root, 'temp'), SUTRADHAR_CLI_STATE_DIR: path.join(root, 'state'), ...extra };
  for (const k of ['SUTRADHAR_CONFIG', 'SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS', 'SUTRADHAR_IDLE_TIMEOUT_MS']) if (!(k in extra)) delete e[k];
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}
function run(bin, args, cwd, env, ms = 60000) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [bin, ...args], { cwd, env });
    let stdout = '', stderr = '';
    cp.stdout.on('data', (d) => (stdout += d));
    cp.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => { try { cp.kill(); } catch { /* gone */ } }, ms);
    cp.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr }); });
  });
}
function scratch(name) {
  const root = path.join(S, name);
  fs.mkdirSync(path.join(root, 'temp'), { recursive: true });
  fs.mkdirSync(path.join(root, 'state'), { recursive: true });
  return root;
}
async function mcpAlive(bin, cwd, env) {
  const cp = spawn(process.execPath, [bin], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '', exited = false, code = null;
  cp.stderr.on('data', (d) => (stderr += d));
  cp.on('exit', (c) => { exited = true; code = c; });
  await delay(4000);
  const aliveAt4s = !exited;
  try { cp.kill(); } catch { /* gone */ }
  await delay(500);
  return { aliveAt4s, code, stderr };
}

// ───────── F1: env wins over an out-of-tree / .git discovered downloadDir, on all four binaries; no env still refuses ─────────
for (const [shape, content] of [['out-of-tree', { downloadDir: '../out' }], ['git-hooks', { downloadDir: '.git/hooks' }]]) {
  for (const [name, bin] of Object.entries(BIN)) {
    const root = scratch(`f1-${shape}-${name}`);
    const repo = path.join(root, 'r');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.sutradhar.json'), JSON.stringify(content));
    const envdl = path.join(root, 'envdl');
    fs.mkdirSync(envdl);
    const withEnv = envFor(root, { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl });
    const noEnv = envFor(root);
    if (name.startsWith('cli')) {
      const a = await run(bin, ['nav', 'about:blank'], path.join(repo, 'sub'), withEnv);
      const c = await run(bin, ['close'], path.join(repo, 'sub'), withEnv);
      const b = await run(bin, ['nav', 'about:blank'], path.join(repo, 'sub'), noEnv);
      const left = pidsReferencing(root);
      killPids(left);
      rec(`F1/${shape}/${name}/env-wins`, a.code === 0 && c.code === 0 && left.length === 0, `exit=${a.code} close=${c.code} chromeLeft=${left.length} ${a.stderr.split('\n')[0].slice(0, 100)}`);
      rec(`F1/${shape}/${name}/no-env-refused`, b.code === 1 && b.stderr.includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS') && !fs.existsSync(path.join(root, 'out')), `exit=${b.code} ${b.stderr.split('\n')[0].slice(0, 80)}`);
    } else {
      const a = await mcpAlive(bin, path.join(repo, 'sub'), withEnv);
      const b = await mcpAlive(bin, path.join(repo, 'sub'), noEnv);
      rec(`F1/${shape}/${name}/env-wins`, a.aliveAt4s && a.stderr.includes('config: loaded'), `aliveAt4s=${a.aliveAt4s} ${a.stderr.split('\n')[0].slice(0, 100)}`);
      rec(`F1/${shape}/${name}/no-env-refused`, !b.aliveAt4s && b.code === 1 && b.stderr.includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS'), `alive=${b.aliveAt4s} code=${b.code}`);
    }
  }
}

// ───────── F2: null option is "not set" (function level on the built dists) ─────────
{
  const mcp = await import(pathToFileURL(path.join(WT, 'packages/mcp-server/dist/server.js')).href);
  const keep = process.env.SUTRADHAR_ALLOWED_DOMAINS;
  process.env.SUTRADHAR_ALLOWED_DOMAINS = 'e.test';
  try {
    for (const [label, opt] of [['null', null], ['undefined', undefined], ['empty-array', []]]) {
      const { runtime } = await mcp.createSutradharServer({ allowedDomains: opt, disableAgent: true });
      const got = runtime.allowedDomains;
      rec(`F2/MCP.allowedDomains=${label}+env`, JSON.stringify(got) === JSON.stringify(['e.test']), `runtime.allowedDomains=${JSON.stringify(got)}`);
      await runtime.shutdownAll?.().catch(() => {});
    }
  } finally {
    if (keep === undefined) delete process.env.SUTRADHAR_ALLOWED_DOMAINS; else process.env.SUTRADHAR_ALLOWED_DOMAINS = keep;
  }
}

// ───────── F3: a junction cwd inside HOME does not read a config above HOME (CLI doctor, both builds) ─────────
for (const name of ['cliPkg', 'cliBundle']) {
  const root = scratch(`f3-${name}`);
  fs.mkdirSync(path.join(root, 'top', 'home'), { recursive: true });
  fs.mkdirSync(path.join(root, 'top', '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'top', '.sutradhar.json'), JSON.stringify({ viewport: { width: 5, height: 5 } }));
  fs.mkdirSync(path.join(root, 'elsewhere', 'deep'), { recursive: true });
  const link = path.join(root, 'top', 'home', 'link');
  try { fs.symlinkSync(path.join(root, 'elsewhere', 'deep'), link, 'junction'); } catch (e) { rec(`F3/${name}`, true, `SKIPPED ${e.code}`); continue; }
  const home = path.join(root, 'top', 'home');
  const d = await run(BIN[name], ['doctor'], link, envFor(root, { USERPROFILE: home, HOME: home }));
  const line = d.stdout.split('\n').find((l) => l.startsWith('Config:')) ?? '';
  rec(`F3/${name}`, d.code === 0 && line.includes('none (searched') && line.includes('stopped at home') && !d.stdout.includes('.sutradhar.json'), line);
}

// ───────── F4: a 20 KB unknown key prints a short warning ─────────
for (const name of ['cliPkg', 'cliBundle']) {
  const root = scratch(`f4-${name}`);
  const repo = path.join(root, 'r');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sutradhar.json'), '{"' + 'k'.repeat(20000) + '": 1}');
  const d = await run(BIN[name], ['doctor'], repo, envFor(root));
  const line = d.stdout.split('\n').find((l) => l.startsWith('Config warning:')) ?? '';
  rec(`F4/${name}`, d.code === 0 && line.length > 0 && line.length < 400 && line.includes('...'), `warningLength=${line.length}`);
}

// ───────── F8: huge viewport (file and flag) is rejected before Chrome, no Chrome left ─────────
for (const name of ['cliPkg', 'cliBundle']) {
  for (const via of ['file', 'flag']) {
    const root = scratch(`f8-${via}-${name}`);
    const repo = path.join(root, 'r');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    if (via === 'file') fs.writeFileSync(path.join(repo, '.sutradhar.json'), JSON.stringify({ viewport: { width: 1000000000, height: 1000000000 } }));
    const args = ['nav', 'about:blank', ...(via === 'flag' ? ['--viewport', '1000000000x1000000000'] : [])];
    const r = await run(BIN[name], args, repo, envFor(root));
    // a SECOND command is only meaningful for the file case (the file applies to every command); with the flag case it would be a
    // legitimate fresh session, whose Chrome is not a leak.
    const e2 = via === 'file' ? await run(BIN[name], ['eval', '1'], repo, envFor(root)) : { code: 1 };
    const left = pidsReferencing(root);
    killPids(left);
    const dirs = fs.readdirSync(path.join(root, 'temp')).filter((n) => n.startsWith('sutradhar-cli-'));
    rec(`F8/${via}/${name}`, r.code === 1 && e2.code === 1 && left.length === 0 && dirs.length === 0 && !fs.existsSync(path.join(root, 'state', 'state.json')), `exit=${r.code}/${e2.code} chromePidsLeft=${left.length} profileDirs=${dirs.length} ${r.stderr.split('\n')[0].slice(0, 100)}`);
  }
}

const failed = rows.filter((r) => !r.pass);
console.log(JSON.stringify({ summary: { total: rows.length, passed: rows.length - failed.length, failed: failed.map((f) => f.id) } }));
process.exitCode = failed.length ? 1 : 0;
