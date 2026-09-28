// GAP-256-fix audit-1 shared helpers (auditor's own; not derived from the executor's harness logic).
// Every process this harness creates lives under one scratch root R (CLI state dirs + TEMP for Chrome
// profiles). Cleanup kills ONLY: CLI child PIDs this harness spawned, wardens whose base64 payload
// stateFile is under R, and chrome.exe whose command line contains R. Never by image name.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
export const CLI_CUR = path.join(repoRoot, 'packages/cli/dist/cli.js');
export const CLI_MASTER = 'E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli/dist/cli.js';
export const puppeteer = createRequire(path.join(repoRoot, 'packages/browser/package.json'))('puppeteer-core');
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => performance.now();
const spawned = new Set();

export async function makeRoot(tag) {
  const R = await fs.mkdtemp(path.join(os.tmpdir(), `g256aud-${tag}-`));
  const TEMP = path.join(R, 'temp');
  await fs.mkdir(TEMP, { recursive: true });
  return { R, TEMP, rReal: await fs.realpath(R) };
}

export function makeCli(root, cliPath) {
  return (args, dir, capMs = 60000) =>
    new Promise((resolve) => {
      const t0 = now();
      const child = spawn(process.execPath, [cliPath, ...args], {
        env: { ...process.env, TEMP: root.TEMP, TMP: root.TEMP, SUTRADHAR_CLI_STATE_DIR: dir },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      spawned.add(child.pid);
      let out = '', err = '', killed = false;
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      const cap = setTimeout(() => { killed = true; taskkill(child.pid, true); }, capMs);
      child.on('exit', (code) => {
        clearTimeout(cap);
        spawned.delete(child.pid);
        resolve({ args: args.join(' '), code, ms: Math.round(now() - t0), cap: killed, stdout: out, stderr: err });
      });
    });
}

export function startServer() {
  return new Promise((resolve) => {
    let PORT;
    const server = http.createServer((q, s) => {
      const u = new URL(q.url, 'http://x');
      const n = u.searchParams.get('n') ?? '';
      s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
      if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>alert ${n}</title><script>alert('inline-${n}')</script><body>alert ${n}</body>`);
      if (u.pathname === '/confirm-inline') return s.end(`<!doctype html><title>confirm ${n}</title><script>confirm('c-${n}')</script><body>c</body>`);
      if (u.pathname === '/prompt-inline') return s.end(`<!doctype html><title>prompt ${n}</title><script>prompt('p-${n}','def')</script><body>p</body>`);
      if (u.pathname === '/bu') return s.end(`<!doctype html><title>bu ${n}</title><script>addEventListener('beforeunload',(e)=>{e.preventDefault();e.returnValue='x';});</script><body>bu</body>`);
      if (u.pathname === '/type-two-popups') return s.end(`<!doctype html><title>type</title><body><input id="in">
<script>let k=0;document.getElementById('in').addEventListener('keydown',()=>{k++;open('http://127.0.0.1:${PORT}/'+(k===1?'?n=first-innocent':'alert-inline?n=second-holder'));});</script></body>`);
      if (u.pathname === '/popup-sync-alert') return s.end(`<!doctype html><title>opener ${n}</title><body style="height:100vh;margin:0">opener<script>document.addEventListener('click',()=>{const w=open('');w.document.write('<p>x</p>');w.alert('from-popup-${n}');})</script></body>`);
      return s.end(`<!doctype html><title>page ${n}</title><body>page ${n}</body>`);
    });
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve({ server, BASE: `http://127.0.0.1:${PORT}` }); });
  });
}

export const readJson = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf-8')); } catch { return undefined; } };
export const readState = (d) => readJson(path.join(d, 'state.json'));
export const readWarden = (d) => readJson(path.join(d, 'warden.json'));

export function procs() {
  try {
    const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @(\'chrome.exe\',\'node.exe\') } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"', { encoding: 'utf-8', maxBuffer: 64 << 20 });
    const p = JSON.parse(out || '[]');
    return Array.isArray(p) ? p : [p];
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
export function taskkill(pid, tree = false) { try { execSync(`taskkill /PID ${pid} /F${tree ? ' /T' : ''}`, { stdio: 'ignore' }); } catch {} }

export async function cleanupRoot(root, cli, dirs) {
  for (const d of dirs) { try { await cli(['close'], d, 20000); } catch {} }
  await delay(2000);
  const list = procs();
  const wl = wardensUnder(root, list), cl = chromeUnder(root, list);
  const leftovers = { wardens: wl.map((w) => w.pid), chrome: cl, cliChildren: [...spawned] };
  for (const w of wl) taskkill(w.pid);
  for (const c of cl) taskkill(c, true);
  for (const pid of spawned) taskkill(pid, true);
  for (let i = 0; i < 8; i++) { try { await fs.rm(root.R, { recursive: true, force: true }); break; } catch { await delay(500 * (i + 1)); } }
  let removed = true; try { await fs.access(root.R); removed = false; } catch {}
  return { ...leftovers, rootRemoved: removed };
}

// Independent observer: a RAW CDP WebSocket client (no Puppeteer, no target manager, no auto-attach,
// never detaches anything on its own). Exposes the same tiny surface the harness uses:
// b._connection.send/on, b.disconnect(); rawSession(b, id) -> { send } on a flat session.
class RawCdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); this._connection = this; }
  static open(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const c = new RawCdp(ws);
      ws.onopen = () => resolve(c);
      ws.onerror = (e) => reject(new Error('ws error ' + (e?.message ?? '')));
      ws.onclose = () => { for (const p of c.pending.values()) p.reject(new Error('Session closed (ws)')); c.pending.clear(); };
      ws.onmessage = (m) => {
        const msg = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString());
        if (msg.id !== undefined) {
          const p = c.pending.get(msg.id); if (!p) return; c.pending.delete(msg.id);
          msg.error ? p.reject(new Error(`Protocol error (${p.method}): ${msg.error.message}`)) : p.resolve(msg.result);
        } else {
          for (const fn of c.handlers.get(msg.method) ?? []) fn(msg.params, msg.sessionId);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, []); this.handlers.get(ev).push(fn); }
  async disconnect() { try { this.ws.close(); } catch {} }
}
export async function observer(dir) {
  const st = await readState(dir);
  return RawCdp.open(st.wsEndpoint);
}
export async function observerWs(ws) { return RawCdp.open(ws); }
export async function liveTargets(dir) {
  const b = await observer(dir);
  try {
    const r = await b.send('Target.getTargets');
    return r.targetInfos.filter((t) => t.type === 'page').map((t) => ({ id: t.targetId, url: t.url, title: t.title, openerId: t.openerId }));
  } finally { await b.disconnect().catch(() => {}); }
}
// Raw flat session on a target.
export async function rawSession(b, targetId) {
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  return { sessionId, send: (method, params) => b.send(method, params, sessionId) };
}
export async function sendT(s, method, params, ms) {
  const t0 = now();
  try {
    await Promise.race([s.send(method, params), new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms))]);
    return { r: 'ok', ms: Math.round(now() - t0) };
  } catch (e) { return { r: /TIMEOUT/.test(String(e?.message)) ? 'TIMEOUT' : 'error:' + String(e?.message).slice(0, 80), ms: Math.round(now() - t0) }; }
}
// A real (trusted) mouse click on a raw session -- gives the page user activation.
export async function clickAt(s, x = 20, y = 20) {
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }).catch(() => {});
  s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }).catch(() => {});
}
export const hexIds = (text) => [...text.matchAll(/\b([0-9A-F]{32})\b/g)].map((m) => m[1]);
