import * as esbuild from 'esbuild';
const [entry, outfile] = process.argv.slice(2);
const REQUIRE_SHIM = 'import { createRequire as __sd_createRequire } from "node:module"; const require = __sd_createRequire(import.meta.url);';
await esbuild.build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node18', external: ['puppeteer-core'], banner: { js: REQUIRE_SHIM }, logLevel: 'warning' });
console.log('built', outfile);
