// Audit probe: what does --disable-blink-features=AutomationControlled actually change?
import { createRequire } from 'node:module';
const require = createRequire(process.argv[2] + '/package.json');
const { pathToFileURL } = await import('node:url');
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default;
const exe = process.argv[3];
for (const withFlag of [true, false]) {
  const args = ['--no-sandbox', '--headless=new'];
  if (withFlag) args.push('--disable-blink-features=AutomationControlled');
  const b = await puppeteer.launch({ executablePath: exe, args, headless: true });
  const p = await b.newPage();
  await p.goto('data:text/html,<p>x</p>');
  const r = await p.evaluate(() => ({ webdriver: navigator.webdriver, hasProp: 'webdriver' in navigator }));
  console.log(`flag=${withFlag ? 'present' : 'absent '} navigator.webdriver=${r.webdriver} ('webdriver' in navigator=${r.hasProp})`);
  await b.close();
}
