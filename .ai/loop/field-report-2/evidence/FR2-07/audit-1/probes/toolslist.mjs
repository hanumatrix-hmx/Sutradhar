import { spawn } from 'node:child_process';
const [server] = process.argv.slice(2);
const c = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'ignore'] });
let buf = '';
const send = (o) => c.stdin.write(JSON.stringify(o) + '\n');
c.stdout.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const m = JSON.parse(line);
    if (m.id === 1) { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }); }
    if (m.id === 2) {
      const t = m.result.tools;
      console.log(JSON.stringify({ count: t.length, bytes: JSON.stringify(t).length, withExpect: t.filter((x) => x.inputSchema?.properties?.expect).length, names: t.map((x) => x.name) }));
      c.kill(); process.exit(0);
    }
  }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a', version: '1' } } });
setTimeout(() => { c.kill(); process.exit(2); }, 30000);
