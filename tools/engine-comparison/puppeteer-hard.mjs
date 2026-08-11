// Raw puppeteer-core (the library Sutradhar's browser engine is built on) vs. the same 6 hard
// problems — isolates what Sutradhar's own logic (occlusion/delivery verification, cross-frame
// resolution, retries) adds or costs relative to using Puppeteer directly with no wrapper.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;
const HEADLESS = process.env.HEADFUL !== '1';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function withPage(fn) {
  const browser = await puppeteer.launch({ headless: HEADLESS, executablePath: CHROME_PATH });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 700 });
    return await fn(page);
  } finally {
    await browser.close();
  }
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

async function scenarioClosedShadow() {
  return withPage(async (page) => {
    await page.goto(fx('closed-shadow.html'));

    const directRead = await page.evaluate(() => document.querySelector('#secret-value')?.textContent ?? null);
    const shadowRootIsNull = await page.evaluate(() => document.querySelector('secret-box').shadowRoot === null);

    let clickWorked = false;
    let clickError = null;
    try {
      // Puppeteer's own `pierce/` custom query handler -- does it reach inside a CLOSED root?
      await page.waitForSelector('pierce/#secret-btn', { timeout: 3000 });
      await page.click('pierce/#secret-btn');
      const signal = await page.$eval('#outside-click-signal', (el) => el.textContent);
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
    // The button is drawn off-center within the canvas — Puppeteer's `offset` option lets a
    // caller click at a specific point within the element's bounding box, not just its center.
    await page.click('#app', { offset: { x: 80, y: 158 } });
    const result = await page.$eval('#canvas-result', (el) => el.textContent);
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
      await new Promise((r) => setTimeout(r, 15));
      found = await page.evaluate((idx) => !!document.querySelector(`[data-index="${idx}"]`), targetIndex);
    }
    if (!found) throw new Error(`never scrolled item ${targetIndex} into the DOM after 80 attempts`);
    await page.click(`[data-index="${targetIndex}"]`);
    const result = await page.$eval('#virtual-result', (el) => el.textContent);
    if (result !== `clicked:${targetIndex}`) throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

async function scenarioNativeDnD() {
  return withPage(async (page) => {
    await page.goto(fx('dnd-native.html'));
    // Raw Puppeteer has no high-level dragAndDrop helper -- must use the low-level
    // ElementHandle.drag()/.drop() CDP primitives directly, same ones Sutradhar uses internally.
    const source = await page.$('#item-alpha');
    const target = await page.$('#target');
    await source.drag(target);
    await target.drop(source);
    const result = await page.$eval('#dnd-result', (el) => el.textContent);
    if (result !== 'dropped:item-alpha-in-target') throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

async function scenarioAnimatedPanel() {
  return withPage(async (page) => {
    await page.goto(fx('animated-panel.html'));
    await page.click('#trigger-btn');
    // Raw Puppeteer's click has no stability/animation-settling wait at all -- clicks the moment
    // the element is present and visible.
    await page.click('#confirm-btn');
    const result = await page.$eval('#animated-result', (el) => el.textContent);
    return { result };
  });
}

async function scenarioNestedScroll() {
  return withPage(async (page) => {
    await page.goto(fx('nested-scroll.html'));
    // No explicit scroll -- Puppeteer's click() does scroll the element into view first via
    // the native Element.scrollIntoViewIfNeeded()-equivalent CDP call.
    await page.click('#deep-btn');
    const result = await page.$eval('#nested-result', (el) => el.textContent);
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
