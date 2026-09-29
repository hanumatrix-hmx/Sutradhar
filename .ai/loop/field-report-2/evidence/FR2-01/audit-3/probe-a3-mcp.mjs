// FR2-01 audit-3: MCP-surface repro of the busy-main-frame hidden false success, plus MCP timeoutMs edge args.
// Spawns THIS worktree's packages/mcp-server/dist/cli.js over stdio.
import path from 'node:path'; import fs from 'node:fs'; import { spawn } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const child = spawn(process.execPath, [path.join(repoRoot, 'packages/mcp-server/dist/cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = ''; let nextId = 1; const pending = new Map();
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue; let m; try { m = JSON.parse(l); } catch { continue; } if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
child.stderr.on('data', () => {});
const call = (method, params) => new Promise((r) => { const id = nextId++; pending.set(id, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const tool = async (name, args) => { const m = await call('tools/call', { name, arguments: args }); if (m.error) return { rpcError: m.error }; const t = m.result?.content?.[0]?.text ?? ''; try { return { isError: m.result.isError, ...JSON.parse(t) }; } catch { return { isError: m.result.isError, text: t.slice(0, 300) }; } };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit3', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const out = [];
const rec = (o) => { console.log('RESULT ' + JSON.stringify(o)); out.push(o); };
const html = 'data:text/html,' + encodeURIComponent('<div id="spinner">loading...</div><script>window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}}</script>');
const L = await tool('browser.launch', { headless: true, initialUrl: 'about:blank' });
const sessionId = L.sessionId;
const short = (r) => ({ success: r.success, retriesUsed: r.retriesUsed, output: r.output, error: (r.error ?? r.text ?? JSON.stringify(r.rpcError ?? ''))?.slice?.(0, 220), isError: r.isError });

for (let rep = 0; rep < 2; rep++) {
  await tool('browser.navigate', { sessionId, url: html });
  // the page runs a 3s long task (e.g. heavy hydration) while its spinner is plainly visible
  await tool('browser.eval', { sessionId, code: 'setTimeout(() => window.__busy(3000), 50); true' });
  await delay(100);
  const t0 = Date.now();
  const r = await tool('browser.wait_for_selector', { sessionId, target: '#spinner', state: 'hidden', timeoutMs: 2000 });
  const took = Date.now() - t0;
  await delay(3200);
  const after = await tool('browser.eval', { sessionId, code: "(() => { const e = document.querySelector('#spinner'); const r = e.getBoundingClientRect(); return { present: !!e, w: r.width, h: r.height, display: getComputedStyle(e).display }; })()" });
  rec({ id: `mcp-hidden-spinner-main-frame-busy rep${rep}`, expected: 'success:false', ...short(r), tookMs: took, spinnerAfter: after.result ?? after, FALSE_SUCCESS: r.success === true });
}

await tool('browser.navigate', { sessionId, url: html });
for (const [label, v] of [['2^31', 2 ** 31], ['1e308', 1e308], ['string-5000', '5000'], ['null', null], ['float-1.5', 1.5]]) {
  const t0 = Date.now();
  const r = await tool('browser.wait_for_selector', { sessionId, target: '#spinner', state: 'visible', timeoutMs: v });
  rec({ id: `mcp-timeoutMs-${label}`, ...short(r), tookMs: Date.now() - t0 });
}
{
  const t0 = Date.now();
  const r = await tool('browser.wait_for_selector', { sessionId, target: '#never', timeoutMs: 0 });
  rec({ id: 'mcp-timeoutMs-0-never (documented: check once, no retrying)', ...short(r), tookMs: Date.now() - t0 });
}
fs.writeFileSync(path.join(here, 'probe-a3-mcp-results.json'), JSON.stringify(out, null, 2));
await tool('browser.shutdown', { sessionId });
child.kill();
process.exit(0);
