// audit-2: characterize interval-polling detection of transient states (foreground tab)
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const FLICK = pathToFileURL(path.join(here, 'adv-flicker.html')).href;
const rt = new SutradharRuntime();
const { sessionId: sid, activeTabId: tid } = await rt.launch({ launch: { headless: true } });
const page = rt.sessionManager.getSession(sid).getTab(tid).page;
const out = [];
for (const [sel, state, onMs, timeout] of [['#blink','visible',300,5000],['#blink','visible',150,5000],['#blink','visible',60,5000],['#blink','visible',30,5000],['#wink','hidden',60,5000],['#wink','hidden',30,5000]]) {
  await rt.navigate(sid, FLICK + '?n=' + Math.random(), tid);
  await page.evaluate(`window.__fx.${sel==='#blink'?'startBlink':'startWink'}(${onMs})`);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, sel, timeout, tid, state);
  const t1 = Date.now();
  const evs = await page.evaluate(() => window.__fx.events.map(e => e.what + '@' + e.at));
  const rec = { sel, state, onMs, timeout, success: r.success, retriesUsed: r.retriesUsed, elapsed: t1 - t0, firstTransitionsRelToT0: evs.slice(0, 8).map(s => { const [w, a] = s.split('@'); return w + '@' + (a - t0); }) };
  console.log(JSON.stringify(rec)); out.push(rec);
}
await rt.shutdown(sid).catch(() => {});
fs.writeFileSync(path.join(here, 'probe-flicker-results.json'), JSON.stringify(out, null, 2));
process.exit(0);
