// PinchTab engine vs. 6 genuinely hard browser-automation problems, all on local, deterministic
// fixtures (no third-party site dependency, no adversarial/CAPTCHA-evasion content).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinchTabRuntime } from '../../packages/capability-runtime/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;
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
    const launched = await runtime.launch({ headless: HEADLESS, launch: { viewport: { width: 1000, height: 700 } } });
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

// 1. Closed shadow DOM
async function scenarioClosedShadow() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, fx('closed-shadow.html'));

    const directRead = await rt.eval(sid, "document.querySelector('#secret-value')?.textContent ?? null");
    const shadowRootIsNull = await rt.eval(sid, "document.querySelector('secret-box').shadowRoot === null");

    let clickWorked = false;
    let clickError = null;
    try {
      await must(rt.click(sid, '#secret-btn'));
      const signal = await rt.eval(sid, "document.getElementById('outside-click-signal').textContent");
      clickWorked = signal === '1';
    } catch (err) {
      clickError = err.message;
    }

    return { directRead, shadowRootIsNull, clickWorked, clickError };
  });
}

// 2. Canvas-only UI (no DOM element for the button — must click by pixel coordinates)
async function scenarioCanvasUI() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, fx('canvas-ui.html'));
    // The button is drawn off-center within the canvas — rt.click()'s offset param (relative to
    // the target's top-left corner) clicks a specific point instead of the element's center.
    await must(rt.click(sid, '#app', undefined, undefined, { x: 80, y: 158 }));
    const result = await rt.eval(sid, "document.getElementById('canvas-result').textContent");
    if (result !== 'clicked') throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

// 3. Virtualized list (target row doesn't exist in the DOM until scrolled into range)
async function scenarioVirtualizedList() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, fx('virtualized-list.html'));
    const targetIndex = 437;
    let found = false;
    for (let i = 0; i < 80 && !found; i++) {
      await rt.eval(
        sid,
        `document.getElementById('viewport').scrollTop = document.getElementById('viewport').scrollTop + 260`,
      );
      // The virtualized list re-renders on the 'scroll' event, which Chrome dispatches
      // asynchronously — checking immediately after setting scrollTop can race ahead of the
      // re-render. A short settle delay avoids that race (confirmed via direct debugging).
      await new Promise((r) => setTimeout(r, 15));
      found = await rt.eval(sid, `!!document.querySelector('[data-index="${targetIndex}"]')`);
    }
    if (!found) throw new Error(`never scrolled item ${targetIndex} into the DOM after 80 attempts`);
    await must(rt.click(sid, `[data-index="${targetIndex}"]`));
    const result = await rt.eval(sid, "document.getElementById('virtual-result').textContent");
    if (result !== `clicked:${targetIndex}`) throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

// 4. Native HTML5 drag-and-drop
async function scenarioNativeDnD() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, fx('dnd-native.html'));
    await must(rt.dragAndDrop(sid, '#item-alpha', '#target'));
    const result = await rt.eval(sid, "document.getElementById('dnd-result').textContent");
    if (result !== 'dropped:item-alpha-in-target') throw new Error(`unexpected result: ${result}`);
    return { result };
  });
}

// 5. Animation-gated interactivity (clicking before the CSS transition settles doesn't count)
async function scenarioAnimatedPanel() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, fx('animated-panel.html'));
    await must(rt.click(sid, '#trigger-btn'));
    // No explicit wait for the 800ms transition — this is exactly the question: does PinchTab's
    // own click verification (occlusion + delivery) happen to wait for visual stability too, or
    // does it click immediately once the button is technically present and visible?
    await must(rt.click(sid, '#confirm-btn'));
    const result = await rt.eval(sid, "document.getElementById('animated-result').textContent");
    return { result };
  });
}

// 6. Nested (non-window) scroll container
async function scenarioNestedScroll() {
  return withRuntime(async (rt, sid) => {
    await rt.navigate(sid, fx('nested-scroll.html'));
    // No explicit scroll step — testing whether click's own scrollIntoView (fixed earlier today)
    // correctly scrolls the NESTED container, not just the window.
    await must(rt.click(sid, '#deep-btn'));
    const result = await rt.eval(sid, "document.getElementById('nested-result').textContent");
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
