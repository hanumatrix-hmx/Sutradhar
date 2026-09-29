// FR2-12 audit-4: does fix-3's revert-confirm.mjs `freshImport()` (index.js?bust=...) actually
// reload runtime.js? index.js does `export * from './runtime.js'`, and Node's ESM cache is keyed by
// resolved URL, so a query string on index.js alone should NOT reload runtime.js.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-4')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const idx = pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')).href;
const a = await import(`${idx}?bust=1`);
const b = await import(`${idx}?bust=2`);
const out = {
  indexModulesDistinct: a !== b,
  SutradharRuntimeSameClass: a.SutradharRuntime === b.SutradharRuntime,
  conclusion: a.SutradharRuntime === b.SutradharRuntime
    ? 'runtime.js is cached across ?bust imports: fix-3 revert-confirm case 2 (GAP-274) ran the module loaded in case 1 (GAP-273-reverted, bound INTACT), so its "no hang" result measured the bounded code'
    : 'runtime.js reloaded',
};
await fs.writeFile(path.join(here, 'probe-esm-cache.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
process.exit(0);
