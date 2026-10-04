// Usage (from $WT): node .ai/loop/release-0.6.1/evidence/S1/bundle-inventory.mjs [auditJson]
import * as esbuild from 'esbuild';
import path from 'node:path';
import { readFileSync } from 'node:fs';
const root = process.cwd();
const entries = { 'dist/index.js': 'packages/sutradhar/src/index.ts', 'dist/cli-bin.js': 'packages/cli/src/cli.ts', 'dist/mcp-cli.js': 'packages/mcp-server/src/cli.ts' };
const inlined = new Map();
for (const [out, entry] of Object.entries(entries)) {
  const r = await esbuild.build({ entryPoints: [path.join(root, entry)], outfile: path.join(root, '.inventory-not-written', out), bundle: true, platform: 'node', format: 'esm', target: 'node18', external: ['puppeteer-core'], write: false, metafile: true, logLevel: 'error' });
  const pk = new Set();
  for (const inp of Object.keys(Object.values(r.metafile.outputs)[0].inputs)) {
    const m = inp.match(/node_modules[\\/]\.pnpm[\\/]((?:@[^+\\/]+\+)?[^@\\/]+)@([^_\\/]+)/);
    if (m) { const name = m[1].replace('+', '/'); pk.add(`${name}@${m[2]}`); (inlined.get(name) ?? inlined.set(name, new Set()).get(name)).add(m[2]); }
  }
  console.log(`== ${out}: ${[...pk].sort().join(', ')}`);
}
if (process.argv[2]) {
  const a = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
  let hits = 0;
  for (const v of Object.values(a.advisories ?? {})) {
    for (const ver of new Set(v.findings.map((f) => f.version))) if (inlined.get(v.module_name)?.has(ver)) { hits++; console.log(`SHIPPED-ADVISORY ${v.module_name}@${ver} ${v.github_advisory_id} ${v.severity}`); }
  }
  console.log(`shipped advisories: ${hits}`);
}
