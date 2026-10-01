// AUDIT-3 functional re-check over MCP (real Chrome): navigate+eval recorded; tab view (default) vs session view;
// closed-tab entries kept in the session view; scope+tabId error; unknown session error; eviction exactly at 199/200/201
// for BOTH scopes (and the note text). Usage: node func3.mjs <mcp-js> <label>
import fs from 'node:fs/promises'; import path from 'node:path';
import { here, mcpClient, startServer } from './lib.mjs';
const [mcpPath, label] = process.argv.slice(2);
const srv = await startServer();
const c = mcpClient(path.resolve(mcpPath));
const out = { label };
const H = async (args) => (await c.tool('browser.get_action_history', args)).json;
try {
  await c.init();
  const L = await c.tool('browser.launch', { headless: true });
  const sid = L.json.sessionId; const b = { sessionId: sid };
  out.afterLaunch = (await H({ ...b, scope: 'session' })).entries.length;
  await c.tool('browser.navigate', { ...b, url: srv.origin + '/p' });
  await c.tool('browser.eval', { ...b, code: '1+1' });
  const t1 = await H(b);
  out.tab1 = { tabId: t1.tabId, types: t1.entries.map((e) => e.actionType), scope: t1.scope, keysFirst: Object.keys(t1.entries[0] ?? {}) };
  const nt = await c.tool('browser.new_tab', { ...b, url: srv.origin + '/p2' });
  out.newTabKeys = Object.keys(nt.json ?? {}); const tab2 = nt.json?.tabId ?? nt.json?.id ?? nt.json?.tab?.tabId ?? nt.json?.tab?.id;
  await c.tool('browser.eval', { ...b, tabId: tab2, code: '2+2' });
  await c.tool('browser.navigate', { ...b, tabId: tab2, url: srv.origin + '/p' });
  out.tab2View = (await H({ ...b, tabId: tab2 })).entries.map((e) => e.actionType);
  await c.tool('browser.close_tab', { ...b, tabId: tab2 });
  const ses = await H({ ...b, scope: 'session' });
  out.sessionAfterClose = ses.entries.map((e) => [e.seq, e.actionType, e.tabId === tab2 ? 'tab2' : e.tabId === out.tab1.tabId ? 'tab1' : e.tabId]);
  out.seqContiguous = ses.entries.every((e, i) => e.seq === ses.entries[0].seq + i);
  out.tab1AfterClose = (await H({ ...b, tabId: out.tab1.tabId })).entries.map((e) => e.actionType); out.defaultViewAfterClose = (await H(b)).tabId;
  out.errScopeTab = (await c.tool('browser.get_action_history', { ...b, scope: 'session', tabId: out.tab1.tabId })).text.slice(0, 160);
  out.errUnknown = (await c.tool('browser.get_action_history', { sessionId: 'nope', scope: 'session' })).text.slice(0, 160);
  // eviction: the session already holds N entries; fill to exactly 199, 200, 201 in the active tab (tab1)
  const ev = [];
  const fillTo = async (n) => { for (;;) { const s = await H({ ...b, scope: 'session' }); const have = s.entries.length + s.evicted; if (have >= n) return; await c.tool('browser.eval', { ...b, code: 'void ' + have }); } };
  for (const n of [199, 200, 201, 202, 205]) {
    await fillTo(n);
    const s = await H({ ...b, scope: 'session' }); const t = await H(b);
    ev.push({ total: n, session: { len: s.entries.length, evicted: s.evicted, cap: s.capacity, note: s.note ?? null, firstSeq: s.entries[0].seq, lastSeq: s.entries.at(-1).seq }, tab: { len: t.entries.length, evicted: t.evicted, note: t.note ?? null } });
  }
  out.eviction = ev;
  await c.tool('browser.shutdown_all', {});
} catch (e) { out.fatal = String(e.stack ?? e); } finally { c.kill(); await srv.close(); }
await fs.writeFile(path.join(here, 'func3-' + label + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
