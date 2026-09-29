// FR2-12 audit-2: does the GAP-261 bug class (a dialog corrupting the machine-readable output, or
// hanging the audit) exist on the MCP and SDK paths? Plus a status-999 live schema check.
// Hard timeouts on everything; MCP child and SDK Chrome killed by their own PIDs only.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const OUT = path.join(here, 'probe-mcp-sdk-dialogs.json');
const req = createRequire(path.join(root, 'package.json'));
let Ajv = req(path.join(root, 'node_modules', '.pnpm', 'ajv@8.20.0', 'node_modules', 'ajv')); Ajv = Ajv.default ?? Ajv;
let addFormats = req(path.join(root, 'node_modules', '.pnpm', 'ajv-formats@3.0.1_ajv@8.20.0', 'node_modules', 'ajv-formats')); addFormats = addFormats.default ?? addFormats;
const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
const validate = ajv.compile(JSON.parse(await fs.readFile(path.join(root, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json'), 'utf8')));
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label}`)), ms))]);
const H = (t, body, script = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${t}</title></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  const send = (c, b, t = 'text/html') => { s.writeHead(c, { 'Content-Type': t }); s.end(b); };
  if (u.pathname === '/favicon.ico') return send(200, '', 'image/x-icon');
  if (u.pathname === '/clean') return send(200, H('clean', '<h1>c</h1>'));
  if (u.pathname === '/alertat') return send(200, H('a', '<h1>a</h1>', `setTimeout(function(){alert('mcp-sdk-alert-${u.searchParams.get('ms')}')},${Number(u.searchParams.get('ms'))})`));
  if (u.pathname === '/s999') return send(200, H('s999', '<img src="/deny.png" alt="d">'));
  if (u.pathname === '/deny.png') return send(999, 'denied', 'text/plain');
  send(404, 'nf', 'text/plain');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { origin, mcp: {}, sdk: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const killTree = (pid) => { if (pid) try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };

// ---------------- MCP ----------------
const child = spawn(process.execPath, [path.join(root, 'packages', 'mcp-server', 'dist', 'cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', nextId = 1; const pending = new Map(); const badLines = [];
child.stdout.on('data', (c) => {
  buf += c.toString('utf8'); let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { badLines.push(line.slice(0, 200)); continue; }
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
child.stderr.on('data', () => {});
const call = (method, params, ms = 90000) => { const id = nextId++; child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); return withTimeout(new Promise((r) => pending.set(id, r)), ms, method); };
const tool = async (name, args, ms) => { const t0 = Date.now(); const m = await call('tools/call', { name, arguments: args }, ms); return { ms: Date.now() - t0, isError: !!m.result?.isError, text: m.result?.content?.[0]?.text ?? JSON.stringify(m.error) }; };
let sdkBrowser = null, sdkChromePid = null;
try {
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit2', version: '0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  const S = JSON.parse((await tool('browser.launch', { headless: true })).text).sessionId;
  const summarize = (r) => {
    let report = null; try { report = JSON.parse(r.text); } catch {}
    return { ms: r.ms, isError: r.isError, textIsSingleJson: report !== null, schemaValid: report && !r.isError ? validate(report) : null, err: r.isError ? r.text.slice(0, 220) : undefined, consoleErrors: report?.consoleErrors?.length };
  };
  for (const ms of [0, 600, 1550]) {
    out.mcp[`alertAt${ms}`] = summarize(await tool('browser.audit', { sessionId: S, url: `${origin}/alertat?ms=${ms}`, includeImages: false }, 120000));
    out.mcp[`pendingAfter${ms}`] = (await tool('browser.get_pending_dialog', { sessionId: S })).text.slice(0, 200);
    try { await tool('browser.handle_dialog', { sessionId: S, action: 'dismiss' }, 20000); } catch {}
    out.mcp[`followUpClean${ms}`] = summarize(await tool('browser.audit', { sessionId: S, url: `${origin}/clean?after=${ms}`, includeImages: false }));
    await save();
  }
  out.mcp.status999 = summarize(await tool('browser.audit', { sessionId: S, url: `${origin}/s999`, includeImages: false }));
  out.mcp.nonJsonStdoutLines = badLines;
  await tool('browser.shutdown', { sessionId: S }).catch(() => {});
  await save();

  // ---------------- SDK ----------------
  const sdk = await import(pathToFileURL(path.join(root, 'packages', 'sutradhar', 'dist', 'index.js')));
  sdkBrowser = await withTimeout(sdk.launch({ headless: true }), 90000, 'sdk launch');
  const page = (await sdkBrowser.pages())[0];
  for (const ms of [0, 600, 1550]) {
    const t0 = Date.now();
    try {
      const r = await withTimeout(page.audit({ url: `${origin}/alertat?ms=${ms}&sdk=1` }), 120000, 'sdk audit');
      out.sdk[`alertAt${ms}`] = { ms: Date.now() - t0, returned: true, schemaValid: validate(r.report) };
    } catch (e) { out.sdk[`alertAt${ms}`] = { ms: Date.now() - t0, threw: String(e.message).slice(0, 220) }; }
    try { const d = await withTimeout(page.evaluate('1+1'), 40000, 'sdk eval'); out.sdk[`evalAfter${ms}`] = d; } catch (e) { out.sdk[`evalAfter${ms}`] = 'ERR ' + String(e.message).slice(0, 150); }
    await save();
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e);
} finally {
  await save();
  try { if (sdkBrowser) await withTimeout(sdkBrowser.close(), 30000, 'sdk close'); } catch (e) { out.sdkCloseErr = String(e); }
  try { child.stdin.end(); } catch {}
  await new Promise((r) => setTimeout(r, 1500));
  killTree(child.pid);
  server.close();
  await save();
}
console.log(JSON.stringify(out, null, 1));
process.exit(0);
