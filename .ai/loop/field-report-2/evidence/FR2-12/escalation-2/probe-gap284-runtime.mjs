// FR2-12 escalation-2: runtime-direct live verification of the GAP-284 fix (loaderId-based
// invalidation of BrowserTab's own-status capture) and GAP-285 (bfcache commit-time rescoping),
// plus two residual-risk checks named in the escalation-2 brief: redirect chains and
// same-document navigations. Watchdog 480s. Chrome killed by own PID only.
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '10');
const OUT = outPath('probe-gap284-runtime-results.json');
const out = { trials: TR, shapes: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(480000, async () => { out.watchdog = true; await save(); });

const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1>', 'nf'));
  if (p === '/home') return res.writeHead(200, H), res.end(html('<h1>home</h1><a id=l href="/own404?from=home">broken link</a>', 'home'));
  if (p === '/clean') return res.writeHead(200, H), res.end(html('<h1>clean</h1>', 'clean'));
  if (p === '/homeerr') return res.writeHead(200, H), res.end(html('<h1>home</h1><script>console.error("HOME-OWN-ERR");fetch("/home-own-missing")</script>', 'homeerr'));
  if (p === '/redir') return res.writeHead(302, { ...H, Location: '/redir-final' }), res.end();
  if (p === '/redir-final') return res.writeHead(200, H), res.end(html('<h1>final</h1>', 'final'));
  if (p === '/hash1') return res.writeHead(200, H), res.end(html('<h1>hash</h1><script>console.error("HASH-OWN-ERR")</script>', 'hash'));
  res.writeHead(404); res.end('nf');
});
const closedUrl = await (async () => { const { server: s, origin: o } = await startServer(() => {}); await new Promise((r) => s.close(r)); return o + '/'; })();

const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);

const push = (k, v) => { (out.shapes[k] ??= []).push(v); };

// (1) GAP-284 shape 1: own-404 -> about:blank -> audit(). The stale 404 must NOT be reported.
for (let t = 0; t < TR; t++) {
  const { id: tabId } = await runtime.createTab(sid);
  await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
  await sleep(250);
  await runtime.navigate(sid, 'about:blank', tabId);
  await sleep(250);
  const a = await runtime.audit(sid, { tabId });
  push('own404->about:blank', { url: a.url, stale404: a.brokenRequests.some((b) => b.url.includes('/own404')), covers: a.observation.coversWholeDocument });
  await runtime.closeTab(sid, tabId);
}

// (2) GAP-284 shape 2: own-404 -> dead host (Chrome's own synthetic error page, no real response) -> audit().
for (let t = 0; t < TR; t++) {
  const { id: tabId } = await runtime.createTab(sid);
  await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
  await sleep(250);
  try { await runtime.navigate(sid, closedUrl, tabId); } catch { /* expected: connection refused */ }
  await sleep(250);
  const a = await runtime.audit(sid, { tabId });
  push('own404->deadhost', { url: a.url, stale404: a.brokenRequests.some((b) => b.url.includes('/own404')), covers: a.observation.coversWholeDocument });
  await runtime.closeTab(sid, tabId);
}

// (3) GAP-284 shape 3: home -> click a broken link (own 404) -> go_back (bfcache restore of home) -> audit.
for (let t = 0; t < TR; t++) {
  const { id: tabId } = await runtime.createTab(sid);
  await runtime.navigate(sid, `${origin}/home?t=${t}`, tabId);
  await sleep(250);
  await runtime.click(sid, '#l', tabId).catch(() => null);
  await sleep(400);
  await runtime.goBack(sid, tabId);
  await sleep(300);
  const a = await runtime.audit(sid, { tabId });
  push('home->click404->go_back', { url: a.url, stale404: a.brokenRequests.some((b) => b.url.includes('/own404')), covers: a.observation.coversWholeDocument });
  await runtime.closeTab(sid, tabId);
}

// (4) GAP-285: a page with its OWN load-time console error + own 404 fetch, navigate away, then
// bfcache-restore it. Its own error/404 must be KEPT (not dropped by the since-boundary moving to
// the restore instant).
for (let t = 0; t < TR; t++) {
  const { id: tabId } = await runtime.createTab(sid);
  await runtime.navigate(sid, `${origin}/homeerr?t=${t}`, tabId);
  await sleep(400);
  await runtime.navigate(sid, `${origin}/clean?t=${t}`, tabId);
  await sleep(250);
  await runtime.goBack(sid, tabId);
  await sleep(300);
  const a = await runtime.audit(sid, { tabId });
  push('homeerr->clean->go_back(own kept)', {
    url: a.url,
    ownErrKept: a.consoleErrors.some((e) => e.text.includes('HOME-OWN-ERR')),
    own404Kept: a.brokenRequests.some((b) => b.url.includes('home-own-missing')),
    covers: a.observation.coversWholeDocument,
  });
  await runtime.closeTab(sid, tabId);
}

// (5) Residual check #1 (redirect chain): a 302 hop followed immediately by its final 200
// document must never have its intermediate hop wrongly clear the eventual real response, nor
// leak a PREVIOUS page's status through the hop.
for (let t = 0; t < TR; t++) {
  const { id: tabId } = await runtime.createTab(sid);
  await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
  await sleep(250);
  await runtime.navigate(sid, `${origin}/redir?t=${t}`, tabId);
  await sleep(300);
  const a = await runtime.audit(sid, { tabId });
  push('own404->redirect-chain(no stale, no wrong-clear)', {
    url: a.url,
    stale404FromOwn404: a.brokenRequests.some((b) => b.url.includes('/own404')),
    landedOnFinal: a.url.includes('/redir-final'),
    covers: a.observation.coversWholeDocument,
  });
  await runtime.closeTab(sid, tabId);
}

// (6) Residual check #2 (same-document navigation, GAP-266 territory): a hash change must NEVER
// be treated as a commit that could clear the own-status capture or move `since` forward — the
// page's own error logged before the hash change must stay visible.
for (let t = 0; t < TR; t++) {
  const { id: tabId } = await runtime.createTab(sid);
  await runtime.navigate(sid, `${origin}/hash1?t=${t}`, tabId);
  await sleep(300);
  await runtime.eval(sid, 'history.pushState({}, "", location.pathname + "#x")', tabId).catch(() => null);
  await sleep(150);
  const a = await runtime.audit(sid, { tabId });
  push('hash-change-preserves-own-error', {
    url: a.url,
    ownErrKept: a.consoleErrors.some((e) => e.text.includes('HASH-OWN-ERR')),
    covers: a.observation.coversWholeDocument,
  });
  await runtime.closeTab(sid, tabId);
}

const summary = {};
for (const [k, v] of Object.entries(out.shapes)) {
  if (k.startsWith('homeerr')) {
    summary[k] = { n: v.length, ownErrKept: v.filter((x) => x.ownErrKept).length, own404Kept: v.filter((x) => x.own404Kept).length, coversTrue: v.filter((x) => x.covers === true).length };
  } else if (k.startsWith('hash-change')) {
    summary[k] = { n: v.length, ownErrKept: v.filter((x) => x.ownErrKept).length, coversTrue: v.filter((x) => x.covers === true).length };
  } else if (k.startsWith('own404->redirect-chain')) {
    summary[k] = { n: v.length, stale404FromOwn404: v.filter((x) => x.stale404FromOwn404).length, landedOnFinal: v.filter((x) => x.landedOnFinal).length };
  } else {
    summary[k] = { n: v.length, stale404Reported: v.filter((x) => x.stale404).length, coversTrue: v.filter((x) => x.covers === true).length };
  }
}
out.summary = summary;
try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
