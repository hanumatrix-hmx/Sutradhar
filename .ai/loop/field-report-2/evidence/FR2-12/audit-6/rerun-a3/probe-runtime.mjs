// FR2-12 audit-3 (independent auditor): runtime-direct probes of fix-2's CDP Page.frameNavigated
// boundary and the unscoped main-document-response lookup.
// Usage: node probe-runtime.mjs <group> [trials]
//   groups: core | newmech | redirects | mismatch | leak | realsites | regress | all
// Hard limits: per-trial 70s race, global watchdog 25 min; Chrome killed by its OWN PID only.
// Output: ONLY audit-3/probe-runtime-<group>.json (path asserted below).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-6/rerun-a3')) throw new Error(`refusing to run outside audit-3: ${here}`);
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const GROUP = process.argv[2] ?? 'all';
const TRIALS = Number(process.argv[3] ?? 10);
const OUT = path.join(here, `probe-runtime-${GROUP}.json`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label} ${ms}ms`)), ms))]);

const H = (title, body, script = '', head = '') =>
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
const hung = new Set();
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const n = u.searchParams.get('n') ?? '0';
  const send = (code, body, headers = { 'Content-Type': 'text/html' }) => { res.writeHead(code, headers); res.end(body); };
  const p = u.pathname;
  if (p === '/favicon.ico') return send(200, '', { 'Content-Type': 'image/x-icon' });
  // --- core GAP-266: errors + 404 fetch BEFORE and AFTER a same-document nav during own load
  if (p === '/spa') {
    const kind = u.searchParams.get('kind') ?? 'replace';
    const at = Number(u.searchParams.get('at') ?? 200);
    const nav = kind === 'replace' ? `history.replaceState({}, '', location.pathname + location.search + '&r=1')`
      : kind === 'push' ? `history.pushState({}, '', '/spa/route2' + location.search)`
      : `location.hash = 'section'`;
    return send(200, H('spa', '<h1>spa</h1><img src="/missing-spa-asset.png" alt="x">',
      `console.error('before-${n}');fetch('/missing-before-${n}').catch(function(){});` +
      (at < 0 ? `${nav};setTimeout(function(){console.error('after-${n}');fetch('/missing-after-${n}').catch(function(){})},60);` : `setTimeout(function(){${nav};setTimeout(function(){console.error('after-${n}');fetch('/missing-after-${n}').catch(function(){})},60)}, ${at});`)));
  }
  // synthetic 8-real-site pattern: several same-doc navs at 7..1047ms with errors & 404s interleaved
  if (p === '/site-pattern') {
    const steps = [7, 60, 300, 1047];
    let s = `console.error('sp-0-${n}');fetch('/missing-sp-0-${n}').catch(function(){});`;
    steps.forEach((ms, i) => {
      const nav = i % 3 === 0 ? `history.replaceState({}, '', location.pathname + location.search + '&s${i}=1')`
        : i % 3 === 1 ? `history.pushState({}, '', location.pathname + location.search + '&p${i}=1')` : `location.hash = 'h${i}'`;
      s += `setTimeout(function(){${nav};console.error('sp-${i + 1}-${n}');fetch('/missing-sp-${i + 1}-${n}').catch(function(){})}, ${ms});`;
    });
    return send(200, H('site-pattern', '<h1>sp</h1>', s));
  }
  // rapid same-doc bursts: 25 replaceStates in one task + 10 pushStates spaced 5ms
  if (p === '/burst') {
    return send(200, H('burst', '<h1>b</h1>',
      `console.error('burst-before-${n}');for(var i=0;i<25;i++)history.replaceState({},'',location.pathname+'?n=${n}&i='+i);` +
      `var k=0;var t=setInterval(function(){k++;history.pushState({},'',location.pathname+'?n=${n}&k='+k);if(k>=10){clearInterval(t);console.error('burst-after-${n}');fetch('/missing-burst-${n}').catch(function(){})}},5);`));
  }
  // --- 2a: same-doc / cross-doc interleaved: x1 (errors, replaceState, real link click -> x2), x2 (errors, replaceState, error)
  if (p === '/x1') return send(200, H('x1', `<a id="go" href="/x2?n=${n}">go</a>`,
    `console.error('x1-before-${n}');history.replaceState({},'',location.pathname+location.search+'&r=1');console.error('x1-after-${n}');fetch('/missing-x1-${n}').catch(function(){});` +
    `setTimeout(function(){document.getElementById('go').click()}, ${Number(u.searchParams.get('clickAt') ?? 200)});`));
  if (p === '/x2') return send(200, H('x2', '<h1>x2</h1>',
    `console.error('x2-before-${n}');fetch('/missing-x2a-${n}').catch(function(){});setTimeout(function(){history.replaceState({},'',location.pathname+location.search+'&r=2');` +
    `console.error('x2-after-${n}');fetch('/missing-x2b-${n}').catch(function(){})},100);`));
  // --- 2b: iframes navigating while main loads
  if (p === '/ifr-main') {
    const mode = u.searchParams.get('mode') ?? 'cross';
    const port = server.address().port;
    const src = mode === 'oopif' ? `http://localhost:${port}/ifr-child?n=${n}&mode=cross` : `/ifr-child?n=${n}&mode=${mode}`;
    return send(200, H('ifr-main', `<iframe src="${src}"></iframe><iframe src="/ifr-child?n=${n}&mode=${mode}&late=1"></iframe>`,
      `console.error('main-own-${n}');fetch('/missing-main-${n}').catch(function(){});setTimeout(function(){console.error('main-late-${n}')},900);`));
  }
  if (p === '/ifr-child') {
    const mode = u.searchParams.get('mode');
    const late = u.searchParams.get('late') ? 700 : 50;
    const hop = Number(u.searchParams.get('hop') ?? 0);
    if (hop >= 3) return send(200, H('child-end', 'end'));
    const next = `/ifr-child?n=${n}&mode=${mode}&hop=${hop + 1}${u.searchParams.get('late') ? '&late=1' : ''}`;
    const navJs = mode === 'same' ? `history.pushState({},'','?hop=x${hop}');location.hash='c${hop}'` : `location.href='${next}'`;
    return send(200, H('child', 'child', `setTimeout(function(){${navJs}}, ${late});`));
  }
  // --- 2c: redirect shapes
  if (p === '/m1') return send(200, H('m1', 'm1', `console.error('m1-own-${n}');fetch('/missing-m1-${n}').catch(function(){})`, `<meta http-equiv="refresh" content="${u.searchParams.get('d') ?? '0'};url=/m2?n=${n}">`));
  if (p === '/m2') return send(200, H('m2', 'm2', `console.error('m2-own-${n}');fetch('/missing-m2-${n}').catch(function(){})`));
  if (p === '/ja') return send(200, H('ja', 'ja', `console.error('ja-own-${n}');fetch('/missing-ja-${n}').catch(function(){});setTimeout(function(){location.replace('/jb?n=${n}')},50)`));
  if (p === '/jb') return send(200, H('jb', 'jb', `console.error('jb-own-${n}');setTimeout(function(){location.replace('/jc?n=${n}')},50)`));
  if (p === '/jc') return send(200, H('jc', 'jc', `console.error('jc-own-${n}');fetch('/missing-jc-${n}').catch(function(){})`));
  // mixed: HTTP 302 -> page that does replaceState -> JS redirect -> page that pushStates + hash
  if (p === '/mix0') return send(302, '', { Location: `/mix1?n=${n}` });
  if (p === '/mix1') return send(200, H('mix1', 'mix1', `console.error('mix1-own-${n}');history.replaceState({},'',location.pathname+location.search+'&r=1');setTimeout(function(){location.replace('/mix2?n=${n}')},80)`));
  if (p === '/mix2') return send(200, H('mix2', 'mix2', `console.error('mix2-before-${n}');fetch('/missing-mix2a-${n}').catch(function(){});setTimeout(function(){history.pushState({},'','/mix2b?n=${n}');location.hash='z';console.error('mix2-after-${n}');fetch('/missing-mix2b-${n}').catch(function(){})},60)`));
  // --- GAP-267 & 3
  if (p === '/own-404') return send(404, H('nf', '<h1>own 404</h1>', `console.error('own404-${n}')`));
  if (p === '/own-500') return send(500, H('se', '<h1>own 500</h1>'));
  if (p === '/own-404-empty') { res.writeHead(404, { 'Content-Length': '0' }); return res.end(); }
  if (p === '/own-404-replace') return send(404, H('nf', '<h1>404 rewrites url</h1>', `history.replaceState({},'','/pretty-not-found')`));
  if (p === '/own-404-hash') return send(404, H('nf', '<h1>404 sets hash</h1>', `location.hash='top'`));
  if (p === '/own-404-heavy') {
    const k = Number(u.searchParams.get('k') ?? 150);
    let imgs = ''; for (let j = 0; j < k; j++) imgs += `<img src="/img-ok-${j}.png?n=${n}" alt="i" width="1" height="1">`;
    return send(404, H('heavy', `<h1>heavy 404</h1>${imgs}`));
  }
  if (p.startsWith('/img-ok-')) return send(200, '', { 'Content-Type': 'image/png' });
  if (p === '/r-to-404') return send(302, '', { Location: `/own-404?n=${n}` });
  if (p === '/hop1') return send(301, '', { Location: `/hop2?n=${n}` });
  if (p === '/hop2') return send(307, '', { Location: `/hop3?n=${n}` });
  if (p === '/hop3') return send(302, '', { Location: `/own-404?n=${n}&final=1` });
  if (p === '/hop-to-500-slow') { return send(302, '', { Location: `/own-500-slow?n=${n}` }); }
  if (p === '/own-500-slow') { await delay(800); return send(500, H('se', 'slow 500')); }
  if (p === '/hang') { hung.add(res); return; } // never responds
  if (p === '/hang-404-body') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.write('<html><body><h1>partial'); hung.add(res); return; }
  // --- regress: GAP-262 contamination and a clean page
  if (p === '/noisy-interval') return send(200, H('noisy', 'noisy', `var i=0;setInterval(function(){i++;console.error('noisy-'+i);fetch('/missing-noisy-'+i).catch(function(){})},25);`));
  if (p === '/clean-delayed') { await delay(Number(u.searchParams.get('delayMs') ?? 150)); return send(200, H('clean', '<h1>clean</h1>')); }
  if (p === '/shift') return send(200, H('shift', `<div id="slot" style="height:0"></div><h1 style="font-size:48px">shift</h1>`, `setTimeout(function(){document.getElementById('slot').style.height='200px'},300)`));
  send(404, 'nf', { 'Content-Type': 'text/plain' });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const out = { group: GROUP, trials: TRIALS, origin, startedAt: new Date().toISOString(), cases: {}, verdicts: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
let chromePid = null;
function killChrome() {
  if (!chromePid) return;
  try { execFileSync('taskkill', ['/PID', String(chromePid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
}
const watchdog = setTimeout(async () => { out.watchdog = 'fired'; await save().catch(() => {}); killChrome(); process.exit(2); }, 25 * 60 * 1000);

const runtime = new SutradharRuntime({});
const { sessionId: sid } = await withTimeout(runtime.launch({ launch: { headless: true } }), 90000, 'launch');
const tab = runtime['resolveTab'](sid).tab;
const page = runtime['requirePage'](tab);
try { chromePid = page.browser().process()?.pid ?? null; } catch {}
out.chromePid = chromePid;

// Independent ground truth: my own CDP session records every main-frame Page.frameNavigated and
// every Page.navigatedWithinDocument with Node timestamps.
const truth = await page.createCDPSession();
const ev = [];
truth.on('Page.frameNavigated', (e) => ev.push({ kind: e.frame.parentId ? 'sub-cross' : 'main-cross', at: new Date().toISOString(), url: e.frame.url + (e.frame.urlFragment ?? '') }));
truth.on('Page.navigatedWithinDocument', (e) => ev.push({ kind: 'same-doc', at: new Date().toISOString(), url: e.url, frameId: e.frameId }));
await truth.send('Page.enable');

// Instrument CDP session creation/detach by the runtime (2d leak check).
const cdpStats = { created: 0, detachOk: 0, detachErr: 0 };
const origCreate = page.createCDPSession.bind(page);
page.createCDPSession = async () => {
  const s = await origCreate();
  cdpStats.created++;
  const d = s.detach.bind(s);
  s.detach = async () => { try { await d(); cdpStats.detachOk++; } catch (e) { cdpStats.detachErr++; throw e; } };
  return s;
};

const rel = (u) => u.replace(origin, '');
const summarize = (a) => ({
  url: rel(a.url), consoleErrors: a.consoleErrors.map((e) => e.text), pageErrors: a.pageErrors.map((e) => e.message),
  brokenRequests: a.brokenRequests.map((b) => `${b.status} ${rel(b.url)}`), coversWholeDocument: a.observation.coversWholeDocument,
});
async function trial(name, fn) {
  out.cases[name] ??= [];
  const e0 = ev.length;
  const t0 = Date.now();
  try {
    const r = await withTimeout(fn(), 70000, name);
    out.cases[name].push({ ms: Date.now() - t0, ...r, events: ev.slice(e0).map((x) => `${x.kind} ${rel(x.url)}`) });
  } catch (e) {
    out.cases[name].push({ ms: Date.now() - t0, error: String(e?.message ?? e) });
  }
  await save();
}
const auditUrl = async (url) => summarize(await runtime.audit(sid, { url }));
const has = (arr, s) => arr.some((x) => x.includes(s));
function verdict(name, pred) {
  const rows = out.cases[name] ?? [];
  const ok = rows.filter((r) => !r.error && pred(r)).length;
  out.verdicts[name] = `${ok}/${rows.length}`;
}
const want = (g) => GROUP === 'all' || GROUP === g;

try {
  if (want('core')) {
    for (const kind of ['replace', 'push', 'hash']) for (const at of [-1, 0, 30, 200]) {
      const nm = `spa_${kind}_at${at}`;
      for (let i = 0; i < TRIALS; i++) {
        const n = `${kind}${at}-${i}`;
        const url = `${origin}/spa?kind=${kind}&at=${at}&n=${n}`;
        await trial(nm, () => auditUrl(url));
      }
      verdict(nm, (r) => has(r.consoleErrors, 'before-') && has(r.consoleErrors, 'after-') && has(r.brokenRequests, 'missing-before') && has(r.brokenRequests, 'missing-after') && has(r.brokenRequests, 'missing-spa-asset'));
    }
    for (let i = 0; i < TRIALS; i++) await trial('sitePattern', () => auditUrl(`${origin}/site-pattern?n=sp${i}`));
    verdict('sitePattern', (r) => [0, 1, 2, 3, 4].every((k) => has(r.consoleErrors, `sp-${k}-`) && has(r.brokenRequests, `missing-sp-${k}-`)));
    for (let i = 0; i < TRIALS; i++) await trial('burst', () => auditUrl(`${origin}/burst?n=b${i}`));
    verdict('burst', (r) => has(r.consoleErrors, 'burst-before') && has(r.consoleErrors, 'burst-after') && has(r.brokenRequests, 'missing-burst'));
    for (const [nm, route, st] of [['own404', 'own-404', 404], ['own500', 'own-500', 500], ['r302to404', 'r-to-404', 404]]) {
      for (let i = 0; i < TRIALS; i++) await trial(nm, () => auditUrl(`${origin}/${route}?n=${nm}${i}`));
      verdict(nm, (r) => r.brokenRequests.some((b) => b.startsWith(`${st} /own-`)) && !r.brokenRequests.some((b) => b.startsWith('302')));
    }
  }
  if (want('newmech')) {
    // 2a: interleaved same-doc/cross-doc
    for (const clickAt of [0, 200, 800]) {
      const nm = `x1x2_click${clickAt}`;
      for (let i = 0; i < TRIALS; i++) await trial(nm, () => auditUrl(`${origin}/x1?n=${clickAt}-${i}&clickAt=${clickAt}`));
      verdict(nm, (r) => r.url.startsWith('/x2') && has(r.consoleErrors, 'x2-before') && has(r.consoleErrors, 'x2-after') && has(r.brokenRequests, 'missing-x2a') && has(r.brokenRequests, 'missing-x2b') && !has(r.consoleErrors, 'x1-') && !has(r.brokenRequests, 'missing-x1'));
    }
    // 2b: iframes navigating (same-process cross-doc, same-doc, cross-site OOPIF)
    for (const mode of ['cross', 'same', 'oopif']) {
      const nm = `iframe_${mode}`;
      for (let i = 0; i < TRIALS; i++) await trial(nm, () => auditUrl(`${origin}/ifr-main?n=${mode}${i}&mode=${mode}`));
      verdict(nm, (r) => r.url.startsWith('/ifr-main') && has(r.consoleErrors, 'main-own') && has(r.consoleErrors, 'main-late') && has(r.brokenRequests, 'missing-main'));
    }
  }
  if (want('redirects')) {
    for (const d of ['0', '1']) {
      const nm = `metaRefresh_d${d}`;
      for (let i = 0; i < TRIALS; i++) await trial(nm, () => auditUrl(`${origin}/m1?n=${d}-${i}&d=${d}`));
      verdict(nm, (r) => r.url.startsWith('/m2') && has(r.consoleErrors, 'm2-own') && has(r.brokenRequests, 'missing-m2') && !has(r.consoleErrors, 'm1-own') && !has(r.brokenRequests, 'missing-m1'));
    }
    for (let i = 0; i < TRIALS; i++) await trial('jsChain', () => auditUrl(`${origin}/ja?n=${i}`));
    verdict('jsChain', (r) => r.url.startsWith('/jc') && has(r.consoleErrors, 'jc-own') && has(r.brokenRequests, 'missing-jc') && !has(r.consoleErrors, 'ja-own') && !has(r.consoleErrors, 'jb-own') && !has(r.brokenRequests, 'missing-ja'));
    for (let i = 0; i < TRIALS; i++) await trial('mixed302_replace_js_push', () => auditUrl(`${origin}/mix0?n=${i}`));
    verdict('mixed302_replace_js_push', (r) => r.url.startsWith('/mix2b') && has(r.consoleErrors, 'mix2-before') && has(r.consoleErrors, 'mix2-after') && has(r.brokenRequests, 'missing-mix2a') && has(r.brokenRequests, 'missing-mix2b') && !has(r.consoleErrors, 'mix1-own'));
    for (let i = 0; i < TRIALS; i++) await trial('hop3_to_404', () => auditUrl(`${origin}/hop1?n=${i}`));
    verdict('hop3_to_404', (r) => r.url.includes('/own-404') && r.brokenRequests.some((b) => b.startsWith('404 /own-404')) && !r.brokenRequests.some((b) => /^30\d/.test(b)) && r.brokenRequests.length === 1);
    for (let i = 0; i < TRIALS; i++) await trial('hop_to_slow500', () => auditUrl(`${origin}/hop-to-500-slow?n=${i}`));
    verdict('hop_to_slow500', (r) => r.brokenRequests.some((b) => b.startsWith('500 /own-500-slow')));
    // 3: hung main document / 404 whose body never completes -- must fail/return cleanly, not hang forever
    for (let i = 0; i < 2; i++) await trial('hang_noResponse', () => auditUrl(`${origin}/hang?n=${i}`));
    for (let i = 0; i < 2; i++) await trial('hang_404_partialBody', () => auditUrl(`${origin}/hang-404-body?n=${i}`));
    // after the hangs, the session must still audit normally
    for (let i = 0; i < 3; i++) await trial('afterHang_own404', () => auditUrl(`${origin}/own-404?n=ah${i}`));
    verdict('afterHang_own404', (r) => r.brokenRequests.some((b) => b.startsWith('404 /own-404')));
  }
  if (want('mismatch')) {
    // GAP-267 lookup keyed on n.url === page.url(): shapes where the final page.url() differs from the response url
    const shapes = [
      ['own404_fragmentInRequest', (i) => `${origin}/own-404?n=f${i}#top`, '404 /own-404'],
      ['own404_pageSetsHash', (i) => `${origin}/own-404-hash?n=h${i}`, '404 /own-404-hash'],
      ['own404_pageReplaceState', (i) => `${origin}/own-404-replace?n=r${i}`, '404 /own-404-replace'],
      ['own404_emptyBody', (i) => `${origin}/own-404-empty?n=e${i}`, '404 /own-404-empty'],
    ];
    for (const [nm, mk, want404] of shapes) {
      for (let i = 0; i < TRIALS; i++) await trial(nm, () => auditUrl(mk(i)));
      verdict(nm, (r) => r.brokenRequests.some((b) => b.startsWith(want404)));
    }
  }
  if (GROUP === 'real404') {
    const urls = ['https://nextjs.org/docs/audit3-nonexistent-page', 'https://react.dev/audit3-nonexistent', 'https://vuejs.org/audit3-nonexistent',
      'https://svelte.dev/audit3-nonexistent', 'https://angular.dev/audit3-nonexistent', 'https://github.com/audit3-nonexistent-user-zz9/nope',
      'https://www.npmjs.com/package/audit3-nonexistent-pkg-zz9', 'https://vercel.com/audit3-nonexistent', 'https://developer.mozilla.org/en-US/docs/audit3-nonexistent',
      'https://www.python.org/audit3-nonexistent/'];
    for (const u of urls) {
      for (let i = 0; i < TRIALS; i++) {
        await trial(`r404_${u}`, async () => {
          const net0 = tab.getNetworkLog().length;
          const e0 = ev.length;
          const a = await runtime.audit(sid, { url: u });
          const docResps = tab.getNetworkLog().slice(net0).filter((x) => x.phase === 'response' && x.resourceType === 'document').map((x) => `${x.status} ${x.url}`);
          return { finalUrl: a.url, docResponses: docResps.slice(0, 4), brokenRequests: a.brokenRequests.slice(0, 6).map((b) => `${b.status} ${b.url}`),
            navEvents: ev.slice(e0).filter((x) => !x.kind.startsWith('sub')).map((x) => `${x.kind} ${x.url}`).slice(0, 6) };
        });
      }
      verdict(`r404_${u}`, (r) => {
        const main = r.docResponses.find((d) => d.startsWith('4') || d.startsWith('5'));
        return !main || r.brokenRequests.includes(main);
      });
    }
  }
  if (GROUP === 'heavy') {
    for (const k of [20, 90, 150]) {
      const nm = `own404_with_${k}_subresources`;
      for (let i = 0; i < 3; i++) await trial(nm, async () => {
        const a = await runtime.audit(sid, { url: `${origin}/own-404-heavy?n=${k}-${i}&k=${k}` });
        const log = tab.getNetworkLog();
        return { ...summarize(a), brokenRequests: a.brokenRequests.filter((b) => b.url.includes('own-404-heavy')).map((b) => `${b.status} ${rel(b.url)}`),
          brokenTotal: a.brokenRequests.length, netLogLen: log.length, netLogHasDoc: log.some((x) => x.resourceType === 'document' && x.url.includes(`n=${k}-${i}`)) };
      });
      verdict(nm, (r) => r.brokenRequests.some((b) => b.startsWith('404 /own-404-heavy')));
    }
    // same for the real GitHub page: buffer length and whether the doc entry survived
    for (let i = 0; i < 2; i++) await trial('github404_buffer', async () => {
      const u = 'https://github.com/audit3-nonexistent-user-zz9/nope';
      const a = await runtime.audit(sid, { url: u });
      const log = tab.getNetworkLog();
      return { brokenTotal: a.brokenRequests.length, netLogLen: log.length, docEntrySurvived: log.some((x) => x.resourceType === 'document' && x.url === u && x.phase === 'response'),
        oldestEntry: log[0]?.timestamp, reportedOwn404: a.brokenRequests.some((b) => b.url === u) };
    });
  }
  if (want('leak')) {
    const times = [];
    const c0 = { ...cdpStats };
    for (let i = 0; i < Math.max(TRIALS, 25); i++) {
      const t0 = Date.now();
      await trial('repeat', () => auditUrl(`${origin}/spa?kind=replace&at=30&n=rep${i}`));
      times.push(Date.now() - t0);
    }
    const heap = await page.metrics().catch(() => null);
    out.cases.leakStats = { cdpBefore: c0, cdpAfter: { ...cdpStats }, times, first5avg: times.slice(0, 5).reduce((a, b) => a + b, 0) / 5, last5avg: times.slice(-5).reduce((a, b) => a + b, 0) / 5, pageMetrics: heap };
    verdict('repeat', (r) => has(r.consoleErrors, 'before-') && has(r.consoleErrors, 'after-'));
  }
  if (want('realsites')) {
    const sites = ['https://nextjs.org/', 'https://react.dev/', 'https://vercel.com/', 'https://github.com/', 'https://www.npmjs.com/', 'https://vuejs.org/', 'https://angular.dev/', 'https://svelte.dev/'];
    for (const site of sites) {
      for (let i = 0; i < TRIALS; i++) {
        await trial(`real_${site}`, async () => {
          const e0 = ev.length;
          const logsBefore = tab.getConsoleLogs().length;
          const netBefore = tab.getNetworkLog().length;
          const a = await runtime.audit(sid, { url: site });
          const myEv = ev.slice(e0);
          const lastCross = [...myEv].reverse().find((x) => x.kind === 'main-cross');
          const sameDocs = myEv.filter((x) => x.kind === 'same-doc' && lastCross && x.at >= lastCross.at);
          // ground truth: every console error / >=400 response of this document at/after MY last main-cross commit
          const expErr = tab.getConsoleLogs().slice(Math.max(0, logsBefore - 0)).filter((l) => l.logType === 'error' && lastCross && l.timestamp >= lastCross.at).map((l) => l.text);
          const expBroken = tab.getNetworkLog().filter((x) => x.phase === 'response' && x.status >= 400 && lastCross && x.timestamp >= lastCross.at).map((x) => `${x.status} ${x.url}`);
          const gotErr = a.consoleErrors.map((e) => e.text);
          const gotBroken = a.brokenRequests.map((b) => `${b.status} ${b.url}`);
          const missingErr = expErr.filter((t) => !gotErr.includes(t));
          const missingBroken = expBroken.filter((t) => !gotBroken.includes(t));
          // errors logged between last cross commit and a later same-doc nav (the exact GAP-266 window)
          const firstSame = sameDocs[0]?.at;
          const inWindow = firstSame ? tab.getConsoleLogs().filter((l) => l.logType === 'error' && l.timestamp >= lastCross.at && l.timestamp < sameDocs[sameDocs.length - 1].at).length : 0;
          return { finalUrl: a.url, crossCommits: myEv.filter((x) => x.kind === 'main-cross').length, sameDocNavsAfterCommit: sameDocs.length,
            errorsInGap266Window: inWindow, gotErrCount: gotErr.length, expErrCount: expErr.length, gotBrokenCount: gotBroken.length, expBrokenCount: expBroken.length,
            missingErr: missingErr.slice(0, 5), missingBroken: missingBroken.slice(0, 5), coversWholeDocument: a.observation.coversWholeDocument };
        });
      }
      verdict(`real_${site}`, (r) => r.missingErr.length === 0 && r.missingBroken.length === 0);
    }
  }
  if (want('regress')) {
    for (const d of [0, 150, 600]) {
      const nm = `gap262_noisyThenClean_${d}`;
      for (let i = 0; i < TRIALS; i++) {
        await trial(nm, async () => {
          await runtime.navigate(sid, `${origin}/noisy-interval?n=${d}-${i}`);
          await delay(400);
          return auditUrl(`${origin}/clean-delayed?delayMs=${d}&n=${i}`);
        });
      }
      verdict(nm, (r) => r.consoleErrors.length === 0 && r.brokenRequests.length === 0 && r.pageErrors.length === 0);
    }
    // B2: CLS equal across repeated URL audits, no leaked global
    const cls = [];
    for (let i = 0; i < 3; i++) { const a = await runtime.audit(sid, { url: `${origin}/shift?n=${i}` }); cls.push(a.webVitals.cls); }
    await runtime.navigate(sid, `${origin}/clean-delayed?delayMs=0&n=g`);
    const leaked = await page.evaluate('typeof window.__sutradharVitals');
    out.cases.b2 = { cls, leaked };
    out.verdicts.b2 = Math.max(...cls) - Math.min(...cls) < 0.005 && cls[0] > 0.01 && leaked === 'undefined' ? 'PASS' : 'FAIL';
    // current-page mode after runtime.navigate to own 404: lookup + scoping
    await runtime.navigate(sid, `${origin}/own-404?n=cp`);
    await delay(500);
    out.cases.currentPageOwn404 = summarize(await runtime.audit(sid, {}));
    // about:blank current page
    await runtime.navigate(sid, 'about:blank');
    out.cases.aboutBlank = summarize(await runtime.audit(sid, {}));
  }
} finally {
  out.cdpStats = cdpStats;
  out.finishedAt = new Date().toISOString();
  await save();
  clearTimeout(watchdog);
  try { await truth.detach(); } catch {}
  try { await withTimeout(runtime.shutdownAll(), 30000, 'shutdown'); } catch (e) { out.shutdownError = String(e); }
  killChrome();
  for (const r of hung) { try { r.destroy(); } catch {} }
  server.close();
  await save();
  console.log(JSON.stringify(out.verdicts, null, 1), JSON.stringify(cdpStats));
  process.exit(0);
}
