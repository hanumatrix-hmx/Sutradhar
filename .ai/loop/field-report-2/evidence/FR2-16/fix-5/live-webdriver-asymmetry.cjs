const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [process.cwd()] }));
const { DEFAULT_LAUNCH_ARGS } = require(path.join(process.cwd(), 'dist', 'launcher', 'browser-options.js'));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
(async () => {
  for (const [label, args] of [['vanilla puppeteer (as pp-server.mjs benchmark)', []], ['Sutradhar DEFAULT_LAUNCH_ARGS', [...DEFAULT_LAUNCH_ARGS]]]) {
    const b = await puppeteer.launch({ headless: true, executablePath: CHROME, args });
    const p = await b.newPage();
    const wd = await p.evaluate(() => navigator.webdriver);
    const ua = await b.userAgent();
    const cdp = await p.createCDPSession();
    const { arguments: argv } = await cdp.send('Browser.getBrowserCommandLine');
    console.log(`${label}: navigator.webdriver=${wd} | UA has HeadlessChrome=${/HeadlessChrome/.test(ua)} | --enable-automation in cmdline=${argv.includes('--enable-automation')} | --disable-infobars=${argv.includes('--disable-infobars')}`);
    await b.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
