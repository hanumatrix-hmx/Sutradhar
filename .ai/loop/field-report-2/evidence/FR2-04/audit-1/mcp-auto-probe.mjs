// FR2-04 audit-1: MCP default ('auto') dialog behavior on the BUILT mcp-server, over real stdio
// JSON-RPC. Pre-FR2-04 behavior to preserve: alert/confirm/prompt stay pending and are visible via
// browser.get_pending_dialog, handle_dialog works, and an unhandled one is auto-DISMISSED after 30s.
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-audit-mcp-'));
const child = spawn(process.execPath, [path.join(root, 'packages/mcp-server/dist/cli.js')], {
  stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TEMP: tmp, TMP: tmp }, windowsHide: true,
});
let buf = '', id = 0; const waiters = new Map(); let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
child.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
    try { const m = JSON.parse(line); if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } } catch {} }
});
const rpc = (method, params) => new Promise((res) => { const i = ++id; waiters.set(i, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
const call = async (name, args) => { const t0 = Date.now(); const r = await rpc('tools/call', { name, arguments: args }); const txt = r.result?.content?.[0]?.text; let j; try { j = JSON.parse(txt); } catch { j = txt; } return { ms: Date.now() - t0, isError: !!r.result?.isError, body: j, raw: r.error }; };
const out = {}; const checks = [];
const check = (n, p, d) => { checks.push({ n, p, d }); console.log(`[${p ? 'PASS' : 'FAIL'}] ${n}${p ? '' : ' ' + JSON.stringify(d).slice(0, 400)}`); };
let sessionId;
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-04-audit', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc('tools/list', {});
  out.toolCount = tools.result?.tools?.length;
  const launch = await call('browser.launch', { headless: true, initialUrl: 'data:text/html,<title>mcpprobe</title><p>x</p>' });
  out.launch = launch; sessionId = launch.body?.sessionId;
  check('launched', !!sessionId, launch);
  // (1) unhandled confirm: pending visible, then auto-dismissed at ~30s -> eval returns false
  const evalP = call('browser.eval', { sessionId, code: "confirm('mcp-probe-1')" });
  await new Promise((r) => setTimeout(r, 2000));
  const pend = await call('browser.get_pending_dialog', { sessionId });
  out.pending1 = pend;
  check('pending-visible', pend.body?.dialog?.dialogType === 'confirm' && pend.body?.dialog?.message === 'mcp-probe-1', pend.body);
  const ev = await evalP; out.eval1 = ev;
  check('auto-dismiss-after-30s (eval resolves false, 29-36s)', ev.ms >= 29000 && ev.ms <= 36000 && JSON.stringify(ev.body).includes('false'), { ms: ev.ms, body: ev.body });
  const pend2 = await call('browser.get_pending_dialog', { sessionId });
  check('pending-cleared-after-auto-dismiss', pend2.body?.dialog === null, pend2.body);
  // (2) prompt handled by the caller
  const evalP2 = call('browser.eval', { sessionId, code: "prompt('mcp-probe-2','dv')" });
  await new Promise((r) => setTimeout(r, 1500));
  const pend3 = await call('browser.get_pending_dialog', { sessionId }); out.pending3 = pend3.body;
  const h = await call('browser.handle_dialog', { sessionId, action: 'accept', promptText: 'zz' }); out.handle = h;
  const ev2 = await evalP2; out.eval2 = ev2;
  check('caller-handle-prompt-zz', !h.isError && JSON.stringify(ev2.body).includes('zz') && ev2.ms < 5000, { h: h.body, ev2 });
  // (3) handle with nothing pending -> same error as before FR2-04
  const h2 = await call('browser.handle_dialog', { sessionId, action: 'accept' }); out.handleNone = h2;
  check('handle-nothing-pending-errors', h2.isError, h2.body);
} finally {
  if (sessionId) await call('browser.shutdown', { sessionId }).catch(() => {});
  child.kill();
  await new Promise((r) => setTimeout(r, 1500));
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  await fs.writeFile(path.join(here, 'mcp-auto-probe.json'), JSON.stringify({ at: new Date().toISOString(), checks, out, stderrTail: stderr.slice(-2000) }, null, 2));
  process.exit(0);
}
