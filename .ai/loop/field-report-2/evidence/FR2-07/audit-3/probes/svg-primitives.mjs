// Raw Chrome: what the platform primitives the contract relies on report for <text> inside SVG non-rendering containers.
import { createRequire } from 'node:module'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { pathToFileURL } from 'node:url';
const WT = process.cwd(); const req = createRequire(path.join(WT, 'packages/browser/package.json')); const puppeteer = req('puppeteer-core');
const exe = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(path.join(WT, 'packages/browser/dist/index.js')).href)}).then(m=>console.log(new m.BrowserLauncher().findExecutablePath()))`], { encoding: 'utf8' }).stdout.trim();
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
console.log('chrome pid', b.process()?.pid, await b.version());
const p = await b.newPage();
await p.setContent(`<svg width="600" height="300"><defs><text id="a" x="0" y="40">DEFS</text></defs><symbol><text id="b" x="0" y="40">SYM</text></symbol><mask><text id="c">MASK</text></mask><text id="v" x="0" y="80">VISIBLE</text></svg><div style="display:none"><span id="n">NONE</span></div>`);
console.log(JSON.stringify(await p.evaluate(() => ['a', 'b', 'c', 'v', 'n'].map((id) => { const e = document.getElementById(id); const r = document.createRange(); r.selectNodeContents(e.firstChild); const rs = Array.from(r.getClientRects()).map((x) => [Math.round(x.width), Math.round(x.height)]); return { id, rects: rs, vis: getComputedStyle(e).visibility, checkVisibility: e.checkVisibility(), inInnerText: document.body.innerText.includes(e.textContent) }; })), null, 0));
await b.close();
