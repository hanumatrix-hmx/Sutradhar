// AUDIT-1: where does a history entry verification differ from the action result verification (failure cases)?
import path from 'node:path'; import fs from 'node:fs/promises';
import { here, mcpClient, startServer, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const srv = await startServer();
const c = mcpClient(path.join(repo, 'packages/mcp-server/dist/cli.js'));
const walk = (a, b, p, out) => { if (typeof a === 'object' && a && typeof b === 'object' && b) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p + '.' + k, out); } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ path: p, result: String(a).slice(0, 400), resultLen: String(a).length, history: String(b).slice(0, 400), historyLen: String(b).length }); };
const report = [];
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  await c.tool('browser.navigate', { sessionId: sid, url: srv.origin + '/p' });
  for (const [name, args] of [['browser.click', { target: '#a[' }], ['browser.drag_and_drop', { sourceTarget: '#a', destTarget: '#b' }], ['browser.click', { target: '#missing' }], ['browser.type', { target: '#mangle', value: 'abcdef' }]]) {
    await delay(1100);
    const r = await c.tool(name, { sessionId: sid, ...args }, 90000);
    const h = (await c.tool('browser.get_action_history', { sessionId: sid })).json.entries.at(-1);
    const d = []; walk(r.json?.verification, h.verification, 'verification', d);
    report.push({ name, args, diffs: d });
    console.log(name, JSON.stringify(args), JSON.stringify(d, null, 1).slice(0, 1500));
  }
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); await srv.close(); }
await fs.writeFile(path.join(here, 'verif-diff.json'), JSON.stringify(report, null, 1));
