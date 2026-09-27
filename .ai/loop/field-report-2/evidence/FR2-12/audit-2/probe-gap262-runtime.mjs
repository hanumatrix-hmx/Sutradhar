// FR2-12 audit-2 (auditor-written): GAP-262 probes against the CURRENT build, runtime-direct.
// Hard limits: per-trial 60s race, global watchdog 20min; Chrome killed by its own PID only.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const ONLY = process.argv[2] ?? 'all';
const OUT = path.join(here, `probe-gap262-runtime-${ONLY}.json`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label} ${ms}ms`)), ms))]);

const H = (title, body, script = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, headers = { 'Content-Type': 'text/html' }) => { res.writeHead(code, headers); res.end(body); };
  const p = u.pathname;
  if (p === '/favicon.ico') return send(200, '', { 'Content-Type': 'image/x-icon' });
  if (p === '/noisy-interval') return send(200, H('noisy', 'noisy', `var i=0;setInterval(function(){i++;console.error('noisy-'+i);fetch('/missing-noisy-'+i).catch(function(){})},25);`));
  // tight-loop noise: emits a console.error roughly every task turn (MessageChannel ping-pong)
  if (p === '/noisy-tight') return send(200, H('tight', 'tight', `var i=0;var mc=new MessageChannel();mc.port1.onmessage=function(){i++;console.error('tight-'+i);mc.port2.postMessage(0)};mc.port2.postMessage(0);`));
  // noise emitted exactly at unload time (the commit boundary itself)
  if (p === '/noisy-unload') return send(200, H('unload', 'unload', `window.addEventListener('pagehide',function(){for(var k=0;k<20;k++)console.error('pagehide-'+k);fetch('/missing-pagehide',{keepalive:true}).catch(function(){})});`));
  if (p === '/clean-delayed') { await delay(Number(u.searchParams.get('delayMs') ?? 150)); return send(200, H('clean', '<h1>clean</h1>')); }
  if (p === '/clean-own') { await delay(Number(u.searchParams.get('delayMs') ?? 150)); return send(200, H('cleanown', '<h1>own</h1>', `console.error('own-error-of-page')`)); }
  if (p === '/main-404') return send(404, H('nf', '<h1>main doc 404</h1>'));
  if (p === '/main-500') { await delay(Number(u.searchParams.get('delayMs') ?? 0)); return send(500, H('err', '<h1>main doc 500</h1>')); }
  // HTTP redirect chain r1 -> r2 -> final
  if (p === '/r1') return send(302, '', { Location: '/r2' });
  if (p === '/r2') return send(302, '', { Location: '/final' });
  if (p === '/final') return send(200, H('final', '<h1>final</h1><img src="/missing-final.png" alt="x">', `console.error('final-own')`));
  if (p === '/r-to-404') return send(302, '', { Location: '/main-404' });
  // JS redirect chain ja -> jb -> jc
  if (p === '/ja') return send(200, H('ja', 'ja', `console.error('ja-own');fetch('/missing-ja').catch(function(){});setTimeout(function(){location.replace('/jb')},50)`));
  if (p === '/jb') return send(200, H('jb', 'jb', `console.error('jb-own');setTimeout(function(){location.replace('/jc')},50)`));
  if (p === '/jc') return send(200, H('jc', 'jc', `console.error('jc-own')`));
  // SPA-style: page's own errors, then a same-document nav (replaceState/pushState/hash) after `at` ms
  if (p === '/spa') {
    const kind = u.searchParams.get('kind') ?? 'replace';
    const at = Number(u.searchParams.get('at') ?? 200);
    const nav = kind === 'replace' ? `history.replaceState({}, '', location.pathname + location.search + '&r=1')`
      : kind === 'push' ? `history.pushState({}, '', '/spa/route2' + location.search)`
      : `location.hash = 'section'`;
    const run = at < 0 ? `${nav};` : `setTimeout(function(){${nav}}, ${at});`;
    return send(200, H('spa', '<h1>spa</h1><img src="/missing-spa-asset.png" alt="x">', `console.error('spa-own-error');fetch('/missing-spa-api').catch(function(){});${run}`));
  }
  if (p.startsWith('/spa/')) return send(200, H('spa2', 'spa2'));
  send(404, 'nf', { 'Content-Type': 'text/plain' });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const out = { origin, startedAt: new Date().toISOString(), cases: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
let chromePid = null;
function killChrome() {
  if (!chromePid) return;
  try { execFileSync('taskkill', ['/PID', String(chromePid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}
const watchdog = setTimeout(async () => { out.watchdog = 'fired'; await save().catch(() => {}); killChrome(); server.close(); process.exit(2); }, 20 * 60 * 1000);

const runtime = new SutradharRuntime({});
const { sessionId: sid } = await withTimeout(runtime.launch({ launch: { headless: true } }), 90000, 'launch');
const tab = runtime['resolveTab'](sid).tab;
const page = runtime['requirePage'](tab);
try { chromePid = page.browser().process()?.pid ?? null; } catch {}
out.chromePid = chromePid;
// independent instrumentation: every main-frame framenavigated with Node timestamp + url
const navEvents = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navEvents.push({ at: new Date().toISOString(), url: f.url() }); });

const summarize = (a) => ({
  url: a.url, requestedUrl: a.requestedUrl,
  consoleErrors: a.consoleErrors.map((e) => e.text), pageErrors: a.pageErrors.map((e) => e.message),
  brokenRequests: a.brokenRequests.map((b) => `${b.status} ${b.url.replace(origin, '')}`),
  observation: a.observation,
});
async function trial(name, fn) {
  out.cases[name] ??= [];
  const n0 = navEvents.length;
  try {
    const r = await withTimeout(fn(), 60000, name);
    out.cases[name].push({ ...r, navEvents: navEvents.slice(n0) });
  } catch (e) {
    out.cases[name].push({ error: String(e?.message ?? e) });
  }
  await save();
}
const want = (k) => ONLY === 'all' || ONLY === k;

try {
  if (want('core')) {
    // 2a: core repro, 15x at 150ms + a few other latencies
    for (let t = 0; t < 21; t++) {
      const ms = t < 15 ? 150 : [0, 50, 400, 800, 1500, 25][t - 15];
      await trial('core', async () => {
        await runtime.navigate(sid, `${origin}/noisy-interval?t=${t}`);
        await delay(80);
        const a = await runtime.audit(sid, { url: `${origin}/clean-delayed?delayMs=${ms}&t=${t}` });
        const s = summarize(a);
        const leaks = s.consoleErrors.filter((x) => x.startsWith('noisy')).length + s.brokenRequests.filter((x) => x.includes('noisy')).length;
        return { delayMs: ms, leaks, s };
      });
    }
    // own-error retention (no false negatives) after noisy predecessor
    for (let t = 0; t < 5; t++) {
      await trial('coreOwnKept', async () => {
        await runtime.navigate(sid, `${origin}/noisy-interval?o=${t}`);
        await delay(80);
        const a = await runtime.audit(sid, { url: `${origin}/clean-own?delayMs=150&o=${t}` });
        const s = summarize(a);
        return { ownKept: s.consoleErrors.includes('own-error-of-page'), leaks: s.consoleErrors.filter((x) => x.startsWith('noisy')).length + s.brokenRequests.filter((x) => x.includes('noisy')).length, s };
      });
    }
  }
  if (want('boundary')) {
    // 2c: boundary race -- tight-loop noise and pagehide-time noise
    for (let t = 0; t < 10; t++) {
      for (const ms of [0, 150]) {
        await trial('tightNoise', async () => {
          await runtime.navigate(sid, `${origin}/noisy-tight?t=${t}`);
          await delay(80);
          const a = await runtime.audit(sid, { url: `${origin}/clean-delayed?delayMs=${ms}&tt=${t}`, settleMs: 800 });
          const s = summarize(a);
          return { delayMs: ms, leaks: s.consoleErrors.filter((x) => x.startsWith('tight')).length, leaked: s.consoleErrors.filter((x) => x.startsWith('tight')).slice(0, 5), since: navEvents.at(-1)?.at };
        });
        await trial('pagehideNoise', async () => {
          await runtime.navigate(sid, `${origin}/noisy-unload?t=${t}`);
          await delay(80);
          const a = await runtime.audit(sid, { url: `${origin}/clean-delayed?delayMs=${ms}&tu=${t}`, settleMs: 800 });
          const s = summarize(a);
          return { delayMs: ms, leaks: s.consoleErrors.filter((x) => x.startsWith('pagehide')).length + s.brokenRequests.filter((x) => x.includes('pagehide')).length, s };
        });
      }
    }
  }
  if (want('regress')) {
    // regression: audited main document itself returns 4xx/5xx (audit-1 PASS edge case)
    for (let t = 0; t < 5; t++) {
      await trial('mainDoc404', async () => summarize(await runtime.audit(sid, { url: `${origin}/main-404?t=${t}`, settleMs: 800 })));
      await trial('mainDoc500slow', async () => summarize(await runtime.audit(sid, { url: `${origin}/main-500?delayMs=150&t=${t}`, settleMs: 800 })));
      await trial('redirectTo404', async () => summarize(await runtime.audit(sid, { url: `${origin}/r-to-404?t=${t}`, settleMs: 800 })));
    }
  }
  if (want('redirect')) {
    for (let t = 0; t < 3; t++) {
      await trial('httpRedirectChain', async () => summarize(await runtime.audit(sid, { url: `${origin}/r1?t=${t}`, settleMs: 800 })));
      await trial('jsRedirectChain', async () => summarize(await runtime.audit(sid, { url: `${origin}/ja?t=${t}`, settleMs: 1500 })));
    }
  }
  if (want('samedoc')) {
    // 2b(i): the AUDITED page itself does a same-document nav during load/settle (SPA router pattern)
    for (const kind of ['replace', 'push', 'hash']) {
      for (const at of [-1, 0, 200, 1000]) {
        for (let t = 0; t < 3; t++) {
          await trial(`spaSelf_${kind}_at${at}`, async () => {
            const a = await runtime.audit(sid, { url: `${origin}/spa?kind=${kind}&at=${at}&t=${t}` });
            const s = summarize(a);
            return { ownConsoleKept: s.consoleErrors.includes('spa-own-error'), ownBrokenKept: s.brokenRequests.filter((b) => b.includes('missing-spa')).length, s };
          });
        }
      }
    }
    // 2b(ii): noisy page, same-document nav (hash / pushState) on the SAME page, then audit (url = hash on same doc)
    for (let t = 0; t < 5; t++) {
      await trial('sameTabHashAudit', async () => {
        const base = `${origin}/noisy-interval?h=${t}`;
        await runtime.navigate(sid, base);
        await delay(500);
        const before = tab.getConsoleLogs().filter((l) => l.text.startsWith('noisy')).length;
        const a = await runtime.audit(sid, { url: `${base}#frag`, settleMs: 500 });
        const s = summarize(a);
        return { noisyEntriesBeforeAudit: before, reportedNoisy: s.consoleErrors.filter((x) => x.startsWith('noisy')).length, coversWholeDocument: s.observation.coversWholeDocument, documentStartedAt: s.observation.documentStartedAt, s: { ...s, consoleErrors: s.consoleErrors.length, brokenRequests: s.brokenRequests.length } };
      });
      // pushState done via page JS, then an URL-less (current-page) audit
      await trial('sameTabPushStateThenCurrentPageAudit', async () => {
        await runtime.navigate(sid, `${origin}/noisy-interval?ps=${t}`);
        await delay(300);
        await page.evaluate(() => history.pushState({}, '', '/pushed'));
        const a = await runtime.audit(sid, {});
        const s = summarize(a);
        return { reportedNoisy: s.consoleErrors.filter((x) => x.startsWith('noisy')).length, observation: s.observation };
      });
    }
  }
  if (ONLY === 'mut') {
    for (let t = 0; t < 5; t++) await trial('core', async () => {
      await runtime.navigate(sid, `${origin}/noisy-interval?mt=${t}`); await delay(80);
      const s = summarize(await runtime.audit(sid, { url: `${origin}/clean-delayed?delayMs=150&mt=${t}` }));
      return { leaks: s.consoleErrors.filter((x) => x.startsWith('noisy')).length + s.brokenRequests.filter((x) => x.includes('noisy')).length };
    });
    for (let t = 0; t < 2; t++) await trial('mainDoc404', async () => ({ has404: summarize(await runtime.audit(sid, { url: `${origin}/main-404?mt=${t}`, settleMs: 800 })).brokenRequests.length > 0 }));
    for (let t = 0; t < 2; t++) await trial('spaReplace200', async () => ({ ownKept: summarize(await runtime.audit(sid, { url: `${origin}/spa?kind=replace&at=200&mt=${t}` })).consoleErrors.includes('spa-own-error') }));
    await trial('jsRedirect', async () => ({ c: summarize(await runtime.audit(sid, { url: `${origin}/ja?mt=1`, settleMs: 1500 })).consoleErrors }));
  }
  if (want('xsite')) {
    // cross-site (process-swap) variant of the core repro: noisy on 127.0.0.1, clean on localhost
    const port = server.address().port;
    for (let t = 0; t < 10; t++) {
      await trial('crossSiteCore', async () => {
        await runtime.navigate(sid, `${origin}/noisy-interval?x=${t}`);
        await delay(80);
        const a = await runtime.audit(sid, { url: `http://localhost:${port}/clean-own?delayMs=150&x=${t}` });
        const s = summarize(a);
        return { leaks: s.consoleErrors.filter((x) => x.startsWith('noisy')).length + s.brokenRequests.filter((x) => x.includes('noisy')).length, ownKept: s.consoleErrors.includes('own-error-of-page') };
      });
    }
  }
  if (want('realworld')) {
    // How common is a same-document nav DURING the audited page's own load/settle on real sites?
    // Counts main-frame framenavigated events per audit (1 = cross-doc commit only; >1 = also
    // same-doc and/or JS redirects) and how many raw console errors / >=400 responses logged after
    // the FIRST commit were dropped from the report because `since` moved to a LATER event.
    const sites = ['https://nextjs.org/', 'https://react.dev/', 'https://vercel.com/', 'https://github.com/', 'https://developer.mozilla.org/en-US/', 'https://www.npmjs.com/', 'https://vuejs.org/', 'https://angular.dev/', 'https://svelte.dev/', 'https://www.wikipedia.org/'];
    for (const site of sites) {
      await trial('realworld', async () => {
        const n0 = navEvents.length;
        const c0 = tab.getConsoleLogs().length, net0 = tab.getNetworkLog().length;
        const a = await runtime.audit(sid, { url: site, settleMs: 3000 });
        const evs = navEvents.slice(n0);
        const firstCommit = evs[0]?.at;
        const rawErr = tab.getConsoleLogs().filter((l) => l.logType === 'error' && firstCommit && l.timestamp >= firstCommit);
        const rawBroken = tab.getNetworkLog().filter((n) => n.phase === 'response' && n.status >= 400 && firstCommit && n.timestamp >= firstCommit);
        return { site, finalUrl: a.url, mainFrameNavEvents: evs.map((e) => e.url), reported: { console: a.consoleErrors.length, broken: a.brokenRequests.length }, sinceFirstCommit: { console: rawErr.length, broken: rawBroken.length }, droppedByLaterSameDocEvent: { console: rawErr.length - a.consoleErrors.length, broken: rawBroken.length - a.brokenRequests.length }, coversWholeDocument: a.observation.coversWholeDocument, bufWrapRisk: { consoleAdded: tab.getConsoleLogs().length - c0, netAdded: tab.getNetworkLog().length - net0 } };
      });
    }
  }
} finally {
  out.finishedAt = new Date().toISOString();
  await save();
  clearTimeout(watchdog);
  try { await withTimeout(runtime.shutdownAll(), 30000, 'shutdown'); } catch (e) { out.shutdownError = String(e); killChrome(); }
  await save();
  server.close();
}
console.log('done', ONLY);
process.exit(0);
