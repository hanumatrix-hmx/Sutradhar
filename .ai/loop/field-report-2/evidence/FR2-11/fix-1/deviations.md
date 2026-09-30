# FR2-11 fix-1: deviations and decisions (stated plainly)

Cycle: audit-1 REOPEN (privacy F1-F3 major, F4-F6 minor). Scope: only the findings. Branch `claude/fr2-11-action-history`, base `785dc53`.

## Deviations from the brief or from earlier contracts

1. **F6 is documented, not changed (brief: "record it ... unless the spec says otherwise").** A selector rejected before dispatch (Playwright
   syntax, `text=Go`) is thrown by `normalizeTarget` BEFORE any tab is resolved. Two earlier contracts pin that: FR2-06 R2
   (`packages/capability-runtime/tests/unit/runtime.spec.ts`: "touches neither resolveTab nor the action engine") and FR2-11 spec N4 ("rejections before a
   tab is resolved are not actions"). Recording it needs a `resolveTab` call in 13 methods and changes FR2-06 R2. I implemented it first, watched R2
   fail (`resolveTab` called 14 times), reverted it (`git show HEAD:... > file`, tree clean for that file) and pinned the current behaviour with a unit test
   (`F6 / N17`). Engine-level rejections (invalid CSS such as `#a[`) stay recorded. Logged as GAP-356, reversible by one helper if the owner prefers
   recording over the FR2-06 pin.
2. **F7 (`handle_dialog`) is documented, not recorded.** The spec's recorded set is the `runAction` methods plus the listed bypass methods; the brief
   allowed either ("decide from the spec"). GAP-357 (extends GAP-341). The CLI `dialog` verb IS recorded (prompt text as a length).
3. **`expect.text`, `--expect-text`, `waitfor` text are stored, not removed or length-only.** The brief says to "list what is NOT recorded, or recorded only as
   a length: expect.text, --expect-text, waitfor text, and typed or selected values". Read literally that asks for them to be removed; I read it as
   "make the docs say which they are". They are part of the FR2-07/FR2-08 verification evidence (`expected` / `observed` / `detail`) that AC5 requires to
   equal the action's own `verification`, and of the `wait_for` action's `selector`. Removing them would gut the evidence and break AC5. So the docs now say
   plainly: STORED (capped at 200 / 300, redacted by the URL and path rule, not masked); `--expect-text` / `--text` FLAGS are not in the CLI line's `args`
   (flags are not recorded) but the text reaches the `actions[]` of that line through the verification evidence; typed and `select` values are lengths only.
   If the owner wants these length-only, it is one change in `sanitizeVerification` plus a scoped AC5 exception: say so and it will be done.
4. **`file:` URLs are stored as `file://…/<basename>`** in history (`redactHistoryUrl`), a deliberate departure from FR2-09 D5's `file://<full pathname>`
   (still used for frame labels, which this code does not touch). Needed for F3; the existing H2 unit expectation was updated.
5. **`cwd` is still a full local path** in every CLI line (a field of the spec'd line format; GAP-359). The brief says "history must not store full local paths";
   `cwd` is the one remaining and is documented rather than hashed, because `sutradhar history` shows it to the user who ran the command.
6. **A cut URL in free text now ends in `[redacted]`** (the old code silently shortened it). Existing exact-string unit expectations (eval preview, evidence
   observed / expected, the CLI `error` cap test) were updated to the new strings; none of them asserted a secret.
7. **Text after a cut is dropped up to the next URL or path** (fail-closed for URLs typed with literal spaces). It costs readability (GAP-353) and is the
   most visible behaviour change. The brief's own rule says "cut ... to the end of that token"; the extra drop is mine, because the matrix cell
   `query-space` (`?q=a b&token=X`) leaks `b&token=X` without it. Mutant MF9 proves the test sees it.
8. **`download` / `audit` directory arguments are stored as `<dir>`, not a basename** (the brief: "store only the file's basename; if the spec requires a length or
   kind, store that instead"): a directory name is not needed for the history and is usually per-user. File arguments stay a basename.
9. **Existing FR2-11 tests edited** (mine, from run-1): `redactHistoryUrl` H2 (file:), H3 (data: tail), H5 / H6 / evidence strings (`[redacted]`),
   the runtime eval-preview test, the CLI `error` cap test, the MCP description test (`query/fragment dropped` -> the exact rule). No test under
   `tests/adversarial/` and none of the auditor's probes was touched (the copies under `audit-probes-rerun-fix-1/` are byte-identical, sha256 in
   `sha-original.txt` / `sha-copy.txt`).
10. **A live harness fix, not a product fix:** the first live PM runs failed on two harness mistakes of mine (a duplicate-guard rejection masking the
    missing-path upload; a canary placed in the BASENAME of the download dir, which is stored by design). Both fixed in the script; the first run is kept
    in `superseded-runs/live-1*`.
11. **Mutant definitions:** the first live mutation run reported three "not caught" that were mutant-definition or coverage bugs (MF4 and MF14 did not
    compile; MF5 was not reachable from the live CLI cases). MF4 / MF14 definitions were fixed; MF5 exposed a real coverage gap (the live CLI case never sent a
    plain positional arg through the generic rule), closed by the `focustab <text>` pass. First runs kept in `superseded-runs/mutants-*-first`.
12. **A second, independent re-think widened the rule beyond the audit's examples** (the FR2-07 lesson: enumerating shapes fails): query strings with no
    URL around them (`/p?token=X`, `intranet/app?t=X`), form bodies (`a=1&token=X`), fully percent-encoded URLs, and a query on a local path are now covered
    and were added to the matrix BEFORE the code (the new cells failed 14 tests first: `before-change/browser-matrix-newshapes-before.json`).

## Not verified / limits
- Headed mode, non-Chrome, POSIX mode 0600 outside WSL (unchanged from run-1).
- The live CLI matrix is a rotating 80-cell subset (GAP-361); the 1,600-cell cross product is unit-level for the CLI and live for MCP / SDK / bundle.
- No real-world corpus of browser error messages was available beyond what the live runs produced; the rule's over-redaction (GAP-353 / GAP-354) was judged on
  the engine's own messages and puppeteer's `net::ERR_*` format, not on a broad sample.
