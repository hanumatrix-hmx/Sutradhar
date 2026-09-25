// audit-2 adversarial probes against the CURRENT built runtime (8e35505).
// Usage: node probe-audit2.mjs [prefix,prefix...]   (mf, g11, g15, g16, g09, g10, n1..n4, c)
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const MAIN = pathToFileURL(path.join(repoRoot, 'tools/scenario-suite/fixtures/fr2-01-wait-states.html')).href;
const only = process.argv[2] ? process.argv[2].split(',') : null;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const unhandled = [];
process.on('unhandledRejection', (e) => unhandled.push(String(e?.message ?? e).slice(0, 200)));
const logLines = [];
const origLog = console.log;
const origWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...rest) => { const s = String(chunk); if (s.startsWith('{"timestamp"')) logLines.push({ at: Date.now(), s }); return origWrite(chunk, ...rest); };
const origErr = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => { const t = String(chunk); if (t.includes('"timestamp"')) logLines.push({ at: Date.now(), s: t.trim() }); return origErr(chunk, ...rest); };
const out = [];
const rec = (o) => { origLog('RESULT ' + JSON.stringify(o)); out.push(o); };
const timeouts = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;

const rt = new SutradharRuntime();
const { sessionId: sid, activeTabId: tidA } = await rt.launch({ launch: { headless: true } });
const sess = rt.sessionManager.getSession(sid);
const pageA = sess.getTab(tidA).page;
const tabB = await rt.createTab(sid, 'data:text/html,<h1>B</h1>');
const pageB = sess.getTab(tabB.id).page;
const want = (id) => !only || only.some((o) => id.startsWith(o));

async function navA(url, hash = '#manual') {
  await pageA.goto(`${url}?n=${Date.now()}${Math.random()}${hash}`);
  await pageA.waitForFunction(() => !!window.__fx);
}
async function background() { await pageB.bringToFront(); await delay(250); return pageA.evaluate(() => document.visibilityState); }
async function foreground() { await pageA.bringToFront(); await delay(150); return pageA.evaluate(() => document.visibilityState); }

// ---- 1. GAP-008 multi-frame + shadow under backgrounding ----
async function bgCase(id, sel, state, setupFn, triggerSrc, bg = true) {
  if (!want(id)) return;
  await navA(MAIN);
  if (setupFn) await setupFn();
  const vis = bg ? await background() : await foreground();
  const frames = pageA.frames().length;
  await pageA.evaluate(`setTimeout(() => { ${triggerSrc}; window.__fx.events.push({id:'audit2-trigger', at: Date.now()}); }, 1000)`);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, sel, 6000, tidA, state);
  const t1 = Date.now();
  const trig = await pageA.evaluate(() => (window.__fx.events.find((e) => e.id === 'audit2-trigger') || {}).at);
  rec({ id, sel, state, visibilityState: vis, frames, success: r.success, retriesUsed: r.retriesUsed, output: r.output, error: r.error?.slice(0, 200), totalMs: t1 - t0, latencyAfterTriggerMs: trig ? t1 - trig : null });
}
const iframeShadowSetup = async () => {
  const f = pageA.frames().find((fr) => fr !== pageA.mainFrame());
  await f.evaluate(() => { const h = document.createElement('div'); h.id = 'fhost'; document.body.appendChild(h); const s = h.attachShadow({ mode: 'open' }); const d = document.createElement('div'); d.id = 'fshadow'; d.textContent = 'iframe shadow'; d.style.display = 'none'; s.appendChild(d); window.__showFS = () => { d.style.display = 'block'; }; window.__hideFS = () => { d.style.display = 'none'; }; });
};
await bgCase('mf1-bg-visible-main-toast', '#toast', 'visible', null, "window.__fx.reveal('toast')");
await bgCase('mf2-bg-visible-iframe-toast', '#frame-toast', 'visible', null, "window.__fx.reveal('frame-toast')");
await bgCase('mf3-bg-visible-shadow-toast', '#shadow-toast', 'visible', null, "window.__fx.reveal('shadow-toast')");
await bgCase('mf4-bg-hidden-shadow-toast', '#shadow-toast', 'hidden', async () => { await pageA.evaluate(() => window.__fx.reveal('shadow-toast')); }, "document.getElementById('host').shadowRoot.getElementById('shadow-toast').style.display='none'");
await bgCase('mf5-bg-visible-iframe-shadow', '#fshadow', 'visible', iframeShadowSetup, "document.getElementById('f').contentWindow.__showFS()");
await bgCase('mf6-bg-hidden-iframe-shadow', '#fshadow', 'hidden', async () => { await iframeShadowSetup(); const f = pageA.frames().find((fr) => fr !== pageA.mainFrame()); await f.evaluate(() => window.__showFS()); }, "document.getElementById('f').contentWindow.__hideFS()");
await bgCase('mf7-bg-hidden-spinner-removed', '#spinner', 'hidden', null, "window.__fx.remove('spinner')");
await bgCase('mf8-bg-hidden-iframe-toast', '#frame-toast', 'hidden', async () => { await pageA.evaluate(() => window.__fx.reveal('frame-toast')); }, "document.getElementById('f').contentWindow.document.getElementById('frame-toast').style.display='none'");
if (want('mf9')) {
  await navA(MAIN); const vis = await background();
  const t0 = Date.now(); const r = await rt.waitForSelector(sid, '#shadow-toast', 800, tidA, 'visible');
  rec({ id: 'mf9-bg-negative-shadow-never-revealed', visibilityState: vis, success: r.success, error: r.error?.slice(0, 220), totalMs: Date.now() - t0 });
}
if (want('mfA')) {
  // negative control: iframe-shadow element stays hidden -> visible wait must fail
  await navA(MAIN); await iframeShadowSetup(); const vis = await background();
  const t0 = Date.now(); const r = await rt.waitForSelector(sid, '#fshadow', 800, tidA, 'visible');
  rec({ id: 'mfA-bg-negative-iframe-shadow-never-revealed', visibilityState: vis, success: r.success, error: r.error?.slice(0, 220), totalMs: Date.now() - t0 });
}

// ---- 2. GAP-011 timeoutMs<=0, all states, satisfied and not ----
if (want('g11')) {
  for (const t of [0, -5]) for (const [sel, state, expect] of [['#stays','visible',true],['#never','visible',false],['#stays','attached',true],['#late','attached',false],['#never','hidden',true],['#nonexistent','hidden',true],['#stays','hidden',false]]) {
    await navA(MAIN); await foreground();
    const t0 = Date.now(); const r = await rt.waitForSelector(sid, sel, t, tidA, state);
    rec({ id: `g11-t${t}-${state}-${sel}`, expectSuccess: expect, success: r.success, ok: r.success === expect, retriesUsed: r.retriesUsed, error: r.error?.slice(0, 200), output: r.output, totalMs: Date.now() - t0 });
  }
}

// ---- 3. GAP-015 invalid selector, all states, background ----
if (want('g15')) {
  for (const state of ['hidden', 'visible', 'attached']) {
    await navA(MAIN); await background();
    const t0 = Date.now(); const r = await rt.waitForSelector(sid, 'div[', 5000, tidA, state);
    rec({ id: `g15-invalid-${state}-bg`, success: r.success, retriesUsed: r.retriesUsed, error: r.error?.slice(0, 200), totalMs: Date.now() - t0 });
  }
}

// ---- 4. GAP-016 otherVisibleMatches ----
if (want('g16')) {
  for (const [sel, setup, expectOther] of [['#banner, #stays', "window.__fx.hide('banner')", 1], ['.dup', '', 1], ['#banner, #never', "window.__fx.hide('banner')", undefined], ['#banner, #stays, .dup', "window.__fx.hide('banner')", 2]]) {
    await navA(MAIN); await foreground(); if (setup) await pageA.evaluate(setup);
    const r = await rt.waitForSelector(sid, sel, 1500, tidA, 'hidden');
    rec({ id: `g16-${sel}`, success: r.success, output: r.output, expectOther, ok: r.success && r.output?.otherVisibleMatches === expectOther, error: r.error?.slice(0, 160) });
  }
}

// ---- 5. GAP-009 end-of-timeout race ----
if (want('g09')) {
  for (const [state, sel, trig] of [['visible', '#toast', "window.__fx.reveal('toast')"], ['attached', '#late', "window.__fx.insert('late')"]]) {
    for (const off of [-40, -20, -10, 0, 5, 10, 20, 40, 80]) {
      await navA(MAIN); await foreground();
      const T = 1000;
      const mark = logLines.length;
      await pageA.evaluate(`setTimeout(() => { ${trig} }, ${T + off})`);
      const r = await rt.waitForSelector(sid, sel, T, tidA, state);
      const warns = logLines.slice(mark).map((l) => l.s).filter((s) => s.includes('failed (attempt'));
      const noElem = warns.filter((s) => s.includes('No element found'));
      rec({ id: `g09-${state}-off${off}`, success: r.success, retriesUsed: r.retriesUsed, attemptErrors: warns.map((s) => { try { return JSON.parse(s).message.slice(0, 260); } catch { return s.slice(0, 200); } }), noElementFoundCount: noElem.length });
    }
  }
}

// ---- 6. GAP-010 hung screenshot (mock) + real bg failure ----
if (want('g10')) {
  await navA(MAIN); await foreground();
  const orig = pageA.screenshot;
  pageA.screenshot = () => new Promise(() => {});
  const t0 = Date.now(); const r = await rt.waitForSelector(sid, '#never', 300, tidA, 'visible'); const wall = Date.now() - t0;
  pageA.screenshot = orig;
  rec({ id: 'g10-mock-hung-screenshot', success: r.success, retriesUsed: r.retriesUsed, hasShot: !!r.failureScreenshot, executionTimeMs: r.executionTimeMs, wallMs: wall, wallMinusExecMs: wall - r.executionTimeMs });
  await navA(MAIN); const vis = await background();
  const t1 = Date.now(); const r2 = await rt.waitForSelector(sid, '#never', 300, tidA, 'visible'); const wall2 = Date.now() - t1;
  rec({ id: 'g10-real-bg-failure', visibilityState: vis, success: r2.success, hasShot: !!r2.failureScreenshot, executionTimeMs: r2.executionTimeMs, wallMs: wall2, wallMinusExecMs: wall2 - r2.executionTimeMs });
}

// ---- 7. NEW: navigate away / close tab mid-poll on a background tab ----
if (want('n1')) {
  await navA(MAIN); const vis = await background();
  const base = timeouts();
  setTimeout(() => { pageA.goto('data:text/html,<div id="toast">already here after nav</div>').catch(() => {}); }, 800);
  const t0 = Date.now(); const r = await rt.waitForSelector(sid, '#toast', 6000, tidA, 'visible');
  rec({ id: 'n1-bg-visible-navigate-away-to-page-with-element', visibilityState: vis, success: r.success, retriesUsed: r.retriesUsed, error: r.error?.slice(0, 200), totalMs: Date.now() - t0, timeoutsBefore: base, timeoutsAfter: timeouts() });
}
if (want('n2')) {
  await navA(MAIN); const vis = await background();
  setTimeout(() => { pageA.goto('data:text/html,<p>no stays here</p>').catch(() => {}); }, 800);
  const t0 = Date.now(); const r = await rt.waitForSelector(sid, '#stays', 6000, tidA, 'hidden');
  rec({ id: 'n2-bg-hidden-navigate-away', visibilityState: vis, success: r.success, output: r.output, error: r.error?.slice(0, 200), totalMs: Date.now() - t0 });
}
if (want('n3')) {
  const tabC = await rt.createTab(sid, `${MAIN}?c=${Date.now()}#manual`);
  const pageC = sess.getTab(tabC.id).page;
  await pageC.waitForFunction(() => !!window.__fx);
  await pageB.bringToFront(); await delay(200);
  const vis = await pageC.evaluate(() => document.visibilityState);
  const base = timeouts();
  setTimeout(() => { pageC.close().catch(() => {}); }, 800);
  const t0 = Date.now(); const r = await rt.waitForSelector(sid, '#never', 5000, tabC.id, 'visible'); const total = Date.now() - t0;
  const afterReturn = timeouts(); await delay(3000); const later = timeouts();
  rec({ id: 'n3-bg-visible-tab-closed-mid-wait', visibilityState: vis, success: r.success, retriesUsed: r.retriesUsed, error: r.error?.slice(0, 220), totalMs: total, timeoutsBefore: base, timeoutsAtReturn: afterReturn, timeouts3sLater: later });
}
if (want('n4')) {
  const tabD = await rt.createTab(sid, `${MAIN}?d=${Date.now()}#manual`);
  const pageD = sess.getTab(tabD.id).page;
  await pageD.waitForFunction(() => !!window.__fx);
  await pageB.bringToFront(); await delay(200);
  setTimeout(() => { pageD.close().catch(() => {}); }, 800);
  const t0 = Date.now(); const r = await rt.waitForSelector(sid, '#stays', 5000, tabD.id, 'hidden');
  rec({ id: 'n4-bg-hidden-tab-closed-mid-wait', success: r.success, output: r.output, retriesUsed: r.retriesUsed, error: r.error?.slice(0, 220), totalMs: Date.now() - t0 });
}

// ---- 8. NEW: concurrent waits ----
if (want('c')) {
  await navA(MAIN);
  const tabE = await rt.createTab(sid, `${MAIN}?e=${Date.now()}#manual`);
  const pageE = sess.getTab(tabE.id).page; await pageE.waitForFunction(() => !!window.__fx);
  await pageE.bringToFront(); await delay(200);
  const visA = await pageA.evaluate(() => document.visibilityState), visE = await pageE.evaluate(() => document.visibilityState);
  await pageA.evaluate("setTimeout(() => window.__fx.reveal('toast'), 1000)");
  await pageE.evaluate("setTimeout(() => window.__fx.reveal('toast'), 1500)");
  const t0 = Date.now();
  const [ra, re] = await Promise.all([
    rt.waitForSelector(sid, '#toast', 5000, tidA, 'visible').then((r) => ({ r, at: Date.now() })),
    rt.waitForSelector(sid, '#toast', 5000, tabE.id, 'visible').then((r) => ({ r, at: Date.now() })),
  ]);
  const evA = await pageA.evaluate(() => window.__fx.events.find((e) => e.id === 'toast').at), evE = await pageE.evaluate(() => window.__fx.events.find((e) => e.id === 'toast').at);
  rec({ id: 'c1-two-tabs-concurrent-visible', visA, visE, a: { success: ra.r.success, retries: ra.r.retriesUsed, doneAt: ra.at - t0, latency: ra.at - evA }, e: { success: re.r.success, retries: re.r.retriesUsed, doneAt: re.at - t0, latency: re.at - evE } });
  await navA(MAIN); await background();
  await pageA.evaluate("setTimeout(() => window.__fx.reveal('toast'), 1000); setTimeout(() => window.__fx.hide('banner'), 1300)");
  const t1 = Date.now();
  const rs = await Promise.all([
    rt.waitForSelector(sid, '#toast', 5000, tidA, 'visible').then((r) => ({ r, at: Date.now() - t1 })),
    rt.waitForSelector(sid, '#banner', 5000, tidA, 'hidden').then((r) => ({ r, at: Date.now() - t1 })),
    rt.waitForSelector(sid, '#toast', 5000, tidA, 'visible').then((r) => ({ r, at: Date.now() - t1 })),
  ]);
  rec({ id: 'c2-same-tab-three-concurrent', results: rs.map((x) => ({ success: x.r.success, doneAt: x.at, retries: x.r.retriesUsed, error: x.r.error?.slice(0, 120) })) });
  const t2 = Date.now();
  const many = await Promise.all([tidA, tabE.id, tabB.id].flatMap((t) => [rt.waitForSelector(sid, '#nope-x', 400, t, 'visible'), rt.waitForSelector(sid, '#stays', 400, t, 'hidden')]));
  rec({ id: 'c3-six-waits-three-tabs', wallMs: Date.now() - t2, successes: many.map((m) => m.success), errs: many.map((m) => m.error?.slice(0, 80)) });
  await rt.closeTab(sid, tabE.id).catch(() => {});
}

const tBefore = timeouts(); await delay(2500);
rec({ id: 'final-resource-check', timeoutsNow: tBefore, timeoutsAfter2500ms: timeouts(), unhandledRejections: unhandled });
await rt.shutdown(sid).catch(() => {});
fs.writeFileSync(path.join(here, only ? `probe-audit2-results-${only.join('_')}.json` : 'probe-audit2-results.json'), JSON.stringify(out, null, 2));
process.exit(0);
