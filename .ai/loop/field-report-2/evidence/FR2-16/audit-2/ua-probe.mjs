// With Sutradhar's real default launch (headless, DEFAULT_LAUNCH_ARGS), what does a simple script see?
import { pathToFileURL } from 'node:url';
const br = await import(pathToFileURL(process.argv[2] + '/packages/browser/dist/index.js').href);
const inst = await new br.BrowserLauncher().launch({ executablePath: process.argv[3] });
const b = inst.puppeteerBrowser; const p = await b.newPage();
await p.goto('data:text/html,<p>x</p>');
console.log(JSON.stringify(await p.evaluate(() => ({ webdriver: navigator.webdriver, ua: navigator.userAgent, headlessInUA: /HeadlessChrome/.test(navigator.userAgent) }))));
await b.close();
