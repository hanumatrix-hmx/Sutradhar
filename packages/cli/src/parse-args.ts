/**
 * @file packages/cli/src/parse-args.ts
 * @description Pure argv-parsing for the Sutradhar CLI, split out from cli.ts so it's testable
 * without importing cli.ts itself — cli.ts runs `main()` immediately at module load (it IS the
 * CLI entrypoint), which would spawn/attach to a real Chrome the moment a test imported it.
 */

export interface ParsedArgs {
  /** The subcommand, e.g. "snap", "click", "nav". `undefined` when no argument was given. */
  verb: string | undefined;
  /** Every remaining argument with recognized flags (and their values) stripped out, e.g.
   *  `sutradhar click 7 --headed` -> `['7']`. */
  cleanArgs: string[];
  headed: boolean;
  failOnDiff: boolean;
  jsonMode: boolean;
  profileFlag: string | undefined;
  userAgentFlag: string | undefined;
  /** Parsed from `--allowlist-domains a.com,b.com` — undefined when the flag isn't given. */
  allowlistDomainsFlag: string[] | undefined;
  /** Parsed from `--baseline <url>` — undefined when the flag isn't given. Used by `audit` to
   *  also run a visual compare against a known-good baseline URL in the same command. */
  baselineFlag: string | undefined;
  /** `--settle` — used by `click`/`type` to wait for the page to stop actively changing
   *  (DOM-quiet + network-idle) before returning. Off by default. */
  settle: boolean;
  /** `--no-text` — used by `snap` to drop name/label/placeholder/value text from each line,
   *  keeping tag+role+id. Off by default. */
  noText: boolean;
  /** `--ids-only` — used by `snap` to drop everything but the bracketed id. Implies `noText`.
   *  Off by default. */
  idsOnly: boolean;
}

/** Parses `process.argv.slice(2)`-style arguments (verb + flags) into their recognized pieces.
 *  Pass `process.argv.slice(2)` in production; pass a literal array in tests. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [verb, ...args] = argv;
  const headed = args.includes('--headed');
  const failOnDiff = args.includes('--fail-on-diff');
  const jsonMode = args.includes('--json');
  const settle = args.includes('--settle');
  const noText = args.includes('--no-text');
  const idsOnly = args.includes('--ids-only');
  const profileFlagIndex = args.indexOf('--profile');
  const profileFlag = profileFlagIndex !== -1 ? args[profileFlagIndex + 1] : undefined;
  const userAgentFlagIndex = args.indexOf('--user-agent');
  const userAgentFlag = userAgentFlagIndex !== -1 ? args[userAgentFlagIndex + 1] : undefined;
  const allowlistDomainsFlagIndex = args.indexOf('--allowlist-domains');
  const allowlistDomainsRaw =
    allowlistDomainsFlagIndex !== -1 ? args[allowlistDomainsFlagIndex + 1] : undefined;
  const allowlistDomainsFlag = allowlistDomainsRaw
    ? allowlistDomainsRaw
        .split(',')
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
    : undefined;
  const baselineFlagIndex = args.indexOf('--baseline');
  const baselineFlag = baselineFlagIndex !== -1 ? args[baselineFlagIndex + 1] : undefined;
  const cleanArgs = args.filter(
    (a, i) =>
      a !== '--headed' &&
      a !== '--fail-on-diff' &&
      a !== '--json' &&
      a !== '--settle' &&
      a !== '--no-text' &&
      a !== '--ids-only' &&
      a !== '--profile' &&
      a !== '--user-agent' &&
      a !== '--allowlist-domains' &&
      a !== '--baseline' &&
      !(profileFlagIndex !== -1 && i === profileFlagIndex + 1) &&
      !(userAgentFlagIndex !== -1 && i === userAgentFlagIndex + 1) &&
      !(allowlistDomainsFlagIndex !== -1 && i === allowlistDomainsFlagIndex + 1) &&
      !(baselineFlagIndex !== -1 && i === baselineFlagIndex + 1),
  );

  return {
    verb,
    cleanArgs,
    headed,
    failOnDiff,
    jsonMode,
    profileFlag,
    userAgentFlag,
    allowlistDomainsFlag,
    baselineFlag,
    settle,
    noText,
    idsOnly,
  };
}
