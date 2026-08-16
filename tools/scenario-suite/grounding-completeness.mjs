// Grounding-completeness contract: loads fixtures/grounding-completeness.html — one instance
// of every interactive element type — takes a real snapshot, and asserts each element marked
// data-expect="snap" actually got the SD_NODE_ID_ATTR stamp `snap` uses for targeting (a
// precise, id-based check — not fuzzy text matching against the listing's rendered strings).
// Elements marked data-expect="alternative:<name>" are asserted NOT to need snap grounding,
// with a per-alternative independent check that the named alternative path genuinely works —
// closing INSIGHTS.md Insight 3 ("CI-assert that every type appears in snap or has a
// documented alternative command... the README's promise should be enumerable").
//
// Exits nonzero (and prints exactly which element/expectation failed) on any contract
// violation — this is a real regression gate, not just a report.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SutradharRuntime } from '../../packages/capability-runtime/dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureUrl = pathToFileURL(path.join(here, 'fixtures', 'grounding-completeness.html')).href;

const runtime = new SutradharRuntime({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
const failures = [];
const passes = [];

function record(name, ok, detail) {
  (ok ? passes : failures).push({ name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

const { sessionId } = await runtime.launch({ headless: true, initialUrl: fixtureUrl });
try {
  await new Promise((r) => setTimeout(r, 300)); // let the iframe's load handler run
  await runtime.snapshot(sessionId);

  const expectations = await runtime.eval(
    sessionId,
    `Array.from(document.querySelectorAll('[data-expect]')).map(el => ({
      id: el.id,
      expect: el.getAttribute('data-expect'),
      stamped: el.hasAttribute('data-sd-node-id'),
    }))`,
  );

  for (const { id, expect, stamped } of expectations) {
    if (expect === 'snap') {
      record(`#${id} is grounded by snap`, stamped, stamped ? undefined : 'no data-sd-node-id stamp after snapshot()');
      continue;
    }

    const altName = expect.replace(/^alternative:/, '');
    // An "alternative" element should NOT need the snap stamp — if it silently started
    // getting one, either grounding grew to cover it (great — but then it should be
    // reclassified as "snap" in the fixture, not "alternative") or this check is stale.
    // Not failing the run over that alone; recorded as a note, not a failure, since it's the
    // GOOD kind of drift.
    if (stamped) {
      console.log(`NOTE — #${id} (declared alternative:${altName}) IS now snap-stamped — consider reclassifying the fixture.`);
    }

    switch (altName) {
      case 'eval-media-api': {
        const hasMediaApi = await runtime.eval(
          sessionId,
          `typeof document.getElementById('${id}').play === 'function'`,
        );
        record(`#${id} (video) has a working eval-based media API alternative`, hasMediaApi === true);
        break;
      }
      case 'offset-click': {
        // Canvas: the documented alternative is browser.click's `offset` param for pixel-precise
        // targeting, not snap grounding of canvas *content*. Assert the element itself is at
        // least resolvable by selector (so `offset` clicks have something to target).
        const result = await runtime.click(sessionId, `#${id}`, undefined, undefined, { x: 5, y: 5 });
        record(`#${id} (canvas) is targetable via click's offset param`, result.success === true, result.error ?? undefined);
        break;
      }
      case 'open-shadow-pierced': {
        const shadowStamped = await runtime.eval(
          sessionId,
          `document.getElementById('${id}').shadowRoot.getElementById('gc-shadow-button').hasAttribute('data-sd-node-id')`,
        );
        record(`#${id} (open shadow) — real content inside is pierced and grounded`, shadowStamped === true);
        break;
      }
      case 'none-closed-shadow-is-a-documented-limitation': {
        // Not a failure by design — closed shadow roots block even evaluate()-level JS access,
        // a real browser security boundary, not a Sutradhar gap. Confirm it's genuinely
        // inaccessible (proves this is the real constraint, not just "nobody tried").
        const closedInaccessible = await runtime.eval(
          sessionId,
          `document.getElementById('${id}').shadowRoot === null`,
        );
        record(`#${id} (closed shadow) — confirmed genuinely inaccessible (documented limitation, not a gap)`, closedInaccessible === true);
        break;
      }
      case 'frame-pierced': {
        const iframeButtonStamped = await runtime.eval(
          sessionId,
          `document.getElementById('${id}').contentDocument.getElementById('gc-iframe-button')?.hasAttribute('data-sd-node-id') ?? false`,
        );
        record(`#${id} (same-origin iframe) — real content inside is pierced and grounded`, iframeButtonStamped === true);
        break;
      }
      default:
        record(`#${id}`, false, `unknown alternative "${altName}" in fixture — grounding-completeness.mjs needs a case for it`);
    }
  }
} finally {
  await runtime.shutdown(sessionId).catch(() => {});
}

console.log(`\n${passes.length}/${passes.length + failures.length} checks passed`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  process.exitCode = 1;
}
