// FR2-12 audit-6: GAP-284 core repro through the REAL MCP stdio server (browser.navigate /
// browser.click / browser.go_back / browser.audit), plus GAP-285 residual and the spec's own
// L12 shapes. Instrumented: server hit log confirms the broken link was visited; pageshow.persisted
// confirms bfcache. MCP child (and its Chrome, as a descendant) killed by own PID tree only.
// Usage: node probe-a6-284-mcp.mjs <trials>
import fs from 'node:fs/promises';
import { startServer, mcpClient, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '15');
const OUT = outPath('probe-a6-284-mcp.json');
const out = { trials: TR, shapes: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(1500000, async () => { out.watchdog = true; await save(); });

const hits = [];
const PS = '<script>window.__ps=[];addEventListener("pageshow",e=>window.__ps.push(e.persisted))</script>';
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  hits.push(p + u.search);
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1>' + PS, 'nf'));
  if (p === '/home') return res.writeHead(200, H), res.end(html(PS + '<h1>home</h1><a id=l href="/own404?from=home' + u.search.replace('?', '&') + '">broken link</a>', 'home'));
  if (p === '/clean') return res.writeHead(200, H), res.end(html(PS + '<h1>clean</h1>', 'clean'));
  if (p === '/homeerr') return res.writeHead(200, H), res.end(html(PS + '<h1>home</h1><script>console.error("HOME-OWN-ERR");fetch("/home-own-missing")</script>', 'homeerr'));
  if (p === '/noisy') return res.writeHead(200, H), res.end(html('<h1>noisy</h1><script>console.error("NOISY-ERR");setTimeout(()=>{throw new Error("NOISY-PE")},0);fetch("/noisy-missing")</script><img src="/missing-noisy.png" alt=x>', 'noisy'));
  res.writeHead(404); res.end('nf');
});
const closedUrl = await (async () => { const { server: s, origin: o } = await startServer(() => {}); await new Promise((r) => s.close(r)); return o + '/'; })();

const m = await mcpClient('audit6-284-mcp');
const sid = await m.launch();
out.sessionId = sid;
const nav = (url) => m.call('browser.navigate', { sessionId: sid, url });
const push = (k, v) => { (out.shapes[k] ??= []).push(v); };
const ps = async () => m.text(await m.call('browser.eval', { sessionId: sid, code: 'JSON.stringify(window.__ps||null)' }));
const own = (a) => (a.brokenRequests ?? []).some((b) => b.url.includes('/own404'));

for (let t = 0; t < TR; t++) {
  await nav(`${origin}/own404?t=${t}a`); await sleep(200);
  await nav('about:blank'); await sleep(250);
  const a1 = await m.auditJson({ sessionId: sid });
  push('S1 own404->about:blank', { url: a1.url, stale404: own(a1), covers: a1.observation?.coversWholeDocument, err: a1.err });

  await nav(`${origin}/own404?t=${t}b`); await sleep(200);
  await nav(closedUrl).catch(() => null); await sleep(300);
  const a2 = await m.auditJson({ sessionId: sid });
  push('S2 own404->deadhost', { url: a2.url, stale404: own(a2), covers: a2.observation?.coversWholeDocument, err: a2.err });

  await nav(`${origin}/home?t=${t}`); await sleep(200);
  const before = hits.length;
  const clickRes = await m.call('browser.click', { sessionId: sid, target: '#l' }).catch((e) => ({ err: String(e) }));
  await sleep(500);
  const visited = hits.slice(before).some((h) => h.startsWith('/own404'));
  await m.call('browser.go_back', { sessionId: sid }); await sleep(300);
  const p3 = await ps();
  const a3 = await m.auditJson({ sessionId: sid });
  push('S3 home->click404->go_back', { url: a3.url, visited404: visited, clickIsError: !!clickRes?.isError, pageshow: p3, stale404: own(a3), covers: a3.observation?.coversWholeDocument, err: a3.err });

  await nav(`${origin}/homeerr?t=${t}`); await sleep(400);
  await nav(`${origin}/clean?t=${t}c`); await sleep(250);
  await m.call('browser.go_back', { sessionId: sid }); await sleep(300);
  const p4 = await ps();
  const a4 = await m.auditJson({ sessionId: sid });
  push('S4 homeerr->clean->go_back', {
    url: a4.url, pageshow: p4,
    ownErrKept: (a4.consoleErrors ?? []).some((e) => e.text.includes('HOME-OWN-ERR')),
    own404Kept: (a4.brokenRequests ?? []).some((b) => b.url.includes('home-own-missing')),
    foreign: (a4.brokenRequests ?? []).filter((b) => !b.url.includes('home-own-missing')).map((b) => b.url),
    covers: a4.observation?.coversWholeDocument, err: a4.err,
  });

  // spec L12 (a): noisy -> clean -> audit current page ; (b) noisy -> audit({url: clean})
  await nav(`${origin}/noisy?t=${t}`); await sleep(150);
  await nav(`${origin}/clean?t=${t}l12`); await sleep(150);
  const a5 = await m.auditJson({ sessionId: sid });
  push('L12a noisy->clean->audit()', { leak: (a5.consoleErrors ?? []).length + (a5.pageErrors ?? []).length + (a5.brokenRequests ?? []).length, covers: a5.observation?.coversWholeDocument, err: a5.err });
  await nav(`${origin}/noisy?t=${t}b`); await sleep(150);
  const a6 = await m.auditJson({ sessionId: sid, url: `${origin}/clean?t=${t}l12b` });
  push('L12b noisy->audit({url:clean})', { leak: (a6.consoleErrors ?? []).length + (a6.pageErrors ?? []).length + (a6.brokenRequests ?? []).length, covers: a6.observation?.coversWholeDocument, err: a6.err });
  await save();
}

const cnt = (k, f) => out.shapes[k].filter(f).length;
out.summary = {
  S1: { n: TR, stale: cnt('S1 own404->about:blank', (x) => x.stale404), coversTrue: cnt('S1 own404->about:blank', (x) => x.covers === true), errors: cnt('S1 own404->about:blank', (x) => x.err) },
  S2: { n: TR, stale: cnt('S2 own404->deadhost', (x) => x.stale404), coversTrue: cnt('S2 own404->deadhost', (x) => x.covers === true), errors: cnt('S2 own404->deadhost', (x) => x.err) },
  S3: { n: TR, visited404: cnt('S3 home->click404->go_back', (x) => x.visited404), bfcache: cnt('S3 home->click404->go_back', (x) => String(x.pageshow).includes('true')), stale: cnt('S3 home->click404->go_back', (x) => x.stale404), coversTrue: cnt('S3 home->click404->go_back', (x) => x.covers === true), errors: cnt('S3 home->click404->go_back', (x) => x.err) },
  S4: { n: TR, bfcache: cnt('S4 homeerr->clean->go_back', (x) => String(x.pageshow).includes('true')), ownErrKept: cnt('S4 homeerr->clean->go_back', (x) => x.ownErrKept), own404Kept: cnt('S4 homeerr->clean->go_back', (x) => x.own404Kept), foreignAny: cnt('S4 homeerr->clean->go_back', (x) => x.foreign?.length), coversTrue: cnt('S4 homeerr->clean->go_back', (x) => x.covers === true) },
  L12a: { n: TR, leaked: cnt('L12a noisy->clean->audit()', (x) => x.leak > 0), coversTrue: cnt('L12a noisy->clean->audit()', (x) => x.covers === true), errors: cnt('L12a noisy->clean->audit()', (x) => x.err) },
  L12b: { n: TR, leaked: cnt('L12b noisy->audit({url:clean})', (x) => x.leak > 0), coversTrue: cnt('L12b noisy->audit({url:clean})', (x) => x.covers === true), errors: cnt('L12b noisy->audit({url:clean})', (x) => x.err) },
};
try { await m.call('browser.shutdown', { sessionId: sid }); } catch {}
await m.close();
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out.summary, null, 1));
process.exit(0);
