// FR2-12 audit-6: fresh-tab setup race in the tab-level own-status capture (current-page mode).
// Hypothesis (from probe-a6-loaderid's "harness own404->hash/push/replace x3" 0/5): when a tab is
// navigated right after creation, BrowserTab.setupCommitTracking's fire-and-forget CDP setup has not
// yet learned the main frame id (Page.getFrameTree still pending) when the main Document response
// arrives, so the response is dropped; the commit then lands, moving `since` past the ring-buffer
// copy of that response; the URL-match fallback then fails whenever the final URL != response URL
// (hash / replaceState / chrome-error empty-body) -> the page's own 4xx/5xx vanishes with
// coversWholeDocument:true. Measured via runtime, MCP (browser.new_tab{url}, launch->navigate) and
// with a delay control.  Usage: node probe-a6-freshtab.mjs <trials>
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, mcpClient, sleep, watchdog, killAll, outPath, cap, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '10');
const OUT = outPath('probe-a6-freshtab.json');
const out = { trials: TR, rows: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(1700000, async () => { out.watchdog = true; await save(); });
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/h404') return res.writeHead(404, H), res.end(html('<h1>nf</h1><script>location.hash="top"</script>'));
  if (p === '/rs404') return res.writeHead(404, H), res.end(html('<h1>nf</h1><script>history.replaceState(null,"","/rewritten-"+Math.random())</script>'));
  if (p === '/e404') { res.writeHead(404, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1>'));
  res.writeHead(200, H); res.end(html('<h1>ok</h1>'));
});
const SHAPES = ['/h404', '/rs404', '/e404', '/own404'];
const push = (k, v) => { (out.rows[k] ??= []).push(v); };
const ownOf = (a, p) => (a.brokenRequests ?? []).some((b) => b.url.includes(p) && b.status === 404);

// ---- runtime: createTab -> navigate immediately / after 1000ms
{
  const { SutradharRuntime } = await loadRuntime();
  const runtime = new SutradharRuntime({});
  const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
  chromePidOf(runtime, sid);
  for (let t = 0; t < TR; t++) {
    for (const p of SHAPES) {
      for (const delay of [0, 1000]) {
        const { id: tabId } = await runtime.createTab(sid);
        const tab = runtime['resolveTab'](sid, tabId).tab;
        if (delay) await sleep(delay);
        try { await runtime.navigate(sid, `${origin}${p}?t=${t}&d=${delay}`, tabId); } catch {}
        await sleep(400);
        const capNow = tab.getLastMainDocumentResponse?.() ?? null;
        const a = await cap(runtime.audit(sid, { tabId }), 60000, 'a');
        push(`runtime createTab ${p} delay${delay}`, { own: ownOf(a, p), covers: a.observation.coversWholeDocument, cap: !!capNow, url: a.url, nConsole: a.consoleErrors.length, nBroken: a.brokenRequests.length, nPage: a.pageErrors.length });
        await runtime.closeTab(sid, tabId).catch(() => {});
      }
    }
    await save();
  }
  // first tab of a fresh launch, navigated immediately
  for (let t = 0; t < Math.min(TR, 5); t++) {
    for (const p of ['/h404', '/e404']) {
      const { sessionId: s2 } = await runtime.launch({ launch: { headless: true } });
      chromePidOf(runtime, s2);
      try { await runtime.navigate(s2, `${origin}${p}?launch=${t}`); } catch {}
      await sleep(400);
      const a = await cap(runtime.audit(s2, {}), 60000, 'a');
      push(`runtime launch->navigate ${p}`, { own: ownOf(a, p), covers: a.observation.coversWholeDocument, url: a.url });
      try { await runtime.shutdown(s2); } catch {}
    }
    await save();
  }
  try { await runtime.shutdown(sid); } catch {}
}

// ---- MCP: browser.new_tab {url} -> browser.audit {tabId}; and launch -> navigate -> audit
{
  const m = await mcpClient('audit6-freshtab');
  const sid = await m.launch();
  for (let t = 0; t < TR; t++) {
    for (const p of SHAPES) {
      const r = await m.call('browser.new_tab', { sessionId: sid, url: `${origin}${p}?mcp=${t}` });
      const tabId = (m.text(r).match(/tab_[A-Za-z0-9_]+/) || [])[0];
      await sleep(400);
      const a = await m.auditJson({ sessionId: sid, tabId });
      push(`mcp new_tab{url} ${p}`, { own: ownOf(a, p), covers: a.observation?.coversWholeDocument, url: a.url, err: a.err, tabId, nConsole: (a.consoleErrors ?? []).length, nBroken: (a.brokenRequests ?? []).length });
      if (tabId) await m.call('browser.close_tab', { sessionId: sid, tabId }).catch(() => {});
    }
    await save();
  }
  try { await m.call('browser.shutdown', { sessionId: sid }); } catch {}
  for (let t = 0; t < Math.min(TR, 5); t++) {
    for (const p of ['/h404', '/e404']) {
      const s2 = await m.launch();
      await m.call('browser.navigate', { sessionId: s2, url: `${origin}${p}?mcplaunch=${t}` });
      await sleep(400);
      const a = await m.auditJson({ sessionId: s2 });
      push(`mcp launch->navigate ${p}`, { own: ownOf(a, p), covers: a.observation?.coversWholeDocument, url: a.url, err: a.err, nConsole: (a.consoleErrors ?? []).length, nBroken: (a.brokenRequests ?? []).length });
      try { await m.call('browser.shutdown', { sessionId: s2 }); } catch {}
    }
    await save();
  }
  await m.close();
}

out.summary = Object.fromEntries(Object.entries(out.rows).map(([k, v]) => [k, {
  n: v.length, ownReported: v.filter((x) => x.own).length,
  droppedWithCoversTrue: v.filter((x) => !x.own && x.covers === true).length, fullyCleanFalseReport: v.filter((x) => !x.own && x.covers === true && x.nConsole === 0 && x.nBroken === 0).length,
  capPresent: v.some((x) => 'cap' in x) ? v.filter((x) => x.cap).length : undefined,
  errors: v.filter((x) => x.err).length || undefined,
}]));
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out.summary, null, 1));
process.exit(0);
