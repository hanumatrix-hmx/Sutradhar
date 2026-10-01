// AUDIT-4 plumbing (own copy): MCP stdio client, CLI runner, PID log, canary extraction.
import fsS from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(here, '../../../../../..');
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));
export function logPid(pid, what) { fsS.appendFileSync(path.join(here, 'pids.log'), new Date().toISOString() + ' ' + pid + ' ' + what + '\n'); }
export const can = (t) => [...new Set((String(t).match(/a4[cuxl][a-z0-9]+/gi) ?? []).map((x) => x.toLowerCase()))];
export function mcpClient(serverPath, env = {}) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env }, windowsHide: true });
  logPid(child.pid, 'mcp-server ' + serverPath);
  let buf = ''; let id = 1; const pending = new Map();
  child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {} } });
  child.stderr.on('data', () => {});
  const rpc = (method, params, timeoutMs = 120000) => new Promise((res, rej) => { const k = id++; const t = setTimeout(() => rej(new Error('timeout ' + method)), timeoutMs); pending.set(k, (m) => { clearTimeout(t); res(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n'); });
  const tool = async (name, args, timeoutMs) => {
    const m = await rpc('tools/call', { name, arguments: args }, timeoutMs);
    const text = m.result?.content?.map((c) => c.text ?? '').join('') ?? JSON.stringify(m.error);
    let json; try { json = JSON.parse(text); } catch {}
    return { isError: !!m.result?.isError, text, json };
  };
  return {
    child, tool,
    init: async () => { await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit-4', version: '1' } }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); },
    kill: () => { try { child.kill(); } catch {} },
  };
}
export function runCli(cliPath, args, { env, cwd, timeoutMs = 180000 } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, ...env }, cwd, windowsHide: true });
    logPid(child.pid, 'cli ' + args.slice(0, 1).join(' '));
    let out = '', err = '';
    child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (err += c));
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Math.round(performance.now() - t0), pid: child.pid }); });
  });
}
