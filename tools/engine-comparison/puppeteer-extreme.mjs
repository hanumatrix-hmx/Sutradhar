// Raw puppeteer-core vs. the 7 "extreme" real-world hard scenarios (see extreme-scenarios.mjs).
// Puppeteer has no official AI-agent grounding layer -- this uses its honest, real capability
// surface: raw CSS selectors, page.evaluate()/evaluateHandle(), page.frames(), page.mouse.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;
const HEADLESS = process.env.HEADFUL !== '1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const LIST_SCRIPT = `(() => {
  const els = Array.from(document.querySelectorAll('a, button, input, select, textarea'));
  return els.filter(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).slice(0, 120).map((el, i) => {
    el.setAttribute('data-pp-idx', String(i));
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || undefined,
      text: (el.innerText || el.value || el.placeholder || '').trim().slice(0, 80),
      href: el.tagName === 'A' ? el.href : undefined,
    };
  });
})()`;

async function withBrowser(fn) {
  const browser = await puppeteer.launch({ headless: HEADLESS, executablePath: CHROME_PATH });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function withPage(fn) {
  return withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 700 });
    return await fn(page);
  });
}

async function timed(id, title, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    return { id, title, engine: 'puppeteer', success: true, ms: Date.now() - start, detail: detail ?? null, error: null };
  } catch (err) {
    return { id, title, engine: 'puppeteer', success: false, ms: Date.now() - start, detail: null, error: err.message };
  }
}

// --- 1. nested-shadow-iframe ---------------------------------------------------------------
async function scenarioNestedShadowIframe() {
  return withPage(async (page) => {
    await page.goto(fx('nested-shadow-in-iframe.html'));

    // Puppeteer has NO automatic piercing-combinator locator (Playwright's `>>>`). The real
    // working path: get the iframe's own Frame object via page.frames(), then reach into the
    // shadow root manually with evaluateHandle inside that frame's context. There is no
    // higher-level helper for "type into a selector inside a shadow root inside a frame" --
    // this is a hand-rolled workaround, not a first-class API.
    const frame = page.frames().find((f) => f !== page.mainFrame());
    if (!frame) throw new Error('could not locate nested iframe via page.frames()');

    // Wait for the custom element + its shadow root to exist inside the frame.
    await frame.waitForFunction(() => {
      const el = document.querySelector('nested-widget');
      return !!(el && el.shadowRoot);
    });

    const inputHandle = await frame.evaluateHandle(() =>
      document.querySelector('nested-widget').shadowRoot.getElementById('nested-input'),
    );
    await inputHandle.type('hello-nested');

    const buttonHandle = await frame.evaluateHandle(() =>
      document.querySelector('nested-widget').shadowRoot.getElementById('nested-submit'),
    );
    await buttonHandle.click();

    const result = await frame.evaluate(() =>
      document.querySelector('nested-widget').shadowRoot.getElementById('nested-result').textContent,
    );
    if (result !== 'submitted:hello-nested') throw new Error(`unexpected result: ${result}`);
    return {
      result,
      note:
        'No built-in piercing selector -- required manually finding the Frame via page.frames(), ' +
        'then evaluateHandle() into the shadow root by hand. Workaround, not a clean built-in path.',
    };
  });
}

// --- 2. rich-text-editor ---------------------------------------------------------------------
async function scenarioRichTextEditor() {
  return withPage(async (page) => {
    await page.goto('https://prosemirror.net/examples/basic/', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.ProseMirror', { timeout: 15000 });
    await page.click('.ProseMirror');
    // Real ProseMirror starts with example content already in the doc -- select-all + type to
    // replace it, so the readback below is unambiguous rather than appended-after-existing-text.
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    const typedText = 'Sutradhar puppeteer-extreme probe sentence 12345';
    await page.keyboard.type(typedText, { delay: 15 });

    const actualText = await page.$eval('.ProseMirror', (el) => el.innerText.trim());
    const landed = actualText.includes(typedText);
    if (!landed) throw new Error(`typed text not found in editor content; actual="${actualText}"`);
    return { typedText, actualText, landed };
  });
}

// --- 3. custom-drag-drop ----------------------------------------------------------------------
async function scenarioCustomDragDrop() {
  return withPage(async (page) => {
    await page.goto(fx('dnd-custom-pointer.html'));
    const card = await page.$('#card');
    const target = await page.$('#target');
    const cardBox = await card.boundingBox();
    const targetBox = await target.boundingBox();
    if (!cardBox || !targetBox) throw new Error('could not compute bounding boxes');

    const startX = cardBox.x + cardBox.width / 2;
    const startY = cardBox.y + cardBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + targetBox.height / 2;

    // Puppeteer's own docs recommend exactly this for non-native DnD: manual
    // move -> down -> multiple intermediate moves -> up. No high-level dragAndDrop() helper
    // works here since it targets HTML5 dragstart/dragover/drop, which this page never fires.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      await page.mouse.move(x, y);
      await new Promise((r) => setTimeout(r, 10));
    }
    await page.mouse.up();

    const result = await page.$eval('#pointer-dnd-result', (el) => el.textContent);
    if (result !== 'dropped:card-in-target') throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

// --- 4. cross-origin-iframe --------------------------------------------------------------------
async function scenarioCrossOriginIframe() {
  return withPage(async (page) => {
    await page.goto(fx('cross-origin-iframe.html'));
    await page.waitForFunction(() => {
      const f = document.getElementById('cross-origin-frame');
      return !!f;
    });
    // page.frames() operates at the CDP level, not through the outer page's JS context -- it can
    // read cross-origin frame content the outer page's own script legally cannot.
    let frame = null;
    for (let i = 0; i < 30 && !frame; i++) {
      frame = page.frames().find((f) => f.url().startsWith('https://example.com'));
      if (!frame) await new Promise((r) => setTimeout(r, 200));
    }
    if (!frame) throw new Error('cross-origin frame never appeared in page.frames()');
    await frame.waitForSelector('h1');
    const heading = await frame.$eval('h1', (el) => el.textContent.trim());
    if (heading !== 'Example Domain') throw new Error(`unexpected heading: ${heading}`);
    return { heading };
  });
}

// --- 5. captcha-detection -----------------------------------------------------------------------
async function scenarioCaptchaDetection() {
  return withPage(async (page) => {
    await page.goto('https://demo.turnstile.workers.dev/', { waitUntil: 'networkidle2', timeout: 30000 });
    // No solve/bypass attempt -- detection only. Poll for either the challenge iframe Cloudflare's
    // script injects for an INTERACTIVE challenge, OR a resolved hidden response token, which is
    // what actually happens on this specific real demo page: it uses Cloudflare's well-known
    // "always-pass" TEST sitekey (1x00000000000000000000AA), which resolves near-instantly with a
    // dummy token and legitimately never renders an interactive iframe at all (confirmed live by
    // probing the widget's own outerHTML) -- a naive "no iframe -> no challenge" check would be a
    // FALSE NEGATIVE on this exact page. Real detection has to recognize both forms.
    let sawIframe = false;
    let sawResponseToken = false;
    for (let i = 0; i < 20 && !sawIframe && !sawResponseToken; i++) {
      const state = await page.evaluate(() => ({
        iframe: Array.from(document.querySelectorAll('iframe')).some((f) => (f.src || '').includes('challenges.cloudflare.com')),
        token: !!document.querySelector('input[name="cf-turnstile-response"]')?.value,
      }));
      sawIframe = state.iframe;
      sawResponseToken = state.token;
      if (!sawIframe && !sawResponseToken) await new Promise((r) => setTimeout(r, 500));
    }
    const detection = await page.evaluate(() => {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      const turnstileIframe = iframes.find(
        (f) => (f.src || '').includes('challenges.cloudflare.com') || (f.title || '').toLowerCase().includes('turnstile') || (f.title || '').toLowerCase().includes('widget'),
      );
      const widgetContainers = document.querySelectorAll('.cf-turnstile, [class*="turnstile"], #widget1, #widget2').length;
      const apiScriptPresent = Array.from(document.scripts).some((s) => (s.src || '').includes('challenges.cloudflare.com/turnstile'));
      const responseTokenValue = document.querySelector('input[name="cf-turnstile-response"]')?.value || null;
      return {
        turnstileIframeFound: !!turnstileIframe,
        turnstileIframeSrc: turnstileIframe ? turnstileIframe.src : null,
        totalIframes: iframes.length,
        widgetContainers,
        apiScriptPresent,
        responseTokenValue,
      };
    });
    // A widget is genuinely present only if the real Cloudflare API script loaded AND either it
    // rendered an interactive iframe or it produced a resolved response token -- container div
    // alone (which exists in the DOM before the async script even runs) is not proof by itself.
    const challengePresent = detection.apiScriptPresent && detection.widgetContainers > 0 && (sawIframe || sawResponseToken);
    if (!challengePresent) throw new Error(`no live Turnstile widget detected: ${JSON.stringify({ ...detection, sawIframe, sawResponseToken })}`);
    return {
      ...detection,
      sawIframe,
      sawResponseToken,
      challengePresent,
      note:
        'detection only -- no solve/bypass attempted, per project exclusion. This page uses Cloudflare\'s ' +
        'known always-pass TEST sitekey (1x00000000000000000000AA), which resolves via a dummy hidden ' +
        'response token rather than an interactive iframe -- a real, honest finding, not a workaround.',
    };
  });
}

// --- 6. large-dom ------------------------------------------------------------------------------
async function scenarioLargeDom() {
  return withPage(async (page) => {
    await page.goto('https://the-internet.herokuapp.com/large', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const cellStart = Date.now();
    const cellText = await page.$eval('.row-50 .column-1', (el) => el.textContent.trim());
    const cellReadMs = Date.now() - cellStart;
    if (cellText !== '50.1') throw new Error(`unexpected cell text: ${cellText}`);

    const allElsStart = Date.now();
    const totalElements = await page.evaluate(() => document.querySelectorAll('*').length);
    const allElsMs = Date.now() - allElsStart;

    const listStart = Date.now();
    const interactiveEls = await page.evaluate(LIST_SCRIPT);
    const listMs = Date.now() - listStart;

    return {
      cellText,
      cellReadMs,
      totalElements,
      totalElementsQueryMs: allElsMs,
      interactiveElementCount: interactiveEls.length,
      interactiveListQueryMs: listMs,
    };
  });
}

// --- 7. concurrency-stress ----------------------------------------------------------------------
async function scenarioConcurrencyStress() {
  // 5 pages on ONE shared browser instance -- this is the realistic way Puppeteer is actually
  // used for concurrent sessions in production (one browser process, many pages/contexts),
  // rather than paying full browser-launch cost 5x.
  return withBrowser(async (browser) => {
    const runOne = async (n) => {
      const start = Date.now();
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1000, height: 700 });
        await page.goto('https://the-internet.herokuapp.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.type('#username', 'tomsmith');
        await page.type('#password', 'SuperSecretPassword!');
        await page.click('button[type="submit"]');
        await page.waitForSelector('.flash.success', { timeout: 15000 });
        const flashText = await page.$eval('.flash.success', (el) => el.textContent.trim());
        const success = flashText.includes('You logged into a secure area');
        return { n, success, ms: Date.now() - start, flashText, error: null };
      } catch (err) {
        return { n, success: false, ms: Date.now() - start, flashText: null, error: err.message };
      } finally {
        await page.close();
      }
    };

    const results = await Promise.all([1, 2, 3, 4, 5].map(runOne));
    const successCount = results.filter((r) => r.success).length;
    const times = results.map((r) => r.ms);
    return {
      picked: '5 pages on one shared browser instance (realistic production pattern)',
      successCount,
      total: 5,
      minMs: Math.min(...times),
      maxMs: Math.max(...times),
      avgMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
      perSession: results,
    };
  });
}

export async function runExtremeScenarios() {
  return [
    await timed('nested-shadow-iframe', 'Open shadow root nested inside a same-origin iframe', scenarioNestedShadowIframe),
    await timed('rich-text-editor', 'Real ProseMirror contenteditable editor (official reference example)', scenarioRichTextEditor),
    await timed('custom-drag-drop', 'Custom pointer-based drag (no native HTML5 draggable/dataTransfer at all)', scenarioCustomDragDrop),
    await timed('cross-origin-iframe', 'Genuinely cross-origin iframe (local outer page, example.com inner)', scenarioCrossOriginIframe),
    await timed('captcha-detection', 'Real Cloudflare Turnstile challenge widget (official demo page)', scenarioCaptchaDetection),
    await timed('large-dom', 'Large table: 13 columns x 50 rows, deep real DOM (the-internet.herokuapp.com/large)', scenarioLargeDom),
    await timed('concurrency-stress', '5 concurrent sessions running the same login-flow scenario simultaneously', scenarioConcurrencyStress),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runExtremeScenarios();
  console.log(JSON.stringify(results, null, 2));
  const outPath = path.join(here, 'results', 'puppeteer-extreme.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
}
