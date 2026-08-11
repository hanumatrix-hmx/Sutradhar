// PinchTab-engine harness: runs each comparison scenario through the real PinchTabRuntime
// (packages/capability-runtime), exercising the actual production API surface an MCP client
// or the autonomous agent would call — not a stripped-down reimplementation.
//
// IMPORTANT: PinchTab's action methods (click/type/waitForSelector/...) do NOT throw on
// failure — they return an ActionResult with `.success`/`.error`, by design (matching the
// codebase-wide "surface the error, don't fabricate success, but don't throw either" contract
// used across the agent loop). `must()` below adapts that into throw-on-failure so a scenario
// script reads the same as the Playwright version instead of silently plowing through a failed
// step and crashing many steps later on a null dereference.
import { pathToFileURL } from 'node:url';
import { PinchTabRuntime } from '../../packages/capability-runtime/dist/index.js';
import { FIXTURE_PATH, UPLOAD_FILE_PATH } from './scenarios.mjs';

const HEADLESS = process.env.HEADFUL !== '1';

async function must(promise) {
  const result = await promise;
  if (result && typeof result === 'object' && result.success === false) {
    throw new Error(`[${result.actionType ?? 'action'}] ${result.error ?? 'action failed'}`);
  }
  return result;
}

async function withRuntime(fn) {
  const runtime = new PinchTabRuntime({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
  let sessionId;
  try {
    const launched = await runtime.launch({ headless: HEADLESS });
    sessionId = launched.sessionId;
    if (!launched.hasRealBrowser) throw new Error('no real Chrome available for this run');
    return await fn(runtime, sessionId);
  } finally {
    if (sessionId) await runtime.shutdown(sessionId).catch(() => {});
  }
}

async function timed(id, title, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, engine: 'pinchtab', success: true, ms: Date.now() - start, detail: detail ?? null, error: null };
  } catch (err) {
    return { id, title, engine: 'pinchtab', success: false, ms: Date.now() - start, detail: null, error: err.message };
  }
}

async function scenarioLoginFlow() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, 'https://the-internet.herokuapp.com/login');
    await must(rt.type(sid, '#username', 'tomsmith'));
    await must(rt.type(sid, '#password', 'SuperSecretPassword!'));
    await must(rt.click(sid, 'button[type="submit"]'));
    await must(rt.waitForSelector(sid, '.flash.success', 8000));
    const loggedInText = await rt.eval(sid, "document.querySelector('.flash').textContent.trim()");
    if (!loggedInText.includes('You logged into a secure area')) {
      throw new Error(`unexpected post-login flash text: ${loggedInText}`);
    }
    await must(rt.clickByText(sid, 'Logout'));
    await must(rt.waitForSelector(sid, '.flash.success', 8000));
    const loggedOutText = await rt.eval(sid, "document.querySelector('.flash').textContent.trim()");
    if (!loggedOutText.includes('You logged out')) {
      throw new Error(`unexpected post-logout flash text: ${loggedOutText}`);
    }
    return { loggedInText, loggedOutText };
  });
}

async function scenarioDynamicLoading() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, 'https://the-internet.herokuapp.com/dynamic_loading/2');
    await must(rt.clickByText(sid, 'Start'));
    await must(rt.waitForSelector(sid, '#finish h4', 10000));
    const text = await rt.eval(sid, "document.querySelector('#finish h4').textContent.trim()");
    if (text !== 'Hello World!') throw new Error(`unexpected finish text: ${text}`);
    return { text };
  });
}

async function scenarioFileUpload() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, 'https://the-internet.herokuapp.com/upload');
    await must(rt.uploadFile(sid, '#file-upload', UPLOAD_FILE_PATH));
    await must(rt.click(sid, '#file-submit'));
    await must(rt.waitForSelector(sid, '#uploaded-files', 8000));
    const uploaded = await rt.eval(sid, "document.querySelector('#uploaded-files').textContent.trim()");
    if (!uploaded.includes('upload-payload.txt')) throw new Error(`upload not confirmed: ${uploaded}`);
    return { uploaded };
  });
}

async function scenarioLongCheckout() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, 'https://www.saucedemo.com/');
    await must(rt.type(sid, '#user-name', 'standard_user'));
    await must(rt.type(sid, '#password', 'secret_sauce'));
    await must(rt.click(sid, '#login-button'));
    await must(rt.waitForSelector(sid, '.inventory_list', 8000));

    const items = ['sauce-labs-backpack', 'sauce-labs-bike-light', 'sauce-labs-bolt-t-shirt'];
    for (const item of items) {
      await must(rt.click(sid, `[data-test="add-to-cart-${item}"]`));
    }
    const cartCount = await rt.eval(sid, "document.querySelector('.shopping_cart_badge')?.textContent ?? '0'");
    if (cartCount !== '3') throw new Error(`expected 3 items in cart, got ${cartCount}`);

    await must(rt.click(sid, '.shopping_cart_link'));
    await must(rt.waitForSelector(sid, '.cart_list', 8000));
    const cartItemCount = await rt.eval(sid, "document.querySelectorAll('.cart_item').length");
    if (cartItemCount !== 3) throw new Error(`cart page shows ${cartItemCount} items, expected 3`);

    await must(rt.click(sid, '[data-test="checkout"]'));
    await must(rt.waitForSelector(sid, '#first-name', 8000));
    await must(rt.type(sid, '#first-name', 'Ada'));
    await must(rt.type(sid, '#last-name', 'Lovelace'));
    await must(rt.type(sid, '#postal-code', '10001'));
    await must(rt.click(sid, '[data-test="continue"]'));
    await must(rt.waitForSelector(sid, '.summary_total_label', 8000));

    await must(rt.click(sid, '[data-test="finish"]'));
    await must(rt.waitForSelector(sid, '.complete-header', 8000));
    const confirmation = await rt.eval(sid, "document.querySelector('.complete-header').textContent.trim()");
    if (!confirmation.includes('Thank you')) throw new Error(`unexpected confirmation text: ${confirmation}`);
    return { confirmation, cartCount, cartItemCount };
  });
}

async function scenarioLocalFixture() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, pathToFileURL(FIXTURE_PATH).href);

    // Shadow DOM: pierce via eval (querySelectorAll alone can't reach into a shadow root).
    const shadowText = await rt.eval(
      sid,
      "document.getElementById('shadow-host').shadowRoot.getElementById('shadow-text').textContent.trim()",
    );
    if (shadowText !== 'secret-shadow-value-42') throw new Error(`unexpected shadow text: ${shadowText}`);

    // Delayed content: appears 1200ms after load — must actually wait, not just check immediately.
    await must(rt.waitForSelector(sid, '#delayed-result', 5000));
    const delayedText = await rt.eval(sid, "document.getElementById('delayed-result').textContent.trim()");
    if (delayedText !== 'delayed-value-ready') throw new Error(`unexpected delayed text: ${delayedText}`);

    // Iframe: PinchTab's selector resolution races across all frames automatically — no
    // explicit frame handle needed, unlike raw Puppeteer/Playwright.
    await must(rt.type(sid, '#inner-input', 'hello-iframe'));
    await must(rt.click(sid, '#inner-submit'));
    await must(rt.waitForSelector(sid, '#inner-result', 3000));
    const iframeResult = await rt.eval(sid, "document.getElementById('frame1').contentDocument.getElementById('inner-result').textContent.trim()");
    if (iframeResult !== 'submitted:hello-iframe') throw new Error(`unexpected iframe result: ${iframeResult}`);

    return { shadowText, delayedText, iframeResult };
  });
}

export async function runPinchTabScenarios() {
  return [
    await timed('login-flow', 'Login + logout flow with dynamic flash-message verification', scenarioLoginFlow),
    await timed('dynamic-loading', 'Wait for AJAX-style delayed content, then extract it', scenarioDynamicLoading),
    await timed('file-upload', 'Upload a local file through a native file input', scenarioFileUpload),
    await timed('long-checkout', 'Long multi-step task: login -> add 3 items -> cart -> checkout -> confirm', scenarioLongCheckout),
    await timed('local-fixture', 'Shadow DOM text + delayed element + iframe form, all in one page', scenarioLocalFixture),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runPinchTabScenarios();
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.success);
  process.exit(failed.length ? 1 : 0);
}
