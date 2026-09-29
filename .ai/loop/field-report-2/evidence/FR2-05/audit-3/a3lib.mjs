// FR2-05 audit-3 shared harness. Independent of the executor's scripts (auditor-written).
//
// Safety rules enforced here, not just by convention:
//  - every process this harness spawns is tracked by PID and killed by PID (tree) only;
//    `killByCommandLine` only ever matches command lines containing THIS run's own mkdtemp root R;
//  - `fsutil setCaseSensitiveInfo` is wrapped by `setCase`, which throws unless the target
//    directory is strictly inside R (never a system/user path);
//  - every downloaded filename carries TAG; the user's real ~/Downloads is snapshotted and any
//    TAG-named file there is recorded and removed immediately by `sweepUserDownloads`.
import fs from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.join(HERE, '..', '..', '..', '..', '..', '..');
export const MCP_PATH = path.join(REPO, 'packages', 'mcp-server', 'dist', 'cli.js');
export const CLI_PATH = path.join(REPO, 'packages', 'cli', 'dist', 'cli.js');
export const USER_DOWNLOADS = path.join(os.homedir(), 'Downloads');
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const TAG = `a3x${Date.now().toString(36)}`;

// ---------- results ----------
export function makeRecorder() {
  const results = [];
  const record = (e) => {
    results.push(e);
    console.log(`[${e.pass ? 'PASS' : 'FAIL'}] ${e.id}${e.detail ? ' -- ' + e.detail : ''}`);
  };
  return { results, record };
}

// ---------- temp root ----------
export async function makeRoot(label) {
  const R = await fs.mkdtemp(path.join(os.tmpdir(), `fr205-a3-${label}-`));
  return R;
}
export function isStrictlyInside(p, R) {
  const a = path.resolve(p).toLowerCase();
  const b = path.resolve(R).toLowerCase();
  return a.startsWith(b + path.sep);
}

// ---------- processes ----------
const children = new Set();
export function track(cp) { children.add(cp); cp.on('exit', () => children.delete(cp)); return cp; }
export async function killTracked() {
  for (const cp of [...children]) {
    if (!cp.pid || cp.exitCode !== null) continue;
    const exited = new Promise((r) => cp.once('exit', r));
    try { process.kill(cp.pid); } catch { continue; }
    if (await Promise.race([exited.then(() => false), delay(3000).then(() => true)])) {
      try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
      await Promise.race([exited, delay(2000)]);
    }
  }
}
/** Lists processes whose command line contains R (this run's own temp root). try/catch-wrapped. */
export function processesMentioning(R) {
  try {
    const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${R.replace(/'/g, "''")}') -and $_.ProcessId -ne $PID } | ForEach-Object { \"$($_.ProcessId)|$($_.Name)\" }`;
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60000 });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    return [`LIST-ERROR ${String(e.message).slice(0, 100)}`];
  }
}
/** Kills (by PID, tree) only processes whose command line contains R. */
export function killByCommandLine(R) {
  const found = processesMentioning(R).filter((l) => !l.startsWith('LIST-ERROR'));
  for (const l of found) {
    const pid = Number(l.split('|')[0]);
    if (pid && pid !== process.pid) {
      try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
  }
  return found;
}

// ---------- shell helpers ----------
export function cmd(line) {
  try {
    return { ok: true, out: execFileSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { encoding: 'utf8', windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) { return { ok: false, out: String(e.stderr ?? e.message).trim().slice(0, 200) }; }
}
export function junction(link, target) { return cmd(`mklink /J "${link}" "${target}"`); }
/** fsutil case-sensitivity toggle, restricted to directories strictly inside R. */
export function setCase(R, dir, on) {
  if (!isStrictlyInside(dir, R)) throw new Error(`setCase refused: ${dir} is not inside ${R}`);
  try {
    const out = execFileSync('fsutil', ['file', 'setCaseSensitiveInfo', dir, on ? 'enable' : 'disable'], { encoding: 'utf8' }).trim();
    return { ok: /is (enabled|disabled)\.?$/i.test(out), out };
  } catch (e) { return { ok: false, out: String(e.stdout || e.stderr || e.message).trim() }; }
}
export function queryCase(dir) {
  try { return execFileSync('fsutil', ['file', 'queryCaseSensitiveInfo', dir], { encoding: 'utf8' }).trim(); } catch (e) { return 'ERR ' + String(e.stdout || e.message).trim(); }
}

// ---------- fixture server (auditor-owned; superset of the repo fixture) ----------
// /page?case&name[&delay][&busy]  -> #dl (plain file), #slow (/file with header delay), #busy (busy-waits in onclick, then navigates)
// /file?case&name[&delay]         -> attachment, unique random body, headers delayed by `delay` ms
export async function startFixture() {
  const served = [];
  let req = 0;
  const sockets = new Set();
  const server = http.createServer((rq, res) => {
    const u = new URL(rq.url ?? '/', 'http://x');
    if (u.pathname === '/page') {
      const c = u.searchParams.get('case') ?? '0';
      const name = u.searchParams.get('name') ?? `${c}.bin`;
      const d = u.searchParams.get('delay') ?? '0';
      const busy = Number(u.searchParams.get('busy') ?? '0');
      const f = (extra = '') => `/file?case=${encodeURIComponent(c)}&name=${encodeURIComponent(name)}${extra}`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>a3 ${c}</title></head><body>` +
        `<a id="dl" href="${f()}">download</a> ` +
        `<a id="slow" href="${f(`&delay=${d}`)}">slow</a> ` +
        `<button id="busy" onclick="var e=Date.now()+${busy};while(Date.now()<e){};location.href='${f(`&delay=${d}`)}'">busy</button>` +
        `<input type="file" id="f"><button id="pick" onclick="document.getElementById('f').click()">pick</button><div id="out"></div>` +
        `<script>document.getElementById('f').addEventListener('change',function(e){var x=e.target.files[0];document.getElementById('out').textContent=x?(x.name+':'+x.size):''});</script>` +
        `</body></html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }
    if (u.pathname === '/file') {
      const c = u.searchParams.get('case') ?? '0';
      const name = u.searchParams.get('name') ?? 'file.bin';
      const d = Number(u.searchParams.get('delay') ?? '0');
      const n = ++req;
      const arrivedAt = Date.now();
      const send = () => {
        const body = Buffer.concat([Buffer.from(`fr2-05 audit-3 case=${c} req=${n}\n`), crypto.randomBytes(65536)]);
        served.push({ caseId: c, req: n, name, size: body.length, sha256: crypto.createHash('sha256').update(body).digest('hex'), arrivedAt, sentAt: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': String(body.length), 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
        res.end(body);
      };
      if (d > 0) setTimeout(send, d); else send();
      return;
    }
    res.writeHead(404); res.end('nf');
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin, port, served,
    pageUrl: (c, o = {}) => `${o.host ? `http://${o.host}:${port}` : origin}/page?case=${encodeURIComponent(c)}&name=${encodeURIComponent(o.name ?? `${c}.bin`)}${o.delay ? `&delay=${o.delay}` : ''}${o.busy ? `&busy=${o.busy}` : ''}`,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

// ---------- MCP client ----------
export function mcp(env, label = 'a3') {
  const child = track(spawn(process.execPath, [MCP_PATH], { stdio: ['pipe', 'pipe', 'pipe'], env }));
  let buf = ''; let id = 1; const pending = new Map(); const stderr = [];
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    }
  });
  child.stderr.on('data', (d) => stderr.push(d.toString('utf8')));
  const call = (method, params, t = 300000) => new Promise((resolve, reject) => {
    const n = id++; pending.set(n, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`timeout ${method}`)); } }, t);
  });
  const tool = async (name, args, t) => {
    const r = await call('tools/call', { name, arguments: args }, t);
    const text = r.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { success: false, error: text, isError: r.isError }; }
  };
  const init = async () => {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: `fr2-05-${label}`, version: '0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  };
  /** end the process WITHOUT shutdown_all (browser stays up) -- used to model a process exiting/disconnecting */
  const exitOnly = async () => { child.stdin.end(); if (!(await Promise.race([new Promise((r) => child.once('exit', () => r(true))), delay(10000).then(() => false)]))) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} } };
  const close = async () => { try { await tool('browser.shutdown_all', {}, 30000); } catch {} await exitOnly(); };
  return { child, tool, init, close, exitOnly, stderr };
}

// ---------- CLI ----------
export function cli(args, env, cwd, t = 200000) {
  return new Promise((resolve) => {
    const cp = track(spawn(process.execPath, [CLI_PATH, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] }));
    let out = '', err = '';
    cp.stdout.on('data', (d) => (out += d)); cp.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => { try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }, t);
    cp.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

// ---------- Chrome for attach scenarios ----------
export async function spawnChrome(udd) {
  const chromeDir = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  const ver = readdirSync(chromeDir).find((d) => d.startsWith('win64'));
  const exe = path.join(chromeDir, ver, 'chrome-win64', 'chrome.exe');
  const chrome = track(spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' }));
  let port, wsPath;
  for (let i = 0; i < 80 && !port; i++) {
    await delay(250);
    try { const t = (await fs.readFile(path.join(udd, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/); port = t[0].trim(); wsPath = t[1].trim(); } catch {}
  }
  return { chrome, port, wsPath, httpEndpoint: `http://127.0.0.1:${port}` };
}

// ---------- file finding / user Downloads ----------
export const sha = async (f) => crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
export function findName(name, dirs, maxDepth = 10) {
  const hits = [];
  const walk = (d, depth) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.name === name || e.name.startsWith(name.replace(/\.bin$/, '')) && e.name.endsWith('.bin') && e.name.includes(' (')) hits.push(p);
      if (e.isDirectory() && !e.isSymbolicLink() && depth < maxDepth) walk(p, depth + 1);
    }
  };
  for (const d of dirs) walk(d, 0);
  return hits;
}
export function userDownloadsTagged() {
  try { return readdirSync(USER_DOWNLOADS).filter((n) => n.includes(TAG)); } catch { return []; }
}
export function userDownloadsCount() { try { return readdirSync(USER_DOWNLOADS).length; } catch { return -1; } }
/** Records + removes any TAG file in the real ~/Downloads. Returns the list removed. */
export async function sweepUserDownloads() {
  const stray = userDownloadsTagged();
  for (const s of stray) await fs.rm(path.join(USER_DOWNLOADS, s), { force: true }).catch(() => {});
  return stray;
}
export const insideCI = (p, root) => p.toLowerCase().startsWith(root.toLowerCase() + path.sep) || p.toLowerCase() === root.toLowerCase();
/** exact (case-SENSITIVE) containment -- what matters in a case-sensitive directory */
export const insideCS = (p, root) => p.startsWith(root + path.sep) || p === root;

export async function rmTree(R) {
  // unlink junctions first (rmdir on a junction removes the link, not the target)
  const walk = (d) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) { try { execFileSync('cmd.exe', ['/d', '/c', 'rmdir', p], { stdio: 'ignore' }); } catch {} }
      else if (e.isDirectory()) walk(p);
    }
  };
  walk(R);
  for (let i = 0; i < 15 && existsSync(R); i++) {
    await fs.rm(R, { recursive: true, force: true }).catch(() => {});
    if (existsSync(R)) await delay(500);
  }
  if (existsSync(R)) cmd(`rmdir /s /q "\\\\?\\${R}"`);
  return !existsSync(R);
}
export { fs, path, os, existsSync, readdirSync, statSync };
