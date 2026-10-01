// AUDIT-3 copy of the audit-1/2 shared helpers (independent of the builder's verify script).
import fs from 'node:fs/promises';
import fsS from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../../..');
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export const started = []; // every PID this audit started
export function logPid(pid, what) { started.push({ pid, what }); fsS.appendFileSync(path.join(here, 'pids.log'), `${new Date().toISOString()} ${pid} ${what}\n`); }

export const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>AUDIT page</title></head><body>
<input id="pw" type="password" aria-label="Password">
<input id="mangle" aria-label="Mangle" oninput="this.value='M-'+this.value.split('').reverse().join('')">
<input id="a" aria-label="A"><input id="b" aria-label="B">
<select id="sel"><option value="ok">OK</option><option value="CNRYselval">LBL-CNRYsellabel</option></select>
<input id="file" type="file"><button id="trig" onclick="document.getElementById('file').click()">trigger</button>
<a id="dl" href="/dl">download</a>
<button id="btn" onclick="document.getElementById('out').textContent='clicked'">Btn</button><div id="out"></div>
<button id="prompt" onclick="document.getElementById('out').textContent=prompt('q')">Prompt</button>
<a id="p2" href="/p2?token=CNRYlinkq">p2</a>
</body></html>`;

export async function startServer() {
  const server = http.createServer((req, res) => {
    const p = (req.url ?? '').split('?')[0];
    if (p === '/p' || p === '/p2') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE.replace('AUDIT page', 'AUDIT ' + p));
    if (p === '/dl') return res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="CNRYdlname.txt"' }).end('x'.repeat(100));
    if (p === '/auth') {
      return res.writeHead(200, { 'content-type': 'text/html' }).end('<title>auth</title>auth=' + (req.headers.authorization ? 'yes' : 'no'));
    }
    res.writeHead(404).end('nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return { port, origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

export function mcpClient(serverPath, env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env }, windowsHide: true });
  logPid(child.pid, 'mcp-server ' + serverPath);
  let buf = ''; let id = 1; const pending = new Map(); const raw = [];
  child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
  child.stderr.on('data', () => {});
  const rpc = (method, params, timeoutMs = 120000) => new Promise((res, rej) => { const k = id++; const t = setTimeout(() => rej(new Error('timeout ' + method)), timeoutMs); pending.set(k, (m) => { clearTimeout(t); res(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n'); });
  const tool = async (name, args, timeoutMs) => {
    const m = await rpc('tools/call', { name, arguments: args }, timeoutMs);
    const text = m.result?.content?.map((c) => c.text ?? '').join('') ?? JSON.stringify(m.error);
    let json; try { json = JSON.parse(text); } catch {}
    raw.push({ name, args, isError: !!m.result?.isError, text });
    return { isError: !!m.result?.isError, text, json };
  };
  return {
    child, raw, tool,
    init: async () => { await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit-1', version: '1' } }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); },
    kill: () => { try { child.kill(); } catch {} },
  };
}

export function runCli(cliPath, args, { env, cwd, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, ...env }, cwd, windowsHide: true });
    logPid(child.pid, 'cli ' + args.slice(0, 2).join(' '));
    let out = '', err = '';
    child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Math.round(performance.now() - t0), pid: child.pid }); });
  });
}
export const canariesIn = (text) => [...new Set(String(text).match(/CNRY[A-Za-z0-9_]*/g) ?? [])];
