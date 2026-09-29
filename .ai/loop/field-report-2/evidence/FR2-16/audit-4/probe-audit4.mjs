// audit-4 adversarial probe: appends each candidate sentence to a scratch copy of a tracked
// file and runs the REAL shipped guard (findStealthClaimViolations) against it.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { repoRoot, STEALTH_CLAIM_FILES, loadStealthClaimFiles, findStealthClaimViolations } from '../../../../../../tools/scenario-suite/fr2-16/stealth-claim-check.mjs';
function run(file, sentence) {
  const s = fs.mkdtempSync(path.join(os.tmpdir(), 'a4-'));
  try {
    for (const rel of STEALTH_CLAIM_FILES) { const d = path.join(s, rel); fs.mkdirSync(path.dirname(d), {recursive:true}); fs.copyFileSync(path.join(repoRoot, rel), d); }
    fs.appendFileSync(path.join(s, file), `\n${sentence}\n`);
    return findStealthClaimViolations(s, loadStealthClaimFiles(s)).filter(v => v.file === file);
  } finally { fs.rmSync(s, {recursive:true, force:true}); }
}
const F = 'packages/browser/src/launcher/browser-options.ts';
const cases = [
  // --- reproductions of 3 of the Executor's own mutation entries ---
  ['REPRO', F, '--disable-blink-features=AutomationControlled is kept for stability, a chrome-recommended stability flag, not detection-evasion.'],
  ['REPRO', 'packages/browser/src/launcher/browser-launcher.ts', 'Generates sanitized launch arguments (see DEFAULT_LAUNCH_ARGS for the stability flags that are always included, unconditionally).'],
  ['REPRO', 'SECURITY.md', 'It is a compatibility flag, nothing more.'],
  ['REPRO', 'README.md', 'Hiding navigator.webdriver is just a side effect of this flag, not its purpose.'],
  // --- auditor's brief-suggested synonym family ---
  ['SYN', F, 'The --disable-blink-features=AutomationControlled flag is chosen for compatibility reasons.'],
  ['SYN', F, 'The AutomationControlled flag helps avoid launch instability.'],
  ['SYN', F, 'This argument improves reliability.'],
  ['SYN', F, 'It is necessary for consistent behavior across Chrome versions.'],
  ['SYN', F, 'The flag is included by default. This helps launches remain stable.'],
  ['SYN', F, 'The AutomationControlled flag is retained for stability.'],
  ['SYN', F, 'DEFAULT_LAUNCH_ARGS exists purely to keep Chrome stable under automation.'],
  ['SYN', F, 'This flag improves launch stability.'],
  ['SYN', F, 'The flag is kept for robustness, not detection evasion.'],
  ['SYN', 'PROJECT_DEEP_DIVE.md', 'The retained flag is a Chrome-recommended default for automation.'],
  ['SYN', 'SECURITY.md', 'Nothing in the launcher masks automation signals.'],
  ['SYN', 'SECURITY.md', 'Sutradhar does not modify navigator.webdriver or any other automation signal.'],
  ['SYN', 'README.md', 'Sutradhar launches a completely stock Chrome with no fingerprint changes at all.'],
  ['SYN', 'README.md', 'The flag hides every automation signal.'],
  ['SYN', 'README.md', 'This flag hides all the automation signals.'],
  ['SYN', 'README.md', 'navigator.webdriver hiding is merely incidental to this flag.'],
  ['SYN', 'README.md', 'Hiding navigator.webdriver is a byproduct of this flag.'],
  ['SYN', 'docs/ARCHITECTURE.md', 'Sutradhar launches a plain undisguised Chrome.'],
  ['SYN', 'docs/ARCHITECTURE.md', 'Sutradhar launches an undisguised, plain browser.'],
  // --- negation-lookback exploits (real false claim, suppressed by an unrelated nearby "not") ---
  ['NEG', F, 'Do not remove this stability flag.'],
  ['NEG', F, 'This is not optional: it is a stability flag.'],
  ['NEG', F, 'Never drop the stability flags from DEFAULT_LAUNCH_ARGS.'],
  ['NEG', F, "Don't remove it; it is a stability flag."],
  ['NEG', 'SECURITY.md', 'It is not optional -- a compatibility flag Chrome needs.'],
  // --- negation that SHOULD be honest (checking false-positive side) ---
  ['HONEST', F, "The flag doesn't act as a stability flag; it hides navigator.webdriver."],
  ['HONEST', F, 'Contrary to older docs, this is not in any sense a stability flag.'],
  ['HONEST', F, 'It is not a stability flag.'],
];
for (const [kind, file, sentence] of cases) {
  const v = run(file, sentence);
  console.log(`${v.length ? 'CAUGHT ' : 'MISSED '} [${kind}] ${file} :: ${JSON.stringify(sentence)}${v.length ? '  <- ' + v.map(x=>x.pattern.slice(0,40)).join(' | ') : ''}`);
}
