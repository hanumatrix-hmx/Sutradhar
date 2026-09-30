import fs from 'node:fs';
import path from 'node:path';
import { mcpClient, WT, MASTER, PIDS } from './lib.mjs';
const out = {};
for (const [k, js] of [['head-mcp', path.join(WT, 'packages/mcp-server/dist/cli.js')], ['head-bundle', path.join(WT, 'packages/sutradhar/dist/mcp-cli.js')], ['master-mcp', path.join(MASTER, 'packages/mcp-server/dist/cli.js')], ['master-bundle', path.join(MASTER, 'packages/sutradhar/dist/mcp-cli.js')]]) {
  const c = mcpClient(js);
  await c.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a', version: '1' } });
  c.notify('notifications/initialized');
  const r = await c.call('tools/list', {});
  const settle = r.tools.filter((t) => t.inputSchema?.properties?.settle).map((t) => t.name).sort();
  const wf = r.tools.find((t) => t.name === 'browser.wait_for');
  out[k] = { tools: r.tools.length, utf8Bytes: Buffer.byteLength(JSON.stringify(r.tools), 'utf8'), settleTools: settle.length, settle, waitForDescBytes: wf ? Buffer.byteLength(wf.description) : 0 };
  c.child.stdin.end(); c.child.kill();
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { ...v, settle: undefined }])), null, 1));
fs.writeFileSync('../tools-list-bytes.json', JSON.stringify({ out, pids: PIDS }, null, 2));
