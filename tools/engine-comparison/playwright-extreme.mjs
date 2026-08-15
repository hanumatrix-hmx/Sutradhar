// Playwright vs. the 7 "genuinely hard" real-world extreme scenarios — see extreme-scenarios.mjs
// for the shared scenario definitions/sourcing. Same pattern as playwright-hard.mjs: launched
// against the same system Chrome install, timed() wrapper, honest detail objects.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;
const HEADLESS = process.env.HEADFUL !== '1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function withPage(fn, opts = {}) {
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, ...opts });
    return await fn(page, browser);
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

async function scenarioNestedShadowIframe() {
  return withPage(async (page) => {
    await page.goto(fx('nested-shadow-in-iframe.html'));

    const frame = page.frameLocator('#nested-frame');
    // Playwright's locator engine natively pierces open shadow roots when you keep chaining
    // locator() calls through the custom element — no manual eval needed, in principle.
    const input = frame.locator('nested-widget').locator('#nested-input');
    const submit = frame.locator('nested-widget').locator('#nested-submit');
    const result = frame.locator('nested-widget').locator('#nested-result');

    await input.fill('hello-nested');
    await submit.click();
    const resultText = await result.textContent();
    if (resultText !== 'submitted:hello-nested') throw new Error(`unexpected result: ${resultText}`);
    return { resultText, approach: 'frameLocator() + chained locator() through custom element shadow root (worked natively)' };
  });
}

async function scenarioRichTextEditor() {
  return withPage(async (page) => {
    await page.goto('https://prosemirror.net/examples/basic/', { waitUntil: 'domcontentloaded' });
    const editor = page.locator('.ProseMirror').first();
    await editor.waitFor({ state: 'visible', timeout: 15000 });

    // Playwright's own open issue (#39492) documents fill() being unreliable on contenteditable
    // — first confirm that, then use the documented-correct workaround: click + keyboard.type().
    let fillWorked = false;
    let fillError = null;
    const beforeFillText = (await editor.textContent())?.trim() ?? '';
    try {
      await editor.fill('fill-attempt-text', { timeout: 3000 });
      const afterFillText = (await editor.textContent())?.trim() ?? '';
      fillWorked = afterFillText.includes('fill-attempt-text');
    } catch (err) {
      fillError = err.message.split('\n')[0];
    }

    // Reset the editor to a clean state, then do it the correct way.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const editor2 = page.locator('.ProseMirror').first();
    await editor2.waitFor({ state: 'visible', timeout: 15000 });
    await editor2.click();
    // Select-all + delete any pre-existing example content, then type real text.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    const sentence = 'Sutradhar wrote this real sentence into a real ProseMirror editor.';
    await page.keyboard.type(sentence, { delay: 15 });
    const finalText = (await editor2.textContent())?.trim() ?? '';
    const typedTextPresent = finalText.includes(sentence);
    if (!typedTextPresent) throw new Error(`keyboard.type() text not found in editor. finalText=${JSON.stringify(finalText)}`);

    return {
      fillApproach: { fillWorked, fillError, beforeFillText },
      keyboardTypeApproach: { finalText, typedTextPresent },
    };
  });
}

async function scenarioCustomDragDrop() {
  return withPage(async (page) => {
    await page.goto(fx('dnd-custom-pointer.html'));

    // First: try the high-level dragAndDrop() API, built around HTML5 DnD events, and confirm
    // it does nothing on a page that only listens for real mouse events.
    let highLevelResult = null;
    let highLevelError = null;
    try {
      await page.dragAndDrop('#card', '#target', { timeout: 3000 });
      highLevelResult = (await page.textContent('#pointer-dnd-result'))?.trim() ?? null;
    } catch (err) {
      highLevelError = err.message.split('\n')[0];
      highLevelResult = (await page.textContent('#pointer-dnd-result').catch(() => null))?.trim?.() ?? null;
    }

    // Reset the page (drag might have partially altered DOM/class state) before the real attempt.
    await page.reload();

    // Second: real mouse.move/down/move.../up sequence.
    const cardBox = await page.locator('#card').boundingBox();
    const targetBox = await page.locator('#target').boundingBox();
    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      await page.mouse.move(x, y);
      await page.waitForTimeout(10);
    }
    await page.mouse.up();

    const manualResult = (await page.textContent('#pointer-dnd-result'))?.trim() ?? null;
    if (manualResult !== 'dropped:card-in-target') {
      throw new Error(`manual mouse sequence failed too. highLevel=${highLevelResult} manual=${manualResult}`);
    }

    return {
      highLevelDragAndDropApi: { result: highLevelResult, error: highLevelError, worked: highLevelResult === 'dropped:card-in-target' },
      manualMouseSequence: { result: manualResult, worked: true },
    };
  });
}

async function scenarioCrossOriginIframe() {
  return withPage(async (page) => {
    await page.goto(fx('cross-origin-iframe.html'));
    const frame = page.frameLocator('#cross-origin-frame');
    const heading = frame.locator('h1');
    await heading.waitFor({ state: 'visible', timeout: 10000 });
    const text = (await heading.textContent())?.trim() ?? null;
    if (text !== 'Example Domain') throw new Error(`unexpected heading text: ${text}`);
    return { text };
  });
}

async function scenarioCaptchaDetection() {
  return withPage(async (page) => {
    await page.goto('https://demo.turnstile.workers.dev/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Turnstile renders its widget inside an iframe whose src is on challenges.cloudflare.com
    // and whose title typically mentions "Widget containing a Cloudflare security challenge".
    await page.waitForTimeout(3000); // give the widget script time to inject its iframe
    const frames = page.frames();
    const turnstileFrames = frames.filter((f) => /challenges\.cloudflare\.com/.test(f.url()));
    const detected = turnstileFrames.length > 0;

    let widgetTitle = null;
    if (detected) {
      const el = await page.$('iframe[src*="challenges.cloudflare.com"]');
      widgetTitle = el ? await el.getAttribute('title') : null;
    }

    if (!detected) throw new Error('no challenges.cloudflare.com iframe found — Turnstile widget not detected');
    return { detected, turnstileFrameCount: turnstileFrames.length, widgetTitle, sampleFrameUrl: turnstileFrames[0]?.url() ?? null };
  });
}

async function scenarioLargeDom() {
  return withPage(async (page) => {
    await page.goto('https://the-internet.herokuapp.com/large', { waitUntil: 'domcontentloaded' });
    const cellText = (await page.textContent('.row-50 .column-1'))?.trim() ?? null;

    const snapStart = Date.now();
    let snapshot;
    let snapshotError = null;
    try {
      snapshot = await page.locator('body').ariaSnapshot();
    } catch (err) {
      snapshotError = err.message.split('\n')[0];
      snapshot = null;
    }
    const snapshotMs = Date.now() - snapStart;
    const snapshotChars = snapshot ? snapshot.length : null;

    if (!cellText) throw new Error('could not extract .row-50 .column-1 text');
    return { cellText, snapshotMs, snapshotChars, snapshotError };
  });
}

async function scenarioConcurrencyStress() {
  const N = 5;
  const runOne = async (idx) => {
    const start = Date.now();
    const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME_PATH });
    try {
      const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
      const page = await context.newPage();
      await page.goto('https://the-internet.herokuapp.com/login', { timeout: 20000 });
      await page.fill('#username', 'tomsmith');
      await page.fill('#password', 'SuperSecretPassword!');
      await page.click('button[type="submit"]');
      await page.waitForSelector('.flash.success', { timeout: 10000 });
      const text = (await page.textContent('.flash'))?.trim() ?? '';
      const success = text.includes('You logged into a secure area');
      return { idx, success, ms: Date.now() - start, text };
    } catch (err) {
      return { idx, success: false, ms: Date.now() - start, error: err.message.split('\n')[0] };
    } finally {
      await browser.close();
    }
  };

  const results = await Promise.all(Array.from({ length: N }, (_, i) => runOne(i)));
  const successCount = results.filter((r) => r.success).length;
  const timings = results.map((r) => r.ms);
  const min = Math.min(...timings);
  const max = Math.max(...timings);
  const avg = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);

  return { successCount, total: N, min, max, avg, perSession: results };
}

export async function runExtremeScenarios() {
  return [
    await timed('nested-shadow-iframe', 'Open shadow root nested inside a same-origin iframe', scenarioNestedShadowIframe),
    await timed('rich-text-editor', 'Real ProseMirror contenteditable editor', scenarioRichTextEditor),
    await timed('custom-drag-drop', 'Custom pointer-based drag (no native HTML5 DnD)', scenarioCustomDragDrop),
    await timed('cross-origin-iframe', 'Genuinely cross-origin iframe (example.com)', scenarioCrossOriginIframe),
    await timed('captcha-detection', 'Real Cloudflare Turnstile challenge widget detection', scenarioCaptchaDetection),
    await timed('large-dom', 'Large table: 13 columns x 50 rows, deep real DOM', scenarioLargeDom),
    await timed('concurrency-stress', '5 concurrent sessions running the same login-flow scenario', scenarioConcurrencyStress),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runExtremeScenarios();
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.success);
  process.exit(failed.length ? 1 : 0);
}
