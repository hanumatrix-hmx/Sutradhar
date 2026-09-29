// FR2-12 audit-3: for real URLs, record the TRUE main-frame document response status (independent
// puppeteer listener) and compare with what runtime.audit reports in brokenRequests.
// Writes ONLY audit-3/probe-real-docstatus.json. Chrome killed by own PID only; 15-min watchdog.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-3')) throw new Error('wrong dir');
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const OUT = path.join(here, 'probe-real-docstatus.json');
const TRIALS = Number(process.argv[2] ?? 3);
const withTimeout = (p, ms, l) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${l}`)), ms))]);
const urls = process.argv.slice(3).length ? process.argv.slice(3) : [
  'https://github.com/audit3-nonexistent-user-zz9/nope', 'https://angular.dev/audit3-nonexistent', 'https://www.npmjs.com/package/audit3-nonexistent-pkg-zz9',
  'https://nextjs.org/docs/audit3-nonexistent-page', 'https://react.dev/audit3-nonexistent', 'https://vercel.com/audit3-nonexistent',
  'https://svelte.dev/audit3-nonexistent', 'https://vuejs.org/audit3-nonexistent', 'https://developer.mozilla.org/en-US/docs/audit3-nonexistent',
  'https://www.python.org/audit3-nonexistent/', 'https://en.wikipedia.org/wiki/Audit3_nonexistent_zz9', 'https://stackoverflow.com/questions/999999999999',
  'https://docs.github.com/en/audit3-nonexistent', 'https://www.w3.org/audit3-nonexistent',
];
const out = { startedAt: new Date().toISOString(), rows: [] };
let chromePid = null;
const kill = () => { if (chromePid) try { execFileSync('taskkill', ['/PID', String(chromePid), '/T', '/F'], { stdio: 'ignore' }); } catch {} };
const wd = setTimeout(async () => { out.watchdog = true; await fs.writeFile(OUT, JSON.stringify(out, null, 2)); kill(); process.exit(2); }, 15 * 60 * 1000);
const runtime = new SutradharRuntime({});
const { sessionId: sid } = await runtime.launch({ launch: { headless: true } });
const tab = runtime['resolveTab'](sid).tab;
const page = runtime['requirePage'](tab);
try { chromePid = page.browser().process()?.pid ?? null; } catch {}
let docs = [];
page.on('response', (r) => { try { if (r.request().resourceType() === 'document' && r.frame() === page.mainFrame()) docs.push({ status: r.status(), url: r.url() }); } catch {} });
try {
  for (const u of urls) for (let i = 0; i < TRIALS; i++) {
    docs = [];
    try {
      const a = await withTimeout(runtime.audit(sid, { url: u }), 70000, u);
      const lastDoc = docs[docs.length - 1];
      const errDoc = docs.filter((d) => d.status >= 400).pop();
      out.rows.push({ url: u, finalUrl: a.url, mainDocResponses: docs.map((d) => `${d.status} ${d.url}`),
        ownErrorStatusReported: errDoc ? a.brokenRequests.some((b) => b.url === errDoc.url && b.status === errDoc.status) : 'n/a (doc not >=400)',
        brokenRequests: a.brokenRequests.slice(0, 5).map((b) => `${b.status} ${b.url}`), consoleErrorCount: a.consoleErrors.length, lastDocMatchesFinalUrl: lastDoc ? lastDoc.url === a.url : null });
    } catch (e) { out.rows.push({ url: u, error: String(e.message ?? e) }); }
    await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  }
} finally {
  clearTimeout(wd);
  try { await withTimeout(runtime.shutdownAll(), 30000, 'sd'); } catch {}
  kill();
  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  for (const r of out.rows) console.log(r.url, '|', r.error ?? `own=${r.ownErrorStatusReported} docs=${JSON.stringify(r.mainDocResponses)} final=${r.finalUrl}`);
  process.exit(0);
}
