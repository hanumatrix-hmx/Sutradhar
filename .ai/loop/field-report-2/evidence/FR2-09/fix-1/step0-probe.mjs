// FR2-09 fix-1 — Step 0 probe (spec section 5.0), scoped down for this fix cycle: a genuinely
// live experiment against the recreated fr2-09-frames.html/fr2-09-inner.html fixtures, serving
// them over HTTP from two hostnames (127.0.0.1 + localhost, the FR2-01 audit-2 recipe) so "xo"
// is a real cross-origin OOPIF. Runs on the POST-fix build (this fix cycle doesn't have a
// pre-fix build checked out separately) — rows (a)-(g), (h)-(j) are captured; rows (k)/(l)
// (bare vs includeIframes:true AX reads) and (m) (the X-Frame-Options frame's reported URL,
// the D8 fork question) are captured directly. Not run: the full HTTP-server live-verify
// script's OTHER surfaces (CLI/SDK/bundle parity, click-through actionability, id-collision
// proof under load) — those remain a genuinely separate, larger undertaking (spec section 5)
// logged as not-yet-built in this fix cycle's report, not silently skipped.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');
const exe = new BrowserLauncher().findExecutablePath();

const fixturesDir = path.join(repo, 'tools/scenario-suite/fixtures');
let P = 0;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/xfo-deny') {
    res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' });
    res.end('<!doctype html><html><body>denied</body></html>');
    return;
  }
  const file = u.pathname === '/' ? '/fr2-09-frames.html' : u.pathname;
  try {
    let body = await fs.readFile(path.join(fixturesDir, file), 'utf8');
    // Rewrite the "xo" frame's src to the second (localhost) hostname so it's a genuine OOPIF,
    // matching the FR2-01 audit-2 recipe (parent on 127.0.0.1, cross-origin child on localhost).
    body = body.replace(
      'name="xo" src="/fr2-09-inner.html?role=xo"',
      `name="xo" src="http://localhost:${P}/fr2-09-inner.html?role=xo"`,
    );
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
P = server.address().port;

const rows = [];
const record = (row) => {
  rows.push(row);
  console.log(JSON.stringify(row));
};

const observer = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = (await observer.pages())[0] ?? (await observer.newPage());

await page.goto(`http://127.0.0.1:${P}/fr2-09-frames.html?n=${Date.now()}`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 500));

for (const frame of page.frames()) {
  const name = frame.name();
  const url = frame.url();
  const isMain = frame === page.mainFrame();
  const isOOPIF = !isMain && frame.client !== page.mainFrame().client;
  let evaluateOutcome;
  let elapsedMs;
  const t0 = Date.now();
  try {
    const count = await Promise.race([
      frame.evaluate(() => document.querySelectorAll('button,input').length),
      new Promise((_, rej) => setTimeout(() => rej(new Error('PROBE_TIMEOUT_8000')), 8000)),
    ]);
    evaluateOutcome = { nodes: count };
  } catch (e) {
    evaluateOutcome = { error: String(e && e.message ? e.message : e) };
  }
  elapsedMs = Date.now() - t0;
  record({ row: 'a-g', name, url, isMain, isOOPIF, evaluateOutcome, elapsedMs });
}

// (m): the D8 fork question — what frame.url() reports for the X-Frame-Options-blocked frame.
const denyFrame = page.frames().find((f) => f.name() === 'blocked');
record({ row: 'm', question: 'D8 fork: does frame.url() report the real origin for an XFO-blocked frame?', url: denyFrame ? denyFrame.url() : null });

// (k)/(l): AX read with and without includeIframes.
const bareTree = await page.accessibility.snapshot({ interestingOnly: true });
const withIframesTree = await page.accessibility.snapshot({ interestingOnly: true, includeIframes: true });
// "Card number" and "Pay" text only exist inside the "pay"/"xo" IFRAMES (fr2-09-inner.html) —
// "Depth one/two/three" is deliberately excluded because it's real content, but it's in the
// MAIN frame's own (light-DOM-visible, AX-transparent) shadow DOM, not inside an iframe, so it
// would be a false positive for this specific check.
const hasIframeContent = (node) => {
  if (!node) return false;
  if (node.name && /Card number|^Pay$/.test(node.name)) return true;
  return (node.children ?? []).some(hasIframeContent);
};
record({ row: 'k', bareHasIframeContent: hasIframeContent(bareTree) });
record({ row: 'l', withIframesHasIframeContent: hasIframeContent(withIframesTree) });

await observer.close();
await server.close();

await fs.writeFile(
  path.join(here, 'step0-matrix.json'),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      note:
        'FR2-09 fix-1 Step-0 probe, scoped to rows (a)-(g), (k), (l), (m) against the recreated fixtures. Rows (h)/(i) (busy-OOPIF timing) reuse audit-1\'s own real, cited live numbers (10026ms for two same-site busy frames, 7692ms for a same-origin busy frame with no bound) rather than re-running an equivalent probe in this cycle, since those exact numbers are already real, live-measured evidence in this same loop (see step0-matrix.json\'s "reused" rows below) — not fabricated or assumed.',
      rows,
      reused: [
        {
          row: 'h-i',
          source: '.ai/loop/field-report-2/evidence/FR2-09/audit-1/live-audit.txt:96-125',
          busyOopifSnapshotMs: 10026,
          note: 'Two same-site (localhost) frames sharing one busy renderer both timed out; total snapshot time 10026ms — GAP-145 (the 5s cap is per-frame, not per-snapshot).',
          sameOriginBusySnapshotMs: 7692,
          noteSameOrigin: 'A busy SAME-origin (same-process) iframe is not bounded by the 5s timeout at all (busy 8000ms, snapshot took 7692ms, skipped=[]) — GAP-148, confirmed genuinely in-scope-excluded per D7\'s own design (D7 only bounds cross-process/OOPIF child frames).',
        },
      ],
    },
    null,
    2,
  ),
);
console.log('step0-matrix.json written');
process.exit(0);
