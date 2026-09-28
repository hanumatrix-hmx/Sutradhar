// FR2-12 audit-5: (1) GAP-273's 17 own-status shapes via audit({url}) with no dialog (audit-4 attack surface re-run);
// (2) GAP-279 LIVE: the same shapes with a real alert OPEN on the audited tab when audit({url}) starts
//     (the repro escalation-1 disclosed it did not run), plus variants: alert open on a DIFFERENT tab,
//     and alert opened then handled just before the audit. PREFIX=1 runs the pre-escalation-1 emulation.
// Watchdog 1500s. Chrome killed by own PID only.
import fs from 'node:fs/promises';
import { loadRuntime, installCdpCounters, emulatePreFix, cdpSummary, startServer, chromePidOf, cap, sleep, watchdog, killAll, outPath, H } from './lib5.mjs';
const PART = process.argv[2] ?? 'all';
const TR = Number(process.argv[3] ?? '10');
const PREFIX = process.env.PREFIX === '1';
const OUT = outPath(`probe-273x-${PART}${PREFIX ? '-prefix' : ''}.json`);
const out = { part: PART, trials: TR, preFixEmulation: PREFIX, results: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(1500000, async () => { out.watchdog = true; await save(); });
await installCdpCounters();
if (PREFIX) out.preFixPatched = await emulatePreFix();
const { SutradharRuntime } = await loadRuntime();
const html = (body, title = 't') => `<html lang=en><head><title>${title}</title></head><body>${body}</body></html>`;
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/ok') { res.writeHead(200, H); return res.end(html('<h1>ok</h1>')); }
  if (p === '/h404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1><script>location.hash="top"</script>')); }
  if (p === '/rs404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1><script>history.replaceState(null,"","/rewritten-"+Math.random())</script>')); }
  if (p === '/e404') { res.writeHead(404, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/e500') { res.writeHead(500, { ...H, 'Content-Length': '0' }); return res.end(); }
  if (p === '/own404') { res.writeHead(404, H); return res.end(html('<h1>nf</h1>')); }
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
  if (p === '/alertload') { res.writeHead(200, H); return res.end(html('<h1>alert</h1><script>setTimeout(function(){alert("a5-open")},100)</script>')); }
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
  { name: 'a-js200-to-hash404', path: '/js200-to-h404', must: [404], urlIncludes: '/h404?from=js' },
  { name: 'a-js404-to-200', path: '/js404-to-ok', must: [] },
  { name: 'b-slow-body-404', path: '/slow404', must: [404] },
  { name: 'b-5MB-body-404', path: '/big404', must: [404] },
  { name: 'b-slow-headers-500', path: '/slowhdr500', must: [500] },
  { name: 'c-302>500(js)>302>200', path: '/c1', must: [] },
  { name: 'c-302>500(js)>302>404', path: '/d1', must: [404], urlIncludes: '/own404?from=chain' },
  { name: 'subframe-emptybody-404', path: '/ok-iframe404', must: [] },
];
const DIALOG_SHAPES = ['hash-404', 'replaceState-404', 'emptybody-404', 'emptybody-500', 'control-own404', 'control-ok', 'a-302-then-hash-404', 'a-js200-to-hash404', 'a-302-then-replaceState-200', 'c-302>500(js)>302>404'];
function judge(shape, broken) {
  const statuses = broken.map((b) => b.status);
  const okMust = shape.must.every((s) => statuses.includes(s));
  const okNot = (shape.mustNot ?? []).every((s) => !statuses.includes(s));
  let okUrl = true;
  if (shape.urlIncludes) okUrl = broken.some((b) => b.url.includes(shape.urlIncludes) && shape.must.includes(b.status));
  return okMust && okNot && okUrl;
}
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const tabOf = (id) => runtime['resolveTab'](sid, id).tab;
const rec = (key, s, a, extra = {}) => {
  const r = (out.results[key] ??= {});
  const x = (r[s.name] ??= { pass: 0, n: 0, fails: [], ms: [] });
  x.n++;
  if (a.error) { x.fails.push({ error: a.error, ...extra }); return; }
  if (judge(s, a.brokenRequests)) x.pass++; else x.fails.push({ url: a.url.replace(origin, ''), broken: a.brokenRequests.map((b) => `${b.status} ${b.url.replace(origin, '')}`), ...extra });
};
const openAlert = async (tabId, tag) => {
  await runtime.navigate(sid, `${origin}/alertload?${tag}`, tabId);
  for (let i = 0; i < 40 && !runtime.getPendingDialog(sid, tabId); i++) await sleep(50);
  return !!runtime.getPendingDialog(sid, tabId);
};

if (PART === 'all' || PART === 'nodialog') {
  for (let t = 0; t < TR; t++) {
    for (const s of SHAPES) {
      let a; try { a = await cap(runtime.audit(sid, { url: `${origin}${s.path}?t=${t}` }), 60000, s.name); } catch (e) { a = { error: e.message.slice(0, 200) }; }
      rec('nodialog', s, a);
    }
    await save();
  }
}
if (PART === 'all' || PART === 'dialog') {
  // Fresh tab(s) per trial so the pre-existing background-tab screenshot stall (probe-dialog-hang-debug)
  // can never carry over between trials. Cap 60s per audit.
  for (let t = 0; t < TR; t++) {
    for (const name of DIALOG_SHAPES) {
      const s = SHAPES.find((x) => x.name === name);
      // (i) alert OPEN on the audited tab when audit({url}) starts (no explicit handleDialog)
      {
        const { id: tabId } = await runtime.createTab(sid);
        await sleep(300);
        const pending = await openAlert(tabId, `s${t}${name}`);
        const t0 = Date.now();
        let a; try { a = await cap(runtime.audit(sid, { url: `${origin}${s.path}?d=${t}`, tabId }), 60000, s.name); } catch (e) { a = { error: e.message.slice(0, 200) }; }
        rec('sameTabDialogOpen', s, a, { pending, goto: tabOf(tabId).getLastGotoResponse?.() });
        const x = out.results.sameTabDialogOpen[s.name]; x.ms.push(Date.now() - t0); x.pendingAtStart = (x.pendingAtStart ?? 0) + (pending ? 1 : 0);
        await runtime.closeTab(sid, tabId).catch(() => {});
      }
      if (t < 3) {
        // (ii) alert OPEN on a DIFFERENT tab while the audited tab runs audit({url})
        const { id: tabId } = await runtime.createTab(sid);
        const { id: otherTab } = await runtime.createTab(sid);
        await sleep(300);
        const p2 = await openAlert(otherTab, `o${t}${name}`);
        const t1 = Date.now();
        let b; try { b = await cap(runtime.audit(sid, { url: `${origin}${s.path}?o=${t}`, tabId }), 60000, s.name); } catch (e) { b = { error: e.message.slice(0, 200) }; }
        rec('otherTabDialogOpen', s, b, { pending: p2 });
        out.results.otherTabDialogOpen[s.name].ms.push(Date.now() - t1);
        await runtime.closeTab(sid, otherTab).catch(() => {});
        await runtime.closeTab(sid, tabId).catch(() => {});
        // (iii) alert opened on the audited tab and accepted via handleDialog right before audit({url})
        const { id: t3 } = await runtime.createTab(sid);
        await sleep(300);
        const p3 = await openAlert(t3, `h${t}${name}`);
        if (runtime.getPendingDialog(sid, t3)) await runtime.handleDialog(sid, 'accept', undefined, t3).catch(() => {});
        const t2 = Date.now();
        let c; try { c = await cap(runtime.audit(sid, { url: `${origin}${s.path}?h=${t}`, tabId: t3 }), 60000, s.name); } catch (e) { c = { error: e.message.slice(0, 200) }; }
        rec('justHandledDialog', s, c, { pending: p3 });
        out.results.justHandledDialog[s.name].ms.push(Date.now() - t2);
        await runtime.closeTab(sid, t3).catch(() => {});
      }
      await save();
    }
  }
}
out.cdp = cdpSummary();
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
stopWd(); killAll(); server.close(); await save();
for (const [k, v] of Object.entries(out.results)) {
  const tot = Object.values(v).reduce((acc, x) => ({ pass: acc.pass + x.pass, n: acc.n + x.n }), { pass: 0, n: 0 });
  console.log(`== ${k}: ${tot.pass}/${tot.n}`);
  for (const [n, x] of Object.entries(v)) console.log(`   ${n}: ${x.pass}/${x.n}${x.ms?.length ? ` ms~${Math.round(x.ms.reduce((a, b) => a + b, 0) / x.ms.length)}` : ''}${x.pendingAtStart !== undefined ? ` pendingAtStart=${x.pendingAtStart}` : ''}${x.fails.length ? ' FAIL e.g. ' + JSON.stringify(x.fails[0]).slice(0, 220) : ''}`);
}
console.log('cdp', JSON.stringify(out.cdp));
process.exit(0);
