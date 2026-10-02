// Child process for the FR2-14 live-verify: runs ONE SDK scenario against the built SDK bundle
// (FR214_SDK_INDEX = packages/sutradhar/dist/index.js) with the cwd the harness chose, and prints
// exactly one JSON line. It always closes its browser.
//   node fr2-14-sdk-probe.mjs <plain|discover|discover-override|explicit|both> [absConfigPath]
import { pathToFileURL } from 'node:url';

const [mode, arg] = process.argv.slice(2);
const port = process.env.FR214_PORT;
const out = { mode, innerWidth: null, navResults: {}, downloadPath: null, error: null };
let browser;
try {
  const { launch } = await import(pathToFileURL(process.env.FR214_SDK_INDEX).href);
  const opts =
    mode === 'plain' ? {}
    : mode === 'discover' ? { discoverConfig: true }
    : mode === 'discover-override' ? { discoverConfig: true, viewport: { width: 390, height: 844 }, allowedDomains: ['127.0.0.1'] }
    : mode === 'explicit' ? { configFile: arg }
    : mode === 'both' ? { configFile: 'x.json', discoverConfig: true }
    : (() => { throw new Error(`unknown mode ${mode}`); })();
  browser = await launch(opts);
  const page = await browser.newPage();
  for (const host of ['127.0.0.1', 'localhost']) {
    try {
      await page.goto(`http://${host}:${port}/page?n=sdk-${mode}-${host}`);
      out.navResults[host] = 'ok';
    } catch (e) {
      out.navResults[host] = `err:${String(e.message).slice(0, 160)}`;
    }
  }
  out.innerWidth = Number(await page.evaluate('innerWidth'));
  if (mode === 'discover' && out.navResults.localhost === 'ok') {
    const r = await page.download('#dl');
    out.downloadPath = r.path ?? r.downloadedPath ?? null;
  }
} catch (e) {
  out.error = String(e.message ?? e);
} finally {
  try { await browser?.close(); } catch { /* best effort */ }
}
console.log(JSON.stringify(out));
