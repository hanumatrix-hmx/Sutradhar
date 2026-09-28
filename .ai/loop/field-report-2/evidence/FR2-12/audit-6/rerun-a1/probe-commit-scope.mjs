// FR2-12 audit-1: is there a cheap fix for the B1 residual leak? Hypothesis: scoping by the
// main frame's navigation COMMIT time (Puppeteer 'framenavigated' on the main frame, Node-side
// timestamp, same clock as the ring-buffer entries) instead of navigation START removes the leak,
// because the old document can only emit events until the new one commits.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (u.pathname === '/poller') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<html lang=en><head><title>p</title></head><body>p<script>setInterval(()=>{console.error('poll-err');fetch('/missing-poll?t='+Date.now()).catch(()=>{})},25)</script></body></html>`); }
  if (u.pathname === '/slowclean') { await delay(Number(u.searchParams.get('ms') ?? 800)); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html lang=en><head><title>c</title></head><body>clean<script>console.error("own-error-of-clean-page")</script></body></html>'); }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
const tab = runtime['resolveTab'](sid).tab;
const page = runtime['requirePage'](tab);
let commitAt = null;
page.on('framenavigated', (f) => { if (f === page.mainFrame()) commitAt = new Date().toISOString(); });
const trials = [];
try {
  for (let t = 0; t < 5; t++) {
    for (const ms of [150, 800]) {
      await runtime.navigate(sid, `${origin}/poller?t=${t}`);
      await delay(400);
      const a = await runtime.audit(sid, { url: `${origin}/slowclean?ms=${ms}&t=${t}`, settleMs: 600 });
      const raw = tab.getConsoleLogs().filter((l) => l.logType === 'error');
      const rawNet = tab.getNetworkLog().filter((n) => n.phase === 'response' && n.status >= 400);
      const byCommit = raw.filter((l) => l.timestamp >= commitAt).map((l) => l.text);
      trials.push({ t, ttfbMs: ms,
        shipped: { consoleErrors: a.consoleErrors.length, broken: a.brokenRequests.length, hasOwnError: a.consoleErrors.some((e) => e.text === 'own-error-of-clean-page') },
        commitScoped: { consoleErrors: byCommit.length, broken: rawNet.filter((n) => n.timestamp >= commitAt).length, hasOwnError: byCommit.includes('own-error-of-clean-page') } });
    }
  }
} finally {
  await fs.writeFile(path.join(here, 'probe-commit-scope.json'), JSON.stringify({ origin, trials }, null, 2));
  await runtime.shutdownAll().catch(() => {});
  server.close();
}
console.log(JSON.stringify(trials));
