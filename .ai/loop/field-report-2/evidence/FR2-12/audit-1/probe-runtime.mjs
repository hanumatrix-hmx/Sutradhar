// FR2-12 audit-1: independent runtime-level probes (auditor-written, not the executor's script).
// Usage: node probe-runtime.mjs <outJson>
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const OUT = process.argv[2] ?? path.join(here, 'probe-runtime.json');
const rtMod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const { SutradharRuntime, buildAuditReport } = rtMod;
const reqMcp = createRequire(path.join(repoRoot, 'packages', 'mcp-server', 'package.json'));
const { AjvJsonSchemaValidator } = reqMcp('@modelcontextprotocol/sdk/validation/ajv');
const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json'), 'utf8'));
const validate = new AjvJsonSchemaValidator().getValidator(schema);
const reqRt = createRequire(path.join(repoRoot, 'packages', 'capability-runtime', 'package.json'));
const { PNG } = reqRt('pngjs');

function bigPng(w, h) {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h * 4; i += 4) { p.data[i] = 200; p.data[i + 1] = 30; p.data[i + 2] = 30; p.data[i + 3] = 255; }
  return PNG.sync.write(p);
}
const BIG = bigPng(600, 400);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const page = (title, body, lang = 'en') => `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0">${body}</body></html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const n = u.searchParams.get('n') ?? '0';
  const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  switch (u.pathname) {
    case '/favicon.ico': return send(200, 'image/png', BIG);
    case '/big.png': { const ms = Number(u.searchParams.get('ms') ?? 0); await delay(ms); return send(200, 'image/png', BIG); }
    case '/fast': return send(200, 'text/html', page('fast', `<h1 style="font-size:60px">Fast ${n}</h1>`));
    case '/slowlcp': return send(200, 'text/html', page('slowlcp', `<p>small</p><img src="/big.png?ms=900&n=${n}" width=600 height=400 alt=b>`));
    case '/latelcp': return send(200, 'text/html', page('latelcp', `<p>tiny</p><script>setTimeout(()=>{const d=document.createElement('div');d.style.cssText='width:700px;height:500px;background:#08f';d.textContent='late big block';document.body.appendChild(d);},700)</script>`));
    case '/shift': return send(200, 'text/html', page('shift', `<div id=slot style="height:0"></div><h1 style="font-size:48px">Shift ${n}</h1><p>para</p><script>setTimeout(()=>{slot.style.height='200px';window.__done=true},300)</script>`));
    case '/multishift': return send(200, 'text/html', page('multishift', `<div id=slot style="height:0"></div><h1 style="font-size:48px">Multi ${n}</h1><p style="height:300px">x</p><script>let i=0;const t=setInterval(()=>{slot.style.height=((i%2)?0:(40+i))+'px';if(++i>=10){clearInterval(t);window.__done=true}},60)</script>`));
    case '/manyshift': return send(200, 'text/html', page('manyshift', `<div id=slot style="height:0"></div><h1 style="font-size:48px">Many ${n}</h1><p style="height:300px">x</p><script>let i=0;function f(){slot.style.height=((i%2)?0:30)+'px';if(++i<220)requestAnimationFrame(f);else window.__done=true}requestAnimationFrame(f)</script>`));
    case '/redirect': res.writeHead(302, { Location: `/fast?n=${n}` }); return res.end();
    case '/jsredirect': return send(200, 'text/html', page('jsr', `<script>console.error('pre-redirect-${n}');location.replace('/fast?n=${n}')</script>`));
    case '/status999': return send(200, 'text/html', page('s999', `<script>fetch('/weird-${n}').catch(()=>{})</script><p>weird status</p>`));
    case `/weird-${n}`: return send(999, 'text/plain', 'weird');
    case '/poller': return send(200, 'text/html', page('poller', `<p>poller ${n}</p><script>setInterval(()=>{console.error('poll-err-${n}');fetch('/missing-poll-${n}?t='+Date.now()).catch(()=>{})},25)</script>`));
    case '/slowclean': { await delay(Number(u.searchParams.get('ms') ?? 800)); return send(200, 'text/html', page('slowclean', `<h1>slow clean ${n}</h1>`)); }
    case '/throwloop': return send(200, 'text/html', page('throwloop', `<p>t ${n}</p><script>setInterval(()=>{throw new Error('loop-${n}')},30)</script>`));
    case '/notfound': return send(404, 'text/html', page('nf', `<h1>404 page ${n}</h1>`));
    default:
      if (u.pathname.startsWith('/weird-')) return send(999, 'text/plain', 'weird');
      return send(404, 'text/plain', 'nf');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const out = { origin, probes: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));

const REF = `(() => { window.__ref = { lcp: null, cls: 0, n: 0 };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ref.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint' }); } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__ref.n++; if (!e.hadRecentInput) window.__ref.cls += e.value; } }).observe({ type: 'layout-shift' }); } catch (e) {}
})()`;

const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
const getPage = (tabId) => runtime['requirePage'](runtime['resolveTab'](sid, tabId).tab);

try {
  // ---- V: vitals accuracy vs a pre-injected live (non-buffered) reference observer, same document
  out.probes.vitals = [];
  for (const route of ['/fast', '/slowlcp', '/latelcp', '/shift', '/multishift', '/manyshift']) {
    for (let t = 0; t < 3; t++) {
      const p = getPage();
      const { identifier } = await p.evaluateOnNewDocument(REF);
      let a;
      try { a = await runtime.audit(sid, { url: `${origin}${route}?n=${route}${t}`, settleMs: 2500 }); }
      finally { await p.removeScriptToEvaluateOnNewDocument(identifier); }
      const ref = await runtime.eval(sid, 'window.__ref');
      const lcpDiff = a.webVitals.lcpMs === null || ref.lcp === null ? null : Math.abs(a.webVitals.lcpMs - Math.round(ref.lcp));
      const clsDiff = a.webVitals.cls === null ? null : Math.abs(a.webVitals.cls - ref.cls);
      out.probes.vitals.push({ route, t, audit: a.webVitals, ref, lcpDiff, clsDiff, shiftEntriesSeenLive: ref.n, hidden: a.observation.pageWasHidden,
        ok: lcpDiff !== null && lcpDiff <= 1 && clsDiff !== null && clsDiff < 0.001 });
    }
  }
  await save();

  // ---- V2: current-page mode (no url) after a plain navigate — same comparison
  out.probes.vitalsCurrentPage = [];
  for (const route of ['/slowlcp', '/shift', '/latelcp']) {
    const p = getPage();
    const { identifier } = await p.evaluateOnNewDocument(REF);
    try { await runtime.navigate(sid, `${origin}${route}?n=cp`); } finally { await p.removeScriptToEvaluateOnNewDocument(identifier); }
    await delay(2500);
    const a = await runtime.audit(sid, {});
    const ref = await runtime.eval(sid, 'window.__ref');
    out.probes.vitalsCurrentPage.push({ route, audit: a.webVitals, ref, observation: a.observation,
      ok: a.webVitals.lcpMs !== null && Math.abs(a.webVitals.lcpMs - Math.round(ref.lcp)) <= 1 && Math.abs(a.webVitals.cls - ref.cls) < 0.001 });
  }
  await save();

  // ---- B2: 3 consecutive URL audits in one tab, CLS stable, no leaked global
  {
    const cls = [];
    for (let i = 0; i < 3; i++) cls.push((await runtime.audit(sid, { url: `${origin}/shift?n=b2${i}`, settleMs: 1200 })).webVitals.cls);
    await runtime.navigate(sid, `${origin}/fast?n=b2x`);
    const leaked = await runtime.eval(sid, 'typeof window.__sutradharVitals');
    out.probes.B2 = { cls, spread: Math.max(...cls) - Math.min(...cls), leaked, ok: Math.max(...cls) - Math.min(...cls) < 0.005 && leaked === 'undefined' };
  }
  await save();

  // ---- B1 (the fixture's static noisy page) -- re-check the executor's L12 at runtime level
  // ---- B1-residual: an old page that KEEPS producing errors while the next page's response is slow
  out.probes.B1residual = [];
  for (let t = 0; t < 5; t++) {
    await runtime.navigate(sid, `${origin}/poller?n=r${t}`);
    await delay(500);
    // current-page mode after a same-process navigate to a slow-TTFB clean page
    await runtime.navigate(sid, `${origin}/slowclean?ms=800&n=c${t}`);
    const a = await runtime.audit(sid, {});
    // url mode directly from the poller page
    await runtime.navigate(sid, `${origin}/poller?n=s${t}`);
    await delay(500);
    const b = await runtime.audit(sid, { url: `${origin}/slowclean?ms=800&n=d${t}`, settleMs: 500 });
    out.probes.B1residual.push({
      t,
      currentPage: { consoleErrors: a.consoleErrors.length, brokenRequests: a.brokenRequests.length, sample: a.consoleErrors.slice(0, 2).map((e) => e.text), cover: a.observation.coversWholeDocument },
      urlMode: { consoleErrors: b.consoleErrors.length, brokenRequests: b.brokenRequests.length, sample: b.consoleErrors.slice(0, 2).map((e) => e.text), cover: b.observation.coversWholeDocument },
    });
    await save();
  }

  // ---- Edge cases
  out.probes.edge = {};
  const tryAudit = async (name, fn) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      const rep = buildAuditReport(r, { screenshotPath: null, diffPath: null });
      const v = validate(rep);
      out.probes.edge[name] = { ok: true, ms: Date.now() - t0, valid: v.valid, err: v.valid ? undefined : v.errorMessage, url: rep.url, requestedUrl: rep.requestedUrl, title: rep.title,
        consoleErrors: rep.consoleErrors.map((e) => e.text).slice(0, 5), pageErrorsN: rep.pageErrors.length, brokenRequests: rep.brokenRequests, webVitals: rep.webVitals, observation: rep.observation, baseline: rep.baseline, screenshot: rep.screenshot };
    } catch (e) {
      out.probes.edge[name] = { ok: false, ms: Date.now() - t0, error: String(e && e.message || e) };
    }
    await save();
  };
  await tryAudit('redirect302', () => runtime.audit(sid, { url: `${origin}/redirect?n=r1` }));
  await tryAudit('jsRedirect', () => runtime.audit(sid, { url: `${origin}/jsredirect?n=r2` }));
  await tryAudit('aboutBlankUrl', () => runtime.audit(sid, { url: 'about:blank' }));
  await runtime.navigate(sid, 'about:blank');
  await tryAudit('aboutBlankCurrent', () => runtime.audit(sid, {}));
  await tryAudit('throwDuringAudit', () => runtime.audit(sid, { url: `${origin}/throwloop?n=t1` }));
  await tryAudit('status999', () => runtime.audit(sid, { url: `${origin}/status999?n=w1` }));
  await tryAudit('baseline404', () => runtime.audit(sid, { url: `${origin}/fast?n=b404`, baselineUrl: `${origin}/notfound?n=b404` }));
  await tryAudit('audited404', () => runtime.audit(sid, { url: `${origin}/notfound?n=a404` }));
  await tryAudit('baselineUnreachable', () => runtime.audit(sid, { url: `${origin}/fast?n=bu`, baselineUrl: 'http://127.0.0.1:9/' }));
  await tryAudit('navUnreachable', () => runtime.audit(sid, { url: 'http://127.0.0.1:9/' }));
  await tryAudit('hashNav', async () => { await runtime.navigate(sid, `${origin}/poller?n=h1`); await delay(300); return runtime.audit(sid, { url: `${origin}/poller?n=h1#frag`, settleMs: 300 }); });

  // Concurrent audits on two tabs of one session
  {
    const t2 = await runtime.createTab(sid, `${origin}/fast?n=conc0`);
    const tabs = await runtime.listTabs(sid);
    const other = tabs.find((t) => t.id !== t2.id);
    const t0 = Date.now();
    const settled = await Promise.allSettled([
      runtime.audit(sid, { url: `${origin}/poller?n=concA`, tabId: other.id }),
      runtime.audit(sid, { url: `${origin}/shift?n=concB`, tabId: t2.id }),
    ]);
    out.probes.edge.concurrentTwoTabs = settled.map((s, i) => s.status === 'fulfilled'
      ? { i, ok: true, url: s.value.url, consoleErrors: s.value.consoleErrors.length, broken: s.value.brokenRequests.length, cls: s.value.webVitals.cls, hidden: s.value.observation.pageWasHidden, lcp: s.value.webVitals.lcpMs, valid: validate(buildAuditReport(s.value, { screenshotPath: null, diffPath: null })).valid }
      : { i, ok: false, error: String(s.reason?.message ?? s.reason) });
    out.probes.edge.concurrentTwoTabs.ms = Date.now() - t0;
    // cross-contamination check: the /shift tab must not report poller errors
    await runtime.closeTab(sid, t2.id).catch(() => {});
    await save();
  }
} catch (e) {
  out.fatal = String(e && e.stack || e);
} finally {
  await save();
  await runtime.shutdownAll().catch(() => {});
  server.close();
}
console.log('done', OUT);
