// FR2-12 escalation-2: scoped re-verification sweep of the prior audits' attack surface, to check
// the loaderId-based GAP-284/285 redesign doesn't regress escalation-1's own fixes. NOT a full
// re-run of every audit-1..5 case (that evidence already exists and is untouched under
// audit-1/ .. audit-5/) -- this targets the shapes most likely to interact with a commit-tracking
// change: a long-lived tab with many navigations, concurrent tabs (cross-tab leak), and the
// same-document-navigation non-regression (GAP-266 territory, already also covered by
// probe-gap284-runtime.mjs's hash-change case and unit test CT14). Watchdog 300s.
import fs from 'node:fs/promises';
import { loadRuntime, startServer, chromePidOf, sleep, watchdog, killAll, outPath, H, html } from './lib.mjs';

const OUT = outPath('probe-resweep-results.json');
const out = {};
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stopWd = watchdog(300000, async () => { out.watchdog = true; await save(); });

const { server, origin } = await startServer((req, res, u) => {
  const p = u.pathname;
  if (p === '/favicon.ico') { res.writeHead(200); return res.end(); }
  if (p.startsWith('/page')) {
    const n = p.replace('/page', '');
    return res.writeHead(200, H), res.end(html(`<h1>page ${n}</h1><script>console.error("ERR-${n}");fetch("/missing-${n}")</script>`, `p${n}`));
  }
  res.writeHead(404); res.end('nf');
});

const { SutradharRuntime } = await loadRuntime();
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
chromePidOf(runtime, sid);

// (1) 25-navigation long-lived tab: each audit must report ONLY that page's own error/broken
// request, never a previous page's.
{
  const { id: tabId } = await runtime.createTab(sid);
  const results = [];
  for (let i = 0; i < 25; i++) {
    await runtime.navigate(sid, `${origin}/page${i}`, tabId);
    await sleep(120);
    const a = await runtime.audit(sid, { tabId });
    const ownErr = a.consoleErrors.some((e) => e.text === `ERR-${i}`);
    const ownBroken = a.brokenRequests.some((b) => b.url.includes(`/missing-${i}`));
    const foreignErr = a.consoleErrors.some((e) => !e.text.includes(`ERR-${i}`));
    const foreignBroken = a.brokenRequests.some((b) => !b.url.includes(`/missing-${i}`));
    results.push({ i, ownErr, ownBroken, foreignErr, foreignBroken, covers: a.observation.coversWholeDocument, errTexts: a.consoleErrors.map((e) => e.text) });
  }
  await runtime.closeTab(sid, tabId);
  out.longLivedTab25 = {
    n: results.length,
    ownErrAll: results.every((r) => r.ownErr),
    ownBrokenAll: results.every((r) => r.ownBroken),
    anyForeignErr: results.some((r) => r.foreignErr),
    anyForeignBroken: results.some((r) => r.foreignBroken),
    coversTrueCount: results.filter((r) => r.covers).length,
    foreignErrDetail: results.filter((r) => r.foreignErr),
  };
  await save();
}

// (2) 2 concurrent tabs x 8 rounds: no cross-tab leakage of console/network findings.
{
  const { id: tabA } = await runtime.createTab(sid);
  const { id: tabB } = await runtime.createTab(sid);
  const rounds = [];
  for (let i = 0; i < 8; i++) {
    await Promise.all([
      runtime.navigate(sid, `${origin}/pageA${i}`, tabA),
      runtime.navigate(sid, `${origin}/pageB${i}`, tabB),
    ]);
    await sleep(150);
    const [aA, aB] = await Promise.all([runtime.audit(sid, { tabId: tabA }), runtime.audit(sid, { tabId: tabB })]);
    rounds.push({
      i,
      aOwnErr: aA.consoleErrors.some((e) => e.text.includes(`ERR-A${i}`)),
      aLeakedB: aA.consoleErrors.some((e) => e.text.includes('ERR-B')) || aA.brokenRequests.some((b) => b.url.includes('missing-B')),
      bOwnErr: aB.consoleErrors.some((e) => e.text.includes(`ERR-B${i}`)),
      bLeakedA: aB.consoleErrors.some((e) => e.text.includes('ERR-A')) || aB.brokenRequests.some((b) => b.url.includes('missing-A')),
    });
  }
  await runtime.closeTab(sid, tabA);
  await runtime.closeTab(sid, tabB);
  out.concurrentTabs = {
    n: rounds.length,
    aOwnErrAll: rounds.every((r) => r.aOwnErr),
    bOwnErrAll: rounds.every((r) => r.bOwnErr),
    anyCrossLeak: rounds.some((r) => r.aLeakedB || r.bLeakedA),
  };
  await save();
}

try { await runtime.shutdown(sid); } catch {}
stopWd(); killAll(); server.close(); await save();
console.log(JSON.stringify(out, null, 1));
process.exit(0);
