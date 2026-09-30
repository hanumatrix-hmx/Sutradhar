// tools/list over stdio for a given MCP entry; prints tool count and UTF-8 byte size of JSON.stringify(tools).
import { spawn } from 'node:child_process';
const entry = process.argv[2];
const c = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '';
const t = setTimeout(() => { console.log('timeout'); c.kill(); process.exit(2); }, 60000);
c.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id === 2) { const tools = m.result.tools; const s = JSON.stringify(tools); console.log(JSON.stringify({ entry, tools: tools.length, utf8Bytes: Buffer.byteLength(s, 'utf8'), chars: s.length, withExpect: tools.filter((x) => x.inputSchema?.properties?.expect).length })); clearTimeout(t); c.kill(); process.exit(0); } } catch {} } });
c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a3', version: '1' } } }) + '\n');
c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
