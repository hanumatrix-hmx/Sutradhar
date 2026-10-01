# FR2-11 AUDIT-4 verdict: BLOCKED (final, extra user-authorised cycle)

Branch claude/fr2-11-action-history at 552f9dd (fix-3 = 549a099..552f9dd). Independent auditor. No source edited
(16 mutants applied and restored byte-identically, sha256 checked, dist rebuilt with turbo --force), nothing committed.
Machine-readable: `audit-findings.json`. My verdict was formed before reading `fix-3/deviations.md` and the FIX-3 section
of `run-1/false-pass-analysis.md`.

## Why BLOCKED
All six functional Done-when items pass again with fresh live evidence, and A3-F1 (glued tokens) is fixed on its own
shapes. But the privacy rule still stores credential material of a kind it claims to cover, on every surface:

- **A4-F1 (major, privacy, regression introduced by fix-3, undocumented).** The new userinfo pre-pass (fix-3 D2) runs over
  the whole whitespace-free run BEFORE rule (a)/(b). For every `@` it deletes everything back to the previous `/`,
  including the `?` `#` `;` `=` `&` that should cut the token, so the value text after the `@` survives:
  `https://h.test/p?pw=P%40ssS3CRET` -> `https://h.test/ssS3CRET` (fix-2 stored `https://h.test/p[redacted]`).
  Live on MCP tab and session views, SDK, CLI `history.jsonl`, `history`, `history --json`, dist and bundle
  (`priv4-live-head.json`, `priv4-live-bundle.json`, `sdk4.json`). The ordinary trigger is `navigate` to a URL with an `@`
  in the query: FR2-07's verification reason quotes the URL (`'navigate' verified: a new document committed at
  http://127.0.0.1:P/ssA4Cnavq2x`), and so do eval errors, `fetch` code, `click_by_text` text and the `wait_for` error's
  "current URL".
- **A4-F1b (major, same mechanism, pre-existing on fix-2, undocumented).** `PGPASSWORD=hunter@S3CRET` -> `S3CRET`; rule (b)
  never sees the `=`. Live: eval error and CLI `clicktext` args.
- **A4-F2 (major, privacy, pre-existing on fix-2, undocumented, missed by audits 1-3).** `redactHistoryUrl` decodes
  `%3F`/`%23` BEFORE `new URL()`. A valid URL whose password contains an encoded `?` or `#` then fails to parse, the fallback
  cuts at that character before any userinfo strip, and `scheme://user:passwordPrefix` is stored. Live:
  `navigate http://A4Uuser1x:A4Upwpre1x%3Frest1@127.0.0.1:P/p` stores `http://A4Uuser1x:A4Upwpre1x` as `target` and `url`,
  and in the `url` of every later action on that tab. CLI `nav`/`newtab` args and actions behave the same way
  (`f2live-head.json`).
- A4-F3 (minor, docs): `--help` and the tool description give the order cut, then `=`/`&`, then userinfo, but the code
  strips userinfo first. They list only 4 decoded forms. "Origin + path only" is contradicted by A4-F2.
- A4-F4 (minor, tests, false pass): every suite is green and every mutant is caught, yet no cell or generator (unit
  property tests, the builder's 1M-string fuzz, audit-1/2/3 generators) combines an `@` with a cut or `=` character in one
  value, or puts an encoded `?`/`#` in a structured-URL password. Mutant M8 (pre-pass removed) drops my generator's
  leaking CLAIM cells from 666 to 366, but it is "caught" only because cells pin the pre-pass.
- A4-F5 (info): a literal `<dir>` in input glues a URL to a local path, the same way the GAP-372 connectors do (path only).
- A4-F6 / A4-F7 (info): the master tree has 4 overlaid spec files, not 3. taskkill latency is noted under Functional.

Attribution (`attribution-fix2-vs-head.txt`, same inputs through the 78087d7 and 552f9dd rule): A4-F1 rule (a) is new in
fix-3. A4-F1b and A4-F2 also leak on fix-2.

**Root-cause hypothesis.** The rule is a pipeline of destructive passes, and their order lets one pass erase the evidence
the next one needs:
- decoding before parsing causes A4-F2 and GAP-373's `%2F` case;
- stripping userinfo before the cut causes A4-F1 and A4-F1b.

Each cycle reordered or widened a pass to close the last shape found. Every generator puts one construct in each string,
so interactions between passes are never exercised. **The spec (R1) is right, the implementation is wrong, and the tests
share the blind spot.**

Revised plan:
1. Structured fields: parse the RAW string with WHATWG `URL` first and emit origin + pathname. Decode and apply the text
   rule only to that output. If parsing fails and an `@` follows `//`, emit `[redacted]`.
2. Free text: when the span the userinfo strip would remove contains a decoded `? # ; = &`, treat it as a cut at the span
   start instead of deleting those characters.
3. Tests: add a pairwise-interaction property test, plus a differential oracle that nothing following a cut character in
   the decoded input may appear in the output.

## Privacy attack matrix
Generator `gen4.mjs`: my own seed 0x4D17A4F5 and my own structure (xoshiro128**, a recipe grammar of credential shape,
placement, glue, escape layer and wrapper, two-half secrets). It produced 3,400 cells and ran each through 10 surfaces of
the built dist: text, selector, every entry field, navigate/eval/wait_for/upload targets, 17 CLI verbs, `buildHistoryLine`
and `formatHistoryHuman`.
- **CLAIM: 666 of 2,668 cells leak.** 389 are A4-F1, 166 A4-F1b and 98 A4-F2 (structured-URL fields only). The other 13
  are artefacts: percent-encoded fullwidth or escape forms that no parser reads as a delimiter. 0 idempotency failures.
- Credentials glued with every delimiter (quotes, brackets, `|`, `^`, comma, Cf, `\"`) and every escape layer: stripped.
- IPv6:
  - `//[::1]:S@h`, `@[dead]C:/Users/N/..`, `['https://[::1]/a','https://u:S@[::2]/b']` and a zone id all stay clean.
  - A non-hex `//[x:S]` and a secret host `https://[dead:beef]@S/x` are kept. Both are the host / no-rule-character limit.
- `<dir>`: all CLAIM shapes stay clean and idempotent; `&lt;dir&gt;` text gives `[redacted]` (it contains `&`).
- **GAP-372: ACCEPTABLE.** Credentials are stripped through all 12 URL-legal connectors and queries are cut. Only a local
  path or user name glued after a URL is stored (path/origin, no credential).
- **GAP-373:** it leaks the user name and the password prefix. Raw space or raw `/` is acceptable as documented (not a
  valid userinfo). The `%2F` case (the correct encoding) is a credential leak created by decode-first. It is documented, so
  it is not a blocking basis on its own, but "minor" understates it. Fix it with A4-F2.
- Earlier probes re-run UNMODIFIED from byte-identical copies (`sha-rerun-originals.txt`) under a junction tree, results in
  `rerun/`:
  - audit-2 `attack-gen`: 375 cells, 0 leaks.
  - audit-3 `attack3`: 7 of 642 CLAIM, exactly the 7 accepted residuals.
  - `glue-unit`, `glue-live` (dist and bundle) and `glue-sdk`: clean.
  - audit-1/2 MCP, CLI, SDK, paren, `type_by_label` and live-attack (dist and bundle): `unexpected []`.
  - `live3` and `sdk3`: only the documented eval-code literal.
  - Builder fuzz (`fuzz-fr2-11-fix3.mjs`, dist, 100k strings): 0 leaks. It shares the blind spot.
- Fields the rule might skip: entry keys are exactly the documented set. Title, frame name, dialog message and console text
  never reach history (`func4-head.json`). Caller results are not redacted (ruling stands).
- Over-redaction: origin and pathname stay readable (`https://h.test/app/settings`, `http://[::1]:8080/api/v1/items`).
  Readability and idempotency checks (`idem4.json`) are all idempotent; xpath and `@`-attribute selectors are over-redacted
  (same on fix-2).

## Functional re-check (fresh, live; all PASS)
- navigate, eval and click are recorded, and the tab view is the default.
- The session view merges tabs with contiguous `seq`, keeps a closed tab's entries, and rejects scope+tabId, a closed tab,
  a bad scope and an unknown session.
- Verification deep-equals the sanitized result (navigate and click).
- Eviction, tab view: 199 -> 199/0, 200 -> 200/0, 201 -> 200/1, 205 -> 200/5. Session view: 1, 2 and 6 evicted, with
  first seq = evicted + 1.
- CLI basics: `history.jsonl` sits beside `state.json`, and `history --json` is byte-identical to it. With no file:
  exit 0 and no `state.json`. `--bogus` exits 1. A torn line is skipped with a Note.
- Close and self-heal: `close` keeps the file and `history` then shows no `(current)`; the next command self-heals into a
  new session id. Deleting `state.json` and a dead `wsEndpoint` are both handled (`miss4.json`).
- Parallel appenders: 14 processes, 6 of them over the 64 KiB guard, gave 14 valid lines.
- Kills: 80 real `taskkill /F /PID` on CLI PIDs I started, 21 of them on a live process; 0 torn lines.

## Build, tests, mutants
- Build: dist deleted and turbo `--force --concurrency=1` run twice (before and after the mutants), 0 cached. The bundle has
  the new rule and the fix-2 authority split is gone.
- typecheck: 34/34.
- vitest: browser 1101, capability-runtime 272, mcp-server 124, cli 276, sutradhar 43, agent 56, server 28. All pass.
- Specs: fix-3 changed pre-existing specs append-only, and the master specs are append-only too.
- Mutants: 16 of my own (`mut4.mjs`, `mutants4-summary.json`), all caught by unit tests: Cf split, quote/comma split,
  first-@ only, strip stops at quote/comma/backslash, whole-token exemption, IPv6 group anywhere, `<dir>` unprotected,
  pre-pass removed, decode removed, entry.error skipped, tab-view raw entry, CLI line error raw, human output raw args,
  wait_for skipped, URL fields skip the text rule, and backslash not a separator.

## Master comparison (concurrent A/B, same load; master tree verified)
- FR2-08: 478/478 on both.
- FR2-07: 488/488 on both. The GAP-325 tolerance fired 0 times on both (mcp and bundle), and H2 passed.
- FR2-04: 110/1/2 on both (L13 headed fails on both).
- CLI suite: HEAD 11/14 vs master 12/14. The extra HEAD failure is UC-03, which passed 2/2 on both builds in a sequential
  A/B (a contention flake). UC-05 and UC-12 fail on both; UC-04 and UC-08 passed on both.
- Recording overhead: MCP eval +0.07 ms, click +0.52 ms, `get_action_history` +0.79 ms; CLI +1 ms median.
- **No regression.**

## Not verified
- Headed mode, non-Chrome browsers, and POSIX 0600 outside WSL.
- A real OAuth custom-scheme redirect.
- No download or lock containment harness was run.

## Side effects, all undone
- The CLI suite rewrote `uc06-modal-after-clicktext.png`; I restored it from the HEAD blob (hash equal).
- One orphan Chrome from my crashed probe run (PID 86760) was killed by PID and logged.
- 56 `sutradhar-cli-*` dirs that my runs created were deleted (`cli-dirs-deleted.txt`). The pre-existing dir in use by
  Chrome 71888 was kept.
- Disk: 18G free before and after. git status shows only this directory.
