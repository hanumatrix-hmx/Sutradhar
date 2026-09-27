// FR2-12 audit-5: attacks on the tab-LIFETIME commit-tracking session (BrowserTab.setupCommitTracking).
//  a) long-lived tab, many varied navigations: commitAt must track the MOST RECENT cross-document commit,
//     never move on same-document navs, sessions/listeners must not accumulate, heap must stay flat.
//  b) close races: tab closed before setup finishes / closed by the page itself / closed mid-audit.
//  c) several tabs navigating + auditing concurrently: no cross-tab leakage of commit times, doc responses, findings.
//  d) adoption: popup (adoptPopupPage) and attach() to an external Chrome (adoptExistingPage).
//  e) URL-mode per-call session interleaved with current-page mode on the same tab.
// Watchdog 900s. Only own PIDs killed; own temp profile dir removed.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadRuntime, installCdpCounters, cdpStats, cdpSummary, startServer, chromePidOf, pids, cap, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';
const ONLY = process.argv[2] ?? 'all';
const OUT = outPath(`probe-tablife-${ONLY}.json`);
const out = { only: ONLY };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
let tmpProfile = null;
const cleanupTmp = () => { if (tmpProfile) try { fsSync.rmSync(tmpProfile, { recursive: true, force: true }); } catch {} };
const stopWd = watchdog(900000, async () => { out.watchdog = true; await save(); cleanupTmp(); });
await installCdpCounters();
const { SutradharRuntime } = await loadRuntime();

const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  const m = u.searchParams.get('m') ?? 'X';
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/noisy') return res.writeHead(200, H), res.end(html(`<h1>noisy ${m}</h1><script>setInterval(function(){console.error("OLD-${m}");fetch("/oldmissing-${m}-"+Math.random())},25)</script>`));
  if (p === '/clean') { const d = Number(u.searchParams.get('d') ?? 0); return void setTimeout(() => { res.writeHead(200, H); res.end(html(`<h1>clean ${m}</h1><script>console.error("OWN-${m}")</script>`)); }, d); }
  if (p === '/own404') return res.writeHead(404, H), res.end(html(`<h1>nf ${m}</h1><script>console.error("OWN-${m}")</script>`));
  if (p === '/hash') return res.writeHead(200, H), res.end(html(`<h1>hash ${m}</h1><script>console.error("OWN-${m}");setTimeout(function(){location.hash="x"},50)</script>`));
  if (p === '/push') return res.writeHead(200, H), res.end(html(`<h1>push ${m}</h1><script>console.error("OWN-${m}");setTimeout(function(){history.pushState(null,"","/pushed-${m}")},50)</script>`));
  if (p === '/jsredir') return res.writeHead(200, H), res.end(html(`<script>location.replace("/clean?m=${m}")</script>`));
  if (p === '/linkto') return res.writeHead(200, H), res.end(html(`<a id=l href="/clean?d=150&m=${m}">go</a><script>setInterval(function(){console.error("OLD-${m}pre")},25)</script>`));
  if (p === '/opener') return res.writeHead(200, H), res.end(html(`<button id=b onclick="window.open('/noisy?m=${m}pop','_blank')">open</button>`));
  if (p === '/selfclose') return res.writeHead(200, H), res.end(html(`<script>setTimeout(function(){window.close()},200)</script>`));
  if (p === '/alertnow') return res.writeHead(200, H), res.end(html(`<script>alert("adopt-dialog")</script>`));
  res.writeHead(404); res.end('nf');
});
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const tabOf = (id) => runtime['resolveTab'](sid, id).tab;
const cls = (a, m) => ({
  url: a.url.replace(origin, ''),
  foreign: a.consoleErrors.filter((e) => /OLD-|OWN-/.test(e.text) && !e.text.includes(`OWN-${m}`)).map((e) => e.text).filter((x, i, arr) => arr.indexOf(x) === i),
  foreignBroken: a.brokenRequests.filter((b) => !b.url.includes(`-${m}`) && !b.url.includes(`m=${m}`)).map((b) => `${b.status} ${b.url.replace(origin, '')}`).slice(0, 5),
  ownKept: a.consoleErrors.some((e) => e.text.includes(`OWN-${m}`)),
  covers: a.observation.coversWholeDocument,
});
const run = async (name, fn) => {
  if (ONLY !== 'all' && ONLY !== name) return;
  const t0 = Date.now();
  try { out[name] = await cap(fn(), 600000, name); } catch (e) { out[name] = { error: String(e.stack ?? e).slice(0, 600) }; }
  out[name].elapsedMs = Date.now() - t0;
  await save();
  console.log(name, JSON.stringify(out[name]).slice(0, 1500));
};

// ---------- a) long-lived tab
await run('a-longlived', async () => {
  const { id: tabId } = await runtime.createTab(sid);
  const tab = tabOf(tabId);
  await sleep(300);
  const page = runtime['requirePage'](tab);
  const steps = [];
  const kinds = ['noisy', 'clean', 'own404', 'hash', 'push', 'jsredir', 'click', 'reload', 'clean800', 'back'];
  const heap0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 60; i++) {
    const kind = kinds[i % kinds.length];
    const m = `L${i}`;
    const before = tab.getLastMainFrameCommitAt();
    const tStart = new Date().toISOString();
    if (kind === 'noisy') { await runtime.navigate(sid, `${origin}/noisy?m=${m}`, tabId); await sleep(300); }
    else if (kind === 'clean') await runtime.navigate(sid, `${origin}/clean?d=150&m=${m}`, tabId);
    else if (kind === 'clean800') await runtime.navigate(sid, `${origin}/clean?d=800&m=${m}`, tabId);
    else if (kind === 'own404') await runtime.navigate(sid, `${origin}/own404?m=${m}`, tabId);
    else if (kind === 'hash') { await runtime.navigate(sid, `${origin}/hash?m=${m}`, tabId); }
    else if (kind === 'push') { await runtime.navigate(sid, `${origin}/push?m=${m}`, tabId); }
    else if (kind === 'jsredir') { await runtime.navigate(sid, `${origin}/jsredir?m=${m}`, tabId); await sleep(300); }
    else if (kind === 'click') { await runtime.navigate(sid, `${origin}/linkto?m=${m}`, tabId); await sleep(300); await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.click('#l')]); }
    else if (kind === 'reload') { await runtime.reload(sid, tabId); }
    else if (kind === 'back') { await runtime.goBack(sid, tabId); }
    const tEndNav = new Date().toISOString();
    // same-document follow-ups (hash/push) happen 50ms after load: let them fire, commitAt must NOT move
    const afterNav = tab.getLastMainFrameCommitAt();
    await sleep(150);
    const afterSameDoc = tab.getLastMainFrameCommitAt();
    const timeOrigin = await page.evaluate(() => performance.timeOrigin).catch(() => null);
    const docStart = timeOrigin ? new Date(Math.floor(timeOrigin)).toISOString() : null;
    const rec = { i, kind, commitMoved: before !== afterNav, commitAfterNavStart: afterNav >= tStart, commitAfterDocStart: afterNav >= docStart, sameDocMovedIt: afterSameDoc !== afterNav, docResp: tab.getLastMainDocumentResponse()?.status };
    if (kind === 'clean' || kind === 'clean800' || kind === 'own404' || kind === 'hash' || kind === 'push' || kind === 'click' || kind === 'jsredir') {
      const a = await runtime.audit(sid, { tabId });
      const mm = kind === 'click' ? m : m;
      rec.audit = cls(a, mm);
      rec.ownStatus404 = a.brokenRequests.some((b) => b.status === 404 && b.url.includes('/own404'));
    }
    steps.push(rec);
  }
  // listener accounting on the tracking session
  const client = tab['commitTrackingCdpClient'];
  const listenerCounts = client ? { frameNavigated: client.listenerCount?.('Page.frameNavigated'), responseReceived: client.listenerCount?.('Network.responseReceived') } : null;
  // 200 fast navigations for leak/heap trend
  global.gc?.();
  const heapMid = process.memoryUsage().heapUsed;
  const createdBefore = cdpStats.created;
  for (let i = 0; i < 200; i++) await runtime.navigate(sid, `${origin}/clean?m=F${i}`, tabId);
  const commitAfterFast = tab.getLastMainFrameCommitAt();
  const a = await runtime.audit(sid, { tabId });
  const heapEnd = process.memoryUsage().heapUsed;
  const res = {
    steps,
    violations: {
      crossDocCommitNotMoved: steps.filter((s) => s.kind !== 'hash' && s.kind !== 'push' && !s.commitMoved).map((s) => `${s.i}:${s.kind}`),
      commitBeforeDocStart: steps.filter((s) => !s.commitAfterDocStart).map((s) => `${s.i}:${s.kind}`),
      sameDocMovedCommit: steps.filter((s) => s.sameDocMovedIt).map((s) => `${s.i}:${s.kind}`),
      foreignFindings: steps.filter((s) => s.audit && (s.audit.foreign.length || s.audit.foreignBroken.length)).map((s) => ({ i: s.i, kind: s.kind, f: s.audit.foreign, fb: s.audit.foreignBroken })),
      ownDropped: steps.filter((s) => s.audit && !s.audit.ownKept).map((s) => `${s.i}:${s.kind}`),
      own404Missing: steps.filter((s) => s.kind === 'own404' && !s.ownStatus404).map((s) => s.i),
      own404Stale: steps.filter((s) => s.audit && s.kind !== 'own404' && s.ownStatus404).map((s) => `${s.i}:${s.kind}`),
    },
    listenerCounts,
    fast200: { sessionsCreatedDuring: cdpStats.created - createdBefore, commitAfterFastIsRecent: commitAfterFast > new Date(Date.now() - 5000).toISOString(), auditAfterFast: cls(a, 'F199') },
    heapMB: { start: +(heap0 / 1e6).toFixed(1), mid: +(heapMid / 1e6).toFixed(1), end: +(heapEnd / 1e6).toFixed(1) },
    cdp: cdpSummary(),
  };
  await runtime.closeTab(sid, tabId);
  res.cdpAfterClose = cdpSummary();
  return res;
});

// ---------- b) close races
await run('b-close', async () => {
  const r = {};
  // b1: close immediately after creation (setup still in flight), then audit on the stale id
  for (let t = 0; t < 5; t++) {
    const createdBefore = cdpStats.created;
    const { id } = await runtime.createTab(sid);
    const tab = tabOf(id);
    await runtime.closeTab(sid, id);
    let auditErr = null;
    try { await cap(runtime.audit(sid, { tabId: id }), 20000, 'auditClosed'); auditErr = 'NO ERROR (unexpected)'; } catch (e) { auditErr = e.message.slice(0, 160); }
    let auditUrlErr = null;
    try { await cap(runtime.audit(sid, { tabId: id, url: `${origin}/clean` }), 20000, 'auditUrlClosed'); auditUrlErr = 'NO ERROR (unexpected)'; } catch (e) { auditUrlErr = e.message.slice(0, 160); }
    await sleep(1200); // let a late createCDPSession resolve
    const client = tab['commitTrackingCdpClient'];
    (r.b1 ??= []).push({ auditErr, auditUrlErr, sessionsCreated: cdpStats.created - createdBefore, lateClientAssigned: !!client, lateClientDetached: client ? client.detached : null, getters: { commit: tab.getLastMainFrameCommitAt(), resp: tab.getLastMainDocumentResponse() } });
  }
  // b2: tab closed by the page itself (window.close), then audit on that id
  const { id: openerId } = await runtime.createTab(sid, `${origin}/opener?m=b2`);
  const opener = runtime['requirePage'](tabOf(openerId));
  const before = (await runtime.listTabs(sid)).map((t) => t.id);
  await opener.evaluate((o) => window.open(o + '/selfclose', '_blank'), origin);
  await sleep(1500);
  const after = (await runtime.listTabs(sid)).map((t) => t.id);
  const popupId = after.find((x) => !before.includes(x)) ?? null;
  let b2err = null;
  if (popupId) { try { await cap(runtime.audit(sid, { tabId: popupId }), 20000, 'b2'); b2err = 'NO ERROR'; } catch (e) { b2err = e.message.slice(0, 160); } }
  r.b2 = { popupStillListed: !!popupId, auditErr: b2err, tabsAfter: after.length };
  // b3: close the tab while an audit({url}) is in flight
  const { id: b3 } = await runtime.createTab(sid);
  await sleep(300);
  const p = runtime.audit(sid, { tabId: b3, url: `${origin}/clean?d=400&m=b3` }).then(() => 'resolved', (e) => 'rejected: ' + e.message.slice(0, 120));
  await sleep(150);
  await runtime.closeTab(sid, b3);
  r.b3 = { outcome: await cap(p, 30000, 'b3') };
  // b4: close while current-page audit in flight
  const { id: b4 } = await runtime.createTab(sid, `${origin}/clean?m=b4`);
  const p4 = runtime.audit(sid, { tabId: b4 }).then(() => 'resolved', (e) => 'rejected: ' + e.message.slice(0, 120));
  await runtime.closeTab(sid, b4);
  r.b4 = { outcome: await cap(p4, 30000, 'b4') };
  await runtime.closeTab(sid, openerId);
  r.cdp = cdpSummary();
  return r;
});

// ---------- c) concurrent multi-tab
await run('c-multitab', async () => {
  const N = 4;
  const tabs = [];
  for (let i = 0; i < N; i++) tabs.push((await runtime.createTab(sid)).id);
  await sleep(300);
  const rounds = [];
  for (let r = 0; r < 10; r++) {
    const res = await Promise.all(tabs.map(async (id, i) => {
      const m = `T${i}R${r}`;
      await runtime.navigate(sid, `${origin}/noisy?m=${m}x`, id);
      await sleep(200 + 50 * i);
      const shape = i % 4;
      const t0 = new Date().toISOString();
      if (shape === 0) await runtime.navigate(sid, `${origin}/clean?d=150&m=${m}`, id);
      else if (shape === 1) await runtime.navigate(sid, `${origin}/own404?m=${m}`, id);
      else if (shape === 2) await runtime.navigate(sid, `${origin}/clean?d=800&m=${m}`, id);
      else await runtime.navigate(sid, `${origin}/push?m=${m}`, id);
      await sleep(150);
      const tab = tabOf(id);
      const commit = tab.getLastMainFrameCommitAt();
      const resp = tab.getLastMainDocumentResponse();
      const a = await runtime.audit(sid, { tabId: id });
      const c = cls(a, m);
      return {
        i, commitInOwnWindow: commit >= t0, respIsOwn: !!resp && resp.url.includes(`m=${m}`),
        foreign: c.foreign, foreignBroken: c.foreignBroken.filter((x) => !x.includes(`/own404?m=${m}`)), ownKept: c.ownKept,
        own404: a.brokenRequests.some((b) => b.status === 404 && b.url.includes('/own404')), expect404: shape === 1,
      };
    }));
    rounds.push(res);
  }
  // concurrent audits of all tabs at once on the settled pages (current-page)
  const conc = await Promise.all(tabs.map((id, i) => runtime.audit(sid, { tabId: id }).then((a) => cls(a, `T${i}R9`))));
  const flat = rounds.flat();
  const res = {
    trials: flat.length,
    commitOutsideOwnWindow: flat.filter((x) => !x.commitInOwnWindow).length,
    docRespNotOwn: flat.filter((x) => !x.respIsOwn).length,
    foreignConsole: flat.filter((x) => x.foreign.length).length,
    foreignBroken: flat.filter((x) => x.foreignBroken.length).length,
    ownDropped: flat.filter((x) => !x.ownKept).length,
    own404Wrong: flat.filter((x) => x.own404 !== x.expect404).length,
    examples: flat.filter((x) => x.foreign.length || x.foreignBroken.length || !x.ownKept || x.own404 !== x.expect404 || !x.respIsOwn).slice(0, 5),
    concurrentAudits: conc.map((c) => ({ foreign: c.foreign.length, fb: c.foreignBroken.length, own: c.ownKept })),
  };
  for (const id of tabs) await runtime.closeTab(sid, id);
  res.cdp = cdpSummary();
  return res;
});

// ---------- d) adoption
await run('d-adoption', async () => {
  const r = {};
  // d1: popup adopted via page.on('popup')
  const { id: openerId } = await runtime.createTab(sid, `${origin}/opener?m=d1`);
  const opener = runtime['requirePage'](tabOf(openerId));
  const before = (await runtime.listTabs(sid)).map((t) => t.id);
  await opener.click('#b');
  await sleep(1500);
  const popupId = (await runtime.listTabs(sid)).map((t) => t.id).find((x) => !before.includes(x));
  const ptab = tabOf(popupId);
  r.popup = { adopted: !!popupId, hasTracker: !!ptab['commitTrackingCdpClient'], commitAtAfterAdopt: ptab.getLastMainFrameCommitAt() };
  const pr = [];
  for (let t = 0; t < 5; t++) {
    await runtime.navigate(sid, `${origin}/noisy?m=d1n${t}`, popupId); await sleep(400);
    await runtime.navigate(sid, `${origin}/clean?d=150&m=d1c${t}`, popupId);
    pr.push(cls(await runtime.audit(sid, { tabId: popupId }), `d1c${t}`));
  }
  r.popup.trials = pr;
  r.popup.leaked = pr.filter((x) => x.foreign.length || x.foreignBroken.length).length;
  r.popup.ownDropped = pr.filter((x) => !x.ownKept).length;
  await runtime.closeTab(sid, popupId); await runtime.closeTab(sid, openerId);

  // d2: attach() to an external Chrome launched here (own temp profile, own PID) and adopt its page
  tmpProfile = fsSync.mkdtempSync(path.join(os.tmpdir(), 'fr212-audit5-attach-'));
  const chromeExe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const cp = spawn(chromeExe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${tmpProfile}`, '--no-first-run', '--no-default-browser-check', `${origin}/noisy?m=d2pre`], { stdio: 'ignore' });
  pids.add(cp.pid);
  let port = null;
  for (let i = 0; i < 100 && !port; i++) { await sleep(100); try { port = fsSync.readFileSync(path.join(tmpProfile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} }
  r.attach = { chromePid: cp.pid, port };
  const rt2 = new SutradharRuntime({});
  const { sessionId: asid } = await rt2.attach({ endpoint: `http://127.0.0.1:${port}` });
  const atab = rt2['resolveTab'](asid).tab;
  r.attach.adoptedUrl = atab.url.replace(origin, '');
  r.attach.hasTracker0 = !!atab['commitTrackingCdpClient'];
  await sleep(300);
  r.attach.hasTracker = !!atab['commitTrackingCdpClient'];
  r.attach.commitAtBeforeAnyNav = atab.getLastMainFrameCommitAt();
  // current-page audit of the ALREADY-loaded noisy page: must be coversWholeDocument:false (attached late)
  const a0 = await rt2.audit(asid, {});
  r.attach.preloadedAudit = { covers: a0.observation.coversWholeDocument, consoleErrors: a0.consoleErrors.length };
  const at = [];
  for (let t = 0; t < 5; t++) {
    await rt2.navigate(asid, `${origin}/noisy?m=d2n${t}`); await sleep(400);
    await rt2.navigate(asid, `${origin}/clean?d=150&m=d2c${t}`);
    at.push(cls(await rt2.audit(asid, {}), `d2c${t}`));
  }
  r.attach.trials = at;
  r.attach.leaked = at.filter((x) => x.foreign.length || x.foreignBroken.length).length;
  r.attach.ownDropped = at.filter((x) => !x.ownKept).length;
  // d3: adopt a page that has a dialog OPEN at adoption time (setup Page.enable blocked) -> bounded? tracking recovers?
  const extPage = (await rt2['requirePage'](atab).browser().newPage());
  void extPage.goto(`${origin}/alertnow`).catch(() => {});
  await sleep(800);
  const session = rt2['requireSession'](asid);
  const t0 = Date.now();
  const adopted = await cap(session.adoptExistingPage(extPage, false), 20000, 'adoptDialog');
  r.attach.adoptWithDialogMs = Date.now() - t0;
  const pend = rt2.getPendingDialog(asid, adopted.id);
  r.attach.pendingSeenByAdoptedTab = !!pend;
  if (pend) await rt2.handleDialog(asid, 'accept', undefined, adopted.id).catch((e) => { r.attach.handleErr = e.message; });
  else await extPage.evaluate(() => 1).catch(() => {});
  await sleep(1500);
  const d3 = [];
  for (let t = 0; t < 3; t++) {
    await rt2.navigate(asid, `${origin}/noisy?m=d3n${t}`, adopted.id).catch((e) => d3.push({ navErr: e.message.slice(0, 100) })); await sleep(400);
    await rt2.navigate(asid, `${origin}/clean?d=150&m=d3c${t}`, adopted.id).catch((e) => d3.push({ navErr: e.message.slice(0, 100) }));
    try { d3.push(cls(await cap(rt2.audit(asid, { tabId: adopted.id }), 30000, 'd3'), `d3c${t}`)); } catch (e) { d3.push({ auditErr: e.message.slice(0, 160) }); }
  }
  r.attach.dialogAdoptTrials = d3;
  r.attach.dialogAdoptCommitAt = adopted.getLastMainFrameCommitAt();
  try { await cap(rt2.shutdownAll(), 20000, 'sd2'); } catch {}
  try { cp.kill(); } catch {}
  await sleep(1000);
  return r;
});

// ---------- e) URL-mode per-call session interleaved with the tab-lifetime session on the same tab
await run('e-interleave', async () => {
  const { id: tabId } = await runtime.createTab(sid);
  const tab = tabOf(tabId);
  await sleep(300);
  const recs = [];
  for (let t = 0; t < 8; t++) {
    await runtime.navigate(sid, `${origin}/noisy?m=e${t}n`, tabId); await sleep(300);
    const a1 = await runtime.audit(sid, { tabId, url: `${origin}/own404?m=e${t}a`, settleMs: 300 });
    const commitAfterUrl = tab.getLastMainFrameCommitAt();
    const respAfterUrl = tab.getLastMainDocumentResponse();
    const a2 = await runtime.audit(sid, { tabId }); // same doc, current-page mode: must match a1's own findings, no old
    const a3 = await runtime.audit(sid, { tabId, url: `${origin}/clean?d=150&m=e${t}b`, settleMs: 300 });
    const a4 = await runtime.audit(sid, { tabId });
    recs.push({
      url404: { ...cls(a1, `e${t}a`), own404: a1.brokenRequests.some((b) => b.status === 404) },
      cp404: { ...cls(a2, `e${t}a`), own404: a2.brokenRequests.some((b) => b.status === 404) },
      trackerSawUrlModeNav: respAfterUrl?.url?.includes(`m=e${t}a`) && commitAfterUrl !== null,
      urlClean: { ...cls(a3, `e${t}b`), any404: a3.brokenRequests.some((b) => b.status === 404) },
      cpClean: { ...cls(a4, `e${t}b`), any404: a4.brokenRequests.some((b) => b.status === 404) },
    });
  }
  // concurrent: url-mode audit and a current-page audit fired together on the same tab (inherently racy -> record only)
  await runtime.navigate(sid, `${origin}/clean?m=econc0`, tabId);
  const [x, y] = await Promise.allSettled([runtime.audit(sid, { tabId, url: `${origin}/clean?d=300&m=econc1`, settleMs: 300 }), runtime.audit(sid, { tabId })]);
  const bad = recs.filter((r) => r.url404.foreign.length || r.cp404.foreign.length || !r.url404.own404 || !r.cp404.own404 || r.urlClean.any404 || r.cpClean.any404 || r.urlClean.foreign.length || r.cpClean.foreign.length || !r.cpClean.ownKept || !r.cp404.ownKept);
  const res = { trials: recs.length, bad: bad.length, badExamples: bad.slice(0, 3), trackerSawUrlModeNavs: recs.filter((r) => r.trackerSawUrlModeNav).length, recs, concurrent: { url: x.status, cp: y.status, cpReason: y.reason?.message?.slice(0, 120), urlReason: x.reason?.message?.slice(0, 120) } };
  await runtime.closeTab(sid, tabId);
  res.cdp = cdpSummary();
  return res;
});

out.cdpFinal = cdpSummary();
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
stopWd(); killAll(); server.close(); cleanupTmp(); await save();
out.tmpProfileRemoved = tmpProfile ? !fsSync.existsSync(tmpProfile) : null;
await save();
process.exit(0);
