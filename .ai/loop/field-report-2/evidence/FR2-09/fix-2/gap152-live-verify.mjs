// FR2-09 fix-2 — GAP-152 live verification: confirms the corrected fr2-09-frames.html fixture's
// hostile frame name (a static, HTML-entity-encoded `name` attribute) actually reaches
// Puppeteer's real frame.name(), unlike the previous JS-property-assignment version (which
// Step 0 recorded as falling back to the element's id, "evil-frame").
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');

let fails = 0;
function check(name, ok, detail) {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

const fixturePath = path.join(repo, 'tools/scenario-suite/fixtures/fr2-09-frames.html');
let html = await fs.readFile(fixturePath, 'utf8');

let P = 0;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/fr2-09-frames.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(html.replace(/\/fr2-09-inner\.html\?role=(\w+)/g, (m, r) => `data:text/html,<button>${r}</button>`).replace('/xfo-deny', 'data:text/html,x'));
  }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
P = server.address().port;

const exe = new BrowserLauncher().findExecutablePath();
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const page = (await browser.pages())[0];
await page.goto(`http://127.0.0.1:${P}/fr2-09-frames.html`, { waitUntil: 'networkidle0' });

try {
  const names = page.frames().map((f) => f.name());
  console.log('--- all frame names ---\n' + JSON.stringify(names, null, 2));

  const expectedRaw = 'evil"]\n[#1] button "Pay';
  const found = names.find((n) => n === expectedRaw);
  check('the hostile frame name reaches frame.name() as the RAW, unescaped string (quote, bracket, newline, hash intact)', found === expectedRaw, found);
  check('the STALE fallback ("evil-frame", the old bug\'s symptom) is NOT what frame.name() reports', !names.includes('evil-frame'), names);
} finally {
  await browser.close();
  server.close();
}

console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
