/**
 * @file packages/cli/tests/unit/help-text.spec.ts
 * @description FR2-16: the CLI's --help text (a single hand-rolled console.log block in
 * cli.ts, no commander/yargs) must state the honest Cloudflare/CAPTCHA/bot-detection boundary.
 * cli.ts runs main() immediately at module load (see parse-args.spec.ts's file comment for why
 * cli.ts itself is never imported directly in a unit test), so this reads the source text
 * rather than importing the module or spawning the built CLI — the latter is covered live by
 * tools/scenario-suite/fr2-16/verify-fr2-16-boundary.mjs, which runs the actual built binary.
 *
 * GAP-104 fix (fix-2): the original version of this spec searched the ENTIRE cli.ts file for
 * the boundary substrings, not just the actual --help output block, so it could not have
 * distinguished "the help text says this" from "this string appears somewhere else in the
 * file" (e.g. in an unrelated comment). This version extracts the exact template-literal block
 * passed to console.log(`Sutradhar CLI ...`) — the only text a real invocation of the CLI with
 * no args actually prints — and asserts against that extracted block only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliSource = fs.readFileSync(path.join(here, '..', '..', 'src', 'cli.ts'), 'utf8');

// Extract the actual --help output block: the template literal starting at
// `console.log(\`Sutradhar CLI` and ending at the first `` `); `` that follows it. This is the
// literal text a real `sutradhar` invocation with no args prints to stdout.
const startMarker = 'console.log(`Sutradhar CLI';
const startIdx = cliSource.indexOf(startMarker);
if (startIdx === -1) {
  throw new Error('Could not locate the --help console.log(`Sutradhar CLI ...`) block in cli.ts — has it moved or been renamed?');
}
const endIdx = cliSource.indexOf('`);', startIdx);
if (endIdx === -1) {
  throw new Error('Could not locate the end of the --help template literal in cli.ts.');
}
const helpText = cliSource.slice(startIdx + startMarker.length, endIdx);

describe('@sutradhar/cli --help text (FR2-16 boundary)', () => {
  it('extracted a non-trivial help-text block (sanity check on the extraction itself)', () => {
    expect(helpText.length).toBeGreaterThan(500);
    expect(helpText).toContain('Usage: sutradhar');
  });

  it('states that Sutradhar does not attempt to evade bot-detection (phrase wraps across a source line, so checked as two adjacent substrings rather than one)', () => {
    expect(helpText).toContain('does not attempt to evade');
    expect(helpText).toContain('bot-detection or solve CAPTCHAs');
  });

  it('mentions CAPTCHA', () => {
    expect(helpText).toContain('CAPTCHA');
  });

  it('mentions Cloudflare', () => {
    expect(helpText).toContain('Cloudflare');
  });

  it('states the honest exception (the retained flag hides navigator.webdriver, nothing more)', () => {
    expect(helpText.toLowerCase()).toContain('navigator.webdriver');
  });

  it('does not overclaim in the other direction (no blanket "never works on any Cloudflare" claim)', () => {
    expect(helpText.toLowerCase()).not.toContain('never works on any cloudflare');
  });
});

describe('@sutradhar/cli --help text (FR2-08 waiting)', () => {
  it('documents the waitfor verb with every condition flag and the exit codes', () => {
    expect(helpText).toContain('waitfor [timeoutMs] --text <t> | --text-gone <t> | --url <s> | --js <expr>');
    expect(helpText).toContain('Use this instead of sleeping');
    expect(helpText).toContain('succeeds at');
    expect(helpText).toContain('3 blocked by an open dialog');
  });

  it('states the visible-text limits (best effort, hidden text and input values do not count)', () => {
    expect(helpText).toContain('RENDERED text');
    expect(helpText).toContain('hidden text and input values');
    expect(helpText).toContain('best');
  });

  it('lists every settle-capable verb on the --settle flag and points at waitfor', () => {
    const idx = helpText.indexOf('  --settle ');
    expect(idx).toBeGreaterThan(-1);
    const flagText = helpText.slice(idx, helpText.indexOf('--text <t> / --text-gone', idx));
    for (const verb of ['click', 'type', 'scroll', 'nav', 'clicktext', 'clickrole', 'press', 'select', 'hover', 'upload', 'drag', 'clickpoint', 'dragpoints', 'download']) {
      expect(flagText, verb).toContain(`"${verb}"`);
    }
    expect(flagText).toContain('cannot see a');
    expect(flagText).toContain('waitfor');
  });
});
