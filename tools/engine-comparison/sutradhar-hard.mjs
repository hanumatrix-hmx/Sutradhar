// Sutradhar vs. the same 6 hard problems as playwright-hard.mjs / puppeteer-hard.mjs /
// pinchtab-hard.mjs, using SutradharRuntime directly against the same local fixture files.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SutradharRuntime } from '../../packages/capability-runtime/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;
const HEADLESS = process.env.HEADFUL !== '1';
const runtime = new SutradharRuntime({ logger: { info() {}, warn() {}, error() {}, debug() {} } });

async function withSession(fn) {
  const { sessionId } = await runtime.launch({ headless: HEADLESS });
  try {
    await runtime.setViewport(sessionId, { width: 1000, height: 700 });
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function scenarioClosedShadow() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('closed-shadow.html'));

    const directRead = await runtime.eval(sid, `document.querySelector('#secret-value')?.textContent ?? null`);
    const shadowRootIsNull = await runtime.eval(sid, `document.querySelector('secret-box').shadowRoot === null`);

    let clickWorked = false;
    let clickError = null;
    const clickResult = await runtime.waitForSelector(sid, '#secret-btn', 3000).then(() => runtime.click(sid, '#secret-btn')).catch((err) => ({ success: false, error: err.message }));
    if (clickResult.success) {
      const signal = await runtime.eval(sid, `document.querySelector('#outside-click-signal').textContent`);
      clickWorked = signal === '1';
    } else {
      clickError = (clickResult.error || '').split('\n')[0];
    }

    return { directRead, shadowRootIsNull, clickWorked, clickError };
  });
}

async function scenarioCanvasUI() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('canvas-ui.html'));
    // Same offset-within-element click Playwright's harness uses — the button is drawn
    // off-center inside the canvas.
    const r = await runtime.click(sid, '#app', undefined, undefined, { x: 80, y: 158 });
    if (!r.success) throw new Error(r.error);
    const result = await runtime.eval(sid, `document.querySelector('#canvas-result').textContent`);
    return { result };
  });
}

async function scenarioVirtualizedList() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('virtualized-list.html'));
    const targetIndex = 437;
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      await runtime.eval(sid, `(() => { const vp = document.getElementById('viewport'); vp.scrollTop = vp.scrollTop + 260; })()`);
      await sleep(15);
      found = await runtime.eval(sid, `!!document.querySelector('[data-index="${targetIndex}"]')`);
    }
    if (!found) throw new Error(`never scrolled item ${targetIndex} into the DOM after 80 attempts`);
    const r = await runtime.click(sid, `[data-index="${targetIndex}"]`);
    if (!r.success) throw new Error(r.error);
    const result = await runtime.eval(sid, `document.querySelector('#virtual-result').textContent`);
    if (result !== `clicked:${targetIndex}`) throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

async function scenarioNativeDnD() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('dnd-native.html'));
    const r = await runtime.dragAndDrop(sid, '#item-alpha', '#target');
    if (!r.success) throw new Error(r.error);
    const result = await runtime.eval(sid, `document.querySelector('#dnd-result').textContent`);
    if (result !== 'dropped:item-alpha-in-target') throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

async function scenarioAnimatedPanel() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('animated-panel.html'));
    const r1 = await runtime.click(sid, '#trigger-btn');
    if (!r1.success) throw new Error(r1.error);
    // No explicit wait for the 800ms CSS transition -- this is exactly what the scenario tests:
    // does the engine's own click handling cope with a target that isn't stable/clickable yet.
    const r2 = await runtime.click(sid, '#confirm-btn');
    if (!r2.success) throw new Error(r2.error);
    const result = await runtime.eval(sid, `document.querySelector('#animated-result').textContent`);
    return { result };
  });
}

async function scenarioNestedScroll() {
  return withSession(async (sid) => {
    await runtime.navigate(sid, fx('nested-scroll.html'));
    // No explicit scroll step -- testing whether Sutradhar's click auto-scrolls the nearest
    // scrollable ancestor into view, same as the other three harnesses test for their engines.
    const r = await runtime.click(sid, '#deep-btn');
    if (!r.success) throw new Error(r.error);
    const result = await runtime.eval(sid, `document.querySelector('#nested-result').textContent`);
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

const results = await runHardScenarios();
console.log(JSON.stringify(results, null, 2));
