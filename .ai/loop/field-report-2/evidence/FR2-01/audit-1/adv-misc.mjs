// Auditor adversarial cases (b) retry/outer-timeout, (c) flicker, (d) pierce comma/combinator,
// (f) timeoutMs:0 on an already-visible element, (g) busy main thread, (h) invalid selector under
// hidden, (i) hidden across a page reload. All via the real built SutradharRuntime (MCP/SDK path).
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const MAIN = pathToFileURL(path.join(repoRoot, 'tools/scenario-suite/fixtures/fr2-01-wait-states.html')).href;
const FLICK = pathToFileURL(path.join(here, 'adv-flicker.html')).href;
const only = process.argv[2] ? process.argv[2].split(',') : null;
const rt = new SutradharRuntime();
const { sessionId: sid, activeTabId: tid } = await rt.launch({ launch: { headless: true } });
const page = rt.sessionManager.getSession(sid).getTab(tid).page;
const out = [];
const nav = async (u) => { await rt.navigate(sid, `${u}${u.includes('?') ? '&' : '?'}n=${Date.now()}${Math.random()}${u === MAIN ? '#manual' : ''}`, tid); await page.waitForFunction(() => !!window.__fx); };
const truth = (sel) => page.evaluate((s) => { const el = document.querySelector(s); if (!el) return 'absent'; const c = getComputedStyle(el), r = el.getBoundingClientRect(); return !['hidden','collapse'].includes(c.visibility) && r.width > 0 && r.height > 0 ? 'visible' : 'hidden'; }, sel).catch((e) => 'eval-error:' + e.message.slice(0, 40));
async function run(id, url, sel, timeoutMs, state, setup) {
  if (only && !only.some((o) => id.startsWith(o))) return;
  await nav(url);
  if (setup) await page.evaluate(setup);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, sel, timeoutMs, tid, state);
  const elapsed = Date.now() - t0;
  const plainSel = sel.split(',')[0].trim();
  const rec = { id, sel, timeoutMs, state, success: r.success, output: r.output, error: r.error?.slice(0, 230), retriesUsed: r.retriesUsed, elapsed, truthAtReturn: await truth(plainSel) };
  console.log(JSON.stringify(rec)); out.push(rec);
}
try {
  // (b) genuine visible timeout, default timeout (10000) + default retries
  await run('b1-never-default-timeout', MAIN, '#never', undefined, undefined);
  await run('b2-never-3000', MAIN, '#never', 3000, 'visible');
  await run('b3-hidden-stays-3000', MAIN, '#stays', 3000, 'hidden');
  // (f) timeoutMs 0 on an element that is ALREADY visible / already hidden
  await run('f1-timeout0-visible-already', MAIN, '#stays', 0, 'visible');
  await run('f2-timeout0-hidden-already', MAIN, '#never', 0, 'hidden');
  await run('f3-timeout0-attached-already', MAIN, '#stays', 0, 'attached');
  // (c) flicker
  await run('c1-blink30-visible', FLICK, '#blink', 3000, 'visible', 'window.__fx.startBlink(30)');
  await run('c2-blink10-visible', FLICK, '#blink', 3000, 'visible', 'window.__fx.startBlink(5)');
  await run('c3-wink30-hidden', FLICK, '#wink', 3000, 'hidden', 'window.__fx.startWink(30)');
  await run('c4-wink5-hidden', FLICK, '#wink', 3000, 'hidden', 'window.__fx.startWink(5)');
  // (d) pierce/ with comma lists and combinators
  await run('d1-comma-first-hidden-visible', MAIN, '#never, #stays', 1500, 'visible');
  await run('d2-comma-visible-first', MAIN, '#stays, #never', 1500, 'visible');
  await run('d3-comma-hidden-banner-stays', MAIN, '#banner, #stays', 1500, 'hidden', "window.__fx.hide('banner')");
  await run('d4-child-combinator-visible', MAIN, 'body > #stays', 1500, 'visible');
  await run('d5-descendant-across-shadow', MAIN, '#host #shadow-toast', 1500, 'visible', "window.__fx.reveal('shadow-toast')");
  await run('d6-descendant-across-shadow-hidden', MAIN, '#host #shadow-toast', 1500, 'hidden', "window.__fx.reveal('shadow-toast')");
  await run('d7-sibling-combinator-hidden', MAIN, '.dup-first ~ .dup', 1500, 'hidden');
  // (h) invalid selector
  await run('h1-invalid-selector-hidden', MAIN, 'div[', 1500, 'hidden');
  await run('h2-invalid-selector-visible', MAIN, 'div[', 1500, 'visible');
  // (g) busy main thread (4s busy loop starting now) — can the generic outer message win?
  await run('g1-busy-never-1000', FLICK, '#nope', 1000, 'visible', 'setTimeout(() => window.__fx.busy(4000), 50)');
  await run('g2-busy-stays-hidden-1000', FLICK, '#stays', 1000, 'hidden', 'setTimeout(() => window.__fx.busy(4000), 50)');
  // (i) hidden across a page reload: #stays is visible before AND after the reload
  await run('i1-hidden-across-reload', MAIN, '#stays', 4000, 'hidden', 'setTimeout(() => location.reload(), 700)');
  await run('i2-hidden-across-slow-nav', FLICK, '#stays', 4000, 'hidden', `setTimeout(() => { location.href = ${JSON.stringify(FLICK)} + '?slow=' + Date.now(); }, 700)`);
} finally {
  await rt.shutdown(sid).catch(() => {});
  const f = path.join(here, only ? `adv-misc-results-${only.join('_')}.json` : 'adv-misc-results.json');
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
}
process.exit(0);
