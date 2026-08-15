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
}

/** Parses `process.argv.slice(2)`-style arguments (verb + flags) into their recognized pieces.
 *  Pass `process.argv.slice(2)` in production; pass a literal array in tests. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [verb, ...args] = argv;
  const headed = args.includes('--headed');
  const failOnDiff = args.includes('--fail-on-diff');
  const jsonMode = args.includes('--json');
  const profileFlagIndex = args.indexOf('--profile');
  const profileFlag = profileFlagIndex !== -1 ? args[profileFlagIndex + 1] : undefined;
  const userAgentFlagIndex = args.indexOf('--user-agent');
  const userAgentFlag = userAgentFlagIndex !== -1 ? args[userAgentFlagIndex + 1] : undefined;
  const cleanArgs = args.filter(
    (a, i) =>
      a !== '--headed' &&
      a !== '--fail-on-diff' &&
      a !== '--json' &&
      a !== '--profile' &&
      a !== '--user-agent' &&
      !(profileFlagIndex !== -1 && i === profileFlagIndex + 1) &&
      !(userAgentFlagIndex !== -1 && i === userAgentFlagIndex + 1),
  );

  return { verb, cleanArgs, headed, failOnDiff, jsonMode, profileFlag, userAgentFlag };
}
