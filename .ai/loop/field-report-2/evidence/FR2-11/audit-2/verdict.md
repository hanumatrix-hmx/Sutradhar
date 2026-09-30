# FR2-11 AUDIT-2 verdict: REOPEN (second failed audit; next step is a root-cause re-derivation, not another shape patch)

Branch claude/fr2-11-action-history at 4604e3a (fix-1 = 785dc53..4604e3a). Independent auditor. No source edited
(mutants restored byte-identically), nothing committed. Machine-readable: audit-findings.json. Probes, logs and raw
outputs are in this directory. Regression logs are in regress/; bulky evidence dirs were kept on C: because E: was full.

## Why REOPEN
All six Done-when items pass again with fresh evidence. Privacy (spec R1 / section 0.7: FR2-09 D5 redaction on EVERY URL-bearing
string, verification text included) still fails on real production paths:

- **A2-F1 (major).** URLs whose scheme has no `//` keep their fragment or query in free text.
  - `browser.navigate com.example.app:/cb#access_token=S` stores Puppeteer's `net::ERR_ABORTED at com.example.app:/cb#access_token=S` in `entry.error`.
    - This is the RFC 8252 private-use redirect form.
    - `target` is correctly `com.example.app:/cb`.
    - The same leak appears on MCP (tab and session), SDK, bundle, CLI `history.jsonl` (`error` and `actions[].error`) and the `sutradhar history` output.
  - `navigate about:blank#S` stores `...committed at about:blank#S` in `verification.reason` and `evidence.detail`.
  - Multi-parameter fragments (`&token_type=`) and `?code=` are cut. A single-parameter fragment or a no-`=` tail is not.
- **A2-F2 (minor, F4 recurrence).** The tool description, changelog and README claim more than the code does.
  - The claim "fragments are cut", "any URL-looking token", "host[:port]/", "a URL typed with literal spaces cannot leak its tail" and "UNC -> basename" is contradicted by:
    - `intranet:8080/p#S` (live: eval code and eval error);
    - `https://x.test/my dir#S`;
    - `?q=ab S&next=https://y/`, which keeps `S&next=`;
    - `//server/share/S/f`.
- **A2-F3 (minor).** 3 of my 11 mutants survive the 1,600-cell matrix: B2 (bare `?=`), B3 (localhost alternative removed) and B4 (IPv6 alternative removed). Every such cell also carries a `?k=` that QUERY_LIKE catches, so the host alternatives are never tested alone.

Root-cause hypothesis: the text rule is marker-ENUMERATED, not fail-closed. Any URL-bearing token outside the list (a scheme with no `//`,
a single-label host:port, a URL with a literal space) keeps its tail. The implementation is wrong; the spec is clear. The tests
share the blind spot because every generated cell also contains a marker that is caught anyway.

## Privacy attack matrix (my generator, attack-gen.mjs; shapes not in the builder's matrix)
375 cells (75 shapes x 5 contexts) through text, entry fields, navigate target, 8 CLI verbs and buildHistoryLine: 104 cells leak (26 shapes).

- **Clean:** IDN and punycode hosts, upper- and mixed-case schemes, javascript:, mailto:, chrome://, ws/wss, `redirect=https://`, a word character
  before the scheme, nested and single-encoded URLs, `http:` + backslash URLs, newline / NBSP / zero-width space, JSON-escaped quotes and slashes,
  scheme-less IPv6, fullwidth parentheses, `;jsessionid`, userinfo variants, absolute Windows and POSIX paths, long and device paths, quoted paths
  with spaces.
- **Leak (LIVE):** `about:blank#S`, custom-scheme `#access_token=S`, `intranet:8080/p#S`.
- **Leak (unit only):** a scheme-less Cyrillic host with `#` or `?S`, a space in the path, a space in the query, a tab before `#`, a form body with a
  space, and a double-encoded URL.
- **By rule (relative paths, documented):** `..`, `./`, `C:x`, `%USERPROFILE%`, `$HOME`; tilde + backslash; `path:/home/S`; single-slash `file:/`
  in text; `//server/share`; and a bare `C:/Users/<name>`, which becomes its basename (the username).
- **Audit-1 probes rerun unmodified** (MCP head and bundle, CLI head and bundle, SDK, paren, type_by_label): no unexpected canaries.

## Rulings
- **expect.text / --expect-text / waitfor text stored: ACCEPTABLE.** This is verification evidence, not an FR2-07 D11 field value or clipboard
  contents. It is scrubbed to `<value>` when it equals the typed value (verified live), and it is documented. Residual risk: an OTP or account
  number used as `--expect-text` is written to `history.jsonl`. A length-only option is recommended but not required.
- **cwd: ACCEPTABLE AS DOCUMENTED (GAP-359).** It is a spec'd field, `state.json` beside it already holds it, and the directory is user-only.
  But it outlives `close` and makes basename redaction moot for the username. Home-relative storage is recommended.
- **F6 (pre-dispatch Playwright rejection) and handle_dialog not recorded: NOT Done-when violations.** They are consistent with spec N4, FR2-06 R2
  and spec section 0.2, and documented as GAP-356 and GAP-357.

## Functional re-check (fresh)
- **Completeness:** exactly-once recording; seq contiguous; the settle, drag and duplicate-guard variants are each recorded once.
- **AC5:** history.verification is deep-equal to `sanitizeHistoryEntry(result).verification` for 10/10 actions, and deep-equal to the raw result for 9/10. The one exception is the documented typed-value scrub.
- **Eviction:** exact (1 and 6, notes correct). audit-1's exact-target check now fails because the eval preview `2+0 /*t1*/` is stored as `2+0 *t1*`: an over-redaction (A2-F4, info), not a count error.
- **Concurrency:** 10 parallel appenders across a rotation: 0 skipped. 40 real kills: 0 torn lines, and the file ends with a newline.

## Build and tests
- Forced full rebuild (dist deleted, turbo `--force`, both stages; the bundle contains `redactHistoryText`).
- typecheck 34/34.
- vitest: browser 989, runtime 272, mcp 124, cli 259, sutradhar 43, agent 56, server 28, all pass.
- Pre-existing spec files were only appended to, relative to master. The fix-1 edits to run-1 FR2-11 tests changed only expected placeholder strings; no canary assertion was removed (negative-assertion counts are equal or higher in every file).

## Mutants (mine, mutants.mjs)
11 total: 8 killed, 3 survived.
- **Killed:** B1 (first `@`; killed only incidentally, by the idempotency test), B5, B6, B7, B13, and the CLI mutants B8 (dialog prompt), B9 (download dir), B10 (nav URL).
- **Survived:** B2, B3, B4 (A2-F3).
- Sources restored with a sha256 check, then rebuilt.

## Master comparison (concurrent A/B)
- **Master tree:** verified against the fdae749 blobs. Only 4 content diffs: 3 specs and 1 png. Master dist equals a fresh tsc of master src.
- **FR2-08:** 478/478 on both.
- **FR2-07:** 488/488 on HEAD vs 487/488 on master (master bundle:H2 is the GAP-330 flake). GAP-325 tolerated: none on either.
- **FR2-04:** 110/1/2 on HEAD vs 109/2/2 on master. L13 headed click fails on both.
- **CLI suite:** 10/14 on HEAD vs 11/14 on master concurrently. The HEAD UC-03 failure was a Chrome-start timeout under contention.
  - Sequential A/B: UC-03 passes 2/2 on both.
  - UC-08 passes 2/2 on HEAD and 1/2 on master: a known intermittent.
  - No regression.

## Not verified
- Headed mode and non-Chrome browsers.
- POSIX 0600 outside WSL.
- A real OAuth provider redirect to a custom scheme (simulated instead).
- The builder's verify-fr2-11 script was not rerun.
- E: reached 0 MB free (other tenants) during one probe. It was rerun after space recovered.

## Side effects, all undone
- The CLI suite rewrote `results/uc06-modal-after-clicktext.png`. It was restored from the HEAD blob; git status is clean apart from audit-2/.
- The master results dir is unchanged.
- The PIDs I started are in pids.log and regress/pids.log; none are alive.
