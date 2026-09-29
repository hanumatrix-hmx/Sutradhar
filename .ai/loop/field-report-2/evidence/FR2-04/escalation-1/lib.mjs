// FR2-04 audit-3 shared helpers (derived from audit-2/lib.mjs). Every process this harness creates
// lives under one scratch root R (state dirs, TEMP for Chrome profiles); cleanup only ever kills
// PIDs whose command line contains R, or wardens whose payload stateFile is under R, or CLI child
// PIDs this harness spawned itself. Never by image name. Process listing is try/catch-wrapped so
// a failing listing can never skip the rest of cleanup (audit-2's cleanup crashed that way).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
export const CLI_DEFAULT = path.join(repoRoot, 'packages/cli/dist/cli.js');
export const puppeteer = createRequire(path.join(repoRoot, 'packages/browser/package.json'))('puppeteer-core');
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const spawnedPids = new Set();

export async function makeRoot(tag) {
  const R = await fs.mkdtemp(path.join(os.tmpdir(), `fr2-04-audit4-${tag}-`));
  const TEMP = path.join(R, 'temp');
  await fs.mkdir(TEMP, { recursive: true });
  const rReal = await fs.realpath(R);
  return { R, TEMP, rReal };
}

export function makeCli(root, cliPath = CLI_DEFAULT) {
  return function cli(args, dir, { capMs = 60000, env = {} } = {}) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const child = spawn(process.execPath, [cliPath, ...args], {
        env: { ...process.env, TEMP: root.TEMP, TMP: root.TEMP, SUTRADHAR_CLI_STATE_DIR: dir, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      spawnedPids.add(child.pid);
      let out = '', err = '', killed = false;
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      const cap = setTimeout(() => { killed = true; taskkill(child.pid); }, capMs);
      child.on('exit', (code) => { clearTimeout(cap); spawnedPids.delete(child.pid); resolve({ args: args.join(' '), code, ms: Date.now() - t0, killedAtCap: killed, stdout: out, stderr: err }); });
    });
  };
}

export const readJson = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf-8')); } catch { return undefined; } };
export const readState = (d) => readJson(path.join(d, 'state.json'));
export const readWarden = (d) => readJson(path.join(d, 'warden.json'));

export function procs() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @(\'chrome.exe\',\'node.exe\') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"', { encoding: 'utf-8', maxBuffer: 64 << 20 });
    const p = JSON.parse(out || '[]'); return Array.isArray(p) ? p : [p];
  } catch { return []; }
}
export function wardensUnder(root, list = procs()) {
  return list.filter((p) => /__dialog-warden/.test(p.CommandLine || '')).map((p) => {
    const m = /__dialog-warden\s+(\S+)/.exec(p.CommandLine); let d = {};
    try { d = JSON.parse(Buffer.from(m[1], 'base64url').toString()); } catch {}
    return { pid: p.ProcessId, stateFile: d.stateFile || '' };
  }).filter((w) => w.stateFile.startsWith(root.R) || w.stateFile.startsWith(root.rReal));
}
export const chromeUnder = (root, list = procs()) => list.filter((p) => /chrome\.exe/i.test(p.Name || '') && ((p.CommandLine || '').includes(root.rReal) || (p.CommandLine || '').includes(root.R))).map((p) => p.ProcessId);
export const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const taskkill = (pid, tree = false) => { try { execSync(`taskkill /PID ${pid} /F${tree ? ' /T' : ''}`, { stdio: 'ignore' }); } catch {} };

export async function cleanupRoot(root, cli, dirs) {
  for (const d of dirs) { try { await cli(['close'], d, { capMs: 20000 }); } catch {} }
  await delay(2500);
  let leftovers = { wardens: [], chrome: [], cliChildren: [] };
  try {
    const list = procs();
    const wl = wardensUnder(root, list), cl = chromeUnder(root, list);
    leftovers = { wardens: wl.map((w) => w.pid), chrome: cl, cliChildren: [...spawnedPids] };
    for (const w of wl) taskkill(w.pid);
    for (const c of cl) taskkill(c, true);
  } catch (e) { leftovers.error = String(e); }
  for (const pid of spawnedPids) taskkill(pid, true);
  for (let i = 0; i < 8; i++) { try { await fs.rm(root.R, { recursive: true, force: true }); break; } catch { await delay(500 * (i + 1)); } }
  return leftovers;
}

// Observer liveness. Runtime.evaluate is used as the independent "is the renderer blocked" read
// (audit-2 convention). Note it cannot tell a dialog from a busy script; callers pair it with
// their own knowledge of what they triggered.
export async function live(s, ms = 1000) {
  try { await s.send('Runtime.evaluate', { expression: '1', returnByValue: true }, { timeout: ms }); return 'responsive'; } catch { return 'blocked'; }
}
export async function metrics(s, ms = 400) {
  const t0 = Date.now();
  try { await s.send('Performance.getMetrics', undefined, { timeout: ms }); return { state: 'responsive', ms: Date.now() - t0 }; }
  catch (e) { return { state: /timed out/i.test(String(e?.message)) ? 'blocked' : 'error', ms: Date.now() - t0, err: String(e?.message).slice(0, 120) }; }
}
export async function waitBlocked(s, ms) { const e = Date.now() + ms; while (Date.now() < e) { if ((await live(s, 250)) === 'blocked') return true; await delay(50); } return false; }
export async function waitLive(s, ms) { const e = Date.now() + ms; while (Date.now() < e) { if ((await live(s, 700)) === 'responsive') return true; await delay(100); } return false; }
export const idOf = (t) => t._targetId;
export const pageTargets = (b) => b.targets().filter((t) => t.type() === 'page');

export async function updateFindings(mutator) {
  const f = path.join(here, 'audit-findings.json');
  const j = JSON.parse(await fs.readFile(f, 'utf-8'));
  mutator(j);
  await fs.writeFile(f, JSON.stringify(j, null, 2));
}
