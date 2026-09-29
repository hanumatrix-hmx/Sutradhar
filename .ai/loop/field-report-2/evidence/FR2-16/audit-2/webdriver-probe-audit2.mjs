// FR2-16 audit-2 probe: launch through Sutradhar's REAL built BrowserLauncher/DEFAULT_LAUNCH_ARGS
// and diff a broad page-visible fingerprint with vs without the AutomationControlled flag,
// to test (a) the webdriver claim and (b) whether the flag has ANY other observable effect.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const exe = process.argv[3];
const br = await import(pathToFileURL(root + '/packages/browser/dist/index.js').href);
const require = createRequire(root + '/packages/browser/package.json');
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')).href)).default;
const FLAG = '--disable-blink-features=AutomationControlled';
const launcher = new br.BrowserLauncher();
const realArgs = launcher.prepareLaunchArgs({});
console.log('prepareLaunchArgs({}) includes flag:', realArgs.includes(FLAG));
async function fp(args) {
  const b = await puppeteer.launch({ executablePath: exe, headless: true, args, defaultViewport: null });
  const p = await b.newPage();
  await p.goto('data:text/html,<p>x</p>');
  const r = await p.evaluate(() => {
    const nav = {};
    for (const k in navigator) { try { const v = navigator[k]; nav[k] = typeof v === 'function' ? 'fn' : (v && typeof v === 'object') ? Object.prototype.toString.call(v) : v; } catch (e) { nav[k] = 'ERR'; } }
    return { nav, winKeys: Object.getOwnPropertyNames(window).sort().join(','), chrome: typeof window.chrome, chromeKeys: window.chrome ? Object.keys(window.chrome).sort().join(',') : null,
      plugins: navigator.plugins.length, langs: navigator.languages.join(','), ua: navigator.userAgent };
  });
  const version = await b.version();
  await b.close();
  return { ...r, version };
}
const withF = await fp(realArgs);
const withoutF = await fp(realArgs.filter((a) => a !== FLAG));
console.log('version:', withF.version);
console.log('WITH flag    navigator.webdriver =', withF.nav.webdriver);
console.log('WITHOUT flag navigator.webdriver =', withoutF.nav.webdriver);
const diffs = [];
for (const k of new Set([...Object.keys(withF.nav), ...Object.keys(withoutF.nav)])) if (JSON.stringify(withF.nav[k]) !== JSON.stringify(withoutF.nav[k])) diffs.push(`navigator.${k}: with=${JSON.stringify(withF.nav[k])} without=${JSON.stringify(withoutF.nav[k])}`);
for (const k of ['winKeys', 'chrome', 'chromeKeys', 'plugins', 'langs', 'ua']) if (withF[k] !== withoutF[k]) diffs.push(`${k}: with=${String(withF[k]).slice(0,200)} without=${String(withoutF[k]).slice(0,200)}`);
console.log(`differences across ${Object.keys(withF.nav).length} navigator props + window keys/chrome/plugins/langs/UA: ${diffs.length}`);
for (const d of diffs) console.log('  DIFF', d);
