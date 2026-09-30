// AUDIT-1: recording overhead, HEAD vs master MCP, interleaved blocks (monotonic clock only).
import path from 'node:path'; import fs from 'node:fs/promises';
import { here, mcpClient, startServer, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const SERVERS = { head: path.join(repo, 'packages/mcp-server/dist/cli.js'), master: 'E:/AI-Cache/tmp/fr211-master/packages/mcp-server/dist/cli.js' };
const srv = await startServer();
const samples = { head: { eval: [], click: [], hist: [] }, master: { eval: [], click: [], hist: [] } };
const block = async (side) => {
  const c = mcpClient(SERVERS[side]);
  try {
    await c.init();
    const sid = (await c.tool('browser.launch', { headless: true, initialUrl: srv.origin + '/p' })).json.sessionId;
    for (let i = 0; i < 20; i++) await c.tool('browser.eval', { sessionId: sid, code: 'warm' + i + '=1' });
    for (let i = 0; i < 200; i++) { const t = performance.now(); await c.tool('browser.eval', { sessionId: sid, code: 'x' + i + '=' + i }); samples[side].eval.push(performance.now() - t); }
    for (let i = 0; i < 40; i++) { await delay(1010); const t = performance.now(); await c.tool('browser.click', { sessionId: sid, target: '#btn' }); samples[side].click.push(performance.now() - t); }
    for (let i = 0; i < 20; i++) { const t = performance.now(); await c.tool('browser.get_action_history', { sessionId: sid }); samples[side].hist.push(performance.now() - t); }
    await c.tool('browser.shutdown_all', {});
  } finally { c.kill(); }
};
for (const order of [['head', 'master'], ['master', 'head'], ['head', 'master']]) for (const s of order) { await block(s); console.log('block done', s); }
await srv.close();
const stat = (a) => { const s = [...a].sort((x, y) => x - y); const mean = a.reduce((x, y) => x + y, 0) / a.length; return { n: a.length, mean: +mean.toFixed(2), median: +s[Math.floor(s.length / 2)].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2) }; };
const out = {}; for (const side of ['head', 'master']) out[side] = Object.fromEntries(Object.entries(samples[side]).map(([k, v]) => [k, stat(v)]));
out.deltaMean = Object.fromEntries(['eval', 'click', 'hist'].map((k) => [k, +(out.head[k].mean - out.master[k].mean).toFixed(2)]));
out.deltaMedian = Object.fromEntries(['eval', 'click', 'hist'].map((k) => [k, +(out.head[k].median - out.master[k].median).toFixed(2)]));
console.log(JSON.stringify(out, null, 1));
await fs.writeFile(path.join(here, 'overhead.json'), JSON.stringify(out, null, 1));
