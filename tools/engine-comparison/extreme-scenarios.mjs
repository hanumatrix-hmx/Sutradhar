// Shared scenario metadata for the "hardest real-world browser automation cases" comparison —
// see speed-and-token-comparison-2026-08-15.md's sibling doc for the researched sourcing
// behind each category. Each harness implements these natively in its own tool's idiom (same
// design philosophy as scenarios.mjs: compare each engine's own real API surface, not a shared
// DSL that would hide genuine differences).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => pathToFileURL(path.join(here, 'hard-fixtures', name)).href;

export const EXTREME_SCENARIOS = [
  {
    id: 'nested-shadow-iframe',
    title: 'Open shadow root nested inside a same-origin iframe',
    url: fx('nested-shadow-in-iframe.html'),
    steps: 'Type "hello-nested" into the input inside the shadow root inside the iframe, click the submit button (same shadow root), read the result.',
    successCriteria: 'result text === "submitted:hello-nested"',
  },
  {
    id: 'rich-text-editor',
    title: 'Real ProseMirror contenteditable editor (official reference example)',
    url: 'https://prosemirror.net/examples/basic/',
    steps: 'Click into the editor content area, type a real sentence, read back what the editor actually contains.',
    successCriteria: 'the typed text is genuinely present in the editor content afterward (not silently dropped/appended wrong)',
  },
  {
    id: 'custom-drag-drop',
    title: 'Custom pointer-based drag (no native HTML5 draggable/dataTransfer at all)',
    url: fx('dnd-custom-pointer.html'),
    steps: 'Drag #card from #source into #target using a real mousedown -> mousemove -> mouseup sequence (a high-level "drag and drop" API built on HTML5 DnD events will do nothing here).',
    successCriteria: 'result text === "dropped:card-in-target"',
  },
  {
    id: 'cross-origin-iframe',
    title: 'Genuinely cross-origin iframe (local outer page, example.com inner)',
    url: fx('cross-origin-iframe.html'),
    steps: 'Read the real heading text inside the cross-origin iframe.',
    successCriteria: 'extracted text === "Example Domain"',
  },
  {
    id: 'captcha-detection',
    title: 'Real Cloudflare Turnstile challenge widget (official demo page)',
    url: 'https://demo.turnstile.workers.dev/',
    steps: 'Load the page and correctly report that a Turnstile challenge widget is present. Do NOT attempt to solve/bypass it — detection correctness only, per this project\'s stealth/evasion exclusion.',
    successCriteria: 'correctly identifies the challenge is present, does not hang, does not falsely claim the page is a normal, challenge-free page',
  },
  {
    id: 'large-dom',
    title: 'Large table: 13 columns x 50 rows, deep real DOM (the-internet.herokuapp.com/large)',
    url: 'https://the-internet.herokuapp.com/large',
    steps: 'Read the text of the cell at row 50, column 1 (selector: ".row-50 .column-1" — real class-based selector, not id-based). Also record how long the page-read/grounding call itself took on this much bigger page, for comparison against the smaller pages already measured.',
    successCriteria: 'correctly extracts row 50 column 1\'s real text content',
  },
  {
    id: 'concurrency-stress',
    title: '5 concurrent sessions running the same login-flow scenario simultaneously',
    url: 'https://the-internet.herokuapp.com/login',
    steps: 'Launch 5 independent sessions at the same time, each performing: navigate -> fill username "tomsmith" -> fill password "SuperSecretPassword!" -> submit -> verify the success flash message. Record how many of the 5 succeed and the real per-session timing (min/max/avg), not just a single-session number.',
    successCriteria: 'report exact success count out of 5 and real timing spread — this scenario is measuring stability under concurrency, not a single pass/fail',
  },
];
