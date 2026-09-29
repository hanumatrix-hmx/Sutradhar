// FR2-12 audit-6: adversarial attacks on escalation-2's loaderId-based invalidation.
//  2a redirect chains whose intermediate hop has no response / no commit
//  2b loaderId reuse / service-worker-served navigations / non-committing navigations (204, download)
//  2c same-document navs (pushState/replaceState/hash) interleaved with cross-document loads, at timings
//  2d a tab that never saw a Page.frameNavigated (fresh about:blank) and popup adoption
// Every audit here is CURRENT-PAGE mode unless noted (that's the mode using the tab-level capture).
// A raw CDP observer session logs frameNavigated/responseReceived loaderIds for the first trial.
// Usage: node probe-a6-loaderid.mjs <trials>
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, sleep, watchdog, killAll, outPath, cap, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '5');
const OUT = outPath('probe-a6-loaderid.json');
const out = { trials: TR, shapes: {}, cdpTraces: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(1700000, async () => { out.watchdog = true; await save(); });

const deadOrigin = await (async () => { const { server: s, origin: o } = await startServer(() => {}); await new Promise((r) => s.close(r)); return o; })();
const SW_JS = `self.addEventListener('install',e=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.pathname==='/sw/page404')e.respondWith(new Response('<html lang=en><title>sw404</title><body><h1>sw 404</h1></body></html>',{status:404,headers:{'Content-Type':'text/html'}}));
else if(u.pathname==='/sw/page200')e.respondWith(new Response('<html lang=en><title>sw200</title><body><h1>sw 200</h1></body></html>',{status:200,headers:{'Content-Type':'text/html'}}));});`;
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1><a id=nc href="/nocontent">nc</a><a id=dl href="/dl200">dl</a>', 'nf'));
  if (p === '/clean') return res.writeHead(200, H), res.end(html('<h1>clean</h1><a id=dl404 href="/dl404">dl404</a>', 'clean'));
  // 2a
  if (p === '/r302-dead') { res.writeHead(302, { Location: deadOrigin + '/x' }); return res.end(); }
  if (p === '/r1') { res.writeHead(302, { Location: '/r2' + u.search }); return res.end(); }
  if (p === '/r2') return res.writeHead(200, H), res.end(html('<script>location.replace("/final404' + u.search + '")</script>', 'r2'));
  if (p === '/final404') return res.writeHead(404, H), res.end(html('<h1>final 404</h1>', 'f404'));
  if (p === '/r1ok') { res.writeHead(302, { Location: '/r2ok' + u.search }); return res.end(); }
  if (p === '/r2ok') return res.writeHead(200, H), res.end(html('<script>location.replace("/finalok' + u.search + '")</script>', 'r2ok'));
  if (p === '/finalok') return res.writeHead(200, H), res.end(html('<h1>final ok</h1>', 'fok'));
  // intermediate hop is a NON-committing 204, then a real commit to a 404
  if (p === '/via204') return res.writeHead(200, H), res.end(html('<script>location.href="/nocontent";setTimeout(()=>location.replace("/final404?via204=1"),400)</script>', 'via204'));
  // intermediate hop is a 404 that JS-redirects to a page that 302s to a dead host (final: chrome-error)
  if (p === '/mid404') return res.writeHead(404, H), res.end(html('<script>location.replace("/r302-dead")</script>', 'mid404'));
  if (p === '/nocontent') { res.writeHead(204); return res.end(); }
  if (p === '/dl200') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=a.bin' }); return res.end('abc'); }
  if (p === '/dl404') { res.writeHead(404, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename=b.bin' }); return res.end('nope'); }
  // 2b service worker
  if (p === '/sw/reg') return res.writeHead(200, H), res.end(html('<script>navigator.serviceWorker.register("/sw/sw.js",{scope:"/sw/"}).then(()=>navigator.serviceWorker.ready).then(()=>{window.__swReady=true})</script>', 'reg'));
  if (p === '/sw/sw.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }), res.end(SW_JS);
  // 2c same-doc interleave: own 404 + console.error before, same-doc nav at D ms, console.error + fetch 404 after
  if (p === '/sd404') {
    const kind = u.searchParams.get('k'); const d = Number(u.searchParams.get('d'));
    const nav = kind === 'hash' ? 'location.hash="h"+Math.random()' : kind === 'push' ? 'history.pushState({},"","/pushed-"+Math.random())' : 'history.replaceState({},"","/replaced-"+Math.random())';
    const body = `<h1>sd</h1><script>console.error("SD-BEFORE");const go=()=>{${nav};console.error("SD-AFTER");fetch("/sd-missing-after")};${d === 0 ? 'go()' : `setTimeout(go,${d})`}</script>`;
    return res.writeHead(404, H), res.end(html(body, 'sd'));
  }
  // 2d popup opener
  if (p === '/opener') return res.writeHead(200, H), res.end(html('<h1>opener</h1><a id=pop href="/own404?popup=1" target=_blank>pop</a>', 'opener'));
  res.writeHead(404); res.end('nf');
});

const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const push = (k, v) => { (out.shapes[k] ??= []).push(v); };
const tabOf = (tabId) => runtime['resolveTab'](sid, tabId).tab;
const pageOf = (tabId) => runtime['requirePage'](tabOf(tabId));

async function tracer(tabId) {
  const c = await pageOf(tabId).createCDPSession();
  const ev = [];
  c.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) ev.push({ t: Date.now(), ev: 'frameNavigated', type: e.type, loaderId: e.frame.loaderId, url: e.frame.url }); });
  c.on('Page.navigatedWithinDocument', (e) => ev.push({ t: Date.now(), ev: 'withinDoc', url: e.url }));
  c.on('Network.responseReceived', (e) => { if (e.type === 'Document') ev.push({ t: Date.now(), ev: 'docResponse', loaderId: e.loaderId, status: e.response.status, url: e.response.url, frameId: e.frameId }); });
  await c.send('Page.enable'); await c.send('Network.enable');
  return { ev, done: async () => { try { await c.detach(); } catch {} } };
}
const has = (a, s) => a.brokenRequests.some((b) => b.url.includes(s));
async function withTab(name, t, fn, trace = false) {
  const { id: tabId } = await runtime.createTab(sid);
  const tr = trace && t === 0 ? await tracer(tabId) : null;
  try { push(name, await fn(tabId)); } catch (e) { push(name, { error: String(e.message).slice(0, 200) }); }
  if (tr) { out.cdpTraces[name] = tr.ev; await tr.done(); }
  await runtime.closeTab(sid, tabId).catch(() => {});
}
const cur = async (tabId) => cap(runtime.audit(sid, { tabId }), 60000, 'audit');

for (let t = 0; t < TR; t++) {
  // ---- 2a
  await withTab('2a own404 -> 302-to-deadhost', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId); await sleep(200);
    try { await runtime.navigate(sid, `${origin}/r302-dead?t=${t}`, tabId); } catch {}
    await sleep(300); const a = await cur(tabId);
    return { url: a.url, stale: has(a, '/own404'), broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  }, true);
  await withTab('2a own404 -> 302 -> 200(js) -> final404', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId); await sleep(200);
    await runtime.navigate(sid, `${origin}/r1?t=${t}`, tabId); await sleep(1200);
    const a = await cur(tabId);
    return { url: a.url, stale: has(a, '/own404'), finalReported: has(a, '/final404'), broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  }, true);
  await withTab('2a own404 -> 302 -> 200(js) -> finalok', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId); await sleep(200);
    await runtime.navigate(sid, `${origin}/r1ok?t=${t}`, tabId); await sleep(1200);
    const a = await cur(tabId);
    return { url: a.url, stale: has(a, '/own404'), any4xx: a.brokenRequests.length, broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  });
  await withTab('2a clean -> via204(js: 204 then final404)', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/clean?t=${t}`, tabId); await sleep(200);
    await runtime.navigate(sid, `${origin}/via204?t=${t}`, tabId); await sleep(1500);
    const a = await cur(tabId);
    return { url: a.url, finalReported: has(a, '/final404'), broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  }, true);
  await withTab('2a own404-other -> mid404(js) -> 302-to-deadhost', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId); await sleep(200);
    try { await runtime.navigate(sid, `${origin}/mid404?t=${t}`, tabId); } catch {}
    await sleep(1500); const a = await cur(tabId);
    return { url: a.url, staleOwn404: has(a, '/own404'), mid404Reported: has(a, '/mid404'), broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  }, true);

  // ---- 2b non-committing navigations
  await withTab('2b own404 -> click 204 link (no commit) -> audit', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId); await sleep(200);
    const a0 = await cur(tabId);
    await runtime.click(sid, '#nc', tabId).catch(() => null); await sleep(500);
    const a = await cur(tabId);
    const capNow = tabOf(tabId).getLastMainDocumentResponse?.() ?? null;
    return { url: a.url, own404BeforeClick: has(a0, '/own404'), own404Kept: has(a, '/own404'), cap: capNow, broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  }, true);
  await withTab('2b own404 -> click download(200) link (no commit) -> audit', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId); await sleep(200);
    await runtime.click(sid, '#dl', tabId).catch(() => null); await sleep(600);
    const a = await cur(tabId);
    const capNow = tabOf(tabId).getLastMainDocumentResponse?.() ?? null;
    return { url: a.url, own404Kept: has(a, '/own404'), cap: capNow, broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  }, true);
  await withTab('2b clean -> click download(404) link -> audit', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/clean?t=${t}`, tabId); await sleep(200);
    await runtime.click(sid, '#dl404', tabId).catch(() => null); await sleep(600);
    const a = await cur(tabId);
    const capNow = tabOf(tabId).getLastMainDocumentResponse?.() ?? null;
    return { url: a.url, dl404Reported: has(a, '/dl404'), cap: capNow, broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  }, true);

  // ---- 2b service worker served navigations
  await withTab('2b SW: sw404 -> audit; -> about:blank -> audit; -> sw200 -> audit', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/sw/reg?t=${t}`, tabId);
    for (let i = 0; i < 50; i++) { if (await runtime.eval(sid, '!!window.__swReady', tabId).catch(() => false)) break; await sleep(100); }
    await runtime.navigate(sid, `${origin}/sw/page404?t=${t}`, tabId); await sleep(300);
    const a1 = await cur(tabId);
    const cap1 = tabOf(tabId).getLastMainDocumentResponse?.() ?? null;
    await runtime.navigate(sid, 'about:blank', tabId); await sleep(250);
    const a2 = await cur(tabId);
    await runtime.navigate(sid, `${origin}/sw/page200?t=${t}`, tabId); await sleep(300);
    const a3 = await cur(tabId);
    const a4 = await cap(runtime.audit(sid, { tabId, url: `${origin}/sw/page404?t=${t}u`, settleMs: 300 }), 60000, 'u');
    return { a1url: a1.url, swOwn404Reported: has(a1, '/sw/page404'), cap1, a2Stale: has(a2, '/sw/page404'), a3Stale: has(a3, '/sw/page404'), a3covers: a3.observation.coversWholeDocument, urlModeSwOwn404: has(a4, '/sw/page404') };
  }, true);

  // ---- 2c same-document interleave, own 404 page doing a same-doc nav at D ms
  for (const k of ['hash', 'push', 'replace']) {
    for (const d of [0, 30, 150, 400]) {
      await withTab(`2c sd404 ${k} @${d}ms (cur)`, t, async (tabId) => {
        await runtime.navigate(sid, `${origin}/other-before?t=${t}`, tabId).catch(() => {}); await sleep(100);
        await runtime.navigate(sid, `${origin}/sd404?k=${k}&d=${d}&t=${t}`, tabId); await sleep(d + 500);
        const a = await cur(tabId);
        return {
          url: a.url, own404: a.brokenRequests.some((b) => b.url.includes('/sd404') && b.status === 404),
          errBefore: a.consoleErrors.some((e) => e.text === 'SD-BEFORE'), errAfter: a.consoleErrors.some((e) => e.text === 'SD-AFTER'),
          fetchAfter: has(a, '/sd-missing-after'), foreign: has(a, '/other-before'), covers: a.observation.coversWholeDocument,
        };
      }, d === 30);
    }
  }
  // harness-driven interleave: own404 -> pushState -> clean -> pushState -> audit (no stale), and own404 -> pushState/hash -> audit (own kept)
  await withTab('2c harness own404->push->clean->push->audit', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
    await runtime.eval(sid, 'history.pushState({},"","/own404-pushed")', tabId);
    await runtime.navigate(sid, `${origin}/clean?t=${t}`, tabId);
    await runtime.eval(sid, 'history.pushState({},"","/clean-pushed");location.hash="z"', tabId);
    await sleep(100);
    const a = await cur(tabId);
    return { url: a.url, stale: has(a, '/own404'), broken: a.brokenRequests, covers: a.observation.coversWholeDocument };
  });
  await withTab('2c harness own404->hash/push/replace x3->audit (own kept)', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
    for (let i = 0; i < 3; i++) { await runtime.eval(sid, `location.hash="a${i}";history.pushState({},"","/p${i}");history.replaceState({},"","/r${i}")`, tabId); await sleep(30); }
    const a = await cur(tabId);
    return { url: a.url, own404Kept: has(a, '/own404'), covers: a.observation.coversWholeDocument };
  });
  // go_back across a same-document entry (popstate, no commit) then across a cross-doc entry
  await withTab('2c own404 -> push -> go_back(samedoc) -> audit (own kept)', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
    await runtime.eval(sid, 'history.pushState({},"","/own404-p")', tabId);
    await runtime.goBack(sid, tabId).catch(() => {}); await sleep(200);
    const a = await cur(tabId);
    return { url: a.url, own404Kept: has(a, '/own404'), covers: a.observation.coversWholeDocument };
  });

  // ---- 2d fresh tab, never navigated
  await withTab('2d fresh about:blank tab audit()', t, async (tabId) => {
    const tb = tabOf(tabId);
    const a = await cur(tabId);
    return { url: a.url, commitAt: tb.getLastMainFrameCommitAt?.() ?? null, cap: tb.getLastMainDocumentResponse?.() ?? null, broken: a.brokenRequests, errs: a.consoleErrors.length, covers: a.observation.coversWholeDocument, docStart: a.observation.documentStartedAt, obs: a.observation.observingSince };
  });
  // popup adoption: opener -> click target=_blank own404 -> audit the popup tab (current page)
  await withTab('2d popup own404 adopted', t, async (tabId) => {
    await runtime.navigate(sid, `${origin}/opener?t=${t}`, tabId); await sleep(150);
    const before = new Set(runtime['resolveTab'](sid, tabId).session ? [] : []);
    const pageCount0 = (await pageOf(tabId).browser().pages()).length;
    await runtime.click(sid, '#pop', tabId).catch(() => null); await sleep(1200);
    const sess = runtime['sessionManager']?.getSession?.(sid) ?? null;
    let popupId = null;
    try {
      const tabs = await runtime.listTabs(sid);
      const pt = tabs.find((x) => String(x.url).includes('popup=1'));
      popupId = pt?.id ?? pt?.tabId ?? null;
    } catch (e) { return { error: 'listTabs ' + e.message }; }
    if (!popupId) return { popupFound: false, pageCount0 };
    const a = await cur(popupId);
    const r = { popupFound: true, url: a.url, own404Reported: has(a, '/own404'), covers: a.observation.coversWholeDocument };
    await runtime.closeTab(sid, popupId).catch(() => {});
    return r;
  });
  await save();
}

// summary
const S = {};
for (const [k, v] of Object.entries(out.shapes)) {
  const keys = new Set(v.flatMap((x) => Object.keys(x)));
  const s = { n: v.length };
  for (const key of keys) {
    const vals = v.map((x) => x[key]);
    if (vals.every((x) => typeof x === 'boolean' || x === undefined)) s[key] = `${vals.filter((x) => x === true).length}/${v.length}`;
  }
  const errs = v.filter((x) => x.error).map((x) => x.error);
  if (errs.length) s.errors = errs.slice(0, 2);
  S[k] = s;
}
out.summary = S;
try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(S, null, 1));
process.exit(0);
