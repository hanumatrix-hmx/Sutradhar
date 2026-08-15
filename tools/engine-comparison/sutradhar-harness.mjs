// Sutradhar harness: implements the identical 5 scenarios from scenarios.mjs, using
// SutradharRuntime directly (not the MCP layer, to avoid measuring protocol/host-AI round-trip
// overhead on top of the engine itself — the fairest comparison against the other three
// harnesses, which are also direct Node scripts with no LLM in the loop). Drives against the
// same auto-detected system Chrome the other harnesses point at explicitly.
import { SutradharRuntime } from '../../packages/capability-runtime/dist/index.js';
import { FIXTURE_PATH, UPLOAD_FILE_PATH } from './scenarios.mjs';
import { pathToFileURL } from 'node:url';

const HEADLESS = process.env.HEADFUL !== '1';
const runtime = new SutradharRuntime({ logger: { info() {}, warn() {}, error() {}, debug() {} } });

async function withSession(fn) {
  const { sessionId } = await runtime.launch({ headless: HEADLESS });
  try {
    return await fn(sessionId);
  } finally {
    await runtime.shutdown(sessionId).catch(() => {});
  }
}

async function timed(id, title, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, engine: 'sutradhar', success: true, ms: Date.now() - start, detail: detail ?? null, error: null };
  } catch (err) {
    return { id, title, engine: 'sutradhar', success: false, ms: Date.now() - start, detail: null, error: err.message };
  }
}

function assertSuccess(result, label) {
  if (!result.success) throw new Error(`${label} failed: ${result.error}`);
  return result;
}

async function scenarioLoginFlow() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/login');
    assertSuccess(await runtime.type(sid, '#username', 'tomsmith'), 'type username');
    assertSuccess(await runtime.type(sid, '#password', 'SuperSecretPassword!'), 'type password');
    assertSuccess(await runtime.click(sid, 'button[type="submit"]'), 'submit login');
    assertSuccess(await runtime.waitForSelector(sid, '.flash.success', 8000), 'wait for login flash');
    const loggedInText = (await runtime.eval(sid, `document.querySelector('.flash').textContent.trim()`)).trim();
    if (!loggedInText.includes('You logged into a secure area')) {
      throw new Error(`unexpected post-login flash text: ${loggedInText}`);
    }
    assertSuccess(await runtime.click(sid, 'a[href="/logout"]'), 'logout');
    assertSuccess(await runtime.waitForSelector(sid, '.flash.success', 8000), 'wait for logout flash');
    const loggedOutText = (await runtime.eval(sid, `document.querySelector('.flash').textContent.trim()`)).trim();
    if (!loggedOutText.includes('You logged out')) {
      throw new Error(`unexpected post-logout flash text: ${loggedOutText}`);
    }
    return { loggedInText, loggedOutText };
  });
}

async function scenarioDynamicLoading() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/dynamic_loading/2');
    assertSuccess(await runtime.click(sid, 'button'), 'start');
    assertSuccess(await runtime.waitForSelector(sid, '#finish h4', 10000), 'wait for finish');
    const text = (await runtime.eval(sid, `document.querySelector('#finish h4').textContent.trim()`)).trim();
    if (text !== 'Hello World!') throw new Error(`unexpected finish text: ${text}`);
    return { text };
  });
}

async function scenarioFileUpload() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://the-internet.herokuapp.com/upload');
    assertSuccess(await runtime.uploadFile(sid, '#file-upload', UPLOAD_FILE_PATH), 'upload file');
    assertSuccess(await runtime.click(sid, '#file-submit'), 'submit upload');
    assertSuccess(await runtime.waitForSelector(sid, '#uploaded-files', 8000), 'wait for upload result');
    const uploaded = (await runtime.eval(sid, `document.querySelector('#uploaded-files').textContent.trim()`)).trim();
    if (!uploaded.includes('upload-payload.txt')) throw new Error(`upload not confirmed: ${uploaded}`);
    return { uploaded };
  });
}

async function scenarioLongCheckout() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, 'https://www.saucedemo.com/');
    assertSuccess(await runtime.type(sid, '#user-name', 'standard_user'), 'type username');
    assertSuccess(await runtime.type(sid, '#password', 'secret_sauce'), 'type password');
    assertSuccess(await runtime.click(sid, '#login-button'), 'login');
    assertSuccess(await runtime.waitForSelector(sid, '.inventory_list', 8000), 'wait for inventory');

    const items = ['sauce-labs-backpack', 'sauce-labs-bike-light', 'sauce-labs-bolt-t-shirt'];
    for (const item of items) {
      assertSuccess(await runtime.click(sid, `[data-test="add-to-cart-${item}"]`), `add ${item}`);
    }
    const cartCount = await runtime.eval(sid, `document.querySelector('.shopping_cart_badge')?.textContent ?? '0'`);
    if (cartCount !== '3') throw new Error(`expected 3 items in cart, got ${cartCount}`);

    assertSuccess(await runtime.click(sid, '.shopping_cart_link'), 'open cart');
    assertSuccess(await runtime.waitForSelector(sid, '.cart_list', 8000), 'wait for cart');
    const cartItemCount = await runtime.eval(sid, `document.querySelectorAll('.cart_item').length`);
    if (cartItemCount !== 3) throw new Error(`cart page shows ${cartItemCount} items, expected 3`);

    assertSuccess(await runtime.click(sid, '[data-test="checkout"]'), 'checkout');
    assertSuccess(await runtime.waitForSelector(sid, '#first-name', 8000), 'wait for checkout form');
    assertSuccess(await runtime.type(sid, '#first-name', 'Ada'), 'type first name');
    assertSuccess(await runtime.type(sid, '#last-name', 'Lovelace'), 'type last name');
    assertSuccess(await runtime.type(sid, '#postal-code', '10001'), 'type postal code');
    assertSuccess(await runtime.click(sid, '[data-test="continue"]'), 'continue');
    assertSuccess(await runtime.waitForSelector(sid, '.summary_total_label', 8000), 'wait for summary');

    assertSuccess(await runtime.click(sid, '[data-test="finish"]'), 'finish');
    assertSuccess(await runtime.waitForSelector(sid, '.complete-header', 8000), 'wait for confirmation');
    const confirmation = (await runtime.eval(sid, `document.querySelector('.complete-header').textContent.trim()`)).trim();
    if (!confirmation.includes('Thank you')) throw new Error(`unexpected confirmation text: ${confirmation}`);
    return { confirmation, cartCount, cartItemCount };
  });
}

async function scenarioLocalFixture() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, pathToFileURL(FIXTURE_PATH).href);

    // Shadow DOM: Sutradhar's selectors don't pierce shadow roots automatically, needs an
    // explicit eval — a genuine ergonomic difference from Playwright's piercing-combinator
    // selectors, noted the same way in that harness's own comments.
    const shadowText = (
      await runtime.eval(sid, `document.getElementById('shadow-host').shadowRoot.getElementById('shadow-text').textContent`)
    ).trim();
    if (shadowText !== 'secret-shadow-value-42') throw new Error(`unexpected shadow text: ${shadowText}`);

    assertSuccess(await runtime.waitForSelector(sid, '#delayed-result', 5000), 'wait for delayed content');
    const delayedText = (await runtime.eval(sid, `document.querySelector('#delayed-result').textContent.trim()`)).trim();
    if (delayedText !== 'delayed-value-ready') throw new Error(`unexpected delayed text: ${delayedText}`);

    // Iframe: Sutradhar's click/type resolve selectors across same-origin iframes automatically
    // (no explicit frame handle needed, unlike Playwright's harness) via its DOM semantic engine.
    assertSuccess(await runtime.type(sid, '#inner-input', 'hello-iframe'), 'type in iframe');
    assertSuccess(await runtime.click(sid, '#inner-submit'), 'submit iframe form');
    assertSuccess(await runtime.waitForSelector(sid, '#inner-result', 3000), 'wait for iframe result');
    const iframeResult = (await runtime.eval(sid, `document.querySelector('#inner-result')?.textContent?.trim() ?? document.getElementById('frame1').contentDocument.getElementById('inner-result').textContent.trim()`)).trim();
    if (iframeResult !== 'submitted:hello-iframe') throw new Error(`unexpected iframe result: ${iframeResult}`);

    return { shadowText, delayedText, iframeResult };
  });
}

export async function runSutradharScenarios() {
  return [
    await timed('login-flow', 'Login + logout flow with dynamic flash-message verification', scenarioLoginFlow),
    await timed('dynamic-loading', 'Wait for AJAX-style delayed content, then extract it', scenarioDynamicLoading),
    await timed('file-upload', 'Upload a local file through a native file input', scenarioFileUpload),
    await timed('long-checkout', 'Long multi-step task: login -> add 3 items -> cart -> checkout -> confirm', scenarioLongCheckout),
    await timed('local-fixture', 'Shadow DOM text + delayed element + iframe form, all in one page', scenarioLocalFixture),
  ];
}

const results = await runSutradharScenarios();
console.log(JSON.stringify(results, null, 2));
