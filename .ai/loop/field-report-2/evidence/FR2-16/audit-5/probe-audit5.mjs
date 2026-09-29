// audit-5 adversarial probe for fix-5's allow-list guard (stealth-claim-check.mjs).
// Each case inserts ONE false sentence into a scratch copy of the 12 tracked files, at a chosen
// position, and asks the real guard whether it produces any violation for that file.
// Positions: 'end' (append, as probe-audit4 did), 'mid' (after the middle line of the file),
// 'start' (after line 1), 'afterTpl' (immediately after the first line that contains the
// start of a canonical template -- i.e. inside an approved boundary paragraph).
// Run: node .ai/loop/field-report-2/evidence/FR2-16/audit-5/probe-audit5.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..', '..', '..', '..', '..', '..');
const mod = await import(new URL('file:///' + path.join(repo, 'tools/scenario-suite/fr2-16/stealth-claim-check.mjs').replace(/\\/g, '/')).href);
const { STEALTH_CLAIM_FILES, loadStealthClaimFiles, findStealthClaimViolations } = mod;

function insert(raw, sentence, pos, isTs) {
  const lines = raw.split('\n');
  const s = isTs ? `// ${sentence}` : sentence;
  let at;
  if (pos === 'end') return raw + `\n${s}\n`;
  if (pos === 'start') at = 1;
  if (pos === 'mid') at = Math.floor(lines.length / 2);
  if (pos === 'afterTpl') {
    at = lines.findIndex((l) => /does not attempt to evade|masks navigator\.webdriver via/.test(l));
    if (at < 0) return null;
    // advance to end of that paragraph (first blank line after it) so we don't split a template
    while (at < lines.length && lines[at].trim() !== '') at++;
  }
  lines.splice(at, 0, '', s, '');
  return lines.join('\n');
}

function probe(file, sentence, pos) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fr2-16-audit5-'));
  try {
    for (const rel of STEALTH_CLAIM_FILES) {
      const dst = path.join(scratch, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(repo, rel), dst);
    }
    const abs = path.join(scratch, file);
    const raw = fs.readFileSync(abs, 'utf8');
    const out = insert(raw, sentence, pos, /\.ts$/.test(file));
    if (out === null) return 'n/a';
    fs.writeFileSync(abs, out);
    const v = findStealthClaimViolations(scratch, loadStealthClaimFiles(scratch)).filter((x) => x.file === file);
    return v.length > 0 ? 'CAUGHT' : 'MISSED';
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const OPTS = 'packages/browser/src/launcher/browser-options.ts';
const LAUNCHER = 'packages/browser/src/launcher/browser-launcher.ts';
const CB = '.ai/competitive-benchmarks.md';
const H2H = 'tools/engine-comparison/head-to-head-comparison-2026-08-14.md';

// [id, category, file, sentence]
const CASES = [
  // --- A: zero-trigger claims that directly contradict the boundary (trigger-vocabulary holes) ---
  ['A1', 'trigger-hole: "undetectable"', 'README.md', 'Sutradhar is undetectable by anti-bot vendors.'],
  ['A2', 'trigger-hole: reCAPTCHA/hCaptcha (no \\b)', 'SECURITY.md', 'Sutradhar reliably gets past reCAPTCHA and hCaptcha challenges.'],
  ['A3', 'trigger-hole: evades/anti-bot', 'packages/browser/README.md', 'Sutradhar evades anti-bot systems such as DataDome and Akamai.'],
  ['A4', 'trigger-hole: disguises/masking', 'docs/ARCHITECTURE.md', 'Sutradhar disguises every automation marker, so sites cannot tell it apart from a human.'],
  ['A5', 'trigger-hole: detected/detect', 'AGENT_SETUP.md', 'Sites will not detect that Sutradhar is automated.'],
  ['A6', 'trigger-hole: false fact about --enable-automation', 'PROJECT_DEEP_DIVE.md', 'Sutradhar strips --enable-automation from the launch command line and rewrites the HeadlessChrome user agent by default.'],
  // --- B: GAP-127 re-introduction (self-flattering symmetric-fairness claim) with no trigger word ---
  ['B1', 'GAP-127 redux, no trigger', CB, 'All three tools were launched identically, so the comparison is fully symmetric and no tool had any masking advantage.'],
  ['B2', 'GAP-127 redux, no trigger', H2H, 'Both tools were launched identically with no automation-hiding of any kind on either side, so the comparison is perfectly fair.'],
  ['B3', 'GAP-127 redux, with trigger (the fix-5 known-limitation shape)', CB, 'Both tools launched with no stealth on any side; the retained flag makes no difference to that symmetry.'],
  ['B4', 'GAP-127 redux, with trigger', H2H, 'No stealth on any side: every tool, Sutradhar included, exposed navigator.webdriver=true.'],
  // --- C: narrative-disguise (dates, fractions, domains, pinchtab, whitelisted phrases) ---
  ['C1', 'narrative: ISO date', OPTS, 'In our 2026-08-14 benchmark, the AutomationControlled flag was shown to help launch stability.'],
  ['C2', 'narrative: fraction', OPTS, 'The AutomationControlled flag improved launch stability in 20/20 runs.'],
  ['C3', 'narrative: domain', 'SECURITY.md', 'Per developer.chrome.com, the AutomationControlled flag is a stability flag.'],
  ['C4', 'narrative: pinchtab name-drop', 'README.md', 'Unlike pinchtab, Sutradhar keeps the AutomationControlled flag purely for stability, not stealth.'],
  ['C5', 'narrative: whitelisted quoted flag literal', OPTS, "'--disable-blink-features=AutomationControlled' is kept purely for launch stability."],
  ['C6', 'narrative: whitelisted --no-sandbox', OPTS, 'Like --no-sandbox, the AutomationControlled flag is kept for stability.'],
  ['C7', 'narrative: whitelisted "is deliberately out of scope"', 'SECURITY.md', 'Evasion is deliberately out of scope, and the AutomationControlled flag is only a stability flag with no stealth effect.'],
  ['C8', 'narrative: whitelisted "sutradhar-mcp"', 'AGENT_SETUP.md', 'sutradhar-mcp keeps the AutomationControlled flag only for stability; it has no detection effect.'],
  ['C9', 'narrative: whitelisted "auto-detection"', 'README.md', 'Chrome auto-detection aside, the webdriver flag is purely a stability measure.'],
  ['C10', 'narrative: "task N"', 'docs/ARCHITECTURE.md', 'As task 1 showed, Sutradhar passes every bot-detection check and every CAPTCHA.'],
  // --- D: template-proximity (60-char approval margin) ---
  ['D1', 'template margin: after boundary paragraph', 'SECURITY.md', 'That flag is kept for stability, and it defeats Cloudflare.'],
  ['D2', 'template margin: after boundary paragraph', 'AGENT_SETUP.md', 'In practice it beats most CAPTCHA walls.'],
  // --- E: sibling flags ---
  ['E1', 'sibling flag, no trigger, in extra-trigger file', 'README.md', '--disable-infobars is there so Chrome does not crash on startup.'],
  ['E2', 'sibling flag in non-extra file', CB, '--enable-automation and --disable-infobars are kept for stability.'],
  ['E3', 'sibling flag, reason in vocab', OPTS, '--disable-infobars is kept for stability.'],
  // --- F: reason words outside the closed vocabulary (anaphoric, no trigger) ---
  ['F1', 'reason-vocab hole: resilient', OPTS, 'This flag makes launches more resilient.'],
  ['F2', 'reason-vocab hole: durable', LAUNCHER, 'These args exist so launches stay durable under load.'],
  ['F3', 'reason-vocab hole: dependable', OPTS, 'The flag is there for dependable startup.'],
  ['F4', 'reason-vocab hole: crash', LAUNCHER, 'Without this flag Chrome crashes on some machines.'],
  ['F5', 'reason-vocab hole: "for safety"', 'PROJECT_DEEP_DIVE.md', 'The retained flag is a safety default for automated launches.'],
  // --- G: control (should be caught) ---
  ['G1', 'control: plain trigger claim', OPTS, 'The AutomationControlled flag is kept for stability.'],
];

const POSITIONS = ['end', 'mid', 'start', 'afterTpl'];
const rows = [];
let missed = 0, total = 0;
for (const [id, cat, file, sentence] of CASES) {
  const res = {};
  for (const pos of POSITIONS) {
    res[pos] = probe(file, sentence, pos);
    if (res[pos] === 'MISSED') missed++;
    if (res[pos] !== 'n/a') total++;
  }
  rows.push({ id, cat, file, sentence, ...res });
  console.log(`${id.padEnd(4)} end=${res.end.padEnd(6)} mid=${res.mid.padEnd(6)} start=${res.start.padEnd(6)} afterTpl=${res.afterTpl.padEnd(6)} | ${cat} | ${file} :: ${JSON.stringify(sentence)}`);
}
console.log(`\nTOTAL insertions: ${total}, MISSED: ${missed}, CAUGHT: ${total - missed}`);
