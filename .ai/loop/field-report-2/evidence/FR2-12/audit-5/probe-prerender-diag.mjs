// FR2-12 audit-5: can a speculation-rules prerender activation happen in a Sutradhar-launched Chrome?
// Tries: link click, location.href, runtime.navigate, with several eagerness modes. Watchdog 240s.
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, cap, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';
const OUT = outPath('probe-prerender-diag.json');
const out = { attempts: [] };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(240000, async () => { out.watchdog = true; await save(); });
const { SutradharRuntime } = await loadRuntime();
const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p === '/src') {
    const target = u.searchParams.get('target');
    const eag = u.searchParams.get('eag') || 'immediate';
    return res.writeHead(200, H), res.end(html(`<a id=l href="${target}">go</a><script type="speculationrules">${JSON.stringify({ prerender: [{ source: 'list', urls: [target], eagerness: eag }] })}</script>`));
  }
  if (p === '/dst') return res.writeHead(200, H), res.end(html('<h1>dst</h1><script>window.__wasPrerendering=document.prerendering;</script>'));
  res.writeHead(404); res.end();
});
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const page = runtime['requirePage'](runtime['resolveTab'](sid).tab);
const browser = page.browser();
out.version = await browser.version();
for (const how of ['click', 'goto', 'runtime.navigate', 'location']) {
  for (const eag of ['immediate', 'eager']) {
    const target = `${origin}/dst?how=${how}&eag=${eag}`;
    await runtime.navigate(sid, `${origin}/src?eag=${eag}&target=${encodeURIComponent(target)}`);
    await sleep(2000);
    const targets = browser.targets().map((t) => ({ type: t.type(), sub: (() => { try { return t._subtype(); } catch { return null; } })(), url: t.url().slice(-40) }));
    const trackerCommitBefore = runtime['resolveTab'](sid).tab.getLastMainFrameCommitAt();
    try {
      if (how === 'click') await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.click('#l')]);
      else if (how === 'goto') await page.goto(target);
      else if (how === 'runtime.navigate') await runtime.navigate(sid, target);
      else await Promise.all([page.waitForNavigation({ timeout: 10000 }).catch(() => {}), page.evaluate((t) => { location.href = t; }, target)]);
    } catch (e) { out.attempts.push({ how, eag, err: e.message }); continue; }
    await sleep(500);
    const r = await page.evaluate(() => ({ was: window.__wasPrerendering, act: performance.getEntriesByType('navigation')[0].activationStart, href: location.href })).catch((e) => ({ err: e.message }));
    const trackerCommitAfter = runtime['resolveTab'](sid).tab.getLastMainFrameCommitAt();
    out.attempts.push({ how, eag, targets, result: r, trackerCommitBefore, trackerCommitAfter });
    await save();
  }
}
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
stopWd(); killAll(); server.close(); await save();
for (const a of out.attempts) console.log(a.how, a.eag, JSON.stringify(a.result), 'prerenderTargets=', (a.targets || []).filter((t) => t.sub === 'prerender').length, a.trackerCommitBefore, '->', a.trackerCommitAfter);
console.log(out.version);
process.exit(0);
