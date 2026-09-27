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
  /** FR2-12/T22: true when `--baseline` was given but its next argument is missing or itself
   *  looks like a flag (e.g. `audit <url> --baseline` with nothing after it, or `audit <url>
   *  --baseline --json`, which would otherwise silently consume `--json` as the baseline URL).
   *  `baselineFlag` is `undefined` whenever this is true — the caller rejects it with a clear
   *  usage message instead of silently skipping the comparison or misparsing another flag. */
  baselineFlagGivenButInvalid: boolean;
  /** `--settle` — used by `click`/`type` to wait for the page to stop actively changing
   *  (DOM-quiet + network-idle) before returning. Off by default. */
  settle: boolean;
  /** `--no-text` — used by `snap` to drop name/label/placeholder/value text from each line,
   *  keeping tag+role+id. Off by default. */
  noText: boolean;
  /** `--ids-only` — used by `snap` to drop everything but the bracketed id. Implies `noText`.
   *  Off by default. */
  idsOnly: boolean;
  /** `--scan-listeners` — used by `snap` to also find elements whose only interactivity signal
   *  is a real addEventListener-attached handler (via CDP DOMDebugger.getEventListeners), for
   *  libraries (e.g. SortableJS) that attach raw pointer/mouse listeners with no CSS/ARIA
   *  signal at all. Slower than a normal snapshot; off by default. */
  scanListeners: boolean;
  /** Parsed from `--modifiers Control,Shift` — undefined when the flag isn't given. Used by
   *  `press` to hold modifier keys (e.g. Ctrl+Shift+ArrowRight to select a word) — the
   *  underlying engine already supported this via `pressKey`'s `modifiers` param, but the CLI
   *  had no way to pass it (found live testing rich-text-editor toolbar formatting). */
  modifiersFlag: readonly ('Control' | 'Shift' | 'Alt' | 'Meta')[] | undefined;
  /** Parsed from `--frame <selector>` — undefined when the flag isn't given. Used by `eval` to
   *  run inside a specific `<iframe>` (a CSS selector or snap node id identifying the iframe
   *  element on the top-level page) instead of the top-level page's own context — including a
   *  genuinely cross-origin iframe, which the top-level page's own JS could never reach into
   *  itself. The underlying runtime already supported this via `eval`'s `frameSelector` param,
   *  but the CLI had no way to pass it (found live verifying a real 3-level nested iframe
   *  chain, where reading a deeply-nested frame's own state needed this). */
  frameFlag: string | undefined;
  /** Parsed from `--viewport WIDTHxHEIGHT` (e.g. `--viewport 390x844`) — undefined when the flag
   *  isn't given or doesn't parse as two positive integers separated by `x`. Applied at session
   *  creation: sets both the real page's CDP device-metrics override (so `window.innerWidth`/
   *  responsive CSS see the requested size — this is what actually matters for layout
   *  correctness) and, for a headed session, Chrome's own `--window-size` launch flag (so the
   *  visible OS window is reasonably sized too, instead of full desktop with a large empty
   *  margin around a phone-sized page — found live via an external field report, PROB-042,
   *  that this was previously not exposed anywhere in the public SDK or CLI at all, only on the
   *  internal runtime). Not pixel-perfect for headed mode (Chrome's own window chrome/toolbar
   *  still eats a few dozen px the CDP override doesn't know about) — that's a real, undocumented
   *  Chromium quirk, not something worth chasing further; the CDP override alone already
   *  guarantees the functionally-correct result. */
  viewportFlag: { width: number; height: number } | undefined;
  /** True when `--viewport` was given but its value didn't parse as `WIDTHxHEIGHT` (e.g.
   *  `--viewport bogus`) — lets the caller reject it with a clear usage message instead of
   *  silently ignoring a typo'd value. */
  viewportFlagGivenButInvalid: boolean;
  /** Parsed from `--state visible|attached|hidden` — undefined when the flag isn't given.
   *  Only meaningful for the `wait` command; `undefined` leaves the engine's own default
   *  ('visible') in force. */
  stateFlag: 'visible' | 'attached' | 'hidden' | undefined;
  /** True when `--state` was given but its value was missing or not one of the three valid
   *  values — lets the caller reject it with a clear usage message instead of silently
   *  falling back to the default. */
  stateFlagGivenButInvalid: boolean;
  /** FR2-04: parsed from `--dialog accept|dismiss|report` — undefined when the flag isn't given.
   *  Sets/clears this session's default native-dialog policy (persisted in CLI state). */
  dialogFlag: 'accept' | 'dismiss' | 'report' | undefined;
  /** True when `--dialog` was given but its value wasn't one of accept/dismiss/report (including
   *  the value being missing entirely). */
  dialogFlagGivenButInvalid: boolean;
  /** FR2-04: parsed from `--dialog-text <text>` — the exact next argument, even if it itself
   *  looks like a flag (e.g. `--dialog-text --weird` is a literal prompt answer of "--weird",
   *  not a second flag). Only meaningful with `--dialog accept`. */
  dialogTextFlag: string | undefined;
  /** Any `--something`-shaped argument that isn't one of the flags this parser recognizes (and
   *  isn't a consumed value of one, e.g. the URL after `--baseline`). Found live (external field
   *  report, PROB-042): a typo'd or misplaced flag like `sutradhar screenshot --help` was
   *  silently treated as the command's positional filename argument instead of being rejected —
   *  `screenshot --help` created a real file literally named `--help` on disk, no error at all.
   *  `main()` checks this before dispatching to any command and errors out immediately rather
   *  than letting an unrecognized flag silently become positional data. */
  unrecognizedFlags: string[];
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
  const scanListeners = args.includes('--scan-listeners');
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
  const baselineRaw = baselineFlagIndex !== -1 ? args[baselineFlagIndex + 1] : undefined;
  const baselineFlagGivenButInvalid = baselineFlagIndex !== -1 && (baselineRaw === undefined || baselineRaw.startsWith('--'));
  const baselineFlag = baselineFlagGivenButInvalid ? undefined : baselineRaw;
  const modifiersFlagIndex = args.indexOf('--modifiers');
  const modifiersRaw = modifiersFlagIndex !== -1 ? args[modifiersFlagIndex + 1] : undefined;
  const VALID_MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta']);
  const modifiersFlag = modifiersRaw
    ? (modifiersRaw
        .split(',')
        .map((m) => m.trim())
        .filter((m) => VALID_MODIFIERS.has(m)) as ('Control' | 'Shift' | 'Alt' | 'Meta')[])
    : undefined;
  const frameFlagIndex = args.indexOf('--frame');
  const frameFlag = frameFlagIndex !== -1 ? args[frameFlagIndex + 1] : undefined;
  const viewportFlagIndex = args.indexOf('--viewport');
  const viewportRaw = viewportFlagIndex !== -1 ? args[viewportFlagIndex + 1] : undefined;
  const viewportMatch = viewportRaw?.match(/^(\d+)x(\d+)$/);
  const viewportFlag = viewportMatch
    ? { width: parseInt(viewportMatch[1]!, 10), height: parseInt(viewportMatch[2]!, 10) }
    : undefined;
  const stateFlagIndex = args.indexOf('--state');
  const stateRaw = stateFlagIndex !== -1 ? args[stateFlagIndex + 1] : undefined;
  const VALID_STATES = new Set(['visible', 'attached', 'hidden']);
  const stateFlag =
    stateRaw && VALID_STATES.has(stateRaw) ? (stateRaw as 'visible' | 'attached' | 'hidden') : undefined;
  const stateFlagGivenButInvalid = stateFlagIndex !== -1 && !stateFlag;
  const dialogFlagIndex = args.indexOf('--dialog');
  const dialogRaw = dialogFlagIndex !== -1 ? args[dialogFlagIndex + 1] : undefined;
  const VALID_DIALOG_MODES = new Set(['accept', 'dismiss', 'report']);
  const dialogFlag =
    dialogRaw && VALID_DIALOG_MODES.has(dialogRaw) ? (dialogRaw as 'accept' | 'dismiss' | 'report') : undefined;
  const dialogFlagGivenButInvalid = dialogFlagIndex !== -1 && !dialogFlag;
  const dialogTextFlagIndex = args.indexOf('--dialog-text');
  const dialogTextFlag = dialogTextFlagIndex !== -1 ? args[dialogTextFlagIndex + 1] : undefined;
  const KNOWN_FLAGS = new Set([
    '--headed',
    '--fail-on-diff',
    '--json',
    '--viewport',
    '--settle',
    '--no-text',
    '--ids-only',
    '--scan-listeners',
    '--profile',
    '--user-agent',
    '--allowlist-domains',
    '--baseline',
    '--modifiers',
    '--frame',
    '--state',
    '--dialog',
    '--dialog-text',
  ]);
  const isConsumedValue = (i: number): boolean =>
    (profileFlagIndex !== -1 && i === profileFlagIndex + 1) ||
    (userAgentFlagIndex !== -1 && i === userAgentFlagIndex + 1) ||
    (allowlistDomainsFlagIndex !== -1 && i === allowlistDomainsFlagIndex + 1) ||
    (baselineFlagIndex !== -1 && !baselineFlagGivenButInvalid && i === baselineFlagIndex + 1) ||
    (modifiersFlagIndex !== -1 && i === modifiersFlagIndex + 1) ||
    (frameFlagIndex !== -1 && i === frameFlagIndex + 1) ||
    (viewportFlagIndex !== -1 && i === viewportFlagIndex + 1) ||
    (stateFlagIndex !== -1 && i === stateFlagIndex + 1) ||
    (dialogFlagIndex !== -1 && i === dialogFlagIndex + 1) ||
    (dialogTextFlagIndex !== -1 && i === dialogTextFlagIndex + 1);
  const cleanArgs = args.filter((a, i) => !KNOWN_FLAGS.has(a) && !isConsumedValue(i));
  // Anything left that's still shaped like a flag (`--foo`) is almost certainly a typo'd or
  // misplaced flag, not literal positional data — see `unrecognizedFlags`'s doc comment.
  const unrecognizedFlags = cleanArgs.filter((a) => a.startsWith('--'));

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
    baselineFlagGivenButInvalid,
    settle,
    noText,
    idsOnly,
    scanListeners,
    modifiersFlag,
    frameFlag,
    viewportFlag,
    viewportFlagGivenButInvalid: viewportFlagIndex !== -1 && !viewportFlag,
    stateFlag,
    stateFlagGivenButInvalid,
    dialogFlag,
    dialogFlagGivenButInvalid,
    dialogTextFlag,
    unrecognizedFlags,
  };
}

/**
 * FR2-04: validates the `--dialog`/`--dialog-text` flags against the parsed args and the verb.
 * Returns the exact user-facing message (spec §2.6) or `undefined` when the combination is
 * valid. Kept here (rather than folded into `parseArgs` itself) because it needs the verb too,
 * which `parseArgs` doesn't otherwise care about.
 */
export function dialogFlagError(p: Pick<ParsedArgs, 'verb' | 'dialogFlag' | 'dialogFlagGivenButInvalid' | 'dialogTextFlag'>): string | undefined {
  if (p.dialogFlagGivenButInvalid) {
    return '--dialog must be one of: accept, dismiss, report (e.g. --dialog accept)';
  }
  if (p.dialogTextFlag !== undefined && p.dialogFlag !== 'accept') {
    return '--dialog-text only applies with --dialog accept (it is the text entered into prompt() dialogs)';
  }
  if (p.verb === 'dialog' && (p.dialogFlag !== undefined || p.dialogTextFlag !== undefined)) {
    return '--dialog sets the session\'s default policy; to handle the open dialog now use: sutradhar dialog accept [text] | sutradhar dialog dismiss';
  }
  return undefined;
}
