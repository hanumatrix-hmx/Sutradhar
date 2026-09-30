// Is a <iframe style="content-visibility:hidden"> actually painted? (decides whether the label "excluded" or the oracle is right)
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const repoRoot = process.argv[2];
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const HARD = setTimeout(() => process.exit(3), 100000);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-spike3-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile });
const p = await b.newPage(); await p.setViewport({ width: 400, height: 200 });
const frame = (style) => `<iframe style="position:absolute;left:0;top:0;width:200px;height:100px;border:0;${style}" srcdoc="<body style='margin:0;background:rgb(255,0,0)'>RED</body>"></iframe>`;
for (const [name, style] of [['plain', ''], ['content-visibility:hidden', 'content-visibility:hidden'], ['visibility:hidden', 'visibility:hidden'], ['display:none', 'display:none']]) {
  await p.setContent(`<body style="margin:0;background:rgb(0,0,255)">${frame(style)}</body>`);
  await new Promise((r) => setTimeout(r, 300));
  const png = await p.screenshot({ type: 'png', clip: { x: 10, y: 10, width: 4, height: 4 }, encoding: 'base64' });
  const { PNG } = await import('node:zlib').then(() => ({}));
  const shot = await p.evaluate(() => 1);
  // decode by drawing? simpler: compare with a blue-only screenshot via base64 equality
  console.log(name, png.length);
  await fs.writeFile(path.join(process.env.TMPDIR ?? os.tmpdir(), 'spike3-' + name.replace(/[^a-z]/g, '') + '.b64'), png);
}
const files = {};
for (const n of ['plain', 'contentvisibilityhidden', 'visibilityhidden', 'displaynone']) files[n] = await fs.readFile(path.join(process.env.TMPDIR ?? os.tmpdir(), 'spike3-' + n + '.b64'), 'utf8');
console.log('cv:hidden looks like plain (RED painted)?', files.contentvisibilityhidden === files.plain, '| looks like display:none (BLUE only)?', files.contentvisibilityhidden === files.displaynone);
console.log('visibility:hidden looks like display:none?', files.visibilityhidden === files.displaynone, '| plain vs displaynone differ?', files.plain !== files.displaynone);
await b.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); clearTimeout(HARD); process.exit(0);
