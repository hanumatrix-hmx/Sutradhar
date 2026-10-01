// AUDIT-1 completeness follow-up: settle variants, drag_and_drop, duplicate guard pair, engine-level invalid selector, runtime-level NaN timeout (SDK path).
import fs from 'node:fs/promises'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { here, mcpClient, startServer, delay } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const srv = await startServer();
const O = srv.origin;
const c = mcpClient(path.join(repo, 'packages/mcp-server/dist/cli.js'));
const out = [];
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  const hist = async () => (await c.tool('browser.get_action_history', { sessionId: sid, scope: 'session' })).json.entries;
  let prev = 0;
  const S = async (label, name, args, expectN) => { await delay(1100); const r = await c.tool(name, { sessionId: sid, ...args }, 60000); const h = await hist(); const a = h.slice(prev); prev = h.length; const row = { label, added: a.length, expectN, ok: a.length === expectN, types: a.map((x) => x.actionType + ':' + x.success + ':' + (x.error ?? '').slice(0, 70)), verifEq: JSON.stringify(r.json?.verification) === JSON.stringify(a.at(-1)?.verification), isError: r.isError, err: r.isError ? r.text.slice(0, 100) : undefined }; out.push(row); console.log(JSON.stringify(row)); };
  await S('navigate settle:true', 'browser.navigate', { url: O + '/p', settle: true }, 1);
  await S('click settle:true', 'browser.click', { target: '#btn', settle: true }, 1);
  await S('drag_and_drop', 'browser.drag_and_drop', { sourceTarget: '#a', destTarget: '#b' }, 1);
  await S('engine invalid css', 'browser.click', { target: '#a[' }, 1);
  await delay(1100);
  const before = prev;
  const pair = await Promise.all([c.tool('browser.click', { sessionId: sid, target: '#btn' }), c.tool('browser.click', { sessionId: sid, target: '#btn' })]);
  const h = await hist(); const dup = h.slice(before); prev = h.length;
  const row = { label: 'duplicate pair', added: dup.length, expectN: 2, ok: dup.length === 2, types: dup.map((x) => x.actionType + ':' + x.success + ':' + (x.error ?? '').slice(0, 70)), results: pair.map((p) => p.json?.success + ':' + (p.json?.error ?? '').slice(0, 50)) };
  out.push(row); console.log(JSON.stringify(row));
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); }
// SDK/runtime path: NaN timeoutMs (GAP-032 early return) must be recorded once as a failure
const sdk = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
const b = await sdk.launch({ headless: true });
try {
  const page = (await b.pages())[0];
  await page.goto(O + '/p');
  const rt = b.runtime;
  const r = await rt.waitForSelector(b.sessionId, '#btn', NaN);
  const rep = rt.getActionHistoryReport(b.sessionId, { scope: 'session' });
  const row = { label: 'NaN timeoutMs (runtime)', resultSuccess: r.success, entries: rep.entries.map((x) => x.actionType + ':' + x.success + ':' + (x.error ?? '').slice(0, 50)), ok: rep.entries.length === 2 && rep.entries[1].success === false };
  out.push(row); console.log(JSON.stringify(row));
} finally { await b.close().catch(() => {}); await srv.close(); }
await fs.writeFile(path.join(here, 'completeness2.json'), JSON.stringify(out, null, 1));
