// FR2-10 x FR2-08 interaction: `sessionId` is optional on every MCP tool while exactly one session is live. Proves it for the NEW
// tool (browser.wait_for) and for a newly settle-capable tool, against real Chrome, with the built server AND the npm bundle.
// Negative: with TWO live sessions the same call must FAIL and list the live ids (never guess).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const puppeteer = createRequire(path.join(repo, 'packages/browser/package.json'))('puppeteer-core');
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const html = '<!doctype html><body><p id="p">hello</p><script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend","<p>Late "+"text</p>")},1200)</script></body>';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); r.end(html); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
const client = (server) => {
  const c = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = ''; let id = 1; const pend = new Map();
  c.stdout.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch { /* not json */ } } });
  const call = (method, params) => new Promise((r) => { const i = id++; pend.set(i, r); c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  return { c, call, tool: async (name, args) => { const m = await call('tools/call', { name, arguments: args }); return m.result ?? { isError: true, content: [{ text: JSON.stringify(m.error) }] }; } };
};
const out = [];
for (const [label, server] of [['mcp-server', path.join(repo, 'packages/mcp-server/dist/cli.js')], ['bundle', path.join(repo, 'packages/sutradhar/dist/mcp-cli.js')]]) {
  const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'fr208-sl-a-'));
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'fr208-sl-b-'));
  const b1 = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: dir1, args: ['--no-sandbox'] });
  const b2 = await puppeteer.launch({ executablePath: chrome, headless: true, userDataDir: dir2, args: ['--no-sandbox'] });
  const m = client(server);
  await m.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'sl', version: '1' } });
  m.c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const first = JSON.parse((await m.tool('browser.attach', { endpoint: b1.wsEndpoint() })).content[0].text);
  // exactly ONE live session: no sessionId anywhere
  const nav = await m.tool('browser.navigate', { url });
  const t0 = Date.now();
  const w = await m.tool('browser.wait_for', { text: 'Late text', timeoutMs: 8000 });
  const wj = JSON.parse(w.content[0].text);
  const settled = await m.tool('browser.hover', { target: '#p', settle: true });
  const sj = JSON.parse(settled.content[0].text);
  // a SECOND session: the same sessionless call must fail and name the live ids
  const second = JSON.parse((await m.tool('browser.attach', { endpoint: b2.wsEndpoint() })).content[0].text);
  const amb = await m.tool('browser.wait_for', { text: 'x', timeoutMs: 100 });
  const ambText = amb.content[0].text;
  out.push({ label, sessionless: { navigateIsError: !!nav.isError, waitSuccess: wj.success, waitMs: Date.now() - t0, tier: wj.verification?.evidence?.tier, hoverSuccess: sj.success }, ambiguous: { isError: !!amb.isError, namesBothIds: ambText.includes(first.sessionId) && ambText.includes(second.sessionId), text: ambText.slice(0, 200) } });
  m.c.stdin.end(); m.c.kill();
  await b1.close().catch(() => {}); await b2.close().catch(() => {});
  await fs.rm(dir1, { recursive: true, force: true }).catch(() => {}); await fs.rm(dir2, { recursive: true, force: true }).catch(() => {});
}
srv.close();
const ok = out.every((o) => !o.sessionless.navigateIsError && o.sessionless.waitSuccess && o.sessionless.tier === 'verified' && o.sessionless.hoverSuccess && o.ambiguous.isError && o.ambiguous.namesBothIds);
console.log(JSON.stringify({ ok, out }, null, 2));
process.exit(ok ? 0 : 1);
