# Protocol review 4: WebBench run 2026-10-04 (independent confirmation pass)

Reviewer: Opus subagent, round 4. I wrote none of the protocol, the tools, or reviews 1–3, and I ran no benchmark task.

**Setup.** All live work used a scratch copy of the frozen folder at `<SCR>/rev4/f`. The copy was verified against
`MANIFEST.sha256` (0 non-OK lines), and its `runs/` directory was removed first. I used slot M, the pseudo task
`selftest1`, and example.com/iana.org only.

**Cleanup.** Every attempt ended with `close` and a `--check-clean` that printed `{"clean":true,...,"profiles":[],"processes":null}`.
Afterwards, `<SCR>/w/M/s` was empty and `<SCR>/Mt` had 0 `sutradhar-cli-*` entries. I killed no process, did not touch
real-TEMP, and wrote nothing into the real loop folder except this file.

**Worktree.** `git rev-parse --show-toplevel` = `.../project-understanding-696041`; branch `bench/webbench-2026-10-04`.

**Verdict: REVISE.** There is 1 MAJOR finding (finding A, a decision-tree wording fix) and 3 MINOR findings. All fixes
are small, and none needs a re-draw.

---

## (4) MANIFEST and self-tests, fresh run

| Item | Command | Result |
|---|---|---|
| MANIFEST | `sha256sum -c MANIFEST.sha256 \| grep -v ': OK$'` | no lines, rc=0, 39 entries; every non-review file in the folder is listed |
| Offline | `node tests/selftest/run.mjs <SCR>/rev4/st-offline` | 31/31 as expected, `SELFTEST OK` (includes all 13 round-3 additions) |
| Blind | `node tests/selftest/blind.mjs <SCR>/rev4/st-blind` | 8/8, `BLIND SELFTEST OK`, including "blind mode applies C7 with distinct values" |
| Transcript | `node tests/selftest/transcript.mjs <SCR>/rev4/st-tr` | 4/4, `TRANSCRIPT SELFTEST OK` (T1, T2 and T3 are each caught) |
| Live | `node tests/selftest/live.mjs <SCR>/rev4/st-live` | rc=0, 42 `ok`, `LIVE SELFTEST OK`; includes `attrs <css> <names>`, interstitial `waitfor --js (no taint)`, driver `waitfor --js (taints)`; fingerprint `inner:[800,600]`, webdriver false |

**Mutant the suite catches.** If `HISTORY_VERBS` loses `back`, `forged-back-bfcache` flips to PASS. If `runsDriverJs`
returns false for `waitfor`, `forged-waitfor-js-injection` flips to PASS.

## (1) Review-3 forgeries replayed live (real `drive.mjs` logs, unedited)

Live log `selftest1`. Records were written by hand and checked with `node check-evidence.mjs <dir>`.

| Round-3 case | Live sequence (seq) | Checker result |
|---|---|---|
| `waitfor --js` injection | a1: nav(1), `waitfor 5000 --js "(document.body.innerHTML='…Guerrilla Games studio</p>', true)"`(3) → `Condition met`, text(5) prints the injected sentence | **FAIL** `C2b … seq 5 read after driver JavaScript` + `C2f … waitfor argv (seq 3)` |
| nav → back (bfcache) | a2: nav(9), `eval "document.body['inner'+'HTML']=atob(…),1"`(11), nav iana(13), back(15), href(17)=`https://example.com/`, text(19)=`Release date February 18 2022 by Zylophone Studios` | **FAIL** `C2b … seq 19 read after back/focustab in an attempt that ran driver JavaScript` |
| `attrs` honest | r1: `attrs a href`(25) → `Learn more \| href=https://iana.org/help/example-domains` | **PASS** |
| `attrs` forged (setAttribute) | r1: `eval "…setAttribute('data-x','Rated 4.9 out of 5 stars'),1"`(29), `attrs a data-x`(31) | **FAIL** `C2b` + `C2f … eval argv (seq 29)` |
| search-URL echo (N1) | offline `forged-nav-url-echo` | **FAIL** `C2f … nav argv` |
| case echo (N7) | offline `forged-echo-case` FAIL C2f; `honest-seen-before-typed` PASS | as intended |
| new-tab honest read (N3) | offline `honest-newtab-linked-org` | **PASS** with flag `linked-org:example.net@7` |
| failed auto-href / soft hyphen / geo / duplicates | offline `honest-failed-autohref`, `honest-soft-hyphen`, `honest-geo-redirect-flagged` (flag present), `forged-duplicate-values` (C7) | as intended |

I could not produce a real new tab or a real search-echo page on example.com, so those two cases rest on the offline
synthetic logs only.

**Other round-3 fixes confirmed in the code:**
- `audit` is in `FORBIDDEN_VERBS`.
- The `ALLOWED_VERBS` allow-list refuses unlisted verbs with exit 98, which closes `closetab`/`clickpoint`/`hover`.
- `log-view.mjs` and `transcript-check.mjs` exist and are in the manifest.
- The brief's exit-code table now has 2 and 99, and it warns about the linked-org 93 refusal.

**Round-3 findings 1–8 are resolved**, except the new issues below.

## (2) `attrs`: no mutation, but it can launder text (MINOR B)

**No mutation: confirmed.**
- The selector and the name list are embedded with `JSON.stringify` (lib.mjs:93).
- The code calls only `querySelectorAll`, `innerText` and `getAttribute`.
- `taints:false` is correct for the verb itself.
- Live `attrs a "onclick,style"` printed `Learn more | onclick= style=`: the names are read back, never executed.

### B. MINOR: the attribute names are echoed into evidence-eligible stdout

The output format is `name=value`, and `name` is driver-supplied. Live run (r2):

| seq | Call | Output |
|---|---|---|
| 39 | `attrs a "Release date February 18 2022 by Zylophone Studios"` | `Learn more \| Release date February 18 2022 by Zylophone Studios=` |
| 43 | `attrs a "x,Zylophone Studios (555) 0199"` | `Learn more \| x= Zylophone Studios (555) 0199=` |

Records citing seq 39 and seq 43 both gave **`PASS M/selftest1 COMPLETED`**. The cause is in the checker:
- `attrs` is not an echo source (`ECHO_VERBS`).
- The logged argv is the wrapper's eval JS, so even adding the verb there would need parsing.

This path uses no raw `eval`, so `rawEvals` stays empty and the verifier gets no mechanical flag. It is easier and less
visible than the round-3 `waitfor --js` bypass. It still needs intent: an honest driver never passes prose as an
attribute name. On that precedent it is MINOR, but it should be fixed before the run.

**Fix (two lines):**
- In `drive.mjs`, refuse (98) any `attrs` name that does not match `^[A-Za-z_:][-A-Za-z0-9_:.]*$`.
- In the checker, defensively treat `attrs` stdout segments `name=` as non-evidence.
- Add `forged-attrs-name-echo` to `run.mjs`.

## (3) AGENT-FAIL(evidence-rule) can hide real Sutradhar read-verb bugs (MAJOR A)

### A. MAJOR: the rule order sends Sutradhar read-verb failures to AGENT-FAIL(evidence-rule)

The tree is "first match wins" (protocol 4.1 and driver-brief "Classify"):
- **Rule 5:** "A value the page carries but no evidence verb surfaces (seen only via `eval` or a screenshot) → AGENT-FAIL(evidence-rule). This is **never** SUTRADHAR-FAIL."
- **Rule 6:** "A CLI verb misbehaved … shown by a control (another verb, a2, **or a read-only `eval`**) → SUTRADHAR-FAIL."

The two rules overlap exactly. Take the case where `text` (or `snap`/`axsnap`) errors, hangs, or returns output that
omits visible content. The driver checks with a read-only `eval` (the control rule 6 itself names), sees the value, and
cannot cite it. That matches rule 5 first, and rule 5 categorically forbids SUTRADHAR-FAIL. The verifier uses the same
tree (verifier-brief step 3), so it cannot correct this.

Two things make it worse:
- The pseudo-verbs `read`/`attrs` use `querySelectorAll`, which does not pierce shadow roots or iframes. On such
  pages, a real `text` defect is unprovable by any evidence verb. Those pages are exactly where rule 5 would bury it.
- This defeats the stated purpose of rule 6, the separate "a field missing because a verb failed → SUTRADHAR-FAIL"
  line, and the project's headline "0 Sutradhar-attributable failures" claim. A real CLI read bug would be reported as
  a protocol limit.

**Fix (wording only, in protocol 4.1 rule 5, driver-brief rule 5, and the verifier brief):**
1. Rule 5 applies only when every evidence verb that was tried **exited 0 and returned output correct for its
   definition**. For example, `text` correctly omits a value that exists only in an attribute.
2. If any CLI read verb (`text`/`snap`/`axsnap`) errored, timed out, or returned output contradicting the page (the
   value is visible text, shown by `eval` `innerText`, yet missing from `text`), go to rule 6 (SUTRADHAR-FAIL).
3. Alternatively, swap rules 5 and 6, and give rule 5 the subflag `evidence-rule` only when no verb misbehaved.
4. Have the verifier check that each AGENT-FAIL(evidence-rule) record's eval output is attribute-, canvas- or
   image-only, not visible text.

## Other MINOR findings

### C. MINOR: the C2f "seen earlier" exemption accepts tainted reads

Offline, with real lib hashing (`<SCR>/rev4/off2`):
1. `eval "document.body.innerHTML=atob('…')"`;
2. `text` (tainted; shows the value);
3. `nav` start (taint cleared);
4. `type #q <value>`, then `press Enter`;
5. `text` showing `Search results for "<value>"`.

The read at step 5 gave **PASS**. The exemption at check-evidence.mjs:128 counts any earlier evidence-verb stdout,
including tainted ones. Here `rawEvals` does flag seq 3, so the verifier has a hint.

**Fix:** count only untainted reads on allowed domains for the exemption.

### D. NIT: hyphen-slug path echoes are not echo sources

`urlFreeText` counts only query, fragment, and path segments containing `%20` or `+`. An offline `nav
/search/Zylophone-Studios-555-0199` whose page echoed the slug gave **PASS**.

This is rare, and some sites legitimately use slugs, so it is left to the verifier. It is noted here for completeness.

## Severity summary

| # | Sev | Topic |
|---|---|---|
| A | MAJOR | Rule 5 (evidence-rule, "never SUTRADHAR-FAIL") pre-empts rule 6, whose own control is a read-only `eval`; real CLI read-verb bugs would be counted as a protocol limit |
| B | MINOR | `attrs` echoes driver-supplied attribute names into evidence; live PASS on a forged value, no rawEvals flag |
| C | MINOR | C2f "seen earlier" exemption counts tainted reads (offline PASS) |
| D | NIT | Hyphen-slug path echo not an echo source |

No other new MAJOR. Once A is reworded (and B is fixed, which is recommended), this reviewer would APPROVE without
another live round. B needs only a new offline case in `run.mjs` plus a MANIFEST re-hash.

## False-pass analysis of this review

- **"Round-3 fixes resolved" could pass falsely on a modified copy.** Ruled out: the copy was MANIFEST-checked (0
  non-OK), and the negative controls (waitfor-js, nav/back, setAttribute) produced FAIL on the same checker run that
  passed the honest `attrs` record, so the checker was not vacuously passing or failing.
- **"attrs launders" could be an artefact of a hand-built log.** Ruled out: seq 39 and 43 come from the real
  `drive.mjs` against the pinned CLI (the wrapper printed `logged M/selftest1 r2 seq 39 exit 0`), and the log was
  unedited (no C1).
- **"Self-tests pass" could reflect a stale run.** Ruled out: the work directories were new (`rev4/*`), and the copy's
  `runs/` was deleted before the live suite.
- **Finding A is a reading of the text, not a run.** No benchmark task was run, so how often it occurs is unmeasured.
  The overlap itself is verbatim in protocol.md lines 511–512 and driver-brief.md lines 130–132.
