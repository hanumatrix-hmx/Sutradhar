// Auditor shared helpers for FR2-03 audit-1. Independent observer: raw PowerShell Get-CimInstance,
// no Sutradhar code imported.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, realpathSync, appendFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../../../../../..');
export const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
export const mcpPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export function makeRecorder(file) {
  const cases = [];
  const rec = (name, expected, observed, pass) => {
    const c = { name, expected, observed, pass, at: new Date().toISOString() };
    cases.push(c);
    appendFileSync(file, JSON.stringify(c) + '\n');
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : '  observed=' + JSON.stringify(observed).slice(0, 600)}`);
  };
  return { cases, rec };
}

export async function makeScratch(prefix) {
  const R = realpathSync.native(await mkdtemp(path.join(os.tmpdir(), prefix)));
  const temp = path.join(R, 'temp');
  const stateRoot = path.join(R, 'state-root');
  await mkdir(temp, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  for (let i = 1; i <= 9; i++) await mkdir(path.join(R, `cwd-${i}`), { recursive: true });
  const env = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp, SUTRADHAR_CLI_STATE_ROOT: stateRoot };
  delete env.SUTRADHAR_CLI_STATE_DIR;
  return { R, temp, stateRoot, env, cwd: (i) => path.join(R, `cwd-${i}`) };
}

export function runCli(args, env, cwd, timeoutMs = 90_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], { env, cwd, windowsHide: true });
    let stdout = '', stderr = '';
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => { clearTimeout(t); resolve({ stdout, stderr, code, pid: child.pid }); });
  });
}

export function spawnCli(args, env, cwd) {
  const child = spawn(process.execPath, [cliPath, ...args], { env, cwd, windowsHide: true });
  child.out = ''; child.err = '';
  child.stdout.on('data', (d) => (child.out += d));
  child.stderr.on('data', (d) => (child.err += d));
  child.exited = new Promise((r) => child.on('close', (code) => r(code)));
  return child;
}

/** Full process table: [{pid, ppid, cmd}] via raw CIM. */
export function observeAll() {
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8
Get-CimInstance Win32_Process | Select-Object @{n='p';e={$_.ProcessId}},@{n='pp';e={$_.ParentProcessId}},@{n='a';e={$_.CommandLine}} | ConvertTo-Json -Compress`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const arr = JSON.parse(out.trim());
  return (Array.isArray(arr) ? arr : [arr]).map((o) => ({ pid: o.p, ppid: o.pp, cmd: o.a ?? '' }));
}

/** Processes whose command line contains `sub` (case-insensitive) plus all their descendants. */
export function observeFor(sub, table = observeAll()) {
  const lower = sub.toLowerCase();
  const hit = new Set(table.filter((p) => p.cmd.toLowerCase().includes(lower)).map((p) => p.pid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of table) if (!hit.has(p.pid) && hit.has(p.ppid)) { hit.add(p.pid); grew = true; }
  }
  return table.filter((p) => hit.has(p.pid));
}

export function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function taskkill(pid, tree) {
  try { execFileSync('taskkill', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore' }); } catch {}
}

export async function waitUntil(fn, timeoutMs, pollMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return !!(await fn());
}

export async function readStates(stateRoot) {
  const out = [];
  for (const e of await readdir(stateRoot).catch(() => [])) {
    const f = path.join(stateRoot, e, 'state.json');
    if (existsSync(f)) {
      try { out.push({ dir: path.join(stateRoot, e), file: f, state: JSON.parse(await readFile(f, 'utf-8')) }); } catch {}
    }
  }
  return out;
}

export async function stateForCwd(stateRoot, cwd) {
  const all = await readStates(stateRoot);
  return all.find((s) => s.state.cwd && path.resolve(s.state.cwd).toLowerCase() === path.resolve(cwd).toLowerCase());
}

export function startFixtureServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><title>fr2-03-audit ${req.url}</title><h1>fixture</h1>`);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

/** Safety interlock: every kill userDataDir and deleteDir path in a GC report must be inside R. */
export function interlock(report, R) {
  const bad = [];
  const r = R.toLowerCase();
  for (const a of report.actions ?? []) {
    if (a.type === 'kill' && a.role === 'browser' && !(a.userDataDir ?? '').toLowerCase().startsWith(r)) bad.push(a);
    if (a.type === 'deleteDir' && !a.path.toLowerCase().startsWith(r)) bad.push(a);
  }
  return bad;
}

export function spawnDecoyChrome(udd) {
  const c = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`, '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' });
  c.unref();
  return c.pid;
}

export async function killEverythingUnder(R) {
  for (let i = 0; i < 3; i++) {
    const procs = observeFor(R);
    if (procs.length === 0) return 0;
    for (const p of procs) taskkill(p.pid, true);
    await new Promise((r) => setTimeout(r, 500));
  }
  return observeFor(R).length;
}
