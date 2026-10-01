// AUDIT-4 functional re-check over MCP (real Chrome): navigate + eval recorded; tab view default; session view by seq incl.
// a closed tab; scope+tabId and unknown session errors; eviction at 199/200/201 (both scopes) and with a 2nd tab;
// verification deep-equal to sanitizeHistoryEntry(result).verification; entry keys; title/dialog/console never stored.
// Usage: node func4.mjs <mcp-js> <label>
import fs from 'node:fs/promises'; import path from 'node:path'; import http from 'node:http';
import { isDeepStrictEqual } from 'node:util'; import { pathToFileURL } from 'node:url';
import { here, repo, mcpClient } from './lib4.mjs';
const [mcpPath, label] = process.argv.slice(2);
const B = await import(pathToFileURL(path.join(repo, 'packages/browser/dist/index.js')).href);
const PAGE = '<!doctype html><title>TitleA4Lttl</title><button id="b" onclick="document.getElementById(\'o\').textContent=\'x\';console.log(\'ConsA4Llog\')">B</button><div id="o"></div><button id="al" onclick="alert(\'DlgA4Lmsg\')">A</button><iframe name="FrmA4Lname" srcdoc="<p>in</p>"></iframe>';
const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const O = 'http://127.0.0.1:' + server.address().port;
const out = { label };
const c = mcpClient(path.resolve(mcpPath));
const t0 = performance.now();
try {
  await c.init();
  const sid = (await c.tool('browser.launch', { headless: true })).json.sessionId;
  const call = (n, a = {}, t) => c.tool(n, { sessionId: sid, ...a }, t);
  const hist = async (a = {}) => (await call('browser.get_action_history', a)).json;
  const nav = await call('browser.navigate', { url: O + '/p?q=1' });
  const ev = await call('browser.eval', { code: 'document.title' });
  const clk = await call('browser.click', { target: '#b' });
  await call('browser.click', { target: '#al' });
  await call('browser.get_pending_dialog', {});
  await call('browser.handle_dialog', { action: 'accept' });
  const h1 = await hist();
  out.basic = { types: h1.entries.map((e) => e.actionType), scope: h1.scope, tabId: h1.tabId, evicted: h1.evicted, capacity: h1.capacity, note: h1.note ?? null, keys: [...new Set(h1.entries.flatMap(Object.keys))].sort(), navTarget: h1.entries[0].target, evalTarget: h1.entries[1].target, evalHasVerification: 'verification' in h1.entries[1], storedForbidden: (JSON.stringify(h1).match(/a4l[a-z]+/gi) ?? []) };
  // verification deep-equality against the SANITIZED result
  out.rawResults = { nav: nav.text.slice(0, 300), clk: clk.text.slice(0, 300) };
  const want = (r) => B.sanitizeHistoryEntry({ actionType: 'x', success: true, executionTimeMs: 0, timestamp: 't', verification: r.json.verification }).verification;
  try { out.verifEqual = { navigate: isDeepStrictEqual(want(nav), h1.entries[0].verification), click: isDeepStrictEqual(want(clk), h1.entries[2].verification), navRawDiffers: !isDeepStrictEqual(nav.json.verification, h1.entries[0].verification) }; } catch (e) { out.verifEqualErr = e.message; console.log(JSON.stringify(out.rawResults)); }
  // second tab, action, close it; session view keeps it
  const nt = (await call('browser.new_tab', { url: O + '/t2' })).json;
  const t2 = nt.tabId ?? nt.id;
  await call('browser.click', { target: '#b', tabId: t2 });
  await call('browser.focus_tab', { tabId: h1.tabId });
  await call('browser.eval', { code: '1+1' });
  await call('browser.close_tab', { tabId: t2 });
  const s1 = await hist({ scope: 'session' });
  const seqs = s1.entries.map((e) => e.seq);
  out.session = { n: s1.entries.length, contiguous: seqs.every((s, i) => i === 0 || s === seqs[i - 1] + 1), closedTabEntries: s1.entries.filter((e) => e.tabId === t2).map((e) => e.actionType), reportTabId: s1.tabId ?? null, scope: s1.scope };
  const tv = await hist();
  out.tabDefault = { onlyActiveTab: tv.entries.every((e) => !('tabId' in e)), n: tv.entries.length, hasSeq: tv.entries.some((e) => 'seq' in e) };
  out.errors = { scopeAndTab: (await call('browser.get_action_history', { scope: 'session', tabId: h1.tabId })).text.slice(0, 120), closedTab: (await call('browser.get_action_history', { tabId: t2 })).text.slice(0, 120), badScope: (await call('browser.get_action_history', { scope: 'all' })).isError, unknownSession: (await c.tool('browser.get_action_history', { sessionId: 'nope' })).text.slice(0, 120) };
  // eviction: fill the tab to exactly 199, 200, 201
  let n = tv.entries.length; let nSes = s1.entries.length;
  const ev2 = [];
  for (const target of [199, 200, 201, 205]) {
    while (n < target) { await call('browser.eval', { code: String(n) + '+0' }); n++; nSes++; }
    const a = await hist(); const b = await hist({ scope: 'session' });
    ev2.push({ tabTotal: target, tabLen: a.entries.length, tabEvicted: a.evicted, tabNote: a.note ?? null, firstTarget: a.entries[0].target, sesTotal: nSes, sesLen: b.entries.length, sesEvicted: b.evicted, sesFirstSeq: b.entries[0].seq, sesNote: b.note ?? null });
  }
  out.eviction = ev2;
  await c.tool('browser.shutdown_all', {});
} finally { c.kill(); server.close(); }
out.ms = Math.round(performance.now() - t0);
await fs.writeFile(path.join(here, 'func4-' + label + '.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
