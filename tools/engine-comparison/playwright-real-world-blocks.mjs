// Does real Playwright (not the puppeteer-core proxy used in Milestone 16) fare any
// differently than Sutradhar against the exact real-world anti-bot walls the WebBench
// benchmark samples hit? Uses Playwright's own default chromium.launch() -- no stealth
// plugins, no custom fingerprinting, the same "plain default launch" standard Milestone 16
// held Sutradhar/puppeteer-core to. See .ai/competitive-benchmarks.md for how this feeds in.
import { chromium } from 'playwright-core';

const targets = [
  // Blocked Sutradhar via Cloudflare JS challenge (samples 2, 5)
  { name: 'britannica.com', url: 'https://www.britannica.com/place/Mount-Everest' },
  { name: 'collinsdictionary.com', url: 'https://www.collinsdictionary.com/' },
  { name: 'cambridge.org', url: 'https://dictionary.cambridge.org/dictionary/english/ubiquitous' },
  // Blocked Sutradhar via hard Cloudflare deny (sample 3)
  { name: 'cars.com', url: 'https://www.cars.com/shopping/results/?stock_type=used&makes[]=toyota&models[]=toyota-camry&year_min=2020&year_max=2020&zip=75201&maximum_distance=50' },
  // Blocked Sutradhar via real CAPTCHA (sample 3)
  { name: 'alibaba.com', url: 'https://www.alibaba.com/trade/search?SearchText=smartphones' },
  // Blocked Sutradhar via real hCaptcha (sample 5)
  { name: 'apa.org', url: 'https://www.apa.org/search?query=cognitive+behavioral+therapy' },
];

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});

for (const t of targets) {
  const page = await browser.newPage();
  try {
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
    console.log(`\n=== ${t.name} (Playwright) ===`);
    console.log('title:', title);
    console.log('body snippet:', bodyText.replace(/\s+/g, ' ').trim());
  } catch (err) {
    console.log(`\n=== ${t.name} (Playwright) ===`);
    console.log('ERROR:', err.message);
  } finally {
    await page.close();
  }
}

await browser.close();
