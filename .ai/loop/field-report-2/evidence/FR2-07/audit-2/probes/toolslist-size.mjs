// Auditor-2: measure MCP tools/list size and tool count for a given MCP entry file.
// Usage: node toolslist-size.mjs <mcp entry js>
import { spawn } from 'node:child_process';
const entry = process.argv[2];
const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
const NL = String.fromCharCode(10);
let buf = ''; const pend = new Map(); let next = 1;
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf(NL)) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch { continue; } if (pend.has(m.id)) { pend.get(m.id)({ m, rawBytes: Buffer.byteLength(line) }); pend.delete(m.id); } } });
const call = (method, params) => new Promise((res) => { const id = next++; pend.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + NL); });
const t = setTimeout(() => { console.log('TIMEOUT'); process.exit(3); }, 60000);
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a2', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + NL);
const { m, rawBytes } = await call('tools/list', {});
const tools = m.result.tools;
console.log(JSON.stringify({ entry, toolCount: tools.length, resultJsonBytes: Buffer.byteLength(JSON.stringify(m.result)), toolsJsonBytes: Buffer.byteLength(JSON.stringify(tools)), rawLineBytes: rawBytes, withExpect: tools.filter((x) => x.inputSchema?.properties?.expect).length, names: tools.map((x) => x.name).sort().join(',').length }));
console.log('NAMES ' + tools.map((x) => x.name).sort().join(','));
clearTimeout(t); child.kill(); process.exit(0);
