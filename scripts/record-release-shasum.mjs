#!/usr/bin/env node
/**
 * @file scripts/record-release-shasum.mjs
 * @description `postpack` hook for `packages/sutradhar` — after `npm pack`/`npm publish`
 * creates the tarball, records its sha256 (version, date, filename, shasum) into an in-repo log
 * so a past published artifact can later be verified against what's actually on the npm
 * registry, instead of being unrecoverable-from-git the way a prior release's mismatch with its
 * own source tree was (see the Phase 6 investigation in .ai/known-problems.md).
 *
 * Runs automatically (wired as `postpack` in packages/sutradhar/package.json) — never needs to
 * be invoked by hand. Writes RELEASE-SHASUMS.md in the package directory; this file is an
 * append-only audit log, so commit it after a real publish (the shasum obviously can't be
 * embedded inside the very tarball it describes, so this step necessarily runs after packing —
 * expect this file to show as a new uncommitted change right after `npm publish` finishes).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, appendFileSync, existsSync, writeFileSync, statSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(__dirname, '..', 'packages', 'sutradhar');

// npm pack/publish write the tarball as `<name>-<version>.tgz` in the current working
// directory by default (no --pack-destination override here) — find the newest .tgz there.
const tgzCandidates = readdirSync(packageDir)
  .filter((f) => f.endsWith('.tgz'))
  .map((f) => ({ f, mtime: statSync(path.join(packageDir, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (tgzCandidates.length === 0) {
  console.warn('[record-release-shasum] No .tgz found in packages/sutradhar — skipping shasum record.');
  process.exit(0); // don't fail the publish over this — it's an audit convenience, not a gate
}

const tgzPath = path.join(packageDir, tgzCandidates[0].f);
const bytes = readFileSync(tgzPath);
const shasum = createHash('sha256').update(bytes).digest('hex');

const pkgJson = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf-8'));
const logPath = path.join(packageDir, 'RELEASE-SHASUMS.md');
if (!existsSync(logPath)) {
  writeFileSync(
    logPath,
    '# Release shasums\n\n' +
      'Append-only audit log — one line per published tarball, so a past release can be verified ' +
      'against what actually shipped. Recorded automatically by `scripts/record-release-shasum.mjs` ' +
      '(the `postpack` hook) on every `npm pack`/`npm publish`.\n\n' +
      '| Date | Version | File | SHA-256 |\n' +
      '|---|---|---|---|\n',
  );
}
const row = `| ${new Date().toISOString().slice(0, 10)} | ${pkgJson.version} | ${tgzCandidates[0].f} | \`${shasum}\` |\n`;
appendFileSync(logPath, row);

console.log(`[record-release-shasum] ${tgzCandidates[0].f} sha256=${shasum}`);
console.log(`[record-release-shasum] recorded to packages/sutradhar/RELEASE-SHASUMS.md — commit this file after publishing.`);
