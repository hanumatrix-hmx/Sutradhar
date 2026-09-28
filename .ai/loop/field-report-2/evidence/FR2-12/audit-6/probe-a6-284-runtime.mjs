// FR2-12 audit-6: GAP-284 core repro (3 named shapes) + GAP-285 residual + ordinary-audit
// coversWholeDocument false-negative check, runtime-direct. Instrumented: server hit log confirms
// the broken link was really visited; pageshow.persisted confirms a real bfcache restore.
// Usage: node probe-a6-284-runtime.mjs <trials>
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, sleep, watchdog, killAll, outPath, cap, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '15');
const OUT = outPath('probe-a6-284-runtime.json');
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
  if (p === '/nostore') return res.writeHead(200, { ...H, 'Cache-Control': 'no-store' }), res.end(html(PS + '<h1>nostore</h1><script>window.addEventListener("unload",()=>{})</script>', 'nostore'));
  if (p === '/homeerr') return res.writeHead(200, H), res.end(html(PS + '<h1>home</h1><script>console.error("HOME-OWN-ERR");fetch("/home-own-missing")</script>', 'homeerr'));
  if (p === '/noisy') return res.writeHead(200, H), res.end(html(PS + '<h1>noisy</h1><script>console.error("NOISY-ERR");fetch("/noisy-missing");setInterval(()=>{console.error("NOISY-TICK");fetch("/noisy-tick-missing")},40)</script>', 'noisy'));
  res.writeHead(404); res.end('nf');
});
const closedUrl = await (async () => { const { server: s, origin: o } = await startServer(() => {}); await new Promise((r) => s.close(r)); return o + '/'; })();

const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const push = (k, v) => { (out.shapes[k] ??= []).push(v); };
const persisted = async (tabId) => { try { return await runtime.eval(sid, 'JSON.stringify(window.__ps||null)', tabId); } catch (e) { return 'ERR ' + e.message; } };
const own404In = (a) => a.brokenRequests.some((b) => b.url.includes('/own404'));

for (let t = 0; t < TR; t++) {
  // S1 own-404 -> about:blank
  {
    const { id: tabId } = await runtime.createTab(sid);
    await runtime.navigate(sid, `${origin}/own404?s1=${t}`, tabId); await sleep(250);
    await runtime.navigate(sid, 'about:blank', tabId); await sleep(250);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 's1');
    push('S1 own404->about:blank', { url: a.url, stale404: own404In(a), covers: a.observation.coversWholeDocument, broken: a.brokenRequests });
    await runtime.closeTab(sid, tabId);
  }
  // S2 own-404 -> dead host
  {
    const { id: tabId } = await runtime.createTab(sid);
    await runtime.navigate(sid, `${origin}/own404?s2=${t}`, tabId); await sleep(250);
    let navErr = null; try { await runtime.navigate(sid, closedUrl, tabId); } catch (e) { navErr = String(e.message).slice(0, 60); }
    await sleep(250);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 's2');
    push('S2 own404->deadhost', { url: a.url, navErr, stale404: own404In(a), covers: a.observation.coversWholeDocument, broken: a.brokenRequests });
    await runtime.closeTab(sid, tabId);
  }
  // S3 home -> click broken link -> go_back (bfcache)
  {
    const { id: tabId } = await runtime.createTab(sid);
    await runtime.navigate(sid, `${origin}/home?s3=${t}`, tabId); await sleep(250);
    const before = hits.length;
    await runtime.click(sid, '#l', tabId).catch((e) => null); await sleep(500);
    const visited404 = hits.slice(before).some((h) => h.startsWith('/own404'));
    const urlAfterClick = runtime['requirePage'](runtime['resolveTab'](sid, tabId).tab).url();
    await runtime.goBack(sid, tabId); await sleep(300);
    const ps = await persisted(tabId);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 's3');
    push('S3 home->click404->go_back', { url: a.url, visited404, urlAfterClick, pageshow: ps, stale404: own404In(a), covers: a.observation.coversWholeDocument, broken: a.brokenRequests });
    await runtime.closeTab(sid, tabId);
  }
  // S4 GAP-285 residual: homeerr -> clean -> go_back
  {
    const { id: tabId } = await runtime.createTab(sid);
    await runtime.navigate(sid, `${origin}/homeerr?s4=${t}`, tabId); await sleep(400);
    await runtime.navigate(sid, `${origin}/clean?s4=${t}`, tabId); await sleep(250);
    await runtime.goBack(sid, tabId); await sleep(300);
    const ps = await persisted(tabId);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 's4');
    push('S4 homeerr->clean->go_back', {
      url: a.url, pageshow: ps,
      ownErrKept: a.consoleErrors.some((e) => e.text.includes('HOME-OWN-ERR')),
      own404Kept: a.brokenRequests.some((b) => b.url.includes('home-own-missing')),
      foreign: a.brokenRequests.filter((b) => !b.url.includes('home-own-missing')).map((b) => b.url),
      covers: a.observation.coversWholeDocument,
    });
    await runtime.closeTab(sid, tabId);
  }
  // S5 noisy -> clean -> go_back to noisy (bfcache) -> audit: must not show CLEAN's stuff; covers false
  //    then go_forward to clean (bfcache) -> audit: must not show NOISY's ticks; covers false
  {
    const { id: tabId } = await runtime.createTab(sid);
    await runtime.navigate(sid, `${origin}/clean?s5=${t}`, tabId); await sleep(250);
    await runtime.navigate(sid, `${origin}/noisy?s5=${t}`, tabId); await sleep(400);
    await runtime.goBack(sid, tabId); await sleep(300);
    const ps = await persisted(tabId);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 's5');
    push('S5 clean->noisy->go_back(clean restored)', {
      url: a.url, pageshow: ps,
      noisyLeak: a.consoleErrors.some((e) => e.text.includes('NOISY')) || a.brokenRequests.some((b) => b.url.includes('noisy')),
      covers: a.observation.coversWholeDocument,
    });
    await runtime.closeTab(sid, tabId);
  }
  // S6 own404 -> clean -> go_back to own404 (bfcache?) -> own 404 should still be reported (URL-match fallback)
  {
    const { id: tabId } = await runtime.createTab(sid);
    await runtime.navigate(sid, `${origin}/own404?s6=${t}`, tabId); await sleep(250);
    await runtime.navigate(sid, `${origin}/clean?s6=${t}`, tabId); await sleep(250);
    await runtime.goBack(sid, tabId); await sleep(300);
    const ps = await persisted(tabId);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 's6');
    push('S6 own404->clean->go_back(own404 restored)', { url: a.url, pageshow: ps, own404Reported: own404In(a), covers: a.observation.coversWholeDocument });
    await runtime.closeTab(sid, tabId);
  }
  // O1..O5 ordinary audits: coversWholeDocument must be TRUE (no false-negative regression)
  {
    const { id: tabId } = await runtime.createTab(sid);
    await runtime.navigate(sid, `${origin}/clean?o1=${t}`, tabId); await sleep(200);
    const a1 = await runtime.audit(sid, { tabId });
    await runtime.navigate(sid, `${origin}/own404?o2=${t}`, tabId); await sleep(200);
    const a2 = await runtime.audit(sid, { tabId });
    const a3 = await runtime.audit(sid, { tabId, url: `${origin}/clean?o3=${t}`, settleMs: 300 });
    await runtime.reload(sid, tabId); await sleep(200);
    const a4 = await runtime.audit(sid, { tabId });
    // back to a no-store+unload page (NOT bfcache-eligible) -> covers should be true
    await runtime.navigate(sid, `${origin}/nostore?o5=${t}`, tabId); await sleep(200);
    await runtime.navigate(sid, `${origin}/clean?o5b=${t}`, tabId); await sleep(200);
    await runtime.goBack(sid, tabId); await sleep(300);
    const ps5 = await persisted(tabId);
    const a5 = await runtime.audit(sid, { tabId });
    // audit({url}) right after a bfcache restore -> navigated mode, covers must be true
    await runtime.navigate(sid, `${origin}/clean?o6a=${t}`, tabId); await sleep(150);
    await runtime.navigate(sid, `${origin}/clean?o6b=${t}`, tabId); await sleep(150);
    await runtime.goBack(sid, tabId); await sleep(200);
    const a6 = await runtime.audit(sid, { tabId, url: `${origin}/clean?o6c=${t}`, settleMs: 300 });
    // current-page audit after a url-audit that followed a bfcache restore -> flag must be reset
    const a7 = await runtime.audit(sid, { tabId });
    push('O ordinary covers', {
      o1cleanCur: a1.observation.coversWholeDocument,
      o2own404Cur: a2.observation.coversWholeDocument, o2own404Reported: own404In(a2),
      o3url: a3.observation.coversWholeDocument,
      o4reload: a4.observation.coversWholeDocument,
      o5backNonBfcache: a5.observation.coversWholeDocument, o5pageshow: ps5,
      o6urlAfterRestore: a6.observation.coversWholeDocument,
      o7curAfterUrlAuditAfterRestore: a7.observation.coversWholeDocument,
    });
    await runtime.closeTab(sid, tabId);
  }
  await save();
}

const s = out.shapes;
const cnt = (arr, f) => arr.filter(f).length;
out.summary = {
  S1: { n: s['S1 own404->about:blank'].length, stale: cnt(s['S1 own404->about:blank'], (x) => x.stale404), coversTrue: cnt(s['S1 own404->about:blank'], (x) => x.covers) },
  S2: { n: s['S2 own404->deadhost'].length, stale: cnt(s['S2 own404->deadhost'], (x) => x.stale404), coversTrue: cnt(s['S2 own404->deadhost'], (x) => x.covers) },
  S3: { n: s['S3 home->click404->go_back'].length, visited404: cnt(s['S3 home->click404->go_back'], (x) => x.visited404), bfcache: cnt(s['S3 home->click404->go_back'], (x) => String(x.pageshow).includes('true')), stale: cnt(s['S3 home->click404->go_back'], (x) => x.stale404), coversTrue: cnt(s['S3 home->click404->go_back'], (x) => x.covers) },
  S4: { n: s['S4 homeerr->clean->go_back'].length, bfcache: cnt(s['S4 homeerr->clean->go_back'], (x) => String(x.pageshow).includes('true')), ownErrKept: cnt(s['S4 homeerr->clean->go_back'], (x) => x.ownErrKept), own404Kept: cnt(s['S4 homeerr->clean->go_back'], (x) => x.own404Kept), foreignAny: cnt(s['S4 homeerr->clean->go_back'], (x) => x.foreign.length), coversTrue: cnt(s['S4 homeerr->clean->go_back'], (x) => x.covers) },
  S5: { n: s['S5 clean->noisy->go_back(clean restored)'].length, bfcache: cnt(s['S5 clean->noisy->go_back(clean restored)'], (x) => String(x.pageshow).includes('true')), noisyLeak: cnt(s['S5 clean->noisy->go_back(clean restored)'], (x) => x.noisyLeak), coversTrue: cnt(s['S5 clean->noisy->go_back(clean restored)'], (x) => x.covers) },
  S6: { n: s['S6 own404->clean->go_back(own404 restored)'].length, bfcache: cnt(s['S6 own404->clean->go_back(own404 restored)'], (x) => String(x.pageshow).includes('true')), own404Reported: cnt(s['S6 own404->clean->go_back(own404 restored)'], (x) => x.own404Reported), coversTrue: cnt(s['S6 own404->clean->go_back(own404 restored)'], (x) => x.covers) },
  O: Object.fromEntries(['o1cleanCur', 'o2own404Cur', 'o2own404Reported', 'o3url', 'o4reload', 'o5backNonBfcache', 'o6urlAfterRestore', 'o7curAfterUrlAuditAfterRestore'].map((k) => [k, `${cnt(s['O ordinary covers'], (x) => x[k] === true)}/${s['O ordinary covers'].length}`])),
  Onote_o5pageshow: s['O ordinary covers'].map((x) => x.o5pageshow),
};
try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out.summary, null, 1));
process.exit(0);
