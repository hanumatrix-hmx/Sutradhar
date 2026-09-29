// FR2-09 fix-2 — GAP-150 live verification: confirms the new frame.frameElement() lookup
// recovers a blocked (X-Frame-Options: DENY) frame's real intended src from the PARENT page's
// realm and uses it as the skipped-frame placeholder's origin/url, instead of Chrome's own
// unhelpful chrome-error:// value.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');

let fails = 0;
function check(name, ok, detail) {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

let P = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/deny') {
    res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' });
    return res.end('<button>Should never render</button>');
  }
  if (u.pathname === '/main.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><html><body>
<button>Top</button>
<iframe name="blocked" src="http://127.0.0.1:${P}/deny?secret=xyz"></iframe>
</body></html>`);
  }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
P = server.address().port;
const base = `http://127.0.0.1:${P}`;

const exe = new BrowserLauncher().findExecutablePath();
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-fix2-gap150-'));
const observer = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const opage = (await observer.pages())[0];
await opage.goto(`${base}/main.html?n=${Date.now()}`, { waitUntil: 'networkidle0' });

const rt = new SutradharRuntime();
const { sessionId } = await rt.attach({ endpoint: observer.wsEndpoint() });

try {
  const s1 = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
  console.log('--- listing ---\n' + s1.interactiveElements);
  console.log('--- skippedFrames ---\n' + JSON.stringify(s1.skippedFrames, null, 2));

  const skipped = s1.skippedFrames.find((f) => f.reason === 'error-page');
  check('a blocked frame was recorded as skipped (error-page)', !!skipped, skipped);
  check(
    'skipped frame url is the RECOVERED real src, not chrome-error://',
    !!skipped && skipped.url.startsWith(base) && skipped.url.includes('/deny'),
    skipped?.url,
  );
  check(
    'skipped frame origin is the real http(s) origin, not "chrome-error://"',
    !!skipped && skipped.origin === new URL(base).origin,
    skipped?.origin,
  );
  const line = s1.interactiveElements.split('\n').find((l) => l.includes('not inspectable'));
  check('placeholder text line shows the real origin, not chrome-error://', !!line && !line.includes('chrome-error'), line);
  check('placeholder text line includes the recovered frame name', !!line && line.includes('"blocked"'), line);

  // Ground truth: confirm Puppeteer's own frame.url() for this frame really is chrome-error://
  // (i.e. this isn't a vacuous check — the raw signal genuinely IS the unhelpful one).
  const rawUrls = opage.frames().map((f) => f.url());
  check('ground truth: Puppeteer\'s raw frame.url() for the blocked frame really is chrome-error://', rawUrls.some((u) => u.startsWith('chrome-error://')), rawUrls);
} finally {
  await observer.close();
  server.close();
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
