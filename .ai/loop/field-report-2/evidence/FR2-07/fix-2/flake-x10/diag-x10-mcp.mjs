// diagnostic (X10 flake): the exact harness flow (observer A launches Chrome; the BUILT MCP server attaches as B) on the
// hidden-text.html fixture, REPS reps of navigate + click{expect.text}; prints every non-contradicted result with the
// frame that did not answer. Usage: node diag-x10-mcp.mjs <repoRoot> <reps>
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const repoRoot = process.argv[2]; const REPS = Number(process.argv[3] ?? 40);
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const b = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const { startFr207Server } = await import(pathToFileURL(path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-07-server.mjs')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => process.exit(3), 1100000);
const server = await startFr207Server();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-diagx10m-'));
const A = await puppeteer.launch({ executablePath: new b.BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile, args: ['--no-sandbox'], defaultViewport: { width: 1100, height: 900 } });
const child = spawn(process.execPath, [path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
console.log('PIDS', JSON.stringify({ chrome: A.process()?.pid, mcp: child.pid, self: process.pid }));
let buf = ''; let next = 1; const pend = new Map();
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; } if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } });
child.stderr.on('data', () => {});
const call = (method, params) => new Promise((res, rej) => { const id = next++; pend.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, 60000); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'diag', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const att = JSON.parse((await call('tools/call', { name: 'browser.attach', arguments: { endpoint: A.wsEndpoint() } })).result.content[0].text);
const tool = async (name, a) => { const m = await call('tools/call', { name, arguments: { sessionId: att.sessionId, ...a } }); try { return JSON.parse(m.result.content[0].text); } catch { return m; } };
let bad = 0;
for (let rep = 0; rep < REPS; rep++) {
  await tool('browser.navigate', { url: server.url('/hidden-text.html') });
  const page = (await A.pages()).find((p) => p.url().includes('/hidden-text.html'));
  await page.waitForFunction(() => window.__ht && window.__ht.ready, { timeout: 8000 });
  const t0 = performance.now();
  for (;;) {
    const tf = page.frames().filter((x) => x.url().includes('/textframe.html'));
    const vis = tf.find((x) => x.url().includes('IFRAME-VISIBLE-XO'));
    if (tf.length === 2 && vis && (await Promise.race([vis.evaluate(() => 1).then(() => true), delay(1000).then(() => false)]).catch(() => false))) break;
    if (performance.now() - t0 > 8000) { console.log('observer readiness timeout'); break; }
    await delay(100);
  }
  const r = await tool('browser.click', { target: '#noop', expect: { text: 'FR2-07 IFRAME-HIDDEN-SAME' } });
  const tier = r.verification?.evidence?.tier;
  const detail = r.verification?.evidence?.checks?.find((c) => c.check === 'expect.text')?.detail;
  if (tier !== 'contradicted') { bad++; console.log(rep, 'NOT contradicted:', tier, detail); } else console.log(rep, 'ok');
  await delay(1100);
}
console.log('SUMMARY bad', bad, 'of', REPS);
try { await tool('browser.shutdown', {}); } catch {}
child.stdin.end(); await delay(300); try { child.kill(); } catch {}
await server.close(); await A.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); clearTimeout(HARD); process.exit(0);
