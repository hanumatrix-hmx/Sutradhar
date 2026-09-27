// FR2-12 audit-5: ask Chrome (CDP Preload domain) why speculation-rules prerender does not start.
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, cap, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';
const OUT = outPath('probe-prerender-why.json');
const out = { events: [] };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(120000, async () => { out.watchdog = true; await save(); });
const { SutradharRuntime } = await loadRuntime();
const { server, origin } = await startServer((req, res, u) => {
  if (u.pathname === '/src') { const target = `${origin}/dst`; return res.writeHead(200, H), res.end(html(`<a id=l href="/dst">go</a><script type="speculationrules">${JSON.stringify({ prerender: [{ source: 'list', urls: ['/dst'], eagerness: 'immediate' }] })}</script>`)); }
  if (u.pathname === '/dst') return res.writeHead(200, H), res.end(html('<h1>dst</h1>'));
  res.writeHead(404); res.end();
});
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const page = runtime['requirePage'](runtime['resolveTab'](sid).tab);
const c = await page.createCDPSession();
for (const ev of ['Preload.prerenderStatusUpdated', 'Preload.preloadEnabledStateUpdated', 'Preload.ruleSetUpdated', 'Preload.ruleSetRemoved', 'Preload.prefetchStatusUpdated', 'Preload.preloadingAttemptSourcesUpdated']) c.on(ev, (e) => out.events.push({ ev, e: JSON.stringify(e).slice(0, 500) }));
await c.send('Preload.enable').catch((e) => out.events.push({ enableErr: e.message }));
await page.goto(`${origin}/src`);
await sleep(3000);
out.targets = page.browser().targets().map((t) => ({ type: t.type(), url: t.url() }));
await c.detach().catch(() => {});
try { await cap(runtime.shutdownAll(), 30000, 'sd'); } catch {}
stopWd(); killAll(); server.close(); await save();
for (const e of out.events) console.log(e.ev, e.e ?? e.enableErr);
process.exit(0);
