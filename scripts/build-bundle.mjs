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
 *
 * RELEASE HYGIENE (field-report remediation Phase 6): esbuild bundles the three entry files
 * fresh from TypeScript source, but every `@sutradhar/*` import inside them resolves through
 * that package's own `package.json` "main"/"types" fields — which point at its COMPILED
 * `dist/`, not `src/`. A stale `packages/browser/dist/` (or any other workspace dependency's
 * dist) at bundle time silently embeds stale engine code into the published tarball, with
 * nothing to detect it — this is the actual root cause behind an already-investigated,
 * unrecoverable-from-git discrepancy between source and a past published artifact (see
 * .ai/known-problems.md). Fix: before bundling, wipe and rebuild every workspace package this
 * bundle's import graph can reach, computed from real `package.json` dependency edges (not a
 * hand-maintained list, which would silently drift as the dependency graph changes) rather than
 * trusting whatever `dist/` output happens to already exist on disk.
 */
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { copyFileSync, rmSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { discoverWorkspacePackages, computeBuildOrder } from './workspace-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const workspacePackages = discoverWorkspacePackages(root);
const buildOrder = computeBuildOrder(workspacePackages);

console.log(`[build-bundle] rebuilding ${buildOrder.length} workspace dependencies from clean, in order:`);
for (const { dir } of buildOrder) {
  const name = path.basename(dir);
  const distPath = path.join(dir, 'dist');
  rmSync(distPath, { recursive: true, force: true });
  execSync('npx tsc -p .', { cwd: dir, stdio: 'inherit' });
  console.log(`[build-bundle]   ✓ ${name}`);
}

// NOT cleaning packages/sutradhar/dist here — by the time this script runs, `tsc
// --emitDeclarationOnly` (the first half of packages/sutradhar's own `build` script) has
// already written `dist/index.d.ts`, and wiping the whole directory would delete it out from
// under the second half of that same build. The three esbuild writes below always fully
// overwrite their own outfiles (no incremental/stale-merge behavior within one `esbuild.build()`
// call), so there's nothing to clean for correctness — only the WORKSPACE DEPENDENCIES' dist
// (cleaned above) can silently embed stale code.

// AGENT_SETUP.md's canonical copy lives at the repo root (so it's visible to anyone browsing
// the repo, and easy to hand-copy into other projects) but also needs to physically exist
// inside packages/sutradhar/ to be included in the published npm tarball — npm's "files"
// field can't reference paths outside the package directory. Mirror it here rather than
// maintaining two hand-edited copies that will inevitably drift.
copyFileSync(path.join(root, 'AGENT_SETUP.md'), path.join(root, 'packages/sutradhar/AGENT_SETUP.md'));
console.log('[build-bundle] mirrored AGENT_SETUP.md into packages/sutradhar/');

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

// `packages/sutradhar/dist/index.d.ts` is produced by this package's own `tsc
// --emitDeclarationOnly` build step (run before this script, per package.json's `build`
// script) — NOT rebuilt here, since esbuild doesn't emit declaration files. A caller invoking
// this script directly (skipping the `tsc --emitDeclarationOnly` step) ends up with a bundle
// but no fresh `.d.ts` — expected, not a bug in this script; `npm run build` in
// packages/sutradhar runs both steps in the right order.
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
  const bytes = statSync(outfile).size;
  console.log(`[build-bundle] ${name} -> ${path.relative(root, outfile)} (${(bytes / 1024).toFixed(0)}kb)`);
  if (result.warnings.length) {
    console.warn(`[build-bundle] ${result.warnings.length} warning(s) for ${name}`);
  }
}

console.log('[build-bundle] done.');
