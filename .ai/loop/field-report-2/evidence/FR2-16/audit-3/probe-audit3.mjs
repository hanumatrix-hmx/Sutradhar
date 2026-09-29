// FR2-16 audit-3 independent probe. Unlike fix-3's probe (raw puppeteer with a 2-flag arg list),
// this goes through Sutradhar's REAL BrowserLauncher / DEFAULT_LAUNCH_ARGS for the "with" case, and
// uses the exact same DEFAULT_LAUNCH_ARGS minus only the one flag for the "without" case, so the
// only difference between the two runs is that single flag.
// usage: node probe-audit3.mjs <repoRoot> <chromeExe>
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const [root, exe] = process.argv.slice(2);
const br = await import(pathToFileURL(root + '/packages/browser/dist/index.js').href);
const require = createRequire(root + '/packages/browser/package.json');
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default;
const FLAG = '--disable-blink-features=AutomationControlled';
const html = 'data:text/html,<p>x</p>';
const probe = (p) => p.evaluate(() => ({
  webdriver: navigator.webdriver,
  ua: navigator.userAgent,
  uaHasHeadlessChrome: navigator.userAgent.includes('HeadlessChrome'),
  uaDataBrands: navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand).join('|') : null,
}));

const launcher = new br.BrowserLauncher();
console.log('DEFAULT_LAUNCH_ARGS includes flag:', br.DEFAULT_LAUNCH_ARGS.includes(FLAG));
const sdArgs = launcher.prepareLaunchArgs({});
console.log('prepareLaunchArgs({}) includes flag:', sdArgs.includes(FLAG), '| argc', sdArgs.length);
console.log('prepareLaunchArgs({args:[]}) includes flag:', launcher.prepareLaunchArgs({ args: [] }).includes(FLAG));
console.log('prepareLaunchArgs({args:["--disable-blink-features=Foo"]}) =>',
  launcher.prepareLaunchArgs({ args: ['--disable-blink-features=Foo'] }).filter((a) => a.startsWith('--disable-blink-features')));

for (const headless of [true, false]) {
  // WITH: Sutradhar's real launcher
  const inst = await launcher.launch({ headless, executablePath: exe });
  const b = inst.puppeteerBrowser;
  const p = await b.newPage(); await p.goto(html);
  console.log(`[sutradhar launcher, headless=${headless}, flag PRESENT]`, JSON.stringify(await probe(p)));
  const execArgs = b.process()?.spawnargs ?? [];
  console.log('   spawned with --enable-automation:', execArgs.includes('--enable-automation'), '| with flag:', execArgs.includes(FLAG));
  await inst.close?.() ?? await b.close();

  // WITHOUT: identical args minus only the flag
  const argsNo = br.DEFAULT_LAUNCH_ARGS.filter((a) => a !== FLAG);
  const b2 = await puppeteer.launch({ executablePath: exe, headless, args: [...argsNo], defaultViewport: null });
  const p2 = await b2.newPage(); await p2.goto(html);
  console.log(`[same DEFAULT_LAUNCH_ARGS minus flag, headless=${headless}, flag ABSENT]`, JSON.stringify(await probe(p2)));
  await b2.close();
}

// Edge: caller passes a different --disable-blink-features value
const inst3 = await launcher.launch({ headless: true, executablePath: exe, args: ['--disable-blink-features=Foo'] });
const p3 = await inst3.puppeteerBrowser.newPage(); await p3.goto(html);
console.log('[sutradhar launcher, caller args --disable-blink-features=Foo]', JSON.stringify(await probe(p3)));
await inst3.puppeteerBrowser.close();
