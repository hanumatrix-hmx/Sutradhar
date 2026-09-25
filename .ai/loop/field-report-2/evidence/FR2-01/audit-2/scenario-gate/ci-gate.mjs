// CI health gate for the scenario suite. Deliberately NOT a pass-rate gate — individual
// scenario failures are frequently real external blocks (a bot wall, a site layout change,
// a CAPTCHA), not a Sutradhar regression, and this project's standing rule is to report those
// honestly rather than treat them as CI failures (see .ai/known-problems.md, .ai/browsing-
// capability-loop.md). What DOES deserve a failed build is total infra breakage — e.g. no
// Chrome/Chromium on the runner, so every single scenario on every surface fails identically
// before ever reaching a real page. That's not "the suite found bugs", that's "the suite didn't
// run" — and would otherwise report a silent 0/14 every day with a green checkmark.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(here, 'results');
const SURFACES = ['sdk', 'cli', 'mcp'];

let totalScenarios = 0;
let totalPassed = 0;
const missingSurfaces = [];

for (const surface of SURFACES) {
  const file = path.join(RESULTS_DIR, `baseline-${surface}.json`);
  if (!fs.existsSync(file)) {
    missingSurfaces.push(surface);
    continue;
  }
  // Result files come in two shapes in practice — a bare array (sdk/cli drivers) or
  // {surface, capturedAt, results: [...]} (mcp driver) — same distinction report.mjs handles.
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const results = Array.isArray(raw) ? raw : raw.results;
  totalScenarios += results.length;
  totalPassed += results.filter((r) => r.success).length;
}

console.log(`Scenario suite health check: ${totalPassed}/${totalScenarios} scenarios passed across ${SURFACES.length - missingSurfaces.length}/${SURFACES.length} surfaces.`);

if (missingSurfaces.length > 0) {
  console.error(`FAIL: no results file for surface(s): ${missingSurfaces.join(', ')} — that surface's driver did not complete.`);
  process.exit(1);
}

if (totalScenarios === 0) {
  console.error('FAIL: zero scenarios recorded across all surfaces — the suite produced no data at all.');
  process.exit(1);
}

if (totalPassed === 0) {
  console.error(
    'FAIL: 0 scenarios passed across ALL surfaces. This is the signature of total infra breakage ' +
      '(e.g. no Chrome/Chromium on the runner) rather than normal external-site flakiness — a real ' +
      'day-to-day run should pass at least some scenarios (file:// fixtures, example.com, etc.) ' +
      'regardless of which external sites happen to be blocking that day.',
  );
  process.exit(1);
}

console.log('OK: at least some scenarios completed on every surface — the harness itself is healthy.');
