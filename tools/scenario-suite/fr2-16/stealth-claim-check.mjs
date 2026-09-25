// Allow-list guard for FR2-16 (stealth boundary honesty) — fix-5 rebuild.
//
// *** KNOWN LIMITATION — READ BEFORE TRUSTING A PASSING RUN ***
// audit-5 (2026-09-25, .ai/loop/field-report-2/evidence/FR2-16/audit-5/) proved this checker
// itself can be bypassed: text containing none of the ~11 trigger words (e.g. "undetectable",
// "evades anti-bot systems", "reCAPTCHA") is never inspected at all (GAP-138), and the
// "narrative" exemption (skip text near a date/score/domain/name) can be gamed to smuggle a
// false claim past the check anywhere in a file, not just at the end (GAP-139/140). Measured
// blind-zone coverage: 35.9%-76.1% of the checked files' text sits in a zone this checker
// cannot fail on, depending on the file. FR2-16 was marked BLOCKED over this (see
// decisions.md's "FR2-16 BLOCKED" entry) — a regex/allow-list classifier cannot reliably
// enforce honesty in free prose. This checker is kept as a best-effort regression guard
// against the SPECIFIC 21 bypasses discovered through audit-4/5 (it does catch those), not as
// a guarantee that these files are honest. Any future edit to a checked file's stealth/
// detection-related prose still needs a human (or Orchestrator) read, not just a green run of
// this script.
//
// This REPLACES the deny-list guard (a hand-written family of "known-bad phrasing" regexes)
// that failed four audits in a row: each round added patterns for the specific bad
// wordings an auditor had already found, and each round a new synonym walked straight
// through the gap (0 of 19 new synonym mutations were caught in audit-4 — see
// .ai/loop/field-report-2/evidence/FR2-16/audit-4/probe-audit4.{mjs,log}). A deny-list is
// structurally the wrong shape for this problem: the space of ways to word a false claim is
// unbounded, so no fixed list of "known-bad phrases" can ever be complete.
//
// The allow-list inverts the failure mode. Every place in the checked files that talks about
// the retained launch flag / navigator.webdriver / stealth / bot-detection must now be traced
// to one of a SMALL set of pre-approved, honest canonical sentences (CANONICAL_TEMPLATES
// below) — or be recognized as plain narrative (a report of a specific, dated/scored/named
// real event, e.g. "Cloudflare blocked task 312 on crunchbase.com on 2026-08-15"), which makes
// no general claim about Sutradhar's own detection posture and therefore isn't in scope for
// this check. Anything that is neither an approved canonical sentence NOR narrative FAILS
// CLOSED — a brand new, never-seen-before wording doesn't get a free pass the way it would
// under a deny-list; it forces a human/Orchestrator look. This is deliberately a smaller
// "positive" vocabulary (a handful of exact honest sentences) rather than a larger "negative"
// one (an ever-growing list of dishonest ones), because positive honest claims about a single
// well-understood mechanism are a closed, enumerable set — dishonest rephrasings of it are not.
//
// Mechanism (no sentence-splitting — regex sentence boundaries are themselves fragile, see
// GAP-123's line-wrap bypass on the OLD guard): every file is whitespace-collapsed and
// markdown/comment-decoration-stripped into one flat normalized string. Every occurrence of a
// TRIGGER word (webdriver, stealth, detection, automation-controlled, bot-detection, captcha,
// cloudflare, fingerprint, "plain browser", "undisguised") is located in that flat string.
// For each occurrence, the guard asks two questions, in order:
//   1. Does this occurrence fall inside (or within a small margin of) a verbatim match of one
//      of CANONICAL_TEMPLATES? If yes, it's accounted for — approved.
//   2. Otherwise, is this occurrence inside a NARRATIVE window — near a domain-like token
//      (site.com), an explicit task/sample/milestone number, an ISO date, a benchmark score
//      fraction (n/m), or a named non-Sutradhar technology this file is allowed to discuss
//      (Selenium/WebDriver, WebDriver-BiDi, pinchtab's own stealthLevel, Playwright/Puppeteer
//      launched "plain")? If yes, it's a specific, checkable, dated real-world report, not a
//      general claim about Sutradhar's own posture — out of scope for this check.
// If neither, it's a VIOLATION: an unapproved, unaccounted-for mention of this topic.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.join(here, '..', '..', '..');

// --- Complete, explicit file list -------------------------------------------------------
// Same 11 files fix-4 checked, PLUS the 12th file audit-4/GAP-127 found missing:
// tools/engine-comparison/head-to-head-comparison-2026-08-14.md.
export const STEALTH_CLAIM_FILES = [
  'packages/browser/README.md',
  'packages/browser/src/launcher/browser-options.ts',
  'packages/browser/src/launcher/browser-launcher.ts',
  'PROJECT_DEEP_DIVE.md',
  'SECURITY.md',
  '.ai/competitive-benchmarks.md',
  'packages/browser/package.json',
  'README.md',
  'docs/ARCHITECTURE.md',
  'AGENT_SETUP.md',
  'packages/cli/src/cli.ts',
  'tools/engine-comparison/head-to-head-comparison-2026-08-14.md',
];

/** Strips markdown/comment decoration and collapses whitespace so matching is format-agnostic. */
function normalize(text) {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m) // keep code fences' content, just don't treat ``` as noise removal boundary
    .replace(/[`*_#]/g, '') // markdown emphasis/heading/backtick decoration
    .replace(/^\s*\/\/\s?/gm, '') // leading `//` line-comment markers
    .replace(/^\s*\*\s?/gm, '') // leading ` * ` JSDoc continuation markers
    .replace(/\s+/g, ' ')
    .trim();
}

export function loadStealthClaimFiles(root = repoRoot) {
  return STEALTH_CLAIM_FILES.map((rel) => {
    const abs = path.join(root, rel);
    const raw = fs.readFileSync(abs, 'utf8');
    return { rel, abs, raw, flat: normalize(raw) };
  });
}

// --- Trigger words -----------------------------------------------------------------------
export const TRIGGER_RE = /\b(webdriver|stealth|detection|automation-?controlled|bot-?detection|captcha|cloudflare|fingerprint|plain browser|undisguised|automation signals?)\b/gi;

// The launcher source files (browser-options.ts, browser-launcher.ts) are near-exclusively
// ABOUT the retained launch flag / DEFAULT_LAUNCH_ARGS -- unlike the other 10 files, a claim
// there can refer back to "the flag"/"this argument" anaphorically without repeating
// webdriver/AutomationControlled/etc by name (the actual shape of GAP-122's real historical
// false claim: "...the stability flags that are always included, unconditionally" -- no
// TRIGGER_RE word at all). So these two files get an EXTRA, file-scoped set of generic
// topic-noun anchors (flag/argument/arg, not reason-words) so a bare reference still gets
// caught. This is a small, closed vocabulary for "the name of a command-line switch," not an
// open-ended list of ways to lie about one -- and it is scoped to just these two files
// specifically because generic words like "flag"/"argument" are common and unrelated
// elsewhere (e.g. cli.ts's CLI-argument-parsing prose, which is not about this topic at all).
// A bare "flag"/"argument" word is far too generic to use as a trigger on its own -- it also
// matches ordinary code (`args?: readonly string[]`, `userArgs`, an unrelated @description
// header). Scoping to a fixed file *section* doesn't work either, because the bypass this is
// for is exactly a NEW sentence appended somewhere unpredictable (see probe-audit4.mjs, which
// appends at end of file). So the extra anchor here requires flag-word AND reason-word
// CO-OCCURRENCE within a short window: a flag/argument reference is only topic-relevant to
// this check when it's paired, nearby, with language giving it a purpose/justification. This
// is a narrower, purely anchor-detecting use of a small reason-word set (to decide "does this
// sentence need checking at all"), not the verdict itself -- the verdict is still "does it
// match an approved template," so a reason-word this list doesn't happen to include is a
// residual gap in flagging (not in verdict correctness): documented, not hidden.
const FLAG_WORD_RE = /\b(flags?|arguments?|args|default_?launch_?args)\b/i;
const REASON_WORD_RE =
  /\b(stab\w*|reliab\w*|consist\w*|robust\w*|compat\w*|purpose|purely|necess\w*|helps?|improves?|avoid\w*|prevent\w*|recommend\w*|chosen|retained|kept|optional)\b/i;
// Window is deliberately wide (400 chars, roughly a paragraph) so a purely anaphoric
// follow-on sentence ("It is necessary for consistent behavior...") that never repeats
// "flag"/"argument" by name still gets caught by virtue of appearing near a paragraph that
// does -- while still being narrow enough to stay well clear of unrelated code elsewhere in
// the same file (e.g. the `findExecutablePath` candidate-path list's "chrome-stable" string,
// which has no "flag"/"argument" mention anywhere near it).
function findExtraTriggerOffsets(flat, window) {
  const offsets = [];
  const reasonRe = new RegExp(REASON_WORD_RE.source, 'gi');
  let m;
  while ((m = reasonRe.exec(flat))) {
    const windowStart = Math.max(0, m.index - window);
    const windowEnd = Math.min(flat.length, m.index + m[0].length + window);
    if (FLAG_WORD_RE.test(flat.slice(windowStart, windowEnd))) {
      offsets.push(m.index);
    }
  }
  return offsets;
}
// Applied to the 9 "boundary" docs/source files where the retained flag is a near-exclusive
// topic (everything except the 2 benchmark-log files and package.json). The 2 launcher source
// files get a WIDE window (400 chars) because they're short and single-topic enough that a
// purely anaphoric follow-on sentence ("It is necessary for consistent behavior...", no
// flag/argument word at all) still needs to reach back to an earlier "flag" mention. The other
// 7 prose docs get a NARROWER window (100 chars) because they're multi-topic (setup
// instructions, unrelated CLI flags) where a wide window produces collateral false positives
// (e.g. AGENT_SETUP.md's MCP `--package` setup instructions, which separately mention
// "recommended"/"optional" near an unrelated "args" JSON field).
const EXTRA_TRIGGER_FILES = new Map([
  ['packages/browser/src/launcher/browser-options.ts', 400],
  ['packages/browser/src/launcher/browser-launcher.ts', 400],
  ['packages/browser/README.md', 100],
  ['PROJECT_DEEP_DIVE.md', 100],
  ['SECURITY.md', 100],
  ['README.md', 100],
  ['docs/ARCHITECTURE.md', 100],
  ['AGENT_SETUP.md', 100],
  ['packages/cli/src/cli.ts', 100],
]);

// --- Canonical approved templates ---------------------------------------------------------
// Small, fixed, Orchestrator-reviewable set. Every one is a real, honest, already-verified
// claim (see fix-5's live-verify re-run of audit-4's live-webdriver-asymmetry.cjs). Adding a
// new one is a deliberate, visible act — not something a stray rewording can slip into.
//
// Style A — long prose (README.md-style docs: root README, packages/browser/README.md,
// PROJECT_DEEP_DIVE.md, SECURITY.md, AGENT_SETUP.md, docs/ARCHITECTURE.md).
const T_BOUNDARY_NOEVADE =
  "Sutradhar does not attempt to evade bot-detection or solve CAPTCHAs, and Cloudflare challenges, CAPTCHA walls, and IP-level blocks stop it exactly as they would stop any other automation tool run the same way.";
const T_BOUNDARY_ONLYFLAG =
  "The only launch argument here with detection-relevant behavior is --disable-blink-features=AutomationControlled, which hides navigator.webdriver from scripts that check for it -- measured directly: navigator.webdriver is true without the flag and false with it.";
const T_BOUNDARY_LIMITS =
  "It does not defeat Cloudflare, CAPTCHA, or any other real bot-detection service, and other simple signals -- the default headless user agent's HeadlessChrome substring and --enable-automation still being present in the launch command line -- remain unmasked.";

// Style B — benchmark-methodology disclosure (GAP-127 fix): the comparison's own fairness
// claim must disclose the one real, narrow asymmetry it doesn't control for, rather than
// asserting a symmetric "no stealth on any side" that audit-4 live-proved false.
// Deliberately no trailing period: this exact-substring template is reused inside a
// parenthetical aside at one insertion site, so callers supply their own closing punctuation
// (". " or ")") right after it.
const T_BENCHMARK_ASYMMETRY =
  "Sutradhar's launch masks navigator.webdriver via its retained --disable-blink-features=AutomationControlled flag; the other tool(s) in this comparison, launched plain, do not -- a real, narrow asymmetry favoring Sutradhar that these numbers do not control for";

// Optional, reusable supporting fact (not itself a claim about WHY the flag is kept -- it's
// independent, checkable evidence about how Chromium classifies the flag -- but it contains
// "recommend" and sits near "flag," so it's listed as its own approved template rather than
// left to accidentally overlap the boundary templates above).
const T_CHROMIUM_UNSUPPORTED =
  "Chromium's own source (bad_flags_prompt.cc) classifies --disable-blink-features as unsupported, developer-only -- the opposite of a Chrome recommendation -- and a live headed launch with this flag present still shows Chrome's own \"Chrome is being controlled by automated test software\" banner.";

export const CANONICAL_TEMPLATES = [
  { name: 'boundary: does-not-evade', text: T_BOUNDARY_NOEVADE },
  { name: 'boundary: only-flag', text: T_BOUNDARY_ONLYFLAG },
  { name: 'boundary: limits/unmasked-signals', text: T_BOUNDARY_LIMITS },
  { name: 'benchmark: webdriver-asymmetry disclosure', text: T_BENCHMARK_ASYMMETRY },
  { name: 'supporting fact: Chromium classifies flag unsupported', text: T_CHROMIUM_UNSUPPORTED },
].map((t) => ({ ...t, flat: normalize(t.text) }));

/** Finds all [start,end) ranges where `needle` occurs in `haystack` (normalized, literal). */
function findAllRanges(haystack, needle) {
  const ranges = [];
  if (!needle) return ranges;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    ranges.push([idx, idx + needle.length]);
    idx += 1;
  }
  return ranges;
}

function isWithinAnyRange(offset, ranges, margin = 60) {
  return ranges.some(([s, e]) => offset >= s - margin && offset <= e + margin);
}

// --- Narrative-window recognizer -----------------------------------------------------------
// Recognizes text that reports a SPECIFIC, checkable, external real-world event/entity rather
// than making a general claim about Sutradhar's own detection posture. This is a structural
// classifier (domain names, dates, numbers, named third-party tech) — not a content judgment
// about whether a claim is honest, so it can't be used to launder a false general claim the
// way a deny-list bypass could: a fabricated "site123.com says the flag is for stability"
// would still read as an obviously fabricated citation under Orchestrator/human review, which
// is exactly the "fail closed, force a look" behavior this redesign is for on anything
// unfamiliar — this check does not claim to be adversarially unbeatable, only structurally
// different in kind from re-listing bad phrasings.
const NARRATIVE_RE =
  /\b[\w-]+\.(com|org|net|edu|gov|io)\b|\btask\s*\d+\b|\bsample\s*\d+\b|\bmilestones?\s*\d{1,3}\b|\b20\d\d-\d\d-\d\d\b(?!\.(md|mjs|cjs|json))|\b\d+\/\d+\b|\bselenium\b|\bwebdriver-bidi\b|\bstealthlevel\b|\/stealth\/status\b|\bstealth injection\b|\blaunched plain\b|\blight level\b|\bstealthengine\b|\bpackages\/browser\/src\/stealth\b|['"]--disable-blink-features=automationcontrolled['"]|--disable-blink-features=automationcontrolled,\s*--|\bcycle detection\b|\bstuck[\s-]loop detection\b|\bstuck detection\b|\bocclusion detection\b|\bport-range\/duplicate detection\b|\bchrome detection\b|\bsee\s+\S*\.md'?s\s+(known\s+limitations|(scope\s+)?boundary)\b|\bdetection-evasion\s*(\/\s*stealth|boundary)\b|\bis\s+deliberately\s+out\s+of\s+scope\b|\bplain browser extension\b|--no-sandbox|--disable-setuid-sandbox|\bno stealth or bot-detection evasion, by design\b|--package=sutradhar|\bsutradhar-mcp\b|\bcaused by the stealth setting\b|\bfair \(non-stealth\) comparison\b|\bsame as always\)|\bstandard practice even in plain automation setups, not active evasion\b|\bexcept mask navigator\.webdriver itself via its one retained launch flag\b|\bwebdriver masking is not part of that remaining gap\b|\bexplained by a stealth-default asymmetry\b|\benv\s+auto-detection\b|\bauto-detection\b|\breal external walls\b|\bcaptcha\/hcaptcha\b|\bpinchtab\b|\bis deliberately (out of scope|excluded)\b|\bheadless-chrome-from-a-datacenter-ip detection\b/i;

// "Cloudflare" (and DataDome) show up constantly in this doc's benchmark-run narration --
// reporting real external blocks the tool hit -- which is exactly the narrative category
// (a specific, checkable real event), not a general claim about Sutradhar's own posture. This
// is a co-occurrence check (Cloudflare/DataDome within a short window of an actual
// block-shaped word) rather than a single regex, since the surface wording varies too much
// for one pattern (interstitial(s), Cloudflare's own, managed challenge, prevalence, ...).
const BLOCK_WORD_RE = /\b(interstitials?|challenges?|blocks?|denys?|denied|denies|walls?|turnstiles?|prevalence|datadome|shimming)\b/i;
function isCloudflareBlockNarrative(flat, offset) {
  const start = Math.max(0, offset - 60);
  const end = Math.min(flat.length, offset + 60);
  return BLOCK_WORD_RE.test(flat.slice(start, end));
}

// "pinchtab" gets a wider window than the general narrative check (250 vs 160): this doc's
// pinchtab-methodology paragraphs are long, carefully-hedged sentences (already
// heavily-audited, honest content describing a THIRD PARTY's own disclosed settings via its
// own source/API, not a claim about Sutradhar), and a bare 160-char window sometimes lands
// just past the word "pinchtab" itself while still clearly inside the same discussion.
const PINCHTAB_RE = /\bpinchtab\b/i;
function isPinchtabNearby(flat, offset, window = 250) {
  const start = Math.max(0, offset - window);
  const end = Math.min(flat.length, offset + window);
  return PINCHTAB_RE.test(flat.slice(start, end));
}

function isNarrativeNearby(flat, offset, window = 160) {
  const start = Math.max(0, offset - window);
  const end = Math.min(flat.length, offset + window);
  return NARRATIVE_RE.test(flat.slice(start, end));
}

/**
 * Runs the allow-list check against every file (or a caller-supplied file list, for mutation
 * testing against scratch copies). Returns violations: unapproved, unaccounted-for trigger
 * occurrences, each with enough context to locate and judge them.
 */
export function findStealthClaimViolations(root = repoRoot, files = loadStealthClaimFiles(root)) {
  const violations = [];
  for (const file of files) {
    const { flat } = file;
    const approvedRanges = CANONICAL_TEMPLATES.flatMap((t) => findAllRanges(flat, t.flat));
    const seenOffsets = new Set();
    const re = new RegExp(TRIGGER_RE.source, TRIGGER_RE.flags);
    let m;
    while ((m = re.exec(flat))) {
      const offset = m.index;
      if (isWithinAnyRange(offset, approvedRanges)) continue;
      if (isNarrativeNearby(flat, offset)) continue;
      if (isPinchtabNearby(flat, offset)) continue;
      if (/^cloudflare$/i.test(m[0]) && isCloudflareBlockNarrative(flat, offset)) continue;
      const key = Math.floor(offset / 40); // de-dupe adjacent triggers from the same unapproved sentence
      if (seenOffsets.has(key)) continue;
      seenOffsets.add(key);
      violations.push({
        file: file.rel,
        trigger: m[0],
        context: flat.slice(Math.max(0, offset - 80), offset + 80),
      });
    }
    if (EXTRA_TRIGGER_FILES.has(file.rel)) {
      for (const offset of findExtraTriggerOffsets(flat, EXTRA_TRIGGER_FILES.get(file.rel))) {
        if (isWithinAnyRange(offset, approvedRanges)) continue;
        if (isNarrativeNearby(flat, offset)) continue;
        if (isPinchtabNearby(flat, offset)) continue;
        const key = Math.floor(offset / 40);
        if (seenOffsets.has(key)) continue;
        seenOffsets.add(key);
        violations.push({
          file: file.rel,
          trigger: flat.slice(offset, offset + 20),
          context: flat.slice(Math.max(0, offset - 80), offset + 80),
        });
      }
    }
  }
  return violations;
}

// Retained for callers that used the old export name during the transition.
export const STEALTH_CLAIM_PATTERNS = [];
