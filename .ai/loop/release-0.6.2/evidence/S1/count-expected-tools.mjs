// Counts the entries of EXPECTED_BROWSER_TOOLS in packages/mcp-server/tests/unit/tools.spec.ts (imports nothing from the product).
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8');
const m = /const EXPECTED_BROWSER_TOOLS = \[([\s\S]*?)\n\];/.exec(src);
if (!m) { console.error('array not found'); process.exit(1); }
const names = [...m[1].matchAll(/'(browser\.[a-z_]+)'/g)].map((x) => x[1]);
if (new Set(names).size !== names.length) { console.error('duplicate entries'); process.exit(1); }
console.log(names.length);
