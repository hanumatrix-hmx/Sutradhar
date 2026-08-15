// Aggregates the three per-surface baseline/post-fix result files into one markdown matrix +
// JSON summary. Handles both result-file shapes that emerged in practice (a bare array, or
// {surface, capturedAt, results: [...]}) rather than forcing a rewrite of already-captured data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS } from './scenarios.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(here, 'results');

function loadSurfaceResults(filename) {
  const raw = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, filename), 'utf8'));
  return Array.isArray(raw) ? raw : raw.results;
}

const label = process.argv[2] === '--post-fix' ? 'post-fix' : 'baseline';
const suffix = label === 'post-fix' ? 'post-fix' : 'baseline';

const surfaces = ['sdk', 'cli', 'mcp'];
const bySurface = {};
for (const s of surfaces) {
  const file = `${suffix}-${s}.json`;
  if (fs.existsSync(path.join(RESULTS_DIR, file))) {
    bySurface[s] = loadSurfaceResults(file);
  }
}

const lines = [];
lines.push(`# Scenario suite — ${label} results\n`);
lines.push(`Surfaces captured: ${Object.keys(bySurface).join(', ')}\n`);

lines.push('| UC | Scenario | SDK | CLI | MCP |');
lines.push('|---|---|---|---|---|');

const totals = { sdk: [0, 0], cli: [0, 0], mcp: [0, 0] };
for (const scenario of SCENARIOS) {
  const cells = surfaces.map((s) => {
    const results = bySurface[s];
    if (!results) return '—';
    const r = results.find((x) => x.id === scenario.id);
    if (!r) return '(missing)';
    totals[s][1]++;
    if (r.success) totals[s][0]++;
    return r.success ? '✅ pass' : `❌ FAIL`;
  });
  lines.push(`| ${scenario.id} | ${scenario.title} | ${cells.join(' | ')} |`);
}

lines.push('');
lines.push('## Totals');
lines.push('');
for (const s of surfaces) {
  if (bySurface[s]) {
    lines.push(`- **${s.toUpperCase()}**: ${totals[s][0]}/${totals[s][1]} pass`);
  }
}

const outMd = path.join(RESULTS_DIR, `${suffix}-report.md`);
fs.writeFileSync(outMd, lines.join('\n') + '\n');
console.log(`Wrote ${outMd}`);

const outJson = path.join(RESULTS_DIR, `${suffix}-combined.json`);
fs.writeFileSync(outJson, JSON.stringify({ label, surfaces: bySurface, totals }, null, 2));
console.log(`Wrote ${outJson}`);
