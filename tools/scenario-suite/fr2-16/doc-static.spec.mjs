// Doc-static consistency test for FR2-16 (stealth boundary honesty). Grep-based, no build or
// Chrome needed — checks the three public-facing surfaces (packages/browser/README.md,
// AGENT_SETUP.md, packages/cli/src/cli.ts's --help text) stay consistent with each other and
// with the "no detection-evasion" decision recorded in
// .ai/loop/field-report-2/evidence/FR2-16/spec.md. See spec §4 (items 5-8) and §6 (negative
// case 4: must not overclaim in the other direction either).
//
// Run: node tools/scenario-suite/fr2-16/doc-static.spec.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findStealthClaimViolations } from './stealth-claim-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..');

const readmePath = path.join(repoRoot, 'packages', 'browser', 'README.md');
const agentSetupPath = path.join(repoRoot, 'AGENT_SETUP.md');
const cliPath = path.join(repoRoot, 'packages', 'cli', 'src', 'cli.ts');
const browserOptionsPath = path.join(
  repoRoot,
  'packages',
  'browser',
  'src',
  'launcher',
  'browser-options.ts',
);
const projectDeepDivePath = path.join(repoRoot, 'PROJECT_DEEP_DIVE.md');

const readme = fs.readFileSync(readmePath, 'utf8');
const agentSetup = fs.readFileSync(agentSetupPath, 'utf8');
const cli = fs.readFileSync(cliPath, 'utf8');
const browserOptions = fs.readFileSync(browserOptionsPath, 'utf8');
const projectDeepDive = fs.readFileSync(projectDeepDivePath, 'utf8');

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`PASS: ${label}`);
  } else {
    console.log(`FAIL: ${label}`);
    failures += 1;
  }
}

// --- README.md must NOT contain any of the four old contradictory spots (spec §4.5) ---
check(
  'README.md does not contain "stealth launcher" (old tagline)',
  !readme.includes('stealth launcher'),
);
check(
  'README.md does not contain "Stealth Launch Policy" (old invariant #2 heading)',
  !readme.includes('Stealth Launch Policy'),
);
check(
  'README.md does not contain "bypass bot detection" (old invariant #2 body)',
  !readme.includes('bypass bot detection'),
);
check(
  'README.md does not reference "0005-stealth-evasion" (dangling ADR reference — no such ADR file exists in docs/adr/)',
  !readme.includes('0005-stealth-evasion'),
);

// --- AGENT_SETUP.md must STILL contain its existing honest boundary text (spec §4.6, regression guard) ---
check(
  'AGENT_SETUP.md still contains "No stealth or bot-detection evasion, by design."',
  agentSetup.includes('No stealth or bot-detection evasion, by design.'),
);

// --- CLI --help text must contain the boundary substrings (spec §4.7) ---
check('cli.ts help text contains "CAPTCHA"', cli.includes('CAPTCHA'));
check('cli.ts help text contains "bot-detection"', cli.includes('bot-detection'));

// --- Cross-check: all three surfaces share "Cloudflare" and "CAPTCHA" (spec §4.8) ---
// This is the exact failure this item exists to fix: one surface saying something the others
// contradict or omit.
for (const [label, text] of [
  ['packages/browser/README.md', readme],
  ['AGENT_SETUP.md', agentSetup],
  ['packages/cli/src/cli.ts', cli],
]) {
  check(`${label} mentions "Cloudflare"`, text.includes('Cloudflare'));
  check(`${label} mentions "CAPTCHA"`, text.includes('CAPTCHA'));
  // GAP-101 fix: every surface must state the one honest exception (the retained flag hides
  // navigator.webdriver) rather than implying the browser is undisguised in every respect.
  check(
    `${label} states the honest navigator.webdriver exception`,
    text.toLowerCase().includes('navigator.webdriver'),
  );
}

// --- Negative case 4 (spec §6.4): must not overclaim in the OTHER direction — no surface may
// claim total/universal failure against Cloudflare; the honest claim is specific
// (bot-detection/CAPTCHA challenges), not a blanket "never works on any Cloudflare-fronted site".
for (const [label, text] of [
  ['packages/browser/README.md', readme],
  ['AGENT_SETUP.md', agentSetup],
  ['packages/cli/src/cli.ts', cli],
]) {
  check(
    `${label} does not overclaim with "never works on any Cloudflare"`,
    !text.toLowerCase().includes('never works on any cloudflare'),
  );
}

// --- README invariant #2 replacement text present verbatim-ish (spec §2) ---
check(
  'README.md contains the "Detection-Evasion Boundary" replacement invariant',
  readme.includes('Detection-Evasion Boundary'),
);

// --- GAP-103: README's 4th contradictory spot (the module-layout line naming src/stealth/)
// must stay gone. Neither this check nor the live-verify script guarded this spot before —
// mutation-tested by re-inserting the line and confirming this check fails (see fix-2 evidence).
check(
  'README.md Sub-Module Layout section does not mention src/stealth/',
  !readme.includes('src/stealth/'),
);
check(
  'README.md does not mention "stealth launch flags" (old module-layout description)',
  !readme.toLowerCase().includes('stealth launch flags'),
);

// --- GAP-118/120/122-131: rebuilt ALLOW-LIST guard (fix-5). This replaces the deny-list guard
// (a hand-written family of "known-bad phrasing" regexes) that failed four audits running,
// most recently 0/19 new synonym mutations caught in audit-4. Every stealth/webdriver/
// detection mention across the 12 tracked surfaces must now trace to one of a small set of
// pre-approved canonical sentences, or be recognized as narrative (a specific, dated/scored
// real event) — anything else fails closed. See stealth-claim-check.mjs for the full file
// list, canonical templates, and narrative-window design.
const violations = findStealthClaimViolations(repoRoot);
check(
  `no unapproved stealth/webdriver/detection claim in any of the ${12} tracked surfaces (GAP-118/120/122-131)`,
  violations.length === 0,
);
for (const v of violations) {
  console.log(`  -> VIOLATION: ${v.file} :: "${v.trigger}" in context "...${v.context}..."`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
