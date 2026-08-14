#!/usr/bin/env node
/**
 * @file scripts/build-bundle.mjs
 * @description Bundles the three published entry points of the `sutradhar` npm package
 * (library, CLI, MCP server) into single self-contained files under packages/sutradhar/dist/,
 * inlining all internal @sutradhar/* workspace packages so the published package has zero
 * workspace-protocol dependencies. `puppeteer-core` is the one real runtime dependency left
 * external — it's pure JS with no native bindings, and inlining it would bloat every
 * consumer's install for no benefit over a normal dependency.
 *
 * Run via `pnpm --filter sutradhar build` (invokes this after `tsc --emitDeclarationOnly`
 * has already produced the .d.ts files for the library entry).
 *
 * Some bundled CJS deps (pngjs, transitively via capability-runtime's visual-compare) call
 * `require()` for a Node builtin in a way esbuild's ESM output can't statically resolve —
 * hence the `createRequire` banner on every entry, the standard fix for this interop case.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const REQUIRE_SHIM =
  'import { createRequire as __sd_createRequire } from "node:module"; ' +
  'const require = __sd_createRequire(import.meta.url);';

const entries = [
  {
    name: 'library (import { launch } from "sutradhar")',
    entry: path.join(root, 'packages/sutradhar/src/index.ts'),
    outfile: path.join(root, 'packages/sutradhar/dist/index.js'),
  },
  {
    name: 'CLI (bin: sutradhar)',
    entry: path.join(root, 'packages/cli/src/cli.ts'),
    outfile: path.join(root, 'packages/sutradhar/dist/cli-bin.js'),
  },
  {
    name: 'MCP server (bin: sutradhar-mcp)',
    entry: path.join(root, 'packages/mcp-server/src/cli.ts'),
    outfile: path.join(root, 'packages/sutradhar/dist/mcp-cli.js'),
  },
];

for (const { name, entry, outfile } of entries) {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    external: ['puppeteer-core'],
    banner: { js: REQUIRE_SHIM },
    logLevel: 'warning',
  });
  const bytes = (await import('node:fs')).statSync(outfile).size;
  console.log(`[build-bundle] ${name} -> ${path.relative(root, outfile)} (${(bytes / 1024).toFixed(0)}kb)`);
  if (result.warnings.length) {
    console.warn(`[build-bundle] ${result.warnings.length} warning(s) for ${name}`);
  }
}

console.log('[build-bundle] done.');
