// FR2-12 audit-5: A5-1 / A5-2 through the real MCP server over stdio (browser.navigate / browser.go_back /
// browser.audit with no url). Watchdog 600s. MCP child + its Chrome killed by own PID only.
import fs from 'node:fs/promises';
import { startServer, mcpClient, cap, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';
const TR = Number(process.argv[2] ?? '10');
const OUT = outPath('probe-a51-mcp.json');
const out = { trials: TR, shapes: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(600000, async () => { out.watchdog = true; await save(); });
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/own404') return res.writeHead(404, H), res.end(html('<h1>not found</h1>', 'nf'));
  if (p === '/home') return res.writeHead(200, H), res.end(html('<h1>home</h1><a id=l href="/own404?from=home">broken link</a>', 'home'));
  if (p === '/homeerr') return res.writeHead(200, H), res.end(html('<h1>home</h1><script>console.error("HOME-OWN-ERR");fetch("/home-own-missing")</script>', 'homeerr'));
  if (p === '/clean') return res.writeHead(200, H), res.end(html('<h1>clean</h1>', 'clean'));
  res.writeHead(404); res.end();
});
const closedUrl = await (async () => { const { server: s, origin: o } = await startServer(() => {}); await new Promise((r) => s.close(r)); return o + '/'; })();
const m = await mcpClient('audit5-a51');
const sid = await m.launch();
out.sessionId = sid;
const nav = (url) => m.call('browser.navigate', { sessionId: sid, url });
const push = (k, v) => { (out.shapes[k] ??= []).push(v); };
for (let t = 0; t < TR; t++) {
  // (1) own-404 -> about:blank -> audit
  await nav(`${origin}/own404?t=${t}a`); await sleep(200);
  const r1 = await nav('about:blank'); await sleep(200);
  const a1 = await m.auditJson({ sessionId: sid });
  push('own404->about:blank', { navText: m.text(r1).slice(0, 80), url: a1.url, stale404: (a1.brokenRequests ?? []).some((b) => b.url.includes('/own404')), covers: a1.observation?.coversWholeDocument, err: a1.err });
  // (2) own-404 -> dead host (navigate fails) -> audit
  await nav(`${origin}/own404?t=${t}b`); await sleep(200);
  const r2 = await nav(closedUrl); await sleep(300);
  const a2 = await m.auditJson({ sessionId: sid });
  push('own404->neterror', { navText: m.text(r2).slice(0, 80), url: a2.url, stale404: (a2.brokenRequests ?? []).some((b) => b.url.includes('/own404')), covers: a2.observation?.coversWholeDocument, err: a2.err });
  // (3) home -> click broken link (own 404) -> go_back -> audit home
  await nav(`${origin}/home?t=${t}`); await sleep(200);
  await m.call('browser.click', { sessionId: sid, target: '#l' }).catch(() => null); await sleep(500);
  const back = await m.call('browser.go_back', { sessionId: sid }); await sleep(300);
  const persisted = await m.call('browser.eval', { sessionId: sid, expression: 'performance.getEntriesByType("navigation")[0].type + "/" + document.title' });
  const a3 = await m.auditJson({ sessionId: sid });
  push('home->click404->go_back', { back: m.text(back).slice(0, 80), page: m.text(persisted).slice(0, 80), url: a3.url, stale404: (a3.brokenRequests ?? []).some((b) => b.url.includes('/own404')), covers: a3.observation?.coversWholeDocument, err: a3.err });
  // (4) A5-2: homeerr (own error + own 404 fetch) -> clean -> go_back -> audit: own findings kept?
  await nav(`${origin}/homeerr?t=${t}`); await sleep(500);
  await nav(`${origin}/clean?t=${t}`); await sleep(200);
  await m.call('browser.go_back', { sessionId: sid }); await sleep(300);
  const a4 = await m.auditJson({ sessionId: sid });
  push('homeerr->clean->go_back', { url: a4.url, ownErr: (a4.consoleErrors ?? []).some((e) => e.text.includes('HOME-OWN-ERR')), own404: (a4.brokenRequests ?? []).some((b) => b.url.includes('home-own-missing')), covers: a4.observation?.coversWholeDocument, err: a4.err });
  await save();
}
out.summary = Object.fromEntries(Object.entries(out.shapes).map(([k, v]) => [k, k.startsWith('homeerr')
  ? { n: v.length, own404Dropped: v.filter((x) => !x.own404).length, ownErrDropped: v.filter((x) => !x.ownErr).length, coversTrue: v.filter((x) => x.covers === true).length, errors: v.filter((x) => x.err).length }
  : { n: v.length, stale404Reported: v.filter((x) => x.stale404).length, coversTrue: v.filter((x) => x.covers === true).length, errors: v.filter((x) => x.err).length }]));
try { await m.call('browser.shutdown', { sessionId: sid }); } catch {}
await m.close();
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out.summary, null, 1));
for (const [k, v] of Object.entries(out.shapes)) console.log(k, JSON.stringify(v[0]).replace(/http:\/\/127\.0\.0\.1:\d+/g, ''));
process.exit(0);
