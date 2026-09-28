// FR2-12 escalation-2: MCP-driven live verification of the GAP-284 fix (all 3 audit-5 repro
// shapes), through the real browser.navigate / browser.click / browser.go_back / browser.audit
// MCP tools over stdio. Watchdog 600s. MCP child + its Chrome killed by own PID only.
import fs from 'node:fs/promises';
import { startServer, mcpClient, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '10');
const OUT = outPath('probe-gap284-mcp-results.json');
const out = { trials: TR, shapes: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(600000, async () => { out.watchdog = true; await save(); });

const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1>', 'nf'));
  if (p === '/home') return res.writeHead(200, H), res.end(html('<h1>home</h1><a id=l href="/own404?from=home">broken link</a>', 'home'));
  res.writeHead(404); res.end();
});
const closedUrl = await (async () => { const { server: s, origin: o } = await startServer(() => {}); await new Promise((r) => s.close(r)); return o + '/'; })();

const m = await mcpClient('esc2-gap284-mcp');
const sid = await m.launch();
out.sessionId = sid;
const nav = (url) => m.call('browser.navigate', { sessionId: sid, url });
const push = (k, v) => { (out.shapes[k] ??= []).push(v); };

for (let t = 0; t < TR; t++) {
  // (1) own-404 -> about:blank -> audit
  await nav(`${origin}/own404?t=${t}a`); await sleep(200);
  await nav('about:blank'); await sleep(250);
  const a1 = await m.auditJson({ sessionId: sid });
  push('own404->about:blank', { url: a1.url, stale404: (a1.brokenRequests ?? []).some((b) => b.url.includes('/own404')), covers: a1.observation?.coversWholeDocument, err: a1.err });

  // (2) own-404 -> dead host (navigate fails, no real response) -> audit
  await nav(`${origin}/own404?t=${t}b`); await sleep(200);
  await nav(closedUrl).catch(() => null); await sleep(300);
  const a2 = await m.auditJson({ sessionId: sid });
  push('own404->neterror', { url: a2.url, stale404: (a2.brokenRequests ?? []).some((b) => b.url.includes('/own404')), covers: a2.observation?.coversWholeDocument, err: a2.err });

  // (3) home -> click a broken link (own 404) -> go_back (bfcache restore of home) -> audit
  await nav(`${origin}/home?t=${t}`); await sleep(200);
  await m.call('browser.click', { sessionId: sid, target: '#l' }).catch(() => null); await sleep(500);
  await m.call('browser.go_back', { sessionId: sid }); await sleep(300);
  const a3 = await m.auditJson({ sessionId: sid });
  push('home->click404->go_back', { url: a3.url, stale404: (a3.brokenRequests ?? []).some((b) => b.url.includes('/own404')), covers: a3.observation?.coversWholeDocument, err: a3.err });
  await save();
}

const summary = Object.fromEntries(Object.entries(out.shapes).map(([k, v]) => [k, {
  n: v.length,
  stale404Reported: v.filter((x) => x.stale404).length,
  coversTrue: v.filter((x) => x.covers === true).length,
  errors: v.filter((x) => x.err).length,
}]));
out.summary = summary;
try { await m.call('browser.shutdown', { sessionId: sid }); } catch {}
await m.close();
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
