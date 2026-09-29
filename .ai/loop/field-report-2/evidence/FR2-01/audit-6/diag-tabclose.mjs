// FR2-01 audit-6: engine-level mechanism trace for probe T's false hidden-success on tab close.
// Uses the REAL built engine (packages/browser/dist/actions/browser-action-engine.js) in-process
// against real Chrome, wrapping (not modifying) its private per-frame primitives on the prototype
// purely to LOG what each one returned/threw on the trials that falsely succeed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const eng = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'actions', 'browser-action-engine.js')));
const idx = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
const { BrowserActionEngine } = eng;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<div id="stay">always visible</div>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

let log = [];
const P = BrowserActionEngine.prototype;
for (const name of ['pierceFirstMatch', 'isHandleVisible', 'isHiddenInEveryFrame', 'raceFrameProbe']) {
  const orig = P[name];
  P[name] = async function (...args) {
    try {
      const v = await orig.apply(this, args);
      log.push({ t: Date.now(), fn: name, ret: typeof v === 'object' && v ? { kind: v.kind } : v });
      return v;
    } catch (e) {
      log.push({ t: Date.now(), fn: name, threw: String(e?.message ?? e).slice(0, 160) });
      throw e;
    }
  };
}
// also capture the RAW puppeteer errors underneath (frame.$ and handle.evaluate)
const rawErrs = [];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fr2-01-a6-diag-'));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? new idx.BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile, args: ['--no-sandbox'] });
const engine = new BrowserActionEngine();
const N = Number(process.env.N ?? 60);
const falseSuccesses = [];
let fails = 0;
try {
  for (let i = 0; i < N; i++) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/?i=${i}`);
    const mf = page.mainFrame();
    const origDollar = mf.$.bind(mf);
    mf.$ = (...a) => origDollar(...a).then((h) => {
      if (h) { const oe = h.evaluate.bind(h); h.evaluate = (...b) => oe(...b).catch((e) => { rawErrs.push({ i, where: 'handle.evaluate', msg: String(e.message).slice(0, 160) }); throw e; }); }
      return h;
    }, (e) => { rawErrs.push({ i, where: 'frame.$', msg: String(e.message).slice(0, 160) }); throw e; });
    const tab = { id: `t${i}`, page, url: page.url(), title: '', recordAction() {} };
    log = [];
    const closeDelay = 20 + ((i * 37) % 400);
    const t0 = Date.now();
    const p = engine.executeAction(tab, { actionType: 'wait_for_selector', selector: '#stay', state: 'hidden', timeoutMs: 2000, maxRetries: 0 });
    await delay(closeDelay);
    const closedAt = Date.now();
    await page.close().catch(() => {});
    const r = await p;
    if (r.success) falseSuccesses.push({ i, closeDelay, msAfterClose: Date.now() - closedAt, output: r.outputData, trace: log.filter((e) => e.t >= closedAt - 30).map((e) => ({ ...e, t: e.t - t0 })), rawErrs: rawErrs.filter((e) => e.i === i) });
    else fails++;
  }
} finally {
  const out = { trials: N, falseSuccess: falseSuccesses.length, honestFailures: fails, falseSuccesses };
  fs.writeFileSync(path.join(here, 'diag-tabclose-results.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
  await browser.close().catch(() => {});
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(0);
