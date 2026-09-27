// FR2-12 audit-5: isolate the audit({url}) stall seen in probe-273x's dialog part. Step-timed, with
// instance-level wrappers on the audited tab's page to see which call stalls. PREFIX=1 = pre-escalation-1
// emulation. Each audit capped at 45s. Watchdog 400s.
import fs from 'node:fs/promises';
import { loadRuntime, emulatePreFix, startServer, chromePidOf, cap, sleep, watchdog, killAll, outPath, H } from './lib.mjs';
const PREFIX = process.env.PREFIX === '1';
const VARIANT = process.argv[2] ?? 'seq';
const OUT = outPath(`probe-dialog-hang-debug-${VARIANT}${PREFIX ? "-prefix" : ""}${process.env.NOTRACK === "1" ? "-notrack" : ""}.json`);
const out = { variant: VARIANT, preFix: PREFIX, log: [] };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(400000, async () => { out.watchdog = true; await save(); });
if (PREFIX) await emulatePreFix();
const { SutradharRuntime } = await loadRuntime();
const html = (b) => `<html lang=en><head><title>t</title></head><body>${b}</body></html>`;
const { server, origin } = await startServer((req, res, u) => {
  if (u.pathname === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (u.pathname === '/alertload') return res.writeHead(200, H), res.end(html('<h1>alert</h1><script>setTimeout(function(){alert("dbg")},100)</script>'));
  if (u.pathname === '/h404') return res.writeHead(404, H), res.end(html('<h1>nf</h1><script>location.hash="top"</script>'));
  res.writeHead(200, H); res.end(html('<h1>ok</h1>'));
});
const T0 = Date.now();
const log = (m, extra = {}) => { out.log.push({ t: Date.now() - T0, m, ...extra }); };
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);
const { id: T } = await runtime.createTab(sid);
const { id: O } = await runtime.createTab(sid);
await sleep(300);
const page = runtime['requirePage'](runtime['resolveTab'](sid, T).tab);
for (const fn of ['goto', 'screenshot', 'evaluate', 'title']) {
  const orig = page[fn].bind(page);
  page[fn] = async (...a) => { const s = Date.now(); log(`page.${fn} start`); try { return await orig(...a); } finally { log(`page.${fn} end`, { ms: Date.now() - s }); } };
}
const openAlert = async (tab, tag) => {
  await runtime.navigate(sid, `${origin}/alertload?${tag}`, tab);
  for (let i = 0; i < 40 && !runtime.getPendingDialog(sid, tab); i++) await sleep(50);
  return !!runtime.getPendingDialog(sid, tab);
};
const aud = async (label, url, tab = T) => {
  log(`AUDIT ${label} start`);
  const s = Date.now();
  try { const a = await cap(runtime.audit(sid, { url, tabId: tab }), 45000, label); log(`AUDIT ${label} ok`, { ms: Date.now() - s, broken: a.brokenRequests.map((b) => b.status) }); }
  catch (e) { log(`AUDIT ${label} FAIL`, { ms: Date.now() - s, err: e.message.slice(0, 120), pendingT: runtime.getPendingDialog(sid, T)?.message ?? null, pendingO: runtime.getPendingDialog(sid, O)?.message ?? null }); }
  await save();
};
const handle = async (tab, label) => { const p = runtime.getPendingDialog(sid, tab); log(`pending on ${label}? ${!!p}`); if (p) { try { await cap(runtime.handleDialog(sid, 'accept', undefined, tab), 10000, 'handle'); log(`handled ${label}`); } catch (e) { log(`handle ${label} FAIL ${e.message}`); } } };

if (VARIANT === 'seq') {
  // exactly probe-273x's first iterations
  log('openAlert T', { p: await openAlert(T, 'a') }); await aud('1 sameTab h404', `${origin}/h404?1`); await handle(T, 'T');
  log('openAlert O', { p: await openAlert(O, 'b') }); await aud('2 otherTab h404', `${origin}/h404?2`); await handle(O, 'O');
  log('openAlert T', { p: await openAlert(T, 'c') }); await handle(T, 'T'); await aud('3 justHandled h404', `${origin}/h404?3`);
  log('openAlert T', { p: await openAlert(T, 'd') }); await aud('4 sameTab ok', `${origin}/ok?4`); await handle(T, 'T');
  await aud('5 no dialog anywhere ok', `${origin}/ok?5`);
} else if (VARIANT === 'justhandled') {
  for (let i = 0; i < 3; i++) { log('openAlert T', { p: await openAlert(T, `j${i}`) }); await handle(T, 'T'); await aud(`jh${i}`, `${origin}/ok?jh${i}`); }
  await aud('plain after', `${origin}/ok?plain`);
} else if (VARIANT === 'othertab') {
  for (let i = 0; i < 3; i++) { log('openAlert O', { p: await openAlert(O, `o${i}`) }); await aud(`ot${i}`, `${origin}/ok?ot${i}`); await handle(O, 'O'); }
  await aud('plain after', `${origin}/ok?plain`);
}
try { await cap(runtime.shutdownAll(), 20000, 'sd'); } catch {}
stopWd(); killAll(); server.close(); await save();
for (const l of out.log) console.log(l.t, l.m, l.ms ?? '', l.err ?? '', l.broken ? JSON.stringify(l.broken) : '', l.pendingT ?? '', l.pendingO ?? '');
process.exit(0);
