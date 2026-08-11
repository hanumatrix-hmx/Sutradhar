// Playwright-core harness: implements the identical 5 scenarios using raw Playwright, launched
// against the SAME system Chrome install Sutradhar uses (via executablePath), so this compares
// engine/API ergonomics and reliability, not "which browser build is faster".
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
import { FIXTURE_PATH, UPLOAD_FILE_PATH } from './scenarios.mjs';

const HEADLESS = process.env.HEADFUL !== '1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function withPage(fn) {
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME_PATH });
  try {
    const page = await browser.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function timed(id, title, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, engine: 'playwright', success: true, ms: Date.now() - start, detail: detail ?? null, error: null };
  } catch (err) {
    return { id, title, engine: 'playwright', success: false, ms: Date.now() - start, detail: null, error: err.message };
  }
}

async function scenarioLoginFlow() {
  return withPage(async (page) => {
    await page.goto('https://the-internet.herokuapp.com/login');
    await page.fill('#username', 'tomsmith');
    await page.fill('#password', 'SuperSecretPassword!');
    await page.click('button[type="submit"]');
    await page.waitForSelector('.flash.success', { timeout: 8000 });
    const loggedInText = (await page.textContent('.flash')).trim();
    if (!loggedInText.includes('You logged into a secure area')) {
      throw new Error(`unexpected post-login flash text: ${loggedInText}`);
    }
    await page.click('a[href="/logout"]');
    await page.waitForSelector('.flash.success', { timeout: 8000 });
    const loggedOutText = (await page.textContent('.flash')).trim();
    if (!loggedOutText.includes('You logged out')) {
      throw new Error(`unexpected post-logout flash text: ${loggedOutText}`);
    }
    return { loggedInText, loggedOutText };
  });
}

async function scenarioDynamicLoading() {
  return withPage(async (page) => {
    await page.goto('https://the-internet.herokuapp.com/dynamic_loading/2');
    await page.click('button');
    await page.waitForSelector('#finish h4', { timeout: 10000 });
    const text = (await page.textContent('#finish h4')).trim();
    if (text !== 'Hello World!') throw new Error(`unexpected finish text: ${text}`);
    return { text };
  });
}

async function scenarioFileUpload() {
  return withPage(async (page) => {
    await page.goto('https://the-internet.herokuapp.com/upload');
    await page.setInputFiles('#file-upload', UPLOAD_FILE_PATH);
    await page.click('#file-submit');
    await page.waitForSelector('#uploaded-files', { timeout: 8000 });
    const uploaded = (await page.textContent('#uploaded-files')).trim();
    if (!uploaded.includes('upload-payload.txt')) throw new Error(`upload not confirmed: ${uploaded}`);
    return { uploaded };
  });
}

async function scenarioLongCheckout() {
  return withPage(async (page) => {
    await page.goto('https://www.saucedemo.com/');
    await page.fill('#user-name', 'standard_user');
    await page.fill('#password', 'secret_sauce');
    await page.click('#login-button');
    await page.waitForSelector('.inventory_list', { timeout: 8000 });

    const items = ['sauce-labs-backpack', 'sauce-labs-bike-light', 'sauce-labs-bolt-t-shirt'];
    for (const item of items) {
      await page.click(`[data-test="add-to-cart-${item}"]`);
    }
    const cartCount = (await page.textContent('.shopping_cart_badge').catch(() => null)) ?? '0';
    if (cartCount !== '3') throw new Error(`expected 3 items in cart, got ${cartCount}`);

    await page.click('.shopping_cart_link');
    await page.waitForSelector('.cart_list', { timeout: 8000 });
    const cartItemCount = await page.locator('.cart_item').count();
    if (cartItemCount !== 3) throw new Error(`cart page shows ${cartItemCount} items, expected 3`);

    await page.click('[data-test="checkout"]');
    await page.waitForSelector('#first-name', { timeout: 8000 });
    await page.fill('#first-name', 'Ada');
    await page.fill('#last-name', 'Lovelace');
    await page.fill('#postal-code', '10001');
    await page.click('[data-test="continue"]');
    await page.waitForSelector('.summary_total_label', { timeout: 8000 });

    await page.click('[data-test="finish"]');
    await page.waitForSelector('.complete-header', { timeout: 8000 });
    const confirmation = (await page.textContent('.complete-header')).trim();
    if (!confirmation.includes('Thank you')) throw new Error(`unexpected confirmation text: ${confirmation}`);
    return { confirmation, cartCount, cartItemCount };
  });
}

async function scenarioLocalFixture() {
  return withPage(async (page) => {
    await page.goto(pathToFileURL(FIXTURE_PATH).href);

    // Shadow DOM: Playwright's own selectors pierce open shadow roots natively (no manual eval
    // needed) via its standard CSS engine — a genuine ergonomic difference from Sutradhar, which
    // needed an explicit eval() for this in the equivalent scenario.
    const shadowText = (await page.textContent('#shadow-host >> #shadow-text').catch(async () => {
      // Fallback in case piercing-combinator syntax isn't enabled for this Playwright version.
      return page.evaluate(() => document.getElementById('shadow-host').shadowRoot.getElementById('shadow-text').textContent);
    }))?.trim?.() ?? (await page.evaluate(() => document.getElementById('shadow-host').shadowRoot.getElementById('shadow-text').textContent.trim()));
    if (shadowText !== 'secret-shadow-value-42') throw new Error(`unexpected shadow text: ${shadowText}`);

    // Delayed content.
    await page.waitForSelector('#delayed-result', { timeout: 5000 });
    const delayedText = (await page.textContent('#delayed-result')).trim();
    if (delayedText !== 'delayed-value-ready') throw new Error(`unexpected delayed text: ${delayedText}`);

    // Iframe: Playwright requires explicitly getting the frame handle before interacting with
    // elements inside it — no automatic cross-frame selector resolution like Sutradhar's.
    const frame = page.frame('frame1') ?? page.frames().find((f) => f !== page.mainFrame());
    if (!frame) throw new Error('could not locate iframe #frame1');
    await frame.fill('#inner-input', 'hello-iframe');
    await frame.click('#inner-submit');
    await frame.waitForSelector('#inner-result', { timeout: 3000 });
    const iframeResult = (await frame.textContent('#inner-result')).trim();
    if (iframeResult !== 'submitted:hello-iframe') throw new Error(`unexpected iframe result: ${iframeResult}`);

    return { shadowText, delayedText, iframeResult };
  });
}

export async function runPlaywrightScenarios() {
  return [
    await timed('login-flow', 'Login + logout flow with dynamic flash-message verification', scenarioLoginFlow),
    await timed('dynamic-loading', 'Wait for AJAX-style delayed content, then extract it', scenarioDynamicLoading),
    await timed('file-upload', 'Upload a local file through a native file input', scenarioFileUpload),
    await timed('long-checkout', 'Long multi-step task: login -> add 3 items -> cart -> checkout -> confirm', scenarioLongCheckout),
    await timed('local-fixture', 'Shadow DOM text + delayed element + iframe form, all in one page', scenarioLocalFixture),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runPlaywrightScenarios();
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.success);
  process.exit(failed.length ? 1 : 0);
}
