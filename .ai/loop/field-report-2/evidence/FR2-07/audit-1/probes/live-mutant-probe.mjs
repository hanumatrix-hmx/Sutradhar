// Focused live probe used for mutation testing of observers the unit tests cannot reach.
// Prints tiers for: focus on a non-focusable div; set_clipboard on a no-op spoof page with a
// SAME-LENGTH value as what the clipboard already holds.
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startAuditServer } from './audit-server.mjs';
const [repoRoot, label, out] = process.argv.slice(2);
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const DEADLINE = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 5 * 60 * 1000);
const srv = await startAuditServer();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-audit-mut-'));
const obs = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile, args: ['--no-sandbox'] });
const child = spawn(process.execPath, [path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = ''; let id = 0; const pend = new Map();
child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } } catch {} } });
const call = (method, params) => new Promise((r) => { const k = ++id; pend.set(k, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n'); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'm', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const att = JSON.parse((await call('tools/call', { name: 'browser.attach', arguments: { endpoint: obs.wsEndpoint() } })).content[0].text);
const tool = async (name, a) => JSON.parse((await call('tools/call', { name, arguments: { sessionId: att.sessionId, ...a } })).content[0].text);
const tier = (j) => j?.verification?.evidence?.tier;
const res = { label };
await tool('browser.navigate', { url: `${srv.origin}/p.html?n=m1` });
await new Promise((r) => setTimeout(r, 500));
res.focusNoFocus = tier(await tool('browser.focus', { target: '#nofocus' }));
await tool('browser.grant_permissions', { origin: srv.origin, permissions: ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'] });
await tool('browser.navigate', { url: `${srv.origin}/a?n=m2` });
res.clipPlain = tier(await tool('browser.set_clipboard', { text: 'SAME-LEN-AAAA-01' }));
await tool('browser.navigate', { url: `${srv.origin}/spoof.html?n=m3` });
res.clipSpoofSameLength = tier(await tool('browser.set_clipboard', { text: 'SAME-LEN-BBBB-02' }));
console.log(JSON.stringify(res));
await fs.appendFile(out, JSON.stringify(res) + '\n');
child.stdin.end(); try { child.kill(); } catch {}
await obs.close(); await srv.close();
await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
clearTimeout(DEADLINE);
