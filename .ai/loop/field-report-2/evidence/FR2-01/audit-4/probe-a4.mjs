// FR2-01 audit-4: NEW adversarial cases against the fix-3 build (runtime -> engine, worktree dist).
// Usage: node probe-a4.mjs [case,case,...]   Output: probe-a4-results-<cases>.json next to this file.
// Same harness shape as audit-3/probe-a3.mjs: distinct loopback IPs (127.0.0.2, .3, ...) are distinct
// *sites*, so each iframe is its own out-of-process (OOPIF) renderer and can be made busy independently.
import http from 'node:http'; import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const only = process.argv[2] ? process.argv[2].split(',') : null;
const want = (id) => !only || only.includes(id);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const BUSY_LIB = `window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};
window.__chunks=(chunk,gap,total)=>{const end=Date.now()+total;const step=()=>{if(Date.now()<end){window.__busy(chunk);setTimeout(step,gap);}};setTimeout(step,0);};`;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  const u = new URL(req.url, 'http://x');
  const port = server.address().port;
  if (u.pathname === '/frame') {
    const kind = u.searchParams.get('kind') ?? 'visible';
    const body =
      kind === 'empty' ? '<div>no match here</div>'
      : kind === 'hidden' ? '<div id="inframe" style="display:none">hidden in frame</div>'
      : kind === 'target' ? '<div id="target">target</div>'
      : '<div id="inframe">in frame</div>';
    res.end(`${body}<script>${BUSY_LIB}</script>`);
    return;
  }
  // frames=kind1,kind2,...  -> one OOPIF per entry, each on its own loopback site
  const kinds = (u.searchParams.get('frames') ?? '').split(',').filter(Boolean);
  let frames = '';
  kinds.forEach((k, i) => { frames += `<iframe class="bf" src="http://127.0.0.${i + 2}:${port}/frame?kind=${k}&i=${i}"></iframe>`; });
  res.end(`<div id="banner">banner</div><div id="spinner">spinner</div>
<div id="toast" style="display:none">toast</div><div id="ghost" style="display:none">ghost</div>${frames}
<script>${BUSY_LIB}window.__ev={};
window.__hide=(id)=>{document.getElementById(id).style.display='none';window.__ev[id]=Date.now();};</script>`);
});
await new Promise((r) => server.listen(0, '0.0.0.0', r));
const port = server.address().port;
const rt = new SutradharRuntime();
const { sessionId: sid, activeTabId: tid } = await rt.launch({ launch: { headless: true } });
const sess = rt.sessionManager.getSession(sid);
const page = sess.getTab(tid).page;
const out = [];
const rec = (o) => { console.log('RESULT ' + JSON.stringify(o)); out.push(o); };
async function load(kinds = []) {
  await page.goto(`http://127.0.0.1:${port}/?frames=${kinds.join(',')}&n=${Math.random()}`, { waitUntil: 'load' });
  await delay(300);
  return page.frames().filter((f) => f.url().includes('/frame'));
}
const inPage = (frame, fn, ...args) => frame.evaluate(fn, ...args).catch(() => {});
const busyFor = (frame, ms) => inPage(frame, (ms) => { setTimeout(() => window.__busy(ms), 0); }, ms);
const chunks = (frame, chunk, gap, total) => inPage(frame, (c, g, t) => window.__chunks(c, g, t), chunk, gap, total);
const isVisible = (frame, sel) => frame.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel).catch((e) => 'ERR ' + e.message);
const summarize = (r) => ({ success: r.success, retriesUsed: r.retriesUsed, output: r.output ?? r.outputData, error: r.error?.slice(0, 300) });
const drain = async (ms) => { await delay(ms); };

// ---------- B: borderline busy — busy chunks just UNDER / around the 250ms probe bound ----------
if (want('b')) {
  for (const chunk of [200, 230, 245, 260, 400]) {
    for (const where of ['main', 'oopif']) {
      const bf = await load(where === 'oopif' ? ['visible'] : []);
      const target = where === 'main' ? page.mainFrame() : bf[0];
      const sel = where === 'main' ? '#spinner' : '#inframe';
      await chunks(target, chunk, 10, 16000); // covers the whole wait INCLUDING the default 2 retries
      await delay(30);
      const t0 = Date.now();
      const r = await rt.waitForSelector(sid, sel, 3000, tid, 'hidden');
      const totalMs = Date.now() - t0;
      await drain(Math.max(0, 16500 - totalMs));
      const stillVisible = await isVisible(target, sel);
      rec({ id: `b-borderline-${where}-chunk${chunk}ms-gap10ms`, expected: 'success:false', ...summarize(r), totalMs, stillVisibleAfter: stillVisible, FALSE_SUCCESS: r.success === true && stillVisible === true });
    }
  }
}

// ---------- S: shifting busy frames — a DIFFERENT frame is busy on different passes ----------
if (want('s')) {
  const patterns = [
    ['s1-element-in-all-3, round-robin 300ms busy', ['visible', 'visible', 'visible'], 300],
    ['s2-element-only-in-A, round-robin 300ms busy over A,B,C', ['visible', 'empty', 'empty'], 300],
    ['s3-element-only-in-A, round-robin 120ms busy over A,B,C', ['visible', 'empty', 'empty'], 120],
    ['s4-element-in-A-and-B, round-robin 270ms busy over A,B', ['visible', 'visible'], 270],
  ];
  for (const [label, kinds, slice] of patterns) {
    const bf = await load(kinds);
    // Round-robin driver running in the MAIN page (not busy itself): tells frame i to spin for
    // `slice` ms, then frame i+1, ... via postMessage-free scheduling from Node side.
    const total = 14000; const t0run = Date.now();
    let stop = false;
    const driver = (async () => {
      let i = 0;
      while (!stop && Date.now() - t0run < total) {
        busyFor(bf[i % bf.length], slice); // fire-and-forget; the CDP call returns once scheduled
        await delay(slice + 5);
        i++;
      }
    })();
    await delay(50);
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, '#inframe', 3000, tid, 'hidden');
    const totalMs = Date.now() - t0;
    stop = true; await driver; await delay(slice + 300);
    const vis = await Promise.all(bf.map((f) => isVisible(f, '#inframe')));
    rec({ id: label, expected: 'success:false', ...summarize(r), totalMs, visibilityAfter: vis, FALSE_SUCCESS: r.success === true && vis.includes(true) });
  }
}

// ---------- P: permanently busy frame for the WHOLE wait ----------
if (want('p')) {
  // p1: genuinely-hidden element INSIDE the permanently busy OOPIF; main has no match.
  let bf = await load(['hidden']);
  await busyFor(bf[0], 20000); await delay(30);
  let t0 = Date.now();
  let r = await rt.waitForSelector(sid, '#inframe', 2000, tid, 'hidden');
  rec({ id: 'p1-hidden-elem-inside-perma-busy-oopif', truth: 'element IS hidden (display:none) the whole time', expected: 'success:false with an honest "could not verify / frame unresponsive" message, NOT "is still visible"', ...summarize(r), totalMs: Date.now() - t0, claimsStillVisible: /still visible/.test(r.error ?? '') });
  await delay(Math.max(0, 20500 - (Date.now() - t0)));

  // p2: genuinely-hidden element in the MAIN frame; an UNRELATED OOPIF (no match at all) is permanently busy.
  bf = await load(['empty']);
  await busyFor(bf[0], 20000); await delay(30);
  t0 = Date.now();
  r = await rt.waitForSelector(sid, '#toast', 2000, tid, 'hidden');
  rec({ id: 'p2-hidden-main-elem-unrelated-perma-busy-oopif', truth: '#toast is display:none in the main frame; the busy iframe has no #toast at all', ...summarize(r), totalMs: Date.now() - t0, claimsStillVisible: /still visible/.test(r.error ?? ''), mainToastVisible: await isVisible(page.mainFrame(), '#toast') });
  await delay(Math.max(0, 20500 - (Date.now() - t0)));

  // p3: same as p2, but check-once (timeoutMs 0)
  bf = await load(['empty']);
  await busyFor(bf[0], 8000); await delay(30);
  t0 = Date.now();
  r = await rt.waitForSelector(sid, '#toast', 0, tid, 'hidden');
  rec({ id: 'p3-checkonce-hidden-main-elem-unrelated-perma-busy-oopif', ...summarize(r), totalMs: Date.now() - t0, claimsStillVisible: /still visible/.test(r.error ?? '') });
  await delay(8500);

  // p4: visible element in the perma-busy OOPIF (true negative) — must fail; record message for contrast
  bf = await load(['visible']);
  await busyFor(bf[0], 20000); await delay(30);
  t0 = Date.now();
  r = await rt.waitForSelector(sid, '#inframe', 2000, tid, 'hidden');
  rec({ id: 'p4-visible-elem-inside-perma-busy-oopif (control: truly visible)', ...summarize(r), totalMs: Date.now() - t0 });
  await delay(Math.max(0, 20500 - (Date.now() - t0)));
}

// ---------- D: visible-timeout diagnosis while a frame is busy (diagnoseSelectorVisibility) ----------
if (want('d')) {
  for (const busy of [false, true]) {
    const bf = await load(['empty']);
    if (busy) await busyFor(bf[0], 20000);
    await delay(30);
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, '#ghost', 1500, tid, 'visible');
    rec({ id: `d-visible-timeout-main-#ghost-display-none, unrelated OOPIF busy=${busy}`, truth: '#ghost EXISTS in the main frame (display:none)', ...summarize(r), totalMs: Date.now() - t0, claimsNoElementFound: /No element found/.test(r.error ?? '') });
    if (busy) await delay(Math.max(0, 20500 - (Date.now() - t0)));
  }
}

// ---------- V: visible / attached paths are still SEQUENTIAL across frames (GAP-059 scope) ----------
if (want('v')) {
  for (const [n, timeoutMs, state] of [[4, 5000, 'visible'], [8, 5000, 'visible'], [14, 1000, 'visible'], [14, 0, 'visible'], [14, 0, 'attached'], [14, 1000, 'hidden'], [14, 0, 'hidden']]) {
    const kinds = [...Array(n).fill('empty'), 'target'];
    const bf = await load(kinds);
    for (const f of bf.slice(0, n)) await busyFor(f, 25000);
    await delay(50);
    const sel = state === 'hidden' ? '#ghost' : '#target';
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, sel, timeoutMs, tid, state);
    const totalMs = Date.now() - t0;
    const targetVisible = await isVisible(bf[n], '#target');
    rec({ id: `v-${state}-${n}-busy-oopifs-then-healthy-target-frame timeout=${timeoutMs}`, truth: state === 'hidden' ? '#ghost hidden in main, absent elsewhere' : '#target visible in the healthy last iframe from the start', ...summarize(r), totalMs, targetVisible, genericOuterMessage: /^Action wait_for_selector timed out after/.test(r.error ?? ''), FALSE_FAILURE: state !== 'hidden' && r.success === false && targetVisible === true });
    await delay(Math.max(0, 25500 - totalMs));
  }
}

// ---------- L: late-resolving abandoned probe handles: are they really disposed? ----------
if (want('l')) {
  const bf = await load(['visible']);
  let created = 0, disposed = 0;
  for (const f of page.frames()) {
    const orig = f.$.bind(f);
    f.$ = async (...a) => {
      const h = await orig(...a);
      if (h) { created++; const d = h.dispose.bind(h); h.dispose = async () => { disposed++; return d(); }; }
      return h;
    };
  }
  await chunks(bf[0], 400, 30, 5000); await delay(30);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#inframe', 4000, tid, 'hidden');
  const totalMs = Date.now() - t0;
  await delay(3000);
  rec({ id: 'l-handle-dispose-count, OOPIF 400ms busy chunks, hidden wait on visible #inframe', ...summarize(r), totalMs, handlesCreated: created, handlesDisposed: disposed, leaked: created - disposed });
}

// ---------- S5: positive control for S — element GENUINELY hides; one of 3 frames is always busy ----------
if (want('s5')) {
  for (const slice of [300, 120]) {
    const bf = await load(['visible', 'empty', 'empty']);
    const total = 14000; const t0run = Date.now(); let stop = false;
    const driver = (async () => { let i = 0; while (!stop && Date.now() - t0run < total) { busyFor(bf[i % bf.length], slice); await delay(slice + 5); i++; } })();
    // hide A's element 500ms in, from inside frame A itself (scheduled now, runs whenever A is free)
    await inPage(bf[0], () => setTimeout(() => { document.getElementById('inframe').style.display = 'none'; window.__hiddenAt = Date.now(); }, 500));
    const t0 = Date.now();
    const r = await rt.waitForSelector(sid, '#inframe', 3000, tid, 'hidden');
    const totalMs = Date.now() - t0;
    stop = true; await driver; await delay(slice + 300);
    const vis = await Promise.all(bf.map((f) => isVisible(f, '#inframe')));
    rec({ id: `s5-element-GENUINELY-hidden-at-500ms, round-robin ${slice}ms busy over A,B,C (always one frame busy)`, truth: 'element hidden in every frame from ~500ms on', ...summarize(r), totalMs, visibilityAfter: vis, claimsStillVisible: /still visible/.test(r.error ?? '') });
  }
}

fs.writeFileSync(path.join(here, `probe-a4-results-${only ? only.join('_') : 'all'}.json`), JSON.stringify(out, null, 2));
await rt.shutdown(sid).catch(() => {});
server.close();
process.exit(0);
