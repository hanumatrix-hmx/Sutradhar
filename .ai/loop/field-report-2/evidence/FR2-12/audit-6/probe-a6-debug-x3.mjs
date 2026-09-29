// FR2-12 audit-6: isolate why own404 -> (hash + pushState + replaceState) x3 -> audit() drops the
// page's own 404 with coversWholeDocument:true. Records tab capture / commit time after every step,
// plus a raw CDP trace. Variants isolate each same-document primitive.
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, sleep, watchdog, killAll, outPath, cap, H, html } from './lib.mjs';

const TR = Number(process.argv[2] ?? '3');
const OUT = outPath(process.argv[3] ?? 'probe-a6-debug-x3.json');
const out = { variants: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(600000, async () => { out.watchdog = true; await save(); });
const hits = [];
const { server, origin } = await startServer((req, res, u) => {
  hits.push(u.pathname);
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1>', 'nf'));
  res.writeHead(200, H); res.end(html('<h1>other ' + u.pathname + '</h1>'));
});
const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);

const VARIANTS = {
  'hash-only-x3': (i) => `location.hash="a${i}"`,
  'push-only-x3': (i) => `history.pushState({},"","/p${i}")`,
  'replace-only-x3': (i) => `history.replaceState({},"","/r${i}")`,
  'push-samepath-x3': (i) => `history.pushState({},"",location.pathname+location.search+"#q${i}")`,
  'hash+push+replace-x3': (i) => `location.hash="a${i}";history.pushState({},"","/p${i}");history.replaceState({},"","/r${i}")`,
  'hash+push+replace-x1': (i) => (i === 0 ? `location.hash="a0";history.pushState({},"","/p0");history.replaceState({},"","/r0")` : '1'),
};
for (const [name, code] of Object.entries(VARIANTS)) {
  out.variants[name] = [];
  for (let t = 0; t < TR; t++) {
    const { id: tabId } = await runtime.createTab(sid);
    const tab = runtime['resolveTab'](sid, tabId).tab;
    const page = runtime['requirePage'](tab);
    const c = await page.createCDPSession();
    const ev = [];
    c.on('Page.frameNavigated', (e) => { if (!e.frame.parentId) ev.push(['frameNavigated', e.type, e.frame.loaderId, e.frame.url]); });
    c.on('Page.navigatedWithinDocument', (e) => ev.push(['withinDoc', e.url]));
    c.on('Network.responseReceived', (e) => { if (e.type === 'Document') ev.push(['docResp', e.loaderId, e.response.status, e.response.url]); });
    await c.send('Page.enable'); await c.send('Network.enable');
    const steps = [];
    const snap = (label) => steps.push({ label, cap: tab.getLastMainDocumentResponse?.() ?? null, commitAt: tab.getLastMainFrameCommitAt?.() ?? null, url: page.url() });
    const h0 = hits.length;
    await runtime.navigate(sid, `${origin}/own404?t=${t}&v=${name}`, tabId);
    snap('after-nav');
    for (let i = 0; i < 3; i++) { await runtime.eval(sid, code(i), tabId); await sleep(30); snap(`after-eval-${i}`); }
    await sleep(200);
    const a = await cap(runtime.audit(sid, { tabId }), 60000, 'audit');
    snap('after-audit');
    out.variants[name].push({ own404Kept: a.brokenRequests.some((b) => b.url.includes('/own404')), url: a.url, broken: a.brokenRequests, covers: a.observation.coversWholeDocument, serverHits: hits.slice(h0), steps, cdp: ev });
    try { await c.detach(); } catch {}
    await runtime.closeTab(sid, tabId).catch(() => {});
  }
  await save();
}
out.summary = Object.fromEntries(Object.entries(out.variants).map(([k, v]) => [k, { own404Kept: `${v.filter((x) => x.own404Kept).length}/${v.length}`, coversTrue: `${v.filter((x) => x.covers).length}/${v.length}` }]));
try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out.summary, null, 1));
process.exit(0);
