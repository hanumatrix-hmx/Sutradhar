// FR2-12 audit-1: repeat the executor's own L12 (B1 fixed) case N times with FULL detail, using the
// executor's own fixture server, to measure its real pass rate (it FAILED in the auditor's fresh
// full live-verify rerun). Also runs the same sequence through the real MCP server over stdio for
// a subset, since L12 is an MCP case.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const N = Number(process.argv[2] ?? 20);
const OUT = path.join(here, 'probe-l12-repeat.json');
const { startAuditFixtureServer } = await import(pathToFileURL(path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-12-audit-server.mjs')));
const fx = await startAuditFixtureServer();
const origin = fx.origin;
const out = { origin, N, runtime: [], mcp: [] };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const summarize = (r) => ({
  consoleErrors: r.consoleErrors.map((e) => e.text),
  pageErrors: r.pageErrors.map((e) => e.message),
  brokenRequests: r.brokenRequests.map((b) => `${b.status} ${b.url.replace(origin, '')}`),
  cover: r.observation.coversWholeDocument,
  since: r.observation.documentStartedAt,
});
const clean = (s) => s.consoleErrors.length === 0 && s.pageErrors.length === 0 && s.brokenRequests.length === 0;

// ---- runtime-level (what MCP browser.navigate/browser.audit call)
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
try {
  for (let i = 0; i < N; i++) {
    await runtime.navigate(sid, `${origin}/noisy?n=a${i}`);
    await runtime.navigate(sid, `${origin}/clean?n=a${i}`);
    const a = summarize(await runtime.audit(sid, {}));
    await runtime.navigate(sid, `${origin}/noisy?n=b${i}`);
    const b = summarize(await runtime.audit(sid, { url: `${origin}/clean?n=b${i}` }));
    out.runtime.push({ i, currentPage: a, urlMode: b, pass: clean(a) && a.cover && clean(b) });
    await save();
  }
} finally {
  await runtime.shutdownAll().catch(() => {});
}

// ---- real MCP server over stdio (exact L12 sequence)
const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let id = 1;
const pending = new Map();
child.stdout.on('data', (c) => {
  buf += c.toString('utf8');
  let k;
  while ((k = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, k).trim();
    buf = buf.slice(k + 1);
    if (!line) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
child.stderr.on('data', () => {});
const rpc = (method, params) => new Promise((resolve) => { const i = id++; pending.set(i, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr212-audit1', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const launched = await call('browser.launch', { headless: true });
  const S = JSON.parse(launched.content[0].text).sessionId;
  const M = Math.min(N, 10);
  for (let i = 0; i < M; i++) {
    await call('browser.navigate', { sessionId: S, url: `${origin}/noisy?n=m${i}` });
    await call('browser.navigate', { sessionId: S, url: `${origin}/clean?n=m${i}` });
    const a = summarize(JSON.parse((await call('browser.audit', { sessionId: S, includeImages: false })).content[0].text));
    await call('browser.navigate', { sessionId: S, url: `${origin}/noisy?n=k${i}` });
    const b = summarize(JSON.parse((await call('browser.audit', { sessionId: S, url: `${origin}/clean?n=k${i}`, includeImages: false })).content[0].text));
    out.mcp.push({ i, currentPage: a, urlMode: b, pass: clean(a) && a.cover && clean(b) });
    await save();
  }
  await call('browser.shutdown_all', {});
} catch (e) {
  out.mcpError = String(e?.stack ?? e);
} finally {
  child.stdin.end();
  setTimeout(() => { try { if (!child.killed && child.exitCode === null) process.kill(child.pid); } catch {} }, 5000).unref();
  await fx.close();
}
out.runtimePassRate = `${out.runtime.filter((r) => r.pass).length}/${out.runtime.length}`;
out.mcpPassRate = `${out.mcp.filter((r) => r.pass).length}/${out.mcp.length}`;
await save();
console.log('runtime', out.runtimePassRate, 'mcp', out.mcpPassRate);
