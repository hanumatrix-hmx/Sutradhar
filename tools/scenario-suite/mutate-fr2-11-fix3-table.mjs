// FR2-11 fix-3 mutants of the GLUE rule (loaded by mutate-fr2-11.mjs with --table=fix3; ids MG*). Each one drops ONE new rule, restores an
// old behaviour (the first-@-only strip, the whole-token scheme exemption), removes one delimiter class, the Cf class, or breaks one of the
// refinements (IPv6 host group, <dir> protection, the exemption span, the prefix before a marker). The unit specs
// (packages/browser/tests/unit/glue-rule.spec.ts first of all) must catch every one; the `live` ones are also run against the real tools
// (the GLUE case of verify-fr2-11-history.mjs). `find` strings must be unique in their file (the driver refuses ambiguous ones).
// MG9 (audit-3's N13: U+2028..U+202F dropped from the whitespace class) is an EQUIVALENT mutant under the new rule: the Cf class splits
// U+202A..U+202E anyway and JS `\s` still covers U+2028 / U+2029 / U+202F. MG9b removes BOTH layers and must be caught (A3-F4).
const BS = String.fromCharCode(92);
const B = 'packages/browser';
const AH = `${B}/src/session/action-history.ts`;
const BU = [B, ['tests/unit/glue-rule.spec.ts', 'tests/unit/char-rule.spec.ts', 'tests/unit/privacy-matrix.spec.ts', 'tests/unit/action-history.spec.ts']];
const LIVE_MCP = { pkg: B, surface: 'mcp', only: 'GLUE' };
// the mutated source is in the BROWSER package; the CLI process imports its dist, so that is what must be rebuilt
const LIVE_CLI = { pkg: B, surface: 'cli', only: 'GLUE' };
const DELIM_LINE = `const SUB_DELIM = /(${BS}${BS}*['"${'`'}]|[,()[${BS}]{}|^]|<(?!dir>)|(?<!<dir)>|${BS}p{Cf}+)/gu;`;
const withDelim = (body) => `const SUB_DELIM = /(${body})/gu;`;
const Q = `${BS}${BS}*['"${'`'}]`;
const BR = (set) => `[${set}]`;

const delimMutant = (id, what, body, live) => ({ id, what, file: AH, find: DELIM_LINE, replace: withDelim(body), unit: BU, ...(live ? { live } : {}) });

export const FIX3_MUTANTS = [
  delimMutant('MG1', 'no split on quotes / backtick', `${BR(`,()[${BS}]{}|^`)}|<(?!dir>)|(?<!<dir)>|${BS}p{Cf}+`, LIVE_MCP),
  delimMutant('MG2', 'no split on commas', `${Q}|${BR(`()[${BS}]{}|^`)}|<(?!dir>)|(?<!<dir)>|${BS}p{Cf}+`),
  delimMutant('MG3', 'no split on parentheses', `${Q}|${BR(`,[${BS}]{}|^`)}|<(?!dir>)|(?<!<dir)>|${BS}p{Cf}+`),
  delimMutant('MG4', 'no split on brackets', `${Q}|${BR('{}(),|^')}|<(?!dir>)|(?<!<dir)>|${BS}p{Cf}+`),
  delimMutant('MG5', 'no split on braces', `${Q}|${BR(`,()[${BS}]|^`)}|<(?!dir>)|(?<!<dir)>|${BS}p{Cf}+`),
  delimMutant('MG6', 'no split on angle brackets', `${Q}|${BR(`,()[${BS}]{}|^`)}|${BS}p{Cf}+`),
  delimMutant('MG7', 'no split on pipe and caret', `${Q}|${BR(`,()[${BS}]{}`)}|<(?!dir>)|(?<!<dir)>|${BS}p{Cf}+`),
  delimMutant('MG8', 'no split on Unicode format characters (Cf)', `${Q}|${BR(`,()[${BS}]{}|^`)}|<(?!dir>)|(?<!<dir)>`, LIVE_MCP),
  {
    id: 'MG9', what: 'audit-3 N13 alone: U+2028..U+202F removed from the whitespace class (EQUIVALENT under the Cf class: expected NOT caught)', file: AH,
    find: `${BS}u2000-${BS}u200f${BS}u2028-${BS}u202f${BS}u205f-${BS}u2064${BS}u3000${BS}ufeff]+)/;`,
    replace: `${BS}u2000-${BS}u200f${BS}u205f-${BS}u2064${BS}u3000${BS}ufeff]+)/;`, unit: BU, expectEquivalent: true,
  },
  {
    id: 'MG9b', what: 'audit-3 N13 + the Cf class removed (A3-F4: U+202A..U+202E re-join a URL and a path)', file: AH,
    find: `${BS}u2000-${BS}u200f${BS}u2028-${BS}u202f${BS}u205f-${BS}u2064${BS}u3000${BS}ufeff]+)/;`,
    replace: `${BS}u2000-${BS}u200f${BS}u205f-${BS}u2064${BS}u3000${BS}ufeff]+)/;`, unit: BU,
    extra: [{ find: DELIM_LINE, replace: withDelim(`${Q}|${BR(`,()[${BS}]{}|^`)}|<(?!dir>)|(?<!<dir)>`) }],
  },
  {
    id: 'MG10', what: 'first-@-only userinfo strip restored (a second URL keeps user:PASS@)', file: AH,
    find: "  const parts = t.split('@');", replace: "  const i0 = t.indexOf('@');\n  const parts = [t.slice(0, i0), t.slice(i0 + 1)];", unit: BU, live: LIVE_MCP,
  },
  {
    id: 'MG11', what: 'whole-token scheme:// exemption restored (anything glued after the first URL keeps the exemption)', file: AH,
    find: '  const parts = splitSubTokens(head);\n  parts[parts.length - 1] += suffix;', replace: '  const parts = schemeEnd(head) >= 0 ? [head] : splitSubTokens(head);\n  parts[parts.length - 1] += suffix;', unit: BU, live: LIVE_MCP,
  },
  {
    id: 'MG12', what: 'userinfo strip bounded at the sub-token start (the literal design: a password with delimiters leaks)', file: AH,
    find: 'p, i) => (i % 2 === 1 ? p : stripUserinfo(p))).join', replace: "p, i) => (i % 2 === 1 ? p : splitSubTokens(p).map((x, j) => (j % 2 === 1 ? x : stripUserinfo(x))).join(''))).join", unit: BU, live: LIVE_CLI,
  },
  {
    id: 'MG13', what: 'a backslash stops the userinfo strip (a JSON-escaped quote in a password leaks)', file: AH,
    find: "acc.slice(0, acc.lastIndexOf('/') + 1)", replace: `acc.slice(0, Math.max(acc.lastIndexOf('/'), acc.lastIndexOf('${BS}${BS}')) + 1)`, unit: BU,
  },
  {
    id: 'MG14', what: 'IPv6 host group rule dropped (brackets always split: http://[::1]:5000/p is over-redacted)', file: AH,
    find: 'if (hosts.some(([from, to]) => at >= from && at < to)) continue;', replace: 'void hosts;', unit: BU,
  },
  {
    id: 'MG15', what: 'IPv6 group charset widened to any bracket content', file: AH,
    find: `${BS}[[0-9A-Fa-f:.%]+${BS}]/g;`, replace: `${BS}[[^${BS}]]+${BS}]/g;`, unit: BU,
  },
  {
    id: 'MG16', what: 'IPv6 group no longer required to follow // or @', file: AH,
    find: `/(?<=${BS}/${BS}/|@)${BS}[`, replace: `/${BS}[`, unit: BU,
  },
  {
    id: 'MG17', what: '<dir> placeholder no longer protected from splitting (second pass changes the text)', file: AH,
    find: '|<(?!dir>)|(?<!<dir)>|', replace: '|<|>|', unit: BU,
  },
  {
    id: 'MG18', what: 'the scheme:// exemption never ends at a backslash', file: AH,
    find: 'for (let i = from; i < t.length; i++) if (t[i] ===', replace: 'for (let i = t.length; i < t.length; i++) if (t[i] ===', unit: BU,
  },
  {
    id: 'MG19', what: 'what is glued in front of data: / javascript: skips the rule', file: AH,
    find: 'const pre = opaque.index > 0 ? redactToken(tok.slice(0, opaque.index), selector, afterUrlish) : null;', replace: 'const pre = opaque.index > 0 ? { out: tok.slice(0, opaque.index), swallow: false } : null;', unit: BU,
  },
  {
    id: 'MG20', what: 'what is glued in front of file: / blob: skips the rule', file: AH,
    find: 'return reduceBeforeMarker(t.slice(0, file.index)) + FILE_URL_PREFIX', replace: 'return t.slice(0, file.index) + FILE_URL_PREFIX', unit: BU,
  },
  {
    id: 'MG21', what: 'eval preview collapses the BOM as whitespace (a password with U+FEFF is split before the rule)', file: AH,
    find: "code.replace(EVAL_WS, ' ')", replace: "code.replace(/\\s+/g, ' ')", unit: BU,
  },
  {
    id: 'MG22', what: 'userinfo pre-pass splits on Cf / zero-width like whitespace (a password with one leaks)', file: AH,
    find: 'decoded.split(TRUE_WS)', replace: 'decoded.split(WS_SPLIT)', unit: BU,
  },
  {
    id: 'MG23', what: 'a file: URL with an empty basename is no longer idempotent', file: AH,
    find: "|| /^[.…]+$/.test(base) ? '…'", replace: "? '…'", unit: BU,
  },
  {
    id: 'MG24', what: 'a JSON-escaped whitespace letter before a marker counts as a word (data: after a literal tab)', file: AH,
    find: `|(?<=${BS}${BS}[tnrfbv]))${'`'};`, replace: `)${'`'};`, unit: BU,
  },
  {
    id: 'MG25', what: 'the userinfo pre-pass over runs of real whitespace is removed (only the per-token strip is left)', file: AH,
    find: "const input = decoded.split(TRUE_WS).map((p, i) => (i % 2 === 1 ? p : stripUserinfo(p))).join('');", replace: 'const input = decoded;', unit: BU,
  },
];
