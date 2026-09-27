// FR2-12 audit-5: GAP-278 core repro (audit-4's exact attack), at 0/150/800ms clean-page TTFB, through
// runtime.audit() directly AND the real MCP browser.audit tool. navigate(noisy) -> 400ms -> navigate(clean)
// -> audit() with no url. Also: URL-mode control, and an "own findings kept" check on the clean page
// variant that has its own error (so a too-late boundary would be caught too). Watchdog 900s.
import fs from 'node:fs/promises';
import { loadRuntime, installCdpCounters, cdpSummary, startServer, chromePidOf, mcpClient, cap, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';
const TR = Number(process.argv[2] ?? '15');
const OUT = outPath('probe-gap278.json');
const out = { trials: TR, runtime: {}, mcp: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(900000, async () => { out.watchdog = true; await save(); });
await installCdpCounters();
const { SutradharRuntime } = await loadRuntime();
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/noisy') return res.writeHead(200, H), res.end(html('<h1>noisy</h1><script>setInterval(function(){console.error("OLDPAGE-err");fetch("/oldpage-missing-"+Math.random())},20)</script>', 'noisy'));
  if (p === '/clean') { const d = Number(u.searchParams.get('d') ?? 0); return void setTimeout(() => { res.writeHead(200, H); res.end(html('<h1>clean</h1>', 'clean')); }, d); }
  // clean page that has exactly ONE own console error and ONE own 404 (checks the boundary isn't too late)
  if (p === '/own') { const d = Number(u.searchParams.get('d') ?? 0); return void setTimeout(() => { res.writeHead(200, H); res.end(html('<h1>own</h1><script>console.error("NEWPAGE-own")</script><img alt=x src="/newpage-missing">', 'own')); }, d); }
  res.writeHead(404); res.end('nf');
});
const classify = (a) => {
  if (!a || a.err) return { err: a?.err ?? 'none' };
  return {
    oldConsole: a.consoleErrors.filter((e) => /OLDPAGE/.test(e.text)).length,
    oldBroken: a.brokenRequests.filter((b) => /oldpage-missing/.test(b.url)).length,
    ownConsole: a.consoleErrors.filter((e) => /NEWPAGE-own/.test(e.text)).length,
    ownBroken: a.brokenRequests.filter((b) => /newpage-missing/.test(b.url)).length,
    covers: a.observation.coversWholeDocument,
  };
};
const summarize = (arr, own) => ({
  n: arr.length,
  leaked: arr.filter((x) => x.oldConsole > 0 || x.oldBroken > 0).length,
  errors: arr.filter((x) => x.err).length,
  ...(own ? { ownDropped: arr.filter((x) => !x.err && (x.ownConsole < 1 || x.ownBroken < 1)).length } : {}),
  coversFalse: arr.filter((x) => x.covers === false).length,
});

// ---- runtime direct
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
for (const d of [0, 150, 800]) {
  const cp = []; const own = []; const urlm = [];
  for (let t = 0; t < TR; t++) {
    await runtime.navigate(sid, `${origin}/noisy?t=${t}`); await sleep(400);
    await runtime.navigate(sid, `${origin}/clean?d=${d}&t=${t}`);
    cp.push(classify(await cap(runtime.audit(sid, {}), 60000, 'cp').catch((e) => ({ err: e.message }))));
    await runtime.navigate(sid, `${origin}/noisy?o=${t}`); await sleep(400);
    await runtime.navigate(sid, `${origin}/own?d=${d}&o=${t}`); await sleep(300);
    own.push(classify(await cap(runtime.audit(sid, {}), 60000, 'own').catch((e) => ({ err: e.message }))));
    if (t < 5) {
      await runtime.navigate(sid, `${origin}/noisy?u=${t}`); await sleep(400);
      urlm.push(classify(await cap(runtime.audit(sid, { url: `${origin}/clean?d=${d}&u=${t}`, settleMs: 300 }), 60000, 'url').catch((e) => ({ err: e.message }))));
    }
  }
  out.runtime[`d${d}`] = { currentPage: summarize(cp), currentPageOwnPage: summarize(own, true), urlModeControl: summarize(urlm), raw: { cp, own, urlm } };
  await save();
  console.log('runtime d' + d, JSON.stringify(out.runtime[`d${d}`].currentPage), JSON.stringify(out.runtime[`d${d}`].currentPageOwnPage), JSON.stringify(out.runtime[`d${d}`].urlModeControl));
}
out.runtimeCdp = cdpSummary();
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}

// ---- MCP stdio
try {
  const m = await mcpClient('audit5-gap278');
  const msid = await m.launch();
  out.mcp.sessionId = msid;
  for (const d of [0, 150, 800]) {
    const cp = []; const own = [];
    for (let t = 0; t < TR; t++) {
      await m.call('browser.navigate', { sessionId: msid, url: `${origin}/noisy?m=${t}` }); await sleep(400);
      await m.call('browser.navigate', { sessionId: msid, url: `${origin}/clean?d=${d}&m=${t}` });
      cp.push(classify(await m.auditJson({ sessionId: msid })));
      await m.call('browser.navigate', { sessionId: msid, url: `${origin}/noisy?mo=${t}` }); await sleep(400);
      await m.call('browser.navigate', { sessionId: msid, url: `${origin}/own?d=${d}&mo=${t}` }); await sleep(300);
      own.push(classify(await m.auditJson({ sessionId: msid })));
    }
    out.mcp[`d${d}`] = { currentPage: summarize(cp), currentPageOwnPage: summarize(own, true), raw: { cp, own } };
    await save();
    console.log('mcp d' + d, JSON.stringify(out.mcp[`d${d}`].currentPage), JSON.stringify(out.mcp[`d${d}`].currentPageOwnPage));
  }
  try { await m.call('browser.shutdown', { sessionId: msid }); } catch {}
  await m.close();
} catch (e) { out.mcp.error = String(e.message ?? e); console.log('mcp error', out.mcp.error); }
stopWd(); killAll(); server.close(); await save();
process.exit(0);
