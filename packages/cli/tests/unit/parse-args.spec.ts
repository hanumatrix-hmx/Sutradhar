/**
 * @file packages/cli/tests/unit/parse-args.spec.ts
 * @description Unit tests for parseArgs — the CLI's flag/verb parsing, split out from cli.ts
 * (which runs main() immediately at module load) specifically so it's independently testable.
 */

import { parseArgs } from '../../src/parse-args.js';

describe('@sutradhar/cli parseArgs', () => {
  it('parses a bare verb with no flags or positional args', () => {
    const result = parseArgs(['snap']);
    expect(result.verb).toBe('snap');
    expect(result.cleanArgs).toEqual([]);
    expect(result.headed).toBe(false);
    expect(result.failOnDiff).toBe(false);
    expect(result.jsonMode).toBe(false);
    expect(result.profileFlag).toBeUndefined();
    expect(result.userAgentFlag).toBeUndefined();
  });

  it('returns undefined verb when no arguments are given at all', () => {
    const result = parseArgs([]);
    expect(result.verb).toBeUndefined();
    expect(result.cleanArgs).toEqual([]);
  });

  it('threads positional args through as cleanArgs, in order', () => {
    const result = parseArgs(['click', '7']);
    expect(result.verb).toBe('click');
    expect(result.cleanArgs).toEqual(['7']);
  });

  it('parses --headed as a standalone boolean flag, stripped from cleanArgs', () => {
    const result = parseArgs(['nav', 'https://example.com', '--headed']);
    expect(result.headed).toBe(true);
    expect(result.cleanArgs).toEqual(['https://example.com']);
  });

  it('parses --json as a standalone boolean flag, stripped from cleanArgs — new in this phase (snap --json / C6)', () => {
    const result = parseArgs(['snap', '--json']);
    expect(result.jsonMode).toBe(true);
    expect(result.cleanArgs).toEqual([]);
  });

  it('parses --fail-on-diff as a standalone boolean flag', () => {
    const result = parseArgs(['compare', 'https://a.com', 'https://b.com', '--fail-on-diff']);
    expect(result.failOnDiff).toBe(true);
    expect(result.cleanArgs).toEqual(['https://a.com', 'https://b.com']);
  });

  it('parses --profile <name> as a valued flag, consuming its value and stripping both from cleanArgs', () => {
    const result = parseArgs(['nav', 'https://example.com', '--profile', 'work']);
    expect(result.profileFlag).toBe('work');
    expect(result.cleanArgs).toEqual(['https://example.com']);
  });

  it('parses --user-agent <ua> as a valued flag — new in this phase (4c)', () => {
    const result = parseArgs(['nav', 'https://example.com', '--user-agent', 'MyBot/1.0']);
    expect(result.userAgentFlag).toBe('MyBot/1.0');
    expect(result.cleanArgs).toEqual(['https://example.com']);
  });

  it('handles a user agent string containing spaces, since it is a single argv element, not a shell-split string', () => {
    const result = parseArgs(['nav', 'https://example.com', '--user-agent', 'Mozilla/5.0 (Custom Bot)']);
    expect(result.userAgentFlag).toBe('Mozilla/5.0 (Custom Bot)');
  });

  it('combines multiple flags (boolean + two valued) and strips all of them cleanly', () => {
    const result = parseArgs([
      'nav',
      'https://example.com',
      '--headed',
      '--profile',
      'work',
      '--user-agent',
      'MyBot/1.0',
    ]);
    expect(result.headed).toBe(true);
    expect(result.profileFlag).toBe('work');
    expect(result.userAgentFlag).toBe('MyBot/1.0');
    expect(result.cleanArgs).toEqual(['https://example.com']);
  });

  it('leaves profileFlag/userAgentFlag undefined, not the next arg, when the flag is the last token (no value given)', () => {
    const result = parseArgs(['nav', 'https://example.com', '--profile']);
    expect(result.profileFlag).toBeUndefined();
    // The flag itself is still stripped from cleanArgs even with no following value.
    expect(result.cleanArgs).toEqual(['https://example.com']);
  });

  it('supports the new multi-arg commands introduced in this phase — select/wait/upload/drag all thread two positional args', () => {
    expect(parseArgs(['select', '3', 'blue']).cleanArgs).toEqual(['3', 'blue']);
    expect(parseArgs(['wait', '3', '5000']).cleanArgs).toEqual(['3', '5000']);
    expect(parseArgs(['upload', '3', '/tmp/file.txt']).cleanArgs).toEqual(['3', '/tmp/file.txt']);
    expect(parseArgs(['drag', '3', '7']).cleanArgs).toEqual(['3', '7']);
    expect(parseArgs(['download', '3', '/tmp/downloads']).cleanArgs).toEqual(['3', '/tmp/downloads']);
  });

  it('parses --allowlist-domains <list> as a comma-separated valued flag', () => {
    const result = parseArgs(['nav', 'https://example.com', '--allowlist-domains', 'example.com,internal.corp']);
    expect(result.allowlistDomainsFlag).toEqual(['example.com', 'internal.corp']);
    expect(result.cleanArgs).toEqual(['https://example.com']);
  });

  it('trims whitespace and drops empty entries in --allowlist-domains', () => {
    const result = parseArgs(['nav', 'https://example.com', '--allowlist-domains', ' example.com , , internal.corp ']);
    expect(result.allowlistDomainsFlag).toEqual(['example.com', 'internal.corp']);
  });

  it('leaves allowlistDomainsFlag undefined when the flag is not given', () => {
    const result = parseArgs(['nav', 'https://example.com']);
    expect(result.allowlistDomainsFlag).toBeUndefined();
  });

  it('parses --baseline <url> as a valued flag, for audit --baseline compare', () => {
    const result = parseArgs(['audit', 'https://example.com', '--baseline', 'https://prod.example.com']);
    expect(result.baselineFlag).toBe('https://prod.example.com');
    expect(result.cleanArgs).toEqual(['https://example.com']);
  });

  it('leaves baselineFlag undefined when the flag is not given', () => {
    const result = parseArgs(['audit', 'https://example.com']);
    expect(result.baselineFlag).toBeUndefined();
  });

  it('parses --settle as a standalone boolean flag, stripped from cleanArgs', () => {
    const result = parseArgs(['click', '7', '--settle']);
    expect(result.settle).toBe(true);
    expect(result.cleanArgs).toEqual(['7']);
  });

  it('defaults settle to false when not given', () => {
    const result = parseArgs(['click', '7']);
    expect(result.settle).toBe(false);
  });

  it('parses --no-text and --ids-only as standalone boolean flags for "snap"', () => {
    const noText = parseArgs(['snap', '--no-text']);
    expect(noText.noText).toBe(true);
    expect(noText.idsOnly).toBe(false);

    const idsOnly = parseArgs(['snap', '--ids-only']);
    expect(idsOnly.idsOnly).toBe(true);
    expect(idsOnly.noText).toBe(false);
  });

  it('defaults noText/idsOnly to false when not given', () => {
    const result = parseArgs(['snap']);
    expect(result.noText).toBe(false);
    expect(result.idsOnly).toBe(false);
  });

  it('parses --scan-listeners as a standalone boolean flag for "snap"', () => {
    const result = parseArgs(['snap', '--scan-listeners']);
    expect(result.scanListeners).toBe(true);
    expect(result.cleanArgs).toEqual([]);
  });

  it('defaults scanListeners to false when not given', () => {
    const result = parseArgs(['snap']);
    expect(result.scanListeners).toBe(false);
  });

  it('parses --modifiers as a comma-separated modifier-key list for "press"', () => {
    const result = parseArgs(['press', '3', 'ArrowRight', '--modifiers', 'Control,Shift']);
    expect(result.modifiersFlag).toEqual(['Control', 'Shift']);
    expect(result.cleanArgs).toEqual(['3', 'ArrowRight']);
  });

  it('drops unrecognized modifier names rather than passing them through', () => {
    const result = parseArgs(['press', '3', 'a', '--modifiers', 'Control,NotAModifier,Shift']);
    expect(result.modifiersFlag).toEqual(['Control', 'Shift']);
  });

  it('defaults modifiersFlag to undefined when --modifiers is not given', () => {
    const result = parseArgs(['press', '3', 'Enter']);
    expect(result.modifiersFlag).toBeUndefined();
  });

  it('parses --frame as the target iframe selector for "eval"', () => {
    const result = parseArgs(['eval', 'document.title', '--frame', '#payment-iframe']);
    expect(result.frameFlag).toBe('#payment-iframe');
    expect(result.cleanArgs).toEqual(['document.title']);
  });

  it('defaults frameFlag to undefined when --frame is not given', () => {
    const result = parseArgs(['eval', 'document.title']);
    expect(result.frameFlag).toBeUndefined();
  });

  it('flags an unrecognized --flag-shaped positional arg instead of silently accepting it as data (fixes PROB-042 — "screenshot --help" used to create a real file named "--help")', () => {
    const result = parseArgs(['screenshot', '--help']);
    expect(result.unrecognizedFlags).toEqual(['--help']);
    expect(result.cleanArgs).toEqual(['--help']); // still surfaced in cleanArgs too, for callers that want it
  });

  it('does not flag a recognized flag or a value consumed by one', () => {
    const result = parseArgs(['nav', 'https://example.com', '--headed', '--profile', 'work']);
    expect(result.unrecognizedFlags).toEqual([]);
  });

  it('reports every unrecognized flag, not just the first', () => {
    const result = parseArgs(['nav', 'https://example.com', '--out', '--dry-run']);
    expect(result.unrecognizedFlags).toEqual(['--out', '--dry-run']);
  });

  it('does not treat a positional arg that happens to equal a flag NAME as anything but a flag, even mid-command', () => {
    // Guards the filter's index-based value-stripping: only the token immediately AFTER
    // --profile/--user-agent is treated as that flag's value, not any later occurrence.
    const result = parseArgs(['eval', '--profile', 'x', 'document.title']);
    expect(result.profileFlag).toBe('x');
    expect(result.cleanArgs).toEqual(['document.title']);
  });
});
