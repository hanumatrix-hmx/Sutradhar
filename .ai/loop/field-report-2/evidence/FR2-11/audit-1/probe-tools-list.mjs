// AUDIT-1: tools/list bytes on HEAD vs master, and dump the schemas of the tools the privacy probe needs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const [serverPath, outFile] = process.argv.slice(2);
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
console.error('spawned pid', child.pid);
let buf = ''; const pending = new Map(); let id = 1;
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); pending.get(m.id)?.(m); } catch {} } });
const call = (method, params) => new Promise((res, rej) => { const k = id++; const t = setTimeout(() => rej(new Error('timeout')), 30000); pending.set(k, (m) => { clearTimeout(t); res(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n'); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const r = await call('tools/list', {});
const raw = JSON.stringify(r.result);
const h = r.result.tools.find((t) => t.name === 'browser.get_action_history');
console.log(JSON.stringify({ tools: r.result.tools.length, bytes: Buffer.byteLength(raw), historyToolBytes: Buffer.byteLength(JSON.stringify(h)) }));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(r.result.tools, null, 1));
child.kill();
