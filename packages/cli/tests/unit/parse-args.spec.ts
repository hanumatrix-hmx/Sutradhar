/**
 * @file packages/cli/tests/unit/parse-args.spec.ts
 * @description Unit tests for parseArgs — the CLI's flag/verb parsing, split out from cli.ts
 * (which runs main() immediately at module load) specifically so it's independently testable.
 */

import { parseArgs, dialogFlagError, expectFlagError, waitForConditionFromArgs } from '../../src/parse-args.js';

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

  // --state (FR2-01): wait_for_selector visibility states.
  it('C1: parses --state hidden, stripping it (and its value) from cleanArgs', () => {
    const result = parseArgs(['wait', '#t', '5000', '--state', 'hidden']);
    expect(result.stateFlag).toBe('hidden');
    expect(result.cleanArgs).toEqual(['#t', '5000']);
    expect(result.unrecognizedFlags).toEqual([]);
  });

  it('C2: defaults stateFlag to undefined, not invalid, when --state is not given', () => {
    const result = parseArgs(['wait', '#t']);
    expect(result.stateFlag).toBeUndefined();
    expect(result.stateFlagGivenButInvalid).toBe(false);
  });

  it('C3: --state bogus is invalid and stripped from cleanArgs', () => {
    const result = parseArgs(['wait', '#t', '--state', 'bogus']);
    expect(result.stateFlag).toBeUndefined();
    expect(result.stateFlagGivenButInvalid).toBe(true);
    expect(result.cleanArgs).toEqual(['#t']);
  });

  it('C4: --state with no value at all is invalid', () => {
    const result = parseArgs(['wait', '#t', '--state']);
    expect(result.stateFlag).toBeUndefined();
    expect(result.stateFlagGivenButInvalid).toBe(true);
  });

  it('C5: each of the three valid state values parses', () => {
    expect(parseArgs(['wait', '#t', '--state', 'visible']).stateFlag).toBe('visible');
    expect(parseArgs(['wait', '#t', '--state', 'attached']).stateFlag).toBe('attached');
    expect(parseArgs(['wait', '#t', '--state', 'hidden']).stateFlag).toBe('hidden');
  });

  // ───────────────────────────────────────────────────────────────────────
  // FR2-04: --dialog / --dialog-text
  // ───────────────────────────────────────────────────────────────────────

  it('P-D1: --dialog accept parses and is stripped from cleanArgs', () => {
    const result = parseArgs(['click', '#a', '--dialog', 'accept']);
    expect(result.dialogFlag).toBe('accept');
    expect(result.cleanArgs).toEqual(['#a']);
    expect(result.unrecognizedFlags).toEqual([]);
  });

  it('P-D2: --dialog dismiss and --dialog report parse as those values', () => {
    expect(parseArgs(['snap', '--dialog', 'dismiss']).dialogFlag).toBe('dismiss');
    expect(parseArgs(['snap', '--dialog', 'report']).dialogFlag).toBe('report');
  });

  it('P-D3: an invalid or missing --dialog value is flagged', () => {
    let result = parseArgs(['snap', '--dialog', 'bogus']);
    expect(result.dialogFlag).toBeUndefined();
    expect(result.dialogFlagGivenButInvalid).toBe(true);
    result = parseArgs(['snap', '--dialog']);
    expect(result.dialogFlagGivenButInvalid).toBe(true);
  });

  it('P-D4: --dialog-text takes the exact next argument, even multi-word', () => {
    const result = parseArgs(['nav', 'u', '--dialog', 'accept', '--dialog-text', 'hello world']);
    expect(result.dialogTextFlag).toBe('hello world');
    expect(result.cleanArgs).toEqual(['u']);
  });

  it('P-D5: --dialog-text captures a literal "--weird" value without treating it as a flag', () => {
    const result = parseArgs(['nav', 'u', '--dialog', 'accept', '--dialog-text', '--weird']);
    expect(result.dialogTextFlag).toBe('--weird');
    expect(result.unrecognizedFlags).toEqual([]);
  });

  it('P-D6: the "dialog" verb keeps its own sub-args as cleanArgs', () => {
    const result = parseArgs(['dialog', 'accept', 'some', 'text']);
    expect(result.verb).toBe('dialog');
    expect(result.cleanArgs).toEqual(['accept', 'some', 'text']);
  });

  it('P-D7: dialogFlagError returns the exact three messages, and undefined for valid combos', () => {
    expect(dialogFlagError(parseArgs(['snap', '--dialog', 'bogus']))).toBe(
      '--dialog must be one of: accept, dismiss, report (e.g. --dialog accept)',
    );
    expect(dialogFlagError(parseArgs(['snap', '--dialog-text', 'x']))).toBe(
      '--dialog-text only applies with --dialog accept (it is the text entered into prompt() dialogs)',
    );
    expect(dialogFlagError(parseArgs(['dialog', 'accept', '--dialog', 'dismiss']))).toBe(
      '--dialog sets the session\'s default policy; to handle the open dialog now use: sutradhar dialog accept [text] | sutradhar dialog dismiss',
    );
    expect(dialogFlagError(parseArgs(['click', '#a', '--dialog', 'accept']))).toBeUndefined();
    expect(dialogFlagError(parseArgs(['nav', 'u', '--dialog', 'accept', '--dialog-text', 'hello world']))).toBeUndefined();
    expect(dialogFlagError(parseArgs(['snap']))).toBeUndefined();
  });

  it('P-D8: no --dialog/--dialog-text given at all leaves everything undefined/false', () => {
    const result = parseArgs(['snap']);
    expect(result.dialogFlag).toBeUndefined();
    expect(result.dialogTextFlag).toBeUndefined();
    expect(result.dialogFlagGivenButInvalid).toBe(false);
  });

  it('P-D9: --dialog/--dialog-text coexist with every pre-existing flag', () => {
    const result = parseArgs(['wait', '#x', '--state', 'hidden', '--dialog', 'accept']);
    expect(result.stateFlag).toBe('hidden');
    expect(result.dialogFlag).toBe('accept');
    expect(result.cleanArgs).toEqual(['#x']);
  });

  describe('P1/P2: baselineFlagGivenButInvalid (FR2-12, T22)', () => {
    it('P1a: --baseline with nothing after it is invalid, baselineFlag stays undefined', () => {
      const result = parseArgs(['audit', 'u', '--baseline']);
      expect(result.baselineFlagGivenButInvalid).toBe(true);
      expect(result.baselineFlag).toBeUndefined();
    });

    it('P1b: --baseline immediately followed by another flag is invalid, and that flag is not swallowed', () => {
      const result = parseArgs(['audit', 'u', '--baseline', '--json']);
      expect(result.baselineFlagGivenButInvalid).toBe(true);
      expect(result.baselineFlag).toBeUndefined();
      expect(result.jsonMode).toBe(true);
    });

    it('P1c: --baseline <url> is valid', () => {
      const result = parseArgs(['audit', 'u', '--baseline', 'https://b']);
      expect(result.baselineFlagGivenButInvalid).toBe(false);
      expect(result.baselineFlag).toBe('https://b');
    });

    it('P1d: no --baseline flag at all is not invalid', () => {
      const result = parseArgs(['audit', 'u']);
      expect(result.baselineFlagGivenButInvalid).toBe(false);
    });

    it('P2: audit url outDir --json parses cleanArgs and jsonMode correctly', () => {
      const result = parseArgs(['audit', 'u', 'out', '--json']);
      expect(result.cleanArgs).toEqual(['u', 'out']);
      expect(result.jsonMode).toBe(true);
    });
  });
});

describe('@sutradhar/cli parseArgs: FR2-07 --expect-* flags', () => {
  it('C1: --expect-text / --expect-url take a value and keep it out of cleanArgs', () => {
    const t = parseArgs(['click', '#a', '--expect-text', 'Saved']);
    expect(t.expectFlag).toEqual({ text: 'Saved' });
    expect(t.cleanArgs).toEqual(['#a']);
    const u = parseArgs(['nav', 'https://x', '--expect-url', '/b']);
    expect(u.expectFlag).toEqual({ url: '/b' });
    expect(u.cleanArgs).toEqual(['https://x']);
    const both = parseArgs(['click', '#a', '--expect-text', 'A B', '--expect-url', '/z']);
    expect(both.expectFlag).toEqual({ text: 'A B', url: '/z' });
  });

  it('C1: a value that looks like a flag but is not one of ours is a literal value', () => {
    expect(parseArgs(['click', '#a', '--expect-text', '--weird']).expectFlag).toEqual({ text: '--weird' });
  });

  it('C2: --expect-url-changed / --expect-url-unchanged, and their conflict', () => {
    expect(parseArgs(['click', '#a', '--expect-url-changed']).expectFlag).toEqual({ urlChanged: true });
    expect(parseArgs(['click', '#a', '--expect-url-unchanged']).expectFlag).toEqual({ urlChanged: false });
    const both = parseArgs(['click', '#a', '--expect-url-changed', '--expect-url-unchanged']);
    expect(expectFlagError(both)).toBe('--expect-url-changed and --expect-url-unchanged are mutually exclusive');
    expect(parseArgs(['click', '#a', '--expect-url-changed']).cleanArgs).toEqual(['#a']);
  });

  it('C3: a value-less --expect-text / --expect-url is an error; no flag means expectFlag is undefined', () => {
    expect(expectFlagError(parseArgs(['click', '#a', '--expect-text']))).toBe(
      '--expect-text needs a value (e.g. --expect-text "Saved")',
    );
    expect(expectFlagError(parseArgs(['click', '#a', '--expect-text', '--json']))).toContain('--expect-text needs a value');
    expect(expectFlagError(parseArgs(['click', '#a', '--expect-url']))).toContain('--expect-url needs a value');
    expect(parseArgs(['click', '#a', '--expect-text', '--json']).jsonMode).toBe(true); // --json not swallowed
    expect(parseArgs(['click', '#a']).expectFlag).toBeUndefined();
    expect(expectFlagError(parseArgs(['click', '#a']))).toBeUndefined();
  });

  it('C3: unrecognised-flag detection is unchanged and does not flag the expect flags', () => {
    expect(parseArgs(['click', '#a', '--expect-text', 'x', '--expect-url-changed']).unrecognizedFlags).toEqual([]);
    expect(parseArgs(['click', '#a', '--bogus']).unrecognizedFlags).toEqual(['--bogus']);
  });
});

describe('FR2-08 waitfor flags', () => {
  it('C1: --text takes a value; positional timeout stays in cleanArgs', () => {
    const r = parseArgs(['waitfor', '5000', '--text', 'Saved']);
    expect(r.waitForFlags).toEqual({ text: 'Saved' });
    expect(r.cleanArgs).toEqual(['5000']);
    expect(r.unrecognizedFlags).toEqual([]);
    expect(r.waitForFlagError).toBeUndefined();
  });

  it('C2: all four flags together', () => {
    const r = parseArgs(['waitfor', '--text', 'a b', '--text-gone', 'c', '--url', '/x', '--js', 'window.ok']);
    expect(r.waitForFlags).toEqual({ text: 'a b', textGone: 'c', url: '/x', js: 'window.ok' });
    expect(r.cleanArgs).toEqual([]);
  });

  it('C3: a condition flag with no value is an error naming the flag', () => {
    expect(parseArgs(['waitfor', '--text']).waitForFlagError).toMatch(/--text needs a value/);
    expect(parseArgs(['waitfor', '--text-gone']).waitForFlagError).toMatch(/--text-gone needs a value/);
    expect(parseArgs(['waitfor', '--url']).waitForFlagError).toMatch(/--url needs a value/);
    expect(parseArgs(['waitfor', '--js']).waitForFlagError).toMatch(/--js needs a value/);
    // followed directly by another of OUR flags: the value is missing, that flag is not swallowed
    const r = parseArgs(['waitfor', '--text', '--json']);
    expect(r.waitForFlagError).toMatch(/--text needs a value/);
    expect(r.jsonMode).toBe(true);
  });

  it('C4: waitForConditionFromArgs: usage, timeout validation, cap', () => {
    const one = { waitForFlags: { text: 'x' } };
    expect(waitForConditionFromArgs({ waitForFlags: {} }, [])).toEqual({
      error: 'usage: sutradhar waitfor [timeoutMs] --text <t> | --text-gone <t> | --url <s> | --js <expr>  (combine to require all)',
    });
    expect((waitForConditionFromArgs(one, ['abc']) as any).error).toMatch(/timeoutMs must be a whole number of milliseconds/);
    expect((waitForConditionFromArgs(one, ['-5']) as any).error).toMatch(/whole number/);
    expect((waitForConditionFromArgs(one, ['1.5']) as any).error).toMatch(/whole number/);
    expect((waitForConditionFromArgs(one, ['']) as any).error).toMatch(/whole number/);
    expect(waitForConditionFromArgs(one, ['280001'])).toEqual({ error: 'waitfor: timeoutMs must be at most 280000' });
    expect(waitForConditionFromArgs(one, ['280000'])).toEqual({ condition: { text: 'x', timeoutMs: 280000 } });
    expect(waitForConditionFromArgs(one, ['0'])).toEqual({ condition: { text: 'x', timeoutMs: 0 } });
    expect(waitForConditionFromArgs(one, [])).toEqual({ condition: { text: 'x' } });
    // an UNQUOTED multi-word value is a second positional: rejected with a quoting hint, never silently mis-parsed
    const bad = waitForConditionFromArgs(one, ['5000', 'successfully']) as { error: string };
    expect(bad.error).toMatch(/unexpected argument "successfully"/);
    expect(bad.error).toMatch(/quote/);
    const bad2 = waitForConditionFromArgs(one, ['successfully']) as { error: string };
    expect(bad2.error).toMatch(/got "successfully"/);
  });

  it('C5: the flags parse on any verb (the CLI itself rejects them off "waitfor": proved live, N-C3)', () => {
    const r = parseArgs(['click', '7', '--text', 'Saved']);
    expect(r.waitForFlags).toEqual({ text: 'Saved' });
    expect(r.cleanArgs).toEqual(['7']);
    expect(r.verb).toBe('click');
  });

  it('C6: a js value is kept verbatim (spaces, quotes, =); a value starting with -- is consumed as the value', () => {
    expect(parseArgs(['waitfor', '--js', 'document.title === "a b"']).waitForFlags.js).toBe('document.title === "a b"');
    const r = parseArgs(['waitfor', '--text', '--x']);
    expect(r.waitForFlags.text).toBe('--x');
    expect(r.cleanArgs).toEqual([]);
    expect(r.unrecognizedFlags).toEqual([]);
  });

  it('C6b: --url does not disturb --expect-url, and --text does not disturb --no-text', () => {
    const r = parseArgs(['snap', '--no-text']);
    expect(r.noText).toBe(true);
    expect(r.waitForFlags).toEqual({});
    const e = parseArgs(['click', '7', '--expect-url', '/a']);
    expect(e.waitForFlags).toEqual({});
    expect(e.expectFlag).toEqual({ url: '/a' });
  });

  it('C7: --settle is still a boolean, on the newly settle-capable verbs too', () => {
    const r = parseArgs(['press', '3', 'Enter', '--settle']);
    expect(r.settle).toBe(true);
    expect(r.cleanArgs).toEqual(['3', 'Enter']);
    expect(parseArgs(['press', '3', 'Enter']).settle).toBe(false);
    expect(parseArgs(['nav', 'https://x.test/', '--settle']).cleanArgs).toEqual(['https://x.test/']);
  });
});

describe('I-048 text paging flags (--offset / --max-chars)', () => {
  it('parses valid values for the text verb and strips both flags and their values from cleanArgs', () => {
    const r = parseArgs(['text', '--offset', '4000', '--max-chars', '2000']);
    expect(r.verb).toBe('text');
    expect(r.textOffsetFlag).toBe(4000);
    expect(r.textMaxCharsFlag).toBe(2000);
    expect(r.textPagingFlagError).toBeUndefined();
    expect(r.cleanArgs).toEqual([]);
    expect(r.unrecognizedFlags).toEqual([]);
  });

  it('works in any position and together with --json', () => {
    const r = parseArgs(['text', '--json', '--max-chars', '100000', '--offset', '0']);
    expect(r.textOffsetFlag).toBe(0);
    expect(r.textMaxCharsFlag).toBe(100000);
    expect(r.jsonMode).toBe(true);
    expect(r.textPagingFlagError).toBeUndefined();
  });

  it('without the flags both are undefined and there is no error', () => {
    const r = parseArgs(['text']);
    expect(r.textOffsetFlag).toBeUndefined();
    expect(r.textMaxCharsFlag).toBeUndefined();
    expect(r.textPagingFlagError).toBeUndefined();
  });

  it.each([
    [['text', '--offset'], '--offset needs a value'],
    [['text', '--offset', '--json'], '--offset needs a value'],
    [['text', '--max-chars'], '--max-chars needs a value'],
    [['text', '--offset', 'abc'], '--offset must be an integer >= 0 (got "abc")'],
    [['text', '--offset', '1.5'], '--offset must be an integer >= 0 (got "1.5")'],
    [['text', '--offset', '-1'], '--offset must be an integer >= 0 (got "-1")'],
    [['text', '--max-chars', '0'], '--max-chars must be an integer from 1 to 100000 (got "0")'],
    [['text', '--max-chars', '100001'], '--max-chars must be an integer from 1 to 100000 (got "100001")'],
    [['text', '--max-chars', '2.5'], '--max-chars must be an integer from 1 to 100000 (got "2.5")'],
    [['text', '--max-chars', 'NaN'], '--max-chars must be an integer from 1 to 100000 (got "NaN")'],
  ])('rejects %j with a message naming the flag and its range', (argv, message) => {
    const r = parseArgs(argv as string[]);
    expect(r.textPagingFlagError).toContain(message);
  });

  it('a bad value is still consumed (never leaks into cleanArgs as positional data)', () => {
    expect(parseArgs(['text', '--offset', 'abc']).cleanArgs).toEqual([]);
  });

  it.each([['snap'], ['nav'], ['click'], ['eval'], ['waitfor'], ['close']])('%s with --offset is rejected: the flag belongs to "text" only', (verb) => {
    const r = parseArgs([verb, '--offset', '5']);
    expect(r.textPagingFlagError).toContain('--offset is only valid with "text"');
    const m = parseArgs([verb, '--max-chars', '5']);
    expect(m.textPagingFlagError).toContain('--max-chars is only valid with "text"');
  });

  it('does not disturb the --text/--url wait flags (they are different flags)', () => {
    const r = parseArgs(['waitfor', '--text', 'Saved']);
    expect(r.textPagingFlagError).toBeUndefined();
    expect(r.waitForFlags).toEqual({ text: 'Saved' });
  });
});
