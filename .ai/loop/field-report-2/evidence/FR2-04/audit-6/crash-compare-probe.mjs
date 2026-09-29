// FR2-04 audit-6: a CRASHED renderer (no dialog anywhere) -- what does each CLI build do?
//   cur    = this worktree's dist (HEAD 36eefa4, FR2-04 escalation-2)
//   master = the main checkout's dist (pre-FR2-04; contains no __dialog-warden; built Aug 20 from master 7073142)
// Shapes: 'bg' = a background tab (CLI newtab) crashes; 'active' = the session's active tab crashes.
// After the crash, run the recovery-ish verbs an agent would try: snap, tabs, dialog, dialog accept,
// closetab <crashed>, nav <url>, snap. Records exit code + wall time + first lines for each.
// The crash is caused by the observer with Page.crash on a throwaway CDP session (never Page.enable).
// usage: node crash-compare-probe.mjs [trials]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, delay, cleanupRoot, here, readState, puppeteer, idOf, CLI_DEFAULT } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 2);
const MASTER_CLI = 'E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli/dist/cli.js';
const server = http.createServer((q, s) => { const n = new URL(q.url, 'http://x').searchParams.get('n'); s.writeHead(200, { 'content-type': 'text/html' }); s.end(`<!doctype html><title>page ${n}</title><body>page ${n}</body>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const root = await makeRoot('crash');
const clis = { cur: makeCli(root, CLI_DEFAULT), master: makeCli(root, MASTER_CLI) };
const dirs = [];
const results = [];
const outFile = path.join(here, 'crash-compare.json');
const short = (r) => ({ args: r.args, code: r.code, ms: r.ms, cap: r.killedAtCap, out: r.stdout.trim().split('\n').slice(0, 3).join(' | ').slice(0, 300), err: r.stderr.trim().split('\n').slice(0, 2).join(' | ').slice(0, 300) });
try {
  for (const which of ['cur', 'master']) {
    const cli = clis[which];
    for (const shape of ['bg', 'active']) {
      for (let t = 0; t < TRIALS; t++) {
        const cd = path.join(root.R, `${which}-${shape}-${t}`);
        dirs.push(cd);
        const rec = { which, shape, trial: t, steps: [] };
        const run = async (args, capMs = 60000) => { const r = await cli(args, cd, { capMs }); rec.steps.push(short(r)); return r; };
        await run(['nav', `${BASE}/?n=main${t}`]);
        await run(['newtab', `${BASE}/?n=bg${t}`]);
        if (shape === 'active') { const tb = await run(['tabs']); const id = /(tab_\S+)\s+page main/.exec(tb.stdout)?.[1]; if (id) await run(['focustab', id]); }
        await delay(1200); // let the warden (cur) confirm both targets
        const st = await readState(cd);
        const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
        const victimUrl = shape === 'bg' ? `n=bg${t}` : `n=main${t}`;
        const tgt = b.targets().find((x) => x.type() === 'page' && x.url().includes(victimUrl));
        const s = await tgt.createCDPSession();
        s.send('Page.crash').catch(() => {});
        await delay(1500);
        await b.disconnect();
        const tabs1 = await run(['snap']);
        await run(['tabs']);
        await run(['dialog']);
        await run(['dialog', 'accept']);
        const tabsOut = rec.steps.find((x) => x.args === 'tabs' && rec.steps.indexOf(x) > 2)?.out ?? '';
        const crashedId = new RegExp(`(tab_\\S+)\\s+\\S*\\s*page ${shape === 'bg' ? 'bg' : 'main'}`).exec(tabsOut)?.[1];
        if (crashedId) await run(['closetab', crashedId]);
        await run(['nav', `${BASE}/?n=after${t}`]);
        const fin = await run(['snap']);
        rec.firstSnapCode = tabs1.code;
        rec.finalSnapCode = fin.code;
        rec.anyCap = rec.steps.some((x) => x.cap);
        results.push(rec);
        console.log(JSON.stringify({ which, shape, t, codes: rec.steps.slice(3).map((x) => `${x.args.split(' ')[0]}${x.args.startsWith('dialog accept') ? '-acc' : ''}=${x.code}(${Math.round(x.ms / 100) / 10}s)`).join(' '), final: fin.code }));
        await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
        await run(['close'], 30000);
      }
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, clis.cur, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
