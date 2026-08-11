// Playwright vs. the same 6 hard problems, launched against the same system Chrome.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;
const HEADLESS = process.env.HEADFUL !== '1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function withPage(fn) {
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: CHROME_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
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

async function scenarioClosedShadow() {
  return withPage(async (page) => {
    await page.goto(fx('closed-shadow.html'));

    const directRead = await page.evaluate(() => document.querySelector('#secret-value')?.textContent ?? null);
    const shadowRootIsNull = await page.evaluate(() => document.querySelector('secret-box').shadowRoot === null);

    let clickWorked = false;
    let clickError = null;
    try {
      await page.click('#secret-btn', { timeout: 3000 });
      const signal = await page.textContent('#outside-click-signal');
      clickWorked = signal === '1';
    } catch (err) {
      clickError = err.message.split('\n')[0];
    }

    return { directRead, shadowRootIsNull, clickWorked, clickError };
  });
}

async function scenarioCanvasUI() {
  return withPage(async (page) => {
    await page.goto(fx('canvas-ui.html'));
    // The button is drawn off-center within the canvas — Playwright's `position` option lets a
    // caller click at a specific offset within the element's bounding box, not just its center.
    await page.click('#app', { position: { x: 80, y: 158 } });
    const result = await page.textContent('#canvas-result');
    return { result };
  });
}

async function scenarioVirtualizedList() {
  return withPage(async (page) => {
    await page.goto(fx('virtualized-list.html'));
    const targetIndex = 437;
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      await page.evaluate(() => {
        const vp = document.getElementById('viewport');
        vp.scrollTop = vp.scrollTop + 260;
      });
      // The virtualized list re-renders on the 'scroll' event, dispatched asynchronously by
      // Chrome — checking immediately can race ahead of the re-render.
      await page.waitForTimeout(15);
      found = await page.evaluate((idx) => !!document.querySelector(`[data-index="${idx}"]`), targetIndex);
    }
    if (!found) throw new Error(`never scrolled item ${targetIndex} into the DOM after 80 attempts`);
    await page.click(`[data-index="${targetIndex}"]`);
    const result = await page.textContent('#virtual-result');
    if (result !== `clicked:${targetIndex}`) throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

async function scenarioNativeDnD() {
  return withPage(async (page) => {
    await page.goto(fx('dnd-native.html'));
    // Playwright's high-level dragAndDrop dispatches real dragstart/dragover/drop with a
    // populated DataTransfer (unlike a manual mousedown/mousemove/mouseup simulation).
    await page.dragAndDrop('#item-alpha', '#target');
    const result = await page.textContent('#dnd-result');
    if (result !== 'dropped:item-alpha-in-target') throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

async function scenarioAnimatedPanel() {
  return withPage(async (page) => {
    await page.goto(fx('animated-panel.html'));
    await page.click('#trigger-btn');
    // No explicit wait for the 800ms transition -- Playwright's own actionability checks
    // include waiting for the target's bounding box to be "stable" across two animation
    // frames before clicking, which is exactly what this scenario tests for.
    await page.click('#confirm-btn');
    const result = await page.textContent('#animated-result');
    return { result };
  });
}

async function scenarioNestedScroll() {
  return withPage(async (page) => {
    await page.goto(fx('nested-scroll.html'));
    // No explicit scroll step -- Playwright's click auto-scrolls the nearest scrollable
    // ancestor into view before clicking.
    await page.click('#deep-btn');
    const result = await page.textContent('#nested-result');
    if (result !== 'clicked') throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

export async function runHardScenarios() {
  return [
    await timed('closed-shadow', 'Closed shadow DOM (fundamentally inaccessible by spec)', scenarioClosedShadow),
    await timed('canvas-ui', 'Canvas-only UI — no DOM element to select', scenarioCanvasUI),
    await timed('virtualized-list', 'Virtualized list — target row not yet mounted', scenarioVirtualizedList),
    await timed('native-dnd', 'Native HTML5 drag-and-drop (real dataTransfer)', scenarioNativeDnD),
    await timed('animated-panel', 'Animation-gated interactivity (800ms CSS transition)', scenarioAnimatedPanel),
    await timed('nested-scroll', 'Nested (non-window) scroll container', scenarioNestedScroll),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = await runHardScenarios();
  console.log(JSON.stringify(results, null, 2));
}
