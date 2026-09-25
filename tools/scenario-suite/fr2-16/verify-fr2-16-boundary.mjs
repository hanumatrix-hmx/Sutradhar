// Live-verify script for FR2-16 (stealth boundary honesty). No Chrome needed — this is a small,
// docs+dead-code item. See .ai/loop/field-report-2/evidence/FR2-16/spec.md §5.
//
// Steps:
//   1. Build @sutradhar/browser, assert success (proves the enableStealth/StealthEngine removal
//      doesn't break the package's own compile or any other monorepo consumer's typecheck).
//   2. Run the built CLI with no args, capture real stdout, check for the boundary substrings.
//   3. Read AGENT_SETUP.md and packages/browser/README.md from disk and assert the same
//      substrings/absences as the unit tests — self-contained live evidence.
//   4. Print a PASS/FAIL summary per surface; exit nonzero on any failure.
//
// Run: node tools/scenario-suite/fr2-16/verify-fr2-16-boundary.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { findStealthClaimViolations } from './stealth-claim-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');
const isWindows = process.platform === 'win32';

const results = [];
function record(surface, label, pass, detail) {
  results.push({ surface, label, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${surface}: ${label}${detail ? ` (${detail})` : ''}`);
}

// --- Step 1: build @sutradhar/browser (and packages/cli, since we run its built output next) ---
console.log('=== Step 1: build @sutradhar/browser ===');
const browserBuild = spawnSync(isWindows ? 'npx.cmd' : 'npx', ['tsc'], {
  cwd: path.join(repoRoot, 'packages', 'browser'),
  encoding: 'utf8',
  shell: isWindows,
});
console.log(browserBuild.stdout || '');
console.log(browserBuild.stderr || '');
record(
  '@sutradhar/browser',
  'tsc build succeeds after enableStealth/StealthEngine removal',
  browserBuild.status === 0,
  `exit code ${browserBuild.status}`,
);

console.log('\n=== Step 1b: build @sutradhar/cli ===');
const cliBuild = spawnSync(isWindows ? 'npx.cmd' : 'npx', ['tsc'], {
  cwd: path.join(repoRoot, 'packages', 'cli'),
  encoding: 'utf8',
  shell: isWindows,
});
console.log(cliBuild.stdout || '');
console.log(cliBuild.stderr || '');
record('@sutradhar/cli', 'tsc build succeeds', cliBuild.status === 0, `exit code ${cliBuild.status}`);

// --- Step 2: run the built CLI with no args, capture real stdout ---
console.log('\n=== Step 2: run built CLI with no args ===');
const cliDistPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
let cliStdout = '';
if (fs.existsSync(cliDistPath)) {
  const run = spawnSync('node', [cliDistPath], { encoding: 'utf8', cwd: repoRoot });
  cliStdout = run.stdout || '';
  console.log(cliStdout);
  if (run.stderr) console.error(run.stderr);
} else {
  console.log(`FAIL: built CLI not found at ${cliDistPath} — build step must have failed`);
}

record('CLI --help (built, run with no args)', 'contains "CAPTCHA"', cliStdout.includes('CAPTCHA'));
record('CLI --help (built, run with no args)', 'contains "bot-detection"', cliStdout.includes('bot-detection'));
record('CLI --help (built, run with no args)', 'contains "Cloudflare"', cliStdout.includes('Cloudflare'));
record(
  'CLI --help (built, run with no args)',
  'contains "does not attempt to evade" and "bot-detection or solve CAPTCHAs" (checked as two adjacent substrings since the phrase wraps across a source line; stdout preserves the source\'s own line breaks, it does not re-wrap them)',
  cliStdout.includes('does not attempt to evade') && cliStdout.includes('bot-detection or solve CAPTCHAs'),
);

// --- Step 3: read AGENT_SETUP.md and packages/browser/README.md from disk ---
console.log('\n=== Step 3: read docs from disk ===');
const agentSetup = fs.readFileSync(path.join(repoRoot, 'AGENT_SETUP.md'), 'utf8');
const readme = fs.readFileSync(path.join(repoRoot, 'packages', 'browser', 'README.md'), 'utf8');

record(
  'AGENT_SETUP.md',
  'still contains "No stealth or bot-detection evasion, by design."',
  agentSetup.includes('No stealth or bot-detection evasion, by design.'),
);
record('AGENT_SETUP.md', 'mentions "Cloudflare"', agentSetup.includes('Cloudflare'));
record('AGENT_SETUP.md', 'mentions "CAPTCHA"', agentSetup.includes('CAPTCHA'));

record('packages/browser/README.md', 'does NOT contain "stealth launcher"', !readme.includes('stealth launcher'));
record(
  'packages/browser/README.md',
  'does NOT contain "Stealth Launch Policy"',
  !readme.includes('Stealth Launch Policy'),
);
record(
  'packages/browser/README.md',
  'does NOT contain "bypass bot detection"',
  !readme.includes('bypass bot detection'),
);
record(
  'packages/browser/README.md',
  'does NOT reference "0005-stealth-evasion"',
  !readme.includes('0005-stealth-evasion'),
);
record(
  'packages/browser/README.md',
  'contains "Detection-Evasion Boundary" replacement invariant',
  readme.includes('Detection-Evasion Boundary'),
);
record('packages/browser/README.md', 'mentions "Cloudflare"', readme.includes('Cloudflare'));
record('packages/browser/README.md', 'mentions "CAPTCHA"', readme.includes('CAPTCHA'));
record(
  'packages/browser/README.md',
  'states the honest navigator.webdriver exception (GAP-101)',
  readme.toLowerCase().includes('navigator.webdriver'),
);
record(
  'AGENT_SETUP.md',
  'states the honest navigator.webdriver exception (GAP-101)',
  agentSetup.toLowerCase().includes('navigator.webdriver'),
);
record(
  'CLI --help (built, run with no args)',
  'states the honest navigator.webdriver exception (GAP-101)',
  cliStdout.toLowerCase().includes('navigator.webdriver'),
);
// --- GAP-103: README's 4th contradictory spot (module-layout line naming src/stealth/) must
// stay gone. Mutation-tested: see fix-2/mutation-tests.log.
record(
  'packages/browser/README.md',
  'Sub-Module Layout section does not mention src/stealth/ (GAP-103)',
  !readme.includes('src/stealth/'),
);
record(
  'packages/browser/README.md',
  'does not mention "stealth launch flags" (GAP-120 -- previously only doc-static caught this)',
  !readme.toLowerCase().includes('stealth launch flags'),
);

// --- GAP-118/120/122-131: rebuilt ALLOW-LIST guard (fix-5), run live here too so this script
// and doc-static.spec.mjs are properly redundant with each other. See stealth-claim-check.mjs
// for the full 12-file list, canonical templates, and narrative-window design this replaces
// the old deny-list (pattern-family) check with.
const claimViolations = findStealthClaimViolations(repoRoot);
record(
  'stealth-claim-check (12 tracked surfaces)',
  'every stealth/webdriver/detection mention traces to an approved canonical sentence or narrative context (GAP-118/120/122-131)',
  claimViolations.length === 0,
  claimViolations.map((v) => `${v.file}: "${v.trigger}" in "...${v.context}..."`).join('; '),
);

// --- Step 4: summary ---
console.log('\n=== Summary ===');
const bySurface = new Map();
for (const r of results) {
  if (!bySurface.has(r.surface)) bySurface.set(r.surface, []);
  bySurface.get(r.surface).push(r);
}
let overallOk = true;
for (const [surface, checks] of bySurface) {
  const failed = checks.filter((c) => !c.pass);
  console.log(`${surface}: ${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) overallOk = false;
}
console.log(`\nOVERALL: ${overallOk ? 'PASS' : 'FAIL'}`);
process.exit(overallOk ? 0 : 1);
