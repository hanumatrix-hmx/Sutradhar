// GAP-256-fix audit-1: raw signal check behind the corroboration fallback. For each crash method,
// Performance.getMetrics on (a) a session attached BEFORE the crash and (b) a FRESH session attached
// AFTER it, plus Target.getTargetInfo. Real headless Chrome launched by the real CLI.
// usage: node asignals.mjs <trials> <out.jsonl>
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, startServer, delay, cleanupRoot, here, CLI_CUR, observer, rawSession, sendT } from './alib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const OUT = path.join(here, process.argv[3] ?? 'signals.jsonl');
const { server, BASE } = await startServer();
const root = await makeRoot('sig');
const cli = makeCli(root, CLI_CUR);
const dirs = [];
try {
  for (let t = 0; t < TRIALS; t++) {
    for (const method of ['Page.crash', 'navigate-chrome-crash']) {
      const dir = path.join(root.R, `sig-${t}-${method}`); dirs.push(dir);
      await cli(['nav', `${BASE}/?n=home`], dir);
      const b = await observer(dir);
      const rec = { t, method, crashEvents: 0 };
      try {
        await b.send('Target.setDiscoverTargets', { discover: true });
        const { targetId } = await b.send('Target.createTarget', { url: `${BASE}/?n=v${t}` });
        b.on('Target.targetCrashed', (e) => { if (e.targetId === targetId) rec.crashEvents++; });
        await delay(1000);
        const old = await rawSession(b, targetId);
        rec.oldBefore = await sendT(old, 'Performance.getMetrics', {}, 400);
        if (method === 'Page.crash') old.send('Page.crash').catch(() => {});
        else old.send('Page.navigate', { url: 'chrome://crash' }).catch(() => {});
        await delay(2000);
        rec.oldAfter = await sendT(old, 'Performance.getMetrics', {}, 400);
        const fresh = await rawSession(b, targetId).catch((e) => ({ err: String(e.message) }));
        rec.fresh = fresh.err ? { r: 'attach-error ' + fresh.err } : await sendT(fresh, 'Performance.getMetrics', {}, 400);
        rec.freshRuntime = fresh.err ? undefined : await sendT(fresh, 'Runtime.evaluate', { expression: '1' }, 400);
        const info = await b.send('Target.getTargetInfo', { targetId });
        rec.targetInfo = { url: info.targetInfo.url, attached: info.targetInfo.attached };
        await delay(3000);
        rec.crashEventsAfter5s = rec.crashEvents;
        const fresh2 = await rawSession(b, targetId).catch(() => undefined);
        rec.fresh2 = fresh2 ? await sendT(fresh2, 'Performance.getMetrics', {}, 400) : 'n/a';
        rec.old2 = await sendT(old, 'Performance.getMetrics', {}, 400);
      } catch (e) { rec.error = String(e?.message); }
      finally { await b.disconnect(); }
      await fs.appendFile(OUT, JSON.stringify(rec) + '\n');
      console.log(JSON.stringify(rec));
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
