// GAP-256-fix audit-1, point 3: crash-classification robustness with the REAL DialogWarden class
// (packages/browser/dist, the built HEAD code) against REAL headless Chrome. A CLI session only
// launches Chrome; then, per shape, the page state is staged by an independent raw CDP client and
// a FRESH DialogWarden is started AFTER the staging (so it never saw any Target.targetCrashed /
// dialog event -- the "warden started after the fact" path, forcing the corroboration fallback),
// or BEFORE it (event path). listWithLiveness() is then called 3 times; every result is recorded.
// usage: node awarden.mjs <trials> <outFile.jsonl>
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { makeRoot, makeCli, startServer, delay, cleanupRoot, here, repoRoot, CLI_CUR, readState, observer, liveTargets, rawSession, sendT, clickAt } from './alib.mjs';

const TRIALS = Number(process.argv[2] ?? 5);
const OUT = path.join(here, process.argv[3] ?? 'warden-shapes.jsonl');
const { DialogWarden } = await import(pathToFileURL(path.join(repoRoot, 'packages/browser/dist/index.js')).href);
const { server, BASE } = await startServer();
const root = await makeRoot('wd');
const cli = makeCli(root, CLI_CUR);
const dirs = [];

async function newWarden(ws) {
  const w = new DialogWarden({ wsEndpoint: ws, readPolicy: async () => undefined, isStillCurrent: async () => true, onReady: () => {}, onExit: () => {}, statePollMs: 60000 });
  await w.start();
  return w;
}
async function openTab(b, url) {
  const { targetId } = await b._connection.send('Target.createTarget', { url });
  return targetId;
}
async function classify(w, ids) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const r = await w.listWithLiveness();
    const per = {};
    for (const [k, id] of Object.entries(ids)) {
      const d = r.dialogs.find((x) => x.targetId === id);
      per[k] = r.crashed.some((c) => c.targetId === id) ? 'CRASHED' : d ? `dialog:${d.type}` : 'clear';
    }
    out.push({ ms: Math.round(performance.now() - t0), per });
    await delay(300);
  }
  return out;
}

const SHAPES = {
  // crash before the warden exists: event missed -> must still be classified crashed (corroboration)
  crashPageCrash: { pre: true, async stage(b, s) { s.send('Page.crash').catch(() => {}); }, expect: 'CRASHED' },
  crashChromeCrashUrl: { pre: true, async stage(b, s) { s.send('Page.navigate', { url: 'chrome://crash' }).catch(() => {}); }, expect: 'CRASHED' },
  // real dialogs open before the warden starts: never CRASHED
  alert: { pre: true, url: '/alert-inline', expect: 'notCrashed' },
  confirm: { pre: true, url: '/confirm-inline', expect: 'notCrashed' },
  prompt: { pre: true, url: '/prompt-inline', expect: 'notCrashed' },
  beforeunload: { pre: true, url: '/bu', async stage(b, s, ctx) {
    await clickAt(s);
    await delay(300);
    s.send('Page.navigate', { url: `${BASE}/?n=leave` }).catch(() => {});
  }, expect: 'notCrashed' },
  busy: { pre: true, async stage(b, s) { s.send('Runtime.evaluate', { expression: 'setTimeout(()=>{const e=performance.now()+20000;while(performance.now()<e);},0)' }).catch(() => {}); }, expect: 'notCrashed' },
  // popup-born alert in a same-renderer blank popup: holder AND collateral opener never CRASHED
  popupSync: { pre: true, url: '/popup-sync-alert', popup: true, async stage(b, s) { await clickAt(s); }, expect: 'notCrashed' },
  // event path: warden up first, then crash -> CRASHED; then reload the crashed target into an alert page
  crashThenAlertReload: { pre: false, expect: 'special' },
};

async function stageAndCheck(name, t, dir) {
  const sh = SHAPES[name];
  const st = await readState(dir);
  const b = await observer(dir);
  const rec = { shape: name, trial: t, info: {} };
  try {
    await b._connection.send('Target.setDiscoverTargets', { discover: true });
    let crashSeen = false; const crashIds = new Set();
    b._connection.on('Target.targetCrashed', (e) => { crashIds.add(e.targetId); crashSeen = true; });
    const vId = await openTab(b, `${BASE}${sh.url ?? '/'}?n=${name}${t}`);
    await delay(1200);
    const s = await rawSession(b, vId);
    s.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    let w;
    if (name === 'crashThenAlertReload') {
      w = await newWarden(st.wsEndpoint);
      s.send('Page.crash').catch(() => {});
      await delay(1500);
      rec.info.afterCrash = await classify(w, { victim: vId });
      s.send('Page.navigate', { url: `${BASE}/alert-inline?n=re${t}` }).catch(() => {});
      await delay(1500);
      rec.info.observerEval = await sendT(s, 'Runtime.evaluate', { expression: '1' }, 1200);
      rec.info.afterReloadIntoAlert = await classify(w, { victim: vId });
      const last = rec.info.afterReloadIntoAlert.map((x) => x.per.victim);
      rec.pass = rec.info.afterCrash.every((x) => x.per.victim === 'CRASHED') && rec.info.observerEval.r === 'TIMEOUT' && last.every((v) => v !== 'CRASHED' && v !== 'clear');
      await w.stop('audit');
      return rec;
    }
    if (sh.stage) await sh.stage(b, s);
    await delay(1500);
    const ids = { victim: vId };
    if (sh.popup) {
      const all = (await b._connection.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page');
      const pop = all.find((x) => x.openerId === vId);
      if (pop) ids.popup = pop.targetId;
    }
    rec.info.crashEventSeenByObserver = crashIds.has(vId);
    rec.info.observerEval = await sendT(s, 'Runtime.evaluate', { expression: '1' }, 800);
    w = await newWarden(st.wsEndpoint); // started AFTER the staging
    rec.info.classify = await classify(w, ids);
    await w.stop('audit');
    const vals = rec.info.classify.flatMap((x) => Object.values(x.per));
    rec.pass = sh.expect === 'CRASHED' ? rec.info.classify.every((x) => x.per.victim === 'CRASHED') && rec.info.crashEventSeenByObserver
      : !vals.includes('CRASHED') && (name === 'busy' || rec.info.observerEval.r === 'TIMEOUT' || !!ids.popup);
    // clean the target so the next shape starts from a healthy browser
    await b._connection.send('Target.closeTarget', { targetId: vId }).catch(() => {});
    if (ids.popup) await b._connection.send('Target.closeTarget', { targetId: ids.popup }).catch(() => {});
  } catch (e) { rec.error = String(e?.stack ?? e).slice(0, 400); rec.pass = false; }
  finally { await b.disconnect().catch(() => {}); }
  return rec;
}

try {
  for (let t = 0; t < TRIALS; t++) {
    for (const name of Object.keys(SHAPES)) {
      const dir = path.join(root.R, `wd-${name}-${t}`);
      dirs.push(dir);
      await cli(['nav', `${BASE}/?n=home`], dir);
      const rec = await stageAndCheck(name, t, dir);
      await fs.appendFile(OUT, JSON.stringify(rec) + '\n');
      console.log(JSON.stringify({ shape: name, t, pass: rec.pass, err: rec.error?.slice(0, 160), c: (rec.info.classify ?? rec.info.afterReloadIntoAlert ?? []).map((x) => x.per) }));
      await cli(['close'], dir, 30000);
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  console.log('leftovers', JSON.stringify(leftovers));
  await fs.appendFile(OUT, JSON.stringify({ leftovers }) + '\n');
  process.exit(0);
}
