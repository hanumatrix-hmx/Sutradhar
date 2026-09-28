// FR2-12 audit-6: audit-4's 17 GAP-273 own-status shapes, run in BOTH modes:
//   url   = runtime.audit(sid, {url})                     (per-call CDP capture, unchanged by esc-2)
//   cur   = runtime.navigate(url) -> runtime.audit(sid,{}) (tab-level capture, CHANGED by esc-2's
//           loaderId invalidation -- the new clear could drop a legit own status if an error page
//           commits under a different loaderId than its response)
//   cur-after-404 = same as cur but the tab first visits an unrelated own-404 page (stale-capture pressure)
// Usage: node probe-a6-273.mjs <trials> [label]
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, sleep, watchdog, killAll, outPath, cap, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '5');
const LABEL = process.argv[3] ?? 'main';
const OUT = outPath(`probe-a6-273-${LABEL}.json`);
const out = { trials: TR, label: LABEL, modes: {}, samples: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(1500000, async () => { out.watchdog = true; await save(); });

const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/ok') { res.writeHead(200, H); return res.end(html('<h1>ok</h1>')); }
  if (p === '/h404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1><script>location.hash="top"</script>')); }
  if (p === '/rs404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1><script>history.replaceState(null,"","/rewritten-"+Math.random())</script>')); }
  if (p === '/e404') { res.writeHead(404, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/e500') { res.writeHead(500, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/own404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1>')); }
  if (p === '/other404') { res.writeHead(404, H); return res.end(html('<h1>other nf</h1>')); }
  if (p === '/r302-rs404') { res.writeHead(302, { Location: '/rs404?from=r' }); return res.end(); }
  if (p === '/r302-h404') { res.writeHead(302, { Location: '/h404?from=r' }); return res.end(); }
  if (p === '/r302-ok-rs') { res.writeHead(302, { Location: '/ok-rs' }); return res.end(); }
  if (p === '/ok-rs') { res.writeHead(200, H); return res.end(html('<h1>ok</h1><script>history.replaceState(null,"","/ok-rs-rewritten")</script>')); }
  if (p === '/js200-to-h404') { res.writeHead(200, H); return res.end(html('<script>location.replace("/h404?from=js")</script>')); }
  if (p === '/js404-to-ok') { res.writeHead(404, H); return res.end(html('<script>location.replace("/ok?from=js404")</script>')); }
  if (p === '/slow404') { res.writeHead(404, H); res.write('<html lang=en><title>s</title><body><h1>slow</h1>' + ' '.repeat(4096)); setTimeout(() => res.end('</body></html>'), 2500); return; }
  if (p === '/big404') { res.writeHead(404, H); return res.end(html('<h1>big</h1><!--' + 'x'.repeat(5 * 1024 * 1024) + '-->')); }
  if (p === '/slowhdr500') { setTimeout(() => { res.writeHead(500, H); res.end(html('<h1>late 500</h1>')); }, 1200); return; }
  if (p === '/c1') { res.writeHead(302, { Location: '/mid500' }); return res.end(); }
  if (p === '/mid500') { res.writeHead(500, H); return res.end(html('<script>location.replace("/c2")</script>')); }
  if (p === '/c2') { res.writeHead(302, { Location: '/ok?from=chain' }); return res.end(); }
  if (p === '/d1') { res.writeHead(302, { Location: '/midb500' }); return res.end(); }
  if (p === '/midb500') { res.writeHead(500, H); return res.end(html('<script>location.replace("/d2")</script>')); }
  if (p === '/d2') { res.writeHead(302, { Location: '/own404?from=chain' }); return res.end(); }
  if (p === '/ok-iframe404') { res.writeHead(200, H); return res.end(html('<iframe src="/e404?frame=1"></iframe>')); }
  res.writeHead(404); res.end();
});

const SHAPES = [
  { name: 'hash-404', path: '/h404', must: [404] },
  { name: 'replaceState-404', path: '/rs404', must: [404] },
  { name: 'emptybody-404', path: '/e404', must: [404] },
  { name: 'emptybody-500', path: '/e500', must: [500] },
  { name: 'control-own404', path: '/own404', must: [404] },
  { name: 'control-ok', path: '/ok', must: [], mustNot: [404, 500] },
  { name: 'a-302-then-replaceState-404', path: '/r302-rs404', must: [404], urlIncludes: '/rs404?from=r' },
  { name: 'a-302-then-hash-404', path: '/r302-h404', must: [404], urlIncludes: '/h404?from=r' },
  { name: 'a-302-then-replaceState-200', path: '/r302-ok-rs', must: [], mustNot: [302, 404, 500] },
  { name: 'a-js200-to-hash404', path: '/js200-to-h404', must: [404], urlIncludes: '/h404?from=js', jsChain: true },
  { name: 'a-js404-to-200', path: '/js404-to-ok', must: [], mustNot: [404], jsChain: true, note: 'final doc is 200; a reported 404 would be the pre-redirect doc' },
  { name: 'b-slow-body-404', path: '/slow404', must: [404] },
  { name: 'b-5MB-body-404', path: '/big404', must: [404] },
  { name: 'b-slow-headers-500', path: '/slowhdr500', must: [500] },
  { name: 'c-302>500(js)>302>200', path: '/c1', must: [], mustNot: [], jsChain: true, note: 'intermediate 500 hop (a real request from a real earlier doc; not asserted)' },
  { name: 'c-302>500(js)>302>404', path: '/d1', must: [404], urlIncludes: '/own404?from=chain', jsChain: true },
  { name: 'subframe-emptybody-404', path: '/ok-iframe404', must: [], note: 'iframe 404 may appear as a subresource' },
];

function judge(shape, broken) {
  const statuses = broken.map((b) => b.status);
  const okMust = shape.must.every((s) => statuses.includes(s));
  const okNot = (shape.mustNot ?? []).every((s) => !statuses.includes(s));
  let okUrl = true;
  if (shape.urlIncludes) okUrl = broken.some((b) => b.url.includes(shape.urlIncludes) && shape.must.includes(b.status));
  // never the unrelated prior page's 404
  const noStale = !broken.some((b) => b.url.includes('/other404'));
  return { ok: okMust && okNot && okUrl && noStale, noStale };
}

const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);

const MODES = ['url', 'cur', 'cur-after-404'];
for (const m of MODES) { out.modes[m] = {}; for (const s of SHAPES) out.modes[m][s.name] = { pass: 0, n: 0, fails: [] }; }

for (let t = 0; t < TR; t++) {
  for (const s of SHAPES) {
    for (const m of MODES) {
      const r = out.modes[m][s.name]; r.n++;
      const { id: tabId } = await runtime.createTab(sid);
      try {
        const u = `${origin}${s.path}?t=${t}&m=${m}`;
        let a;
        if (m === 'url') {
          a = await cap(runtime.audit(sid, { url: u, tabId }), 60000, s.name);
        } else {
          if (m === 'cur-after-404') { await runtime.navigate(sid, `${origin}/other404?t=${t}`, tabId); await sleep(150); }
          try { await cap(runtime.navigate(sid, u, tabId), 40000, 'nav'); } catch (e) { r.navErr = String(e.message).slice(0, 120); }
          await sleep(s.jsChain ? 1500 : 600);
          const tabObj = runtime['resolveTab'](sid, tabId).tab;
          const capBefore = tabObj.getLastMainDocumentResponse?.() ?? null;
          a = await cap(runtime.audit(sid, { tabId }), 60000, s.name);
          a.__cap = capBefore;
        }
        const j = judge(s, a.brokenRequests);
        if (j.ok) r.pass++; else r.fails.push({ t, url: a.url, broken: a.brokenRequests, covers: a.observation.coversWholeDocument, cap: a.__cap ?? undefined });
        if (t === 0) out.samples[`${m}:${s.name}`] = { url: a.url, broken: a.brokenRequests, covers: a.observation.coversWholeDocument, cap: a.__cap ?? undefined };
      } catch (e) { r.fails.push({ t, error: String(e.message).slice(0, 200) }); }
      await runtime.closeTab(sid, tabId).catch(() => {});
    }
  }
  await save();
}

out.summary = Object.fromEntries(MODES.map((m) => [m, Object.fromEntries(Object.entries(out.modes[m]).map(([k, v]) => [k, `${v.pass}/${v.n}`]))]));
try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out.summary, null, 1));
process.exit(0);
