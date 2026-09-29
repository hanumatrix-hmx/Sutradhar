// FR2-12 audit-5: exploratory probes of hypotheses derived from reading escalation-1's code.
// Runtime-direct. Watchdog 420s. Chrome killed by own PID only.
import fs from 'node:fs/promises';
import { loadRuntime, installCdpCounters, emulatePreFix, cdpSummary, startServer, chromePidOf, cap, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';

const ONLY = process.argv[2] ?? 'all';
const TR = Number(process.argv[3] ?? '5');
const PREFIX = process.env.PREFIX === "1";
const OUT = outPath(`probe-hyp-${ONLY}${PREFIX ? "-prefix" : ""}.json`);
const out = { only: ONLY, trials: TR, preFixEmulation: PREFIX, results: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(420000, async () => { out.watchdog = true; await save(); });

await installCdpCounters();
if (PREFIX) out.preFixPatched = await emulatePreFix();
const { SutradharRuntime } = await loadRuntime();

const noisyScript = `<script>setInterval(function(){console.error("OLDPAGE-err");fetch("/oldpage-missing-"+Math.random())},20)</script>`;
const { server, origin, altOrigin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/noisy') return res.writeHead(200, H), res.end(html('<h1>noisy</h1>' + noisyScript, 'noisy'));
  if (p === '/noisy-pr') {
    const target = u.searchParams.get('target');
    return res.writeHead(200, H), res.end(html(`<h1>noisy-pr</h1><a id=l href="${target}">go</a><script type="speculationrules">${JSON.stringify({ prerender: [{ source: 'list', urls: [target], eagerness: 'immediate' }] })}</script>` + noisyScript, 'noisy-pr'));
  }
  if (p === '/clean') { const d = Number(u.searchParams.get('d') ?? 0); return void setTimeout(() => { res.writeHead(200, H); res.end(html('<h1>clean</h1>', 'clean')); }, d); }
  if (p === '/cleanpr') return res.writeHead(200, H), res.end(html('<h1>clean-pr</h1><script>window.__wasPrerendering=document.prerendering;</script>', 'cleanpr'));
  if (p === '/own404') return res.writeHead(404, H), res.end(html('<h1>nf</h1>', 'nf'));
  if (p === '/bfA') return res.writeHead(200, H), res.end(html('<h1>A</h1><a id=l href="/own404">x</a><script>console.error("A-OWN-ERR");fetch("/a-own-missing");addEventListener("pageshow",function(e){window.__persisted=e.persisted;window.__showCount=(window.__showCount||0)+1})</script>', 'A'));
  if (p === '/bfAclean') return res.writeHead(200, H), res.end(html('<h1>Aclean</h1><script>addEventListener("pageshow",function(e){window.__persisted=e.persisted})</script>', 'Aclean'));
  if (p === '/unloadnoisy') return res.writeHead(200, H), res.end(html('<h1>un</h1><script>addEventListener("pagehide",function(){for(var i=0;i<5;i++){console.error("OLDPAGE-pagehide");fetch("/oldpage-missing-ph"+i,{keepalive:true})}});addEventListener("unload",function(){console.error("OLDPAGE-unload")});setInterval(function(){console.error("OLDPAGE-err")},20)</script>', 'un'));
  if (p === '/early') return res.writeHead(200, H), res.end(`<!doctype html><html lang=en><head><script>console.error("NEW-EARLY")</script><title>early</title></head><body><img alt=x src="/new-missing-${Math.random()}"></body></html>`);
  if (p === '/js200-to-404') return res.writeHead(200, H), res.end(html('<h1>hop</h1><script>location.replace("/own404?from=js")</script>', 'hop'));
  if (p === '/alertload') return res.writeHead(200, H), res.end(html('<h1>alert</h1><script>setTimeout(function(){alert("a5-open")},100)</script>', 'al'));
  res.writeHead(404); res.end('nf');
});
out.origin = origin;
const closedUrl = await (async () => { const { server: s, origin: o } = await startServer(() => {}); await new Promise((r) => s.close(r)); return o + "/"; })();

const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const tabOf = (tabId) => runtime['resolveTab'](sid, tabId).tab;
const summarize = (a) => ({
  url: a.url,
  oldConsole: a.consoleErrors.filter((e) => /OLDPAGE/.test(e.text)).length,
  oldBroken: a.brokenRequests.filter((b) => /oldpage-missing/.test(b.url)).length,
  consoleErrors: a.consoleErrors.map((e) => e.text.slice(0, 60)).filter((t, i, arr) => arr.indexOf(t) === i).slice(0, 8),
  brokenRequests: a.brokenRequests.slice(0, 8),
  covers: a.observation.coversWholeDocument,
  documentStartedAt: a.observation.documentStartedAt,
});
const tabState = (tab) => ({ commitAt: tab.getLastMainFrameCommitAt?.() ?? null, docResp: tab.getLastMainDocumentResponse?.() ?? null, goto: tab.getLastGotoResponse?.() ?? null });
const run = async (name, fn) => {
  if (ONLY !== 'all' && ONLY !== name) return;
  out.results[name] = { trials: [] };
  for (let t = 0; t < TR; t++) {
    try { out.results[name].trials.push(await cap(fn(t), 90000, name)); } catch (e) { out.results[name].trials.push({ error: String(e.message ?? e).slice(0, 300) }); }
    await save();
  }
};

// H1: prerender activation swaps Puppeteer's primary target; the tab-lifetime session was bound to the old one.
await run('prerender', async (t) => {
  const { id: tabId } = await runtime.createTab(sid);
  const tab = tabOf(tabId);
  await sleep(300);
  const target = `${origin}/cleanpr?t=${t}`;
  await runtime.navigate(sid, `${origin}/noisy-pr?target=${encodeURIComponent(target)}`, tabId);
  await sleep(1500); // let the prerender finish
  const before = tabState(tab);
  const tNav = new Date().toISOString();
  await runtime.navigate(sid, target, tabId);
  const wasPrerendering = await runtime.eval(sid, 'window.__wasPrerendering === true', tabId).catch((e) => 'eval-err ' + e.message);
  const activationStart = await runtime.eval(sid, 'performance.getEntriesByType("navigation")[0].activationStart', tabId).catch(() => null);
  const after = tabState(tab);
  const a1 = summarize(await runtime.audit(sid, { tabId }));
  // Second phase: is tracking still alive after the swap? noisy -> clean again, then audit()
  await runtime.navigate(sid, `${origin}/noisy?p2=${t}`, tabId);
  await sleep(400);
  const tNav2 = new Date().toISOString();
  await runtime.navigate(sid, `${origin}/clean?d=150&p2=${t}`, tabId);
  const after2 = tabState(tab);
  const a2 = summarize(await runtime.audit(sid, { tabId }));
  await runtime.closeTab(sid, tabId);
  return { wasPrerendering, activationStart, before, tNav, after, commitAdvanced: after.commitAt !== before.commitAt, audit1: a1, tNav2, after2, commitAdvanced2: after2.commitAt !== after.commitAt, audit2: a2 };
});

// H2a: bfcache back to a page with its OWN load-time errors -> are they dropped (commit moved to restore time)?
await run('bfcache-own-errors', async (t) => {
  const { id: tabId } = await runtime.createTab(sid);
  const tab = tabOf(tabId);
  await sleep(300);
  await runtime.navigate(sid, `${origin}/bfA?t=${t}`, tabId);
  await sleep(600);
  await runtime.navigate(sid, `${origin}/clean?t=${t}`, tabId);
  await sleep(300);
  await runtime.goBack(sid, tabId);
  await sleep(300);
  const persisted = await runtime.eval(sid, 'window.__persisted', tabId).catch(() => null);
  const navType = await runtime.eval(sid, 'performance.getEntriesByType("navigation")[0].type', tabId).catch(() => null);
  const st = tabState(tab);
  const a = await runtime.audit(sid, { tabId });
  const s = summarize(a);
  await runtime.closeTab(sid, tabId);
  return { persisted, navType, state: st, ownErrPresent: a.consoleErrors.some((e) => e.text.includes('A-OWN-ERR')), ownMissingPresent: a.brokenRequests.some((b) => b.url.includes('a-own-missing')), audit: s };
});

// H2b: bfcache back from an own-404 page -> stale own-status capture reported against the restored page?
await run('bfcache-stale-404', async (t) => {
  const { id: tabId } = await runtime.createTab(sid);
  const tab = tabOf(tabId);
  await sleep(300);
  await runtime.navigate(sid, `${origin}/bfAclean?t=${t}`, tabId);
  await sleep(300);
  await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
  await sleep(300);
  await runtime.goBack(sid, tabId);
  await sleep(300);
  const persisted = await runtime.eval(sid, 'window.__persisted', tabId).catch(() => null);
  const st = tabState(tab);
  const a = await runtime.audit(sid, { tabId });
  await runtime.closeTab(sid, tabId);
  return { persisted, state: st, stale404Reported: a.brokenRequests.some((b) => b.url.includes('/own404')), audit: summarize(a) };
});

// H3: commits with no Document response (about:blank / data:) after an own-404 page -> stale own-status?
await run('stale-404-no-response-commit', async (t) => {
  const { id: tabId } = await runtime.createTab(sid);
  const tab = tabOf(tabId);
  await sleep(300);
  const res = {};
  for (const target of ['about:blank', 'data:text/html,<title>d</title><h1>data</h1>']) {
    await runtime.navigate(sid, `${origin}/own404?t=${t}`, tabId);
    await sleep(300);
    try { await runtime.navigate(sid, target, tabId); } catch (e) { res[target.slice(0, 11)] = { navError: e.message }; continue; }
    await sleep(300);
    const st = tabState(tab);
    const a = await runtime.audit(sid, { tabId });
    res[target.slice(0, 11)] = { state: st, stale404Reported: a.brokenRequests.some((b) => b.url.includes('/own404')), audit: summarize(a) };
  }
  // net error page
  await runtime.navigate(sid, `${origin}/own404?t=${t}n`, tabId);
  await sleep(300);
  let navErr = null;
  try { await runtime.navigate(sid, closedUrl, tabId); } catch (e) { navErr = e.message.slice(0, 80); }
  await sleep(300);
  try {
    const a = await runtime.audit(sid, { tabId });
    res.neterror = { navErr, state: tabState(tab), stale404Reported: a.brokenRequests.some((b) => b.url.includes('/own404')), audit: summarize(a) };
  } catch (e) { res.neterror = { navErr, auditError: e.message.slice(0, 200) }; }
  await runtime.closeTab(sid, tabId);
  return res;
});

// H4: cross-site (127.0.0.1 -> localhost) navigation away from a page that logs in pagehide/unload.
await run('crosssite-unload', async (t) => {
  await runtime.navigate(sid, `${origin}/unloadnoisy?t=${t}`);
  await sleep(400);
  await runtime.navigate(sid, `${altOrigin}/clean?d=${t % 2 ? 150 : 0}&t=${t}`);
  const cp = summarize(await runtime.audit(sid, {}));
  await runtime.navigate(sid, `${origin}/unloadnoisy?u=${t}`);
  await sleep(400);
  await runtime.navigate(sid, `${origin}/clean?d=${t % 2 ? 150 : 0}&u=${t}`);
  const same = summarize(await runtime.audit(sid, {}));
  return { crossSite: cp, sameSite: same };
});

// H5: the new document's own very-first inline error must never be dropped (cross-session ordering).
await run('early-own-error', async (t) => {
  await runtime.navigate(sid, `${origin}/noisy?t=${t}`);
  await sleep(300);
  await runtime.navigate(sid, `${origin}/early?t=${t}`);
  await sleep(300);
  const a = await runtime.audit(sid, {});
  return { earlyKept: a.consoleErrors.some((e) => e.text.includes('NEW-EARLY')), imgKept: a.brokenRequests.some((b) => b.url.includes('new-missing')), leak: summarize(a).oldConsole + summarize(a).oldBroken };
});

// H6: GAP-279 goto-fallback with a JS redirect to a 404 while a dialog is open at audit({url}) start.
await run('dialog-jsredirect-404', async (t) => {
  const { id: tabId } = await runtime.createTab(sid);
  await sleep(300);
  await runtime.navigate(sid, `${origin}/alertload?t=${t}`, tabId);
  await sleep(600);
  const pendingBefore = !!runtime.getPendingDialog(sid, tabId);
  const t0 = Date.now();
  let a; let err = null;
  try { a = await runtime.audit(sid, { url: `${origin}/js200-to-404?t=${t}`, tabId }); } catch (e) { err = e.message.slice(0, 200); }
  const ms = Date.now() - t0;
  const tab = tabOf(tabId);
  const st = tabState(tab);
  // control, no dialog
  const c = await runtime.audit(sid, { url: `${origin}/js200-to-404?c=${t}`, tabId });
  await runtime.closeTab(sid, tabId);
  return { pendingBefore, ms, err, state: st, withDialog404: a ? a.brokenRequests.some((b) => b.status === 404 && b.url.includes('/own404')) : null, withDialogUrl: a?.url, noDialog404: c.brokenRequests.some((b) => b.status === 404 && b.url.includes('/own404')) };
});

out.cdp = cdpSummary();
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
stopWd(); killAll(); server.close(); await save();
for (const [k, v] of Object.entries(out.results)) console.log(k, JSON.stringify(v.trials[0]).slice(0, 900));
console.log('cdp', JSON.stringify(out.cdp));
process.exit(0);
