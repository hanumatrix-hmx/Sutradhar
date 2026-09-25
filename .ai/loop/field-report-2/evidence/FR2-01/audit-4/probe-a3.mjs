// FR2-01 audit-3: new adversarial cases against the fix-2 build (runtime -> engine, worktree dist).
// Usage: node probe-a3.mjs [case,case,...]   Output: probe-a3-results-<cases>.json next to this file.
// Distinct loopback IPs (127.0.0.2, .3, ...) are distinct *sites*, so each iframe is its own
// out-of-process (OOPIF) renderer under site isolation, and one can be made busy independently.
import http from 'node:http'; import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const only = process.argv[2] ? process.argv[2].split(',') : null;
const want = (id) => !only || only.includes(id);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  const u = new URL(req.url, 'http://x');
  const port = server.address().port;
  if (u.pathname === '/frame') {
    // #inframe visible; #late hidden until __reveal. __busy(ms) blocks this renderer.
    res.end(`<div id="inframe">in frame</div><div id="late" style="display:none">late</div>
<script>window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};
window.__busyThenReveal=(ms)=>{window.__busy(ms);document.getElementById('late').style.display='block';window.__revealedAt=Date.now();};</script>`);
    return;
  }
  if (u.pathname === '/reloader') {
    // an iframe that keeps navigating itself (destroys its execution context repeatedly)
    res.end(`<div>reloading</div><script>setTimeout(()=>location.replace('/reloader?'+Math.random()), 40)</script>`);
    return;
  }
  const n = Number(u.searchParams.get('frames') ?? 0);
  const reloader = u.searchParams.get('reloader') === '1';
  let frames = '';
  for (let i = 0; i < n; i++) frames += `<iframe class="bf" src="http://127.0.0.${i + 2}:${port}/frame?i=${i}"></iframe>`;
  if (reloader) frames += `<iframe id="rl" src="http://127.0.0.${n + 2}:${port}/reloader"></iframe>`;
  res.end(`<div id="banner">banner</div><div id="stays">stays</div><div id="spinner">spinner</div>
<div id="toast" style="display:none">toast</div>${frames}
<script>window.__ev={};window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};
window.__show=(id)=>{document.getElementById(id).style.display='block';window.__ev[id]=Date.now();};
window.__hide=(id)=>{document.getElementById(id).style.display='none';window.__ev[id]=Date.now();};</script>`);
});
await new Promise((r) => server.listen(0, '0.0.0.0', r));
const port = server.address().port;
const rt = new SutradharRuntime();
const { sessionId: sid, activeTabId: tid } = await rt.launch({ launch: { headless: true } });
const sess = rt.sessionManager.getSession(sid);
const pageOf = (id) => sess.getTab(id).page;
const out = [];
const rec = (o) => { console.log('RESULT ' + JSON.stringify(o)); out.push(o); };
async function load(page, frames = 0, extra = '') {
  await page.goto(`http://127.0.0.1:${port}/?frames=${frames}${extra}&n=${Math.random()}`, { waitUntil: 'load' });
  await delay(300);
  const bf = page.frames().filter((f) => f.url().includes('/frame'));
  return bf;
}
// fire-and-forget busy inside a frame, scheduled in-page so our CDP call returns immediately
const makeBusy = (frame, ms, fn = '__busy') => frame.evaluate((ms, fn) => { setTimeout(() => window[fn](ms), 0); }, ms, fn).catch(() => {});
const isVisible = (frame, sel) => frame.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel).catch((e) => 'ERR ' + e.message);
const summarize = (r) => ({ success: r.success, retriesUsed: r.retriesUsed, output: r.output, error: r.error?.slice(0, 260) });

const page = pageOf(tid);

// ---------- H: hidden-state false success when a frame is busy (GAP-030 fix side effect) ----------
if (want('h1')) {
  // #spinner is visible in the MAIN frame and never hides; the main frame is busy (long task) for 3s.
  await load(page, 0);
  await page.evaluate(() => { setTimeout(() => window.__busy(3000), 50); });
  await delay(100);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#spinner', 2000, tid, 'hidden');
  const totalMs = Date.now() - t0;
  await delay(3200);
  const stillVisible = await isVisible(page.mainFrame(), '#spinner');
  rec({ id: 'h1-hidden-main-frame-busy-element-never-hid', expected: 'success:false (still visible)', ...summarize(r), totalMs, stillVisibleAfter: stillVisible, FALSE_SUCCESS: r.success === true && stillVisible === true });
}
if (want('h2')) {
  // #inframe is visible inside an OOPIF and never hides; that iframe is busy for 4s.
  const bf = await load(page, 1);
  await makeBusy(bf[0], 4000);
  await delay(50);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#inframe', 2000, tid, 'hidden');
  const totalMs = Date.now() - t0;
  await delay(4200);
  const stillVisible = await isVisible(bf[0], '#inframe');
  rec({ id: 'h2-hidden-oopif-busy-element-never-hid', expected: 'success:false (still visible)', oopif: bf.length, ...summarize(r), totalMs, stillVisibleAfter: stillVisible, FALSE_SUCCESS: r.success === true && stillVisible === true });
}
if (want('h3')) {
  // same as h2, but check-once (timeoutMs 0)
  const bf = await load(page, 1);
  await makeBusy(bf[0], 4000);
  await delay(50);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#inframe', 0, tid, 'hidden');
  const totalMs = Date.now() - t0;
  await delay(4200);
  const stillVisible = await isVisible(bf[0], '#inframe');
  rec({ id: 'h3-hidden-checkonce-oopif-busy', expected: 'success:false (still visible)', ...summarize(r), totalMs, stillVisibleAfter: stillVisible, FALSE_SUCCESS: r.success === true && stillVisible === true });
}
if (want('h5')) {
  // realistic: "wait for the spinner to go away" while the page does chunked heavy work
  // (300ms long tasks back-to-back with 20ms gaps) for ~3s, THEN hides the spinner.
  for (let rep = 0; rep < 3; rep++) {
    await load(page, 0);
    await page.evaluate((chunk) => {
      const end = Date.now() + 3000;
      const step = () => { if (Date.now() < end) { window.__busy(chunk); setTimeout(step, 20); } else { window.__hide('spinner'); } };
      setTimeout(step, 0);
    }, Number(process.env.CHUNK ?? 300));
    await delay(30);
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, '#spinner', 10000, tid, 'hidden');
    const recvAt = Date.now();
    await delay(3500);
    const hiddenAt = await page.evaluate(() => window.__ev.spinner ?? null);
    rec({ id: `h5-hidden-spinner-during-chunked-${process.env.CHUNK ?? 300}ms-long-tasks rep${rep}`, expected: 'success only AFTER the spinner is hidden (~3s)', ...summarize(r), totalMs: recvAt - t0, returnedBeforeSpinnerHidden: hiddenAt ? recvAt < hiddenAt : 'spinner-never-hidden?', FALSE_SUCCESS: r.success && hiddenAt && recvAt < hiddenAt });
  }
}
if (want('h4')) {
  // control: same page, iframe NOT busy -> must fail (proves h2 success is caused by busyness)
  const bf = await load(page, 1);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#inframe', 1000, tid, 'hidden');
  rec({ id: 'h4-control-hidden-oopif-not-busy', expected: 'success:false', ...summarize(r), totalMs: Date.now() - t0 });
}

// ---------- V: visible-state latency with busy frames ----------
async function visibleLatency(label, frames, busyMs, revealAt = 500, timeoutMs = 5000, extra = '') {
  const bf = await load(page, frames, extra);
  for (const f of bf) await makeBusy(f, busyMs);
  await page.evaluate((at) => setTimeout(() => window.__show('toast'), at), revealAt);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#toast', timeoutMs, tid, 'visible');
  const recvAt = Date.now();
  const shownAt = await page.evaluate(() => window.__ev.toast ?? null);
  const o = { id: label, oopifs: bf.length, busyMs, ...summarize(r), totalMs: recvAt - t0, latencyAfterRevealMs: shownAt ? recvAt - shownAt : null };
  if (busyMs) await delay(busyMs + 300);
  return o;
}
if (want('v0')) {
  // baseline latency (non-busy): no iframes, and 1 / 4 healthy iframes; 8 reps each
  for (const n of [0, 1, 4]) {
    const lats = [];
    for (let i = 0; i < 8; i++) { const o = await visibleLatency('v0', n, 0); lats.push(o.success ? o.latencyAfterRevealMs : `FAIL:${o.error}`); }
    rec({ id: `v0-baseline-nonbusy-${n}-healthy-iframes`, latenciesMs: lats });
  }
}
if (want('v1')) {
  for (const n of [1, 4, 8]) rec(await visibleLatency(`v1-visible-main-toast-${n}-busy-oopifs`, n, 6000));
}
if (want('v2')) {
  // 10 busy frames, element never appears, short timeout: is the state-naming message preserved?
  const bf = await load(page, 10);
  for (const f of bf) await makeBusy(f, 15000);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#never', 1000, tid, 'visible');
  rec({ id: 'v2-never-10-busy-oopifs-timeout1000', oopifs: bf.length, ...summarize(r), totalMs: Date.now() - t0, genericOuterMessage: /^Action wait_for_selector timed out after/.test(r.error ?? '') });
  await delay(12000);
}
if (want('v3')) {
  // recovering frame: OOPIF busy 3s, then reveals #late synchronously at the end of the busy loop
  for (const n of [1, 3]) {
    const bf = await load(page, n);
    await makeBusy(bf[0], 3000, '__busyThenReveal');
    for (const f of bf.slice(1)) await makeBusy(f, 3000);
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, '#late', 8000, tid, 'visible');
    const recvAt = Date.now();
    const revealedAt = await bf[0].evaluate(() => window.__revealedAt ?? null).catch(() => null);
    rec({ id: `v3-recovering-oopif-reveals-after-3s-busy (${n} busy)`, ...summarize(r), totalMs: recvAt - t0, latencyAfterRevealMs: revealedAt ? recvAt - revealedAt : null });
    await delay(500);
  }
}

// ---------- D: frame detach / context destroy mid-wait (GAP-031 variants) ----------
if (want('d1')) {
  await load(page, 2);
  await page.evaluate(() => setTimeout(() => document.querySelector('iframe.bf').remove(), 500));
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#stays', 2000, tid, 'hidden');
  rec({ id: 'd1-hidden-stays-one-iframe-detached-mid-wait', expected: 'success:false, "still visible"', ...summarize(r), totalMs: Date.now() - t0, stillVisible: await isVisible(page.mainFrame(), '#stays') });
}
if (want('d2')) {
  await load(page, 2);
  await page.evaluate(() => { setTimeout(() => document.querySelector('iframe.bf').remove(), 500); setTimeout(() => window.__show('toast'), 1500); });
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#toast', 5000, tid, 'visible');
  rec({ id: 'd2-visible-toast-one-iframe-detached-mid-wait', expected: 'success:true retriesUsed 0', ...summarize(r), totalMs: Date.now() - t0 });
}
if (want('d3')) {
  for (let rep = 0; rep < 3; rep++) {
    await load(page, 0, '&reloader=1');
    await page.evaluate(() => setTimeout(() => window.__show('toast'), 1500));
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, '#toast', 5000, tid, 'visible');
    rec({ id: `d3-visible-toast-with-self-reloading-iframe rep${rep}`, expected: 'success:true retriesUsed 0', ...summarize(r), totalMs: Date.now() - t0 });
    await load(page, 0, '&reloader=1');
    await page.evaluate(() => setTimeout(() => window.__hide('banner'), 1500));
    const t1 = Date.now();
    const r2 = await rt.waitForSelector(sid, '#banner', 5000, tid, 'hidden');
    rec({ id: `d3-hidden-banner-with-self-reloading-iframe rep${rep}`, expected: 'success:true retriesUsed 0', ...summarize(r2), totalMs: Date.now() - t1 });
    await load(page, 0, '&reloader=1');
    const t2 = Date.now();
    const r3 = await rt.waitForSelector(sid, '#stays', 2500, tid, 'hidden');
    rec({ id: `d3-hidden-stays-with-self-reloading-iframe rep${rep}`, expected: 'success:false still visible', ...summarize(r3), totalMs: Date.now() - t2 });
  }
}
if (want('d4')) {
  // tab closed mid-wait, visible and hidden, via rt.createTab
  for (const [state, sel] of [['visible', '#never'], ['hidden', '#stays'], ['attached', '#never']]) {
    const t = await rt.createTab(sid, `http://127.0.0.1:${port}/?frames=1&n=${Math.random()}`);
    const p = pageOf(t.id);
    await delay(500);
    setTimeout(() => { p.close().catch(() => {}); }, 800);
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, sel, 5000, t.id, state);
    rec({ id: `d4-${state}-tab-closed-mid-wait (1 iframe)`, expected: 'success:false', ...summarize(r), totalMs: Date.now() - t0 });
  }
}

// ---------- C: concurrent waits on two tabs, one with busy frames ----------
if (want('c1')) {
  const tB = await rt.createTab(sid, `http://127.0.0.1:${port}/?frames=0&n=${Math.random()}`);
  const pB = pageOf(tB.id);
  await delay(500);
  // baseline for tab B alone
  await pB.goto(`http://127.0.0.1:${port}/?frames=0&n=${Math.random()}`);
  await pB.evaluate(() => setTimeout(() => window.__show('toast'), 500));
  let t0 = Date.now(); let rB = await rt.waitForSelector(sid, '#toast', 5000, tB.id, 'visible'); let recvB = Date.now();
  const aloneLat = recvB - (await pB.evaluate(() => window.__ev.toast));
  // concurrent
  const bf = await load(page, 6);
  for (const f of bf) await makeBusy(f, 6000);
  await pB.goto(`http://127.0.0.1:${port}/?frames=0&n=${Math.random()}`);
  await Promise.all([
    page.evaluate(() => setTimeout(() => window.__show('toast'), 500)),
    pB.evaluate(() => setTimeout(() => window.__show('toast'), 500)),
  ]);
  t0 = Date.now();
  let recvA;
  const [rA, rB2] = await Promise.all([
    rt.waitForSelector(sid, '#toast', 5000, tid, 'visible').then((r) => { recvA = Date.now(); return r; }),
    rt.waitForSelector(sid, '#toast', 5000, tB.id, 'visible').then((r) => { recvB = Date.now(); return r; }),
  ]);
  const latA = recvA - (await page.evaluate(() => window.__ev.toast));
  const latB = recvB - (await pB.evaluate(() => window.__ev.toast));
  rec({ id: 'c1-concurrent-tabs-A-6-busy-oopifs-B-clean', tabA: { ...summarize(rA), latencyAfterRevealMs: latA }, tabB: { ...summarize(rB2), latencyAfterRevealMs: latB }, tabBAloneLatencyMs: aloneLat });
  await delay(6500);
  await rt.closeTab(sid, tB.id).catch(() => {});
}

// ---------- B: reveal right at the timeout boundary ----------
if (want('b1')) {
  for (const [frames, busy] of [[0, 0], [2, 8000]]) {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      const bf = await load(page, frames);
      for (const f of bf) await makeBusy(f, busy);
      await page.evaluate(() => setTimeout(() => window.__show('toast'), 1990));
      const t0 = Date.now();
      const r = await rt.waitForSelector(sid, '#toast', 2000, tid, 'visible');
      const recvAt = Date.now();
      const shownAt = await page.evaluate(() => window.__ev.toast ?? null);
      rows.push({ success: r.success, retriesUsed: r.retriesUsed, shownRelMs: shownAt ? shownAt - t0 : null, totalMs: recvAt - t0, err: r.error?.slice(0, 80) });
      if (busy) await delay(busy);
    }
    rec({ id: `b1-reveal-at-1990ms-of-2000ms (${frames} busy oopifs)`, rows });
  }
}

// ---------- R: "timeoutMs <= 0 checks once, no retrying" doc claim ----------
if (want('r1')) {
  await load(page, 0);
  let t0 = Date.now();
  let r = await rt.waitForSelector(sid, '#never', 0, tid, 'visible');
  rec({ id: 'r1-timeout0-never-visible', expected: 'fails immediately, no retry', ...summarize(r), totalMs: Date.now() - t0 });
  await load(page, 0);
  await page.evaluate(() => setTimeout(() => window.__show('toast'), 700));
  t0 = Date.now();
  r = await rt.waitForSelector(sid, '#toast', 0, tid, 'visible');
  rec({ id: 'r1-timeout0-toast-revealed-at-700ms', expected: 'documented: check once -> success:false', ...summarize(r), totalMs: Date.now() - t0 });
}

// ---------- S: selector / timeout validation timing ----------
if (want('s1')) {
  await load(page, 1);
  for (const state of ['attached', 'visible', 'hidden']) {
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, '#[[[', 5000, tid, state);
    rec({ id: `s1-invalid-selector-${state}`, ...summarize(r), totalMs: Date.now() - t0 });
  }
  for (const [label, t] of [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['2^31', 2 ** 31], ['1e308', 1e308]]) {
    for (const state of ['visible', 'attached', 'hidden']) {
      const t0 = Date.now();
      const sel = label.startsWith('2') || label.startsWith('1e') ? (state === 'hidden' ? '#nomatch' : '#stays') : '#never';
      const r = await rt.waitForSelector(sid, sel, t, tid, state);
      rec({ id: `s1-timeout-${label}-${state}`, sel, ...summarize(r), totalMs: Date.now() - t0 });
    }
  }
}

fs.writeFileSync(path.join(here, `probe-a3-results-${only ? only.join('_') : 'all'}.json`), JSON.stringify(out, null, 2));
await rt.shutdown(sid).catch(() => {});
server.close();
process.exit(0);
