#!/usr/bin/env node
/**
 * @file scripts/check-release-ready.mjs
 * @description `prepublishOnly` gate for `packages/sutradhar` — fails the publish, loudly and
 * before npm packs anything, when the release wouldn't be trustworthy:
 *
 *   1. The working tree has uncommitted changes — a published artifact must be traceable back
 *      to a real commit, or a bug report against it can never be reproduced from git history.
 *   2. Any workspace dependency the bundle's import graph reaches has a `dist/` older than its
 *      own `src/` — the exact condition that let a past published artifact silently diverge
 *      from its own source tree (see .ai/known-problems.md's Phase 6 investigation). This is a
 *      pure CHECK, not an auto-rebuild: it intentionally fails rather than silently fixing
 *      staleness, so "did the maintainer actually run a real build before publishing" stays a
 *      verifiable fact rather than something this script could paper over.
 *
 * Run automatically by `npm publish` (wired as `prepublishOnly` in packages/sutradhar's
 * package.json) — never needs to be invoked by hand in normal use.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { discoverWorkspacePackages, computeBuildOrder } from './workspace-graph.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const failures = [];

// ── 1. Working tree must be clean ───────────────────────────────────────────────────────────
const gitStatus = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' });
if (gitStatus.trim().length > 0) {
  failures.push(
    'Working tree has uncommitted changes:\n' +
      gitStatus
        .trim()
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n') +
      '\n  Commit or stash them before publishing — a published artifact must be traceable to a real commit.',
  );
}

// ── 2. No workspace dependency's dist may be older than its own src ────────────────────────
/** Latest mtime (ms) of any file under `dir`, recursing into subdirectories. `undefined` if
 *  `dir` doesn't exist or contains no files. */
function newestMtimeMs(dir) {
  if (!existsSync(dir)) return undefined;
  let newest;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const mtime = statSync(full).mtimeMs;
        if (newest === undefined || mtime > newest) newest = mtime;
      }
    }
  };
  walk(dir);
  return newest;
}

const workspacePackages = discoverWorkspacePackages(root);
const buildOrder = computeBuildOrder(workspacePackages);
// The three bundle entry packages themselves also need a freshness check — their OWN src
// (cli.ts, the mcp-server cli.ts, sutradhar's own index.ts) feeds directly into the bundle, so
// a stale packages/sutradhar/dist is exactly as real a risk as a stale dependency's.
const sutradharInfo = workspacePackages.get('sutradhar') ?? { dir: path.join(root, 'packages/sutradhar') };
const checklist = [...buildOrder, sutradharInfo];

for (const { dir } of checklist) {
  const name = path.basename(dir);
  const srcNewest = newestMtimeMs(path.join(dir, 'src'));
  const distNewest = newestMtimeMs(path.join(dir, 'dist'));
  if (srcNewest === undefined) continue; // no src directory — nothing to compare (shouldn't happen for these packages)
  if (distNewest === undefined) {
    failures.push(`packages/${name}/dist does not exist.`);
  } else if (distNewest < srcNewest) {
    failures.push(`packages/${name}/dist is STALE (older than its own src).`);
  }
}

if (failures.length > 0) {
  console.error('\n[check-release-ready] REFUSING TO PUBLISH:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\n  Run `node scripts/build-bundle.mjs` (or `npm run build` in packages/sutradhar) for a ' +
      'real, clean rebuild, commit any resulting changes, then try publishing again.\n',
  );
  process.exit(1);
}

console.log('[check-release-ready] working tree clean, all workspace dependencies fresh — OK to publish.');
