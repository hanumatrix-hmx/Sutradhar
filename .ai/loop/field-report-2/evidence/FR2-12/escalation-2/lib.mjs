// FR2-12 escalation-2 shared probe helpers. Evidence is written ONLY under this escalation-2 dir
// (guarded, mirrors audit-5's lib.mjs). Process hygiene: every Chrome/MCP/CLI child is tracked by
// PID and killed by PID only (never by image name).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/escalation-2')) throw new Error('wrong evidence dir: ' + here);
export const root = path.resolve(here, '..', '..', '..', '..', '..', '..');

export const outPath = (name) => {
  const p = path.join(here, name);
  if (!p.replace(/\\/g, '/').includes('/evidence/FR2-12/escalation-2/')) throw new Error('refusing to write outside escalation-2: ' + p);
  return p;
};

export async function loadRuntime() {
  return await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
}

export const cap = (p, ms, l) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`CAP ${l} ${ms}ms`)), ms))]);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const pids = new Set();
export function killAll() {
  for (const p of pids) {
    try { execFileSync('taskkill', ['/PID', String(p), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  }
  pids.clear();
}
export function watchdog(ms, onFire) {
  const t = setTimeout(async () => {
    try { await onFire?.(); } catch {}
    killAll();
    process.exit(2);
  }, ms);
  return () => clearTimeout(t);
}

export async function startServer(handler) {
  const server = http.createServer((req, res) => {
    try { handler(req, res, new URL(req.url, 'http://x')); } catch (e) { try { res.writeHead(500); res.end(String(e)); } catch {} }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { server, port, origin: `http://127.0.0.1:${port}`, altOrigin: `http://localhost:${port}` };
}

export function chromePidOf(runtime, sid) {
  try {
    const p = runtime['requirePage'](runtime['resolveTab'](sid).tab).browser().process()?.pid;
    if (p) pids.add(p);
    return p;
  } catch { return null; }
}

export async function mcpClient(label = 'esc2') {
  const mcpEntry = path.join(root, 'packages', 'mcp-server', 'dist', 'cli.js');
  await fs.access(mcpEntry);
  const cp = spawn(process.execPath, [mcpEntry], { stdio: ['pipe', 'pipe', 'pipe'] });
  pids.add(cp.pid);
  let buf = '';
  const waiters = new Map();
  let id = 0;
  cp.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try { const m = JSON.parse(line); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch {}
    }
  });
  cp.stderr.on('data', () => {});
  const rpc = (method, params) => new Promise((resolve) => { const i = ++id; waiters.set(i, resolve); cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const call = async (name, args, ms = 90000) => { const r = await cap(rpc('tools/call', { name, arguments: args }), ms, name); return r.result; };
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: label, version: '0' } });
  cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const text = (r) => r?.content?.[0]?.text ?? '';
  const launch = async () => {
    const launched = await call('browser.launch', { headless: true });
    return (text(launched).match(/sess_[0-9_]+/) || [])[0];
  };
  const auditJson = async (args) => {
    const r = await call('browser.audit', { includeImages: false, ...args });
    try { return JSON.parse(text(r)); } catch { return { err: text(r).slice(0, 300) }; }
  };
  const close = async () => { try { cp.stdin.end(); } catch {} await sleep(1500); };
  return { cp, call, rpc, text, launch, auditJson, close };
}

export const H = { 'Content-Type': 'text/html' };
export const html = (body, title = 't') => `<!doctype html><html lang=en><head><title>${title}</title></head><body>${body}</body></html>`;
